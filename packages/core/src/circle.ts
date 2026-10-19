// Circle pooled picks: the post-aggregation policy layer.
//
// IMPORTANT: this module takes per-member endorsement sets as plain input. A real
// deployment must never hand any member (or any server) the other members' raw sets.
// Inputs have to be combined by secure aggregation (Bonawitz et al., CCS 2017; DESIGN
// A12) inside the MLS group, so the only thing anyone learns is the aggregate count
// per item, and ideally the noise is added inside the aggregation too. This module
// is the policy applied to that aggregate: the member floor, the reveal threshold and
// discrete DP noise. Simulations call it directly with raw sets. See DESIGN.md,
// "Circles", and THREAT_MODEL.md, T3.
//
// Output is picks only, never counts. Noise is sticky within an epoch, and an
// epoch's output is frozen once released (`releaseCircleEpoch`), so neither
// averaging repeated releases nor differencing around a membership change works.
//
// The noise is a two-sided geometric (discrete Laplace) sample, which avoids the
// floating-point attacks on continuous Laplace (Mironov, CCS 2012). For production,
// prefer OpenDP's audited samplers.

import type { Candidate, Rng, Video } from "./types.ts";
import { keyedRng, sha256 } from "./rng.ts";
import { fail, has, number, plainObject } from "./validate.ts";

/** Circle reveal policy (wire format: docs/PROTOCOL.md, "Circle policy"). */
export interface CirclePolicy {
  v: 1;
  /** Fewer present members than this → no output for the round. Never below 8. */
  minMembers: number;
  /**
   * A pick is shown only if its noised count reaches this. Optional: when absent it
   * is derived from the present member count with `revealThresholdFor` (3 for 8–15
   * members, 4 for 16 and up), per docs/SIMULATION_RESULTS.md, Exp 3.
   */
  revealThreshold?: number;
  /** Per-item, per-epoch privacy parameter of the discrete Laplace noise. Recommended 1. */
  epsilon: number;
  /**
   * Each member contributes at most this many items per round. A member's total
   * privacy loss per round is at most `epsilon × maxItemsPerMember` (basic composition).
   */
  maxItemsPerMember: number;
}

/** Hard floor on circle size (THREAT_MODEL.md, T3). */
export const CIRCLE_MIN_MEMBERS = 8;

/**
 * Recommended circle size. k = 8 is the hard floor; Exp 3 found k = 12–30 keeps
 * 86–100% recall of true group picks at ε = 1 with no ≥90%-confidence inference.
 */
export const CIRCLE_RECOMMENDED_SIZE = { min: 12, max: 30 } as const;

/**
 * Ranker strength given to every circle pick (`circleCandidates`). Picks carry no
 * count (counts leak, Exp 3), so all picks of a circle are equally strong.
 */
export const CIRCLE_PICK_STRENGTH = 0.5;

/**
 * Reveal threshold for a round with `members` present members: 3 for k = 8–15 and
 * 4 for k ≥ 16 (Exp 3 tested up to 30; larger circles use 4 too).
 */
export function revealThresholdFor(members: number): number {
  return members <= 15 ? 3 : 4;
}

/** The default policy: k ≥ 8, ε = 1 per item per epoch, threshold derived from k. */
export const DEFAULT_CIRCLE_POLICY: CirclePolicy = {
  v: 1,
  minMembers: CIRCLE_MIN_MEMBERS,
  epsilon: 1,
  maxItemsPerMember: 64,
};

/** Validate an untrusted circle policy (e.g. proposed by a circle admin). */
export function parseCirclePolicy(json: unknown): CirclePolicy {
  const keys = ["v", "minMembers", "revealThreshold", "epsilon", "maxItemsPerMember"] as const;
  const o = plainObject(json, "circlePolicy", keys, ["v", "minMembers", "epsilon", "maxItemsPerMember"]);
  if (o.v !== 1) fail("circlePolicy.v", "must be 1");
  const minMembers = number(o.minMembers, "circlePolicy.minMembers", CIRCLE_MIN_MEMBERS, 10_000, true);
  const policy: CirclePolicy = {
    v: 1,
    minMembers,
    epsilon: number(o.epsilon, "circlePolicy.epsilon", 0.01, 5),
    maxItemsPerMember: number(o.maxItemsPerMember, "circlePolicy.maxItemsPerMember", 1, 256, true),
  };
  // `undefined` counts as absent, so `{...DEFAULT_CIRCLE_POLICY}` style objects parse.
  if (has(o, "revealThreshold") && o.revealThreshold !== undefined) {
    policy.revealThreshold = number(o.revealThreshold, "circlePolicy.revealThreshold", 2, minMembers, true);
  }
  return policy;
}

/**
 * Sample from the two-sided geometric distribution with P(k) ∝ exp(-epsilon·|k|),
 * as the difference of two geometric samples.
 */
export function discreteLaplace(epsilon: number, rng: Rng): number {
  if (!(epsilon > 0)) throw new RangeError("epsilon must be positive");
  const geometric = () => {
    // Failures before first success with p = 1 - e^-ε; 1 - rng() is in (0, 1].
    return Math.floor(Math.log(1 - rng()) / -epsilon);
  };
  return geometric() - geometric();
}

export interface CirclePick {
  videoId: string;
  /**
   * @deprecated Never populated. Showing counts, even noised ones, lets members
   * difference two releases and expose up to 94% of a member's endorsements
   * (docs/SIMULATION_RESULTS.md, Exp 3). Circle output is picks only.
   */
  noisedCount?: number;
}

export type CircleResult =
  | { ok: true; members: number; picks: CirclePick[] }
  | { ok: false; members: number; reason: "too-few-members" };

export interface CirclePicksOptions {
  /**
   * Secret per-epoch seed for sticky noise: each item's noise is derived from
   * (noiseSeed, videoId), so recomputing within an epoch gives the same draw and
   * repeated releases can't be averaged. The seed must stay inside the secure
   * aggregation; a member who knows it can subtract the noise. Without it, noise
   * comes fresh from `rng`.
   */
  noiseSeed?: string;
  /** Ids never evaluated in this round, e.g. items already released in an earlier epoch. */
  exclude?: ReadonlySet<string>;
}

/**
 * Apply the circle policy to one round. `memberSets` has one entry per member of
 * the round's fixed membership; `null` marks a member who dropped out (they count
 * as absent). Output: the ids whose noised count reaches the threshold, sorted by
 * id. Counts are never output, and the order carries no count information.
 *
 * Prefer `releaseCircleEpoch`, which adds sticky noise and the epoch freeze.
 */
export function circlePicks(
  memberSets: ReadonlyArray<Iterable<string> | null | undefined>,
  policy: CirclePolicy,
  rng: Rng,
  opts: CirclePicksOptions = {},
): CircleResult {
  const p = parseCirclePolicy(policy);
  const present = memberSets.filter((s): s is Iterable<string> => s != null);
  if (present.length < p.minMembers) return { ok: false, members: present.length, reason: "too-few-members" };
  const threshold = p.revealThreshold ?? revealThresholdFor(present.length);

  const counts = new Map<string, number>();
  for (const set of present) {
    const mine = [...new Set(set)].filter((id) => !opts.exclude?.has(id)).slice(0, p.maxItemsPerMember);
    for (const id of mine) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const picks: CirclePick[] = [];
  // Sample in a fixed order so results depend only on the rng seed.
  for (const id of [...counts.keys()].sort()) {
    const noise = discreteLaplace(p.epsilon, opts.noiseSeed !== undefined ? keyedRng(opts.noiseSeed, id) : rng);
    if (counts.get(id)! + noise >= threshold) picks.push({ videoId: id });
  }
  return { ok: true, members: present.length, picks };
}

/** One released epoch. Stored by every member's device; never recomputed. */
export interface CircleEpochRecord {
  epoch: number;
  /** SHA-256 (hex) of the sorted member ids. */
  membership: string;
  result: CircleResult;
}

/** Per-circle release history, oldest first. */
export interface CircleLedger {
  epochs: CircleEpochRecord[];
}

export interface CircleEpochInput {
  /** The MLS epoch this round binds to (integer ≥ 0, increasing). */
  epoch: number;
  /** Member ids of the epoch's fixed membership. */
  members: readonly string[];
  /** Secret per-epoch noise seed (see `CirclePicksOptions.noiseSeed`). */
  noiseSeed: string;
  /**
   * Member id → that member's endorsements made **during this epoch** (the new epoch
   * pools only new endorsements). Missing or `null` = absent. Non-members are ignored.
   */
  contributions: ReadonlyMap<string, Iterable<string> | null | undefined>;
}

export type CircleEpochOutcome =
  | {
      ok: true;
      result: CircleResult;
      ledger: CircleLedger;
      /** True when this is an earlier release of the same epoch, returned unchanged. */
      frozen: boolean;
    }
  | { ok: false; reason: "stale-epoch" };

export function emptyCircleLedger(): CircleLedger {
  return { epochs: [] };
}

/** Fingerprint of a membership: SHA-256 hex of the sorted, de-duplicated ids. */
export function circleMembershipId(members: readonly string[]): string {
  const ids = [...new Set(members)].sort().join("\n");
  return [...sha256(new TextEncoder().encode(ids))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Release one circle epoch with sticky noise and the epoch freeze
 * (docs/SIMULATION_RESULTS.md, Exp 3):
 *
 * - An epoch is computed at most once. Asking again (with any membership, any
 *   contributions) returns the stored result with `frozen: true`. A past epoch is
 *   never recomputed with a different membership.
 * - An epoch older than the newest released one is refused (`stale-epoch`).
 * - Items released in earlier epochs are not evaluated again.
 * - Noise is sticky: derived from (noiseSeed, videoId), one draw per item per epoch.
 *
 * Together these make membership-change differencing and averaging reduce to a
 * single release.
 */
export function releaseCircleEpoch(
  ledger: CircleLedger,
  input: CircleEpochInput,
  policy: CirclePolicy = DEFAULT_CIRCLE_POLICY,
): CircleEpochOutcome {
  if (!Number.isInteger(input.epoch) || input.epoch < 0) throw new RangeError("epoch must be a non-negative integer");
  const existing = ledger.epochs.find((r) => r.epoch === input.epoch);
  if (existing) return { ok: true, result: existing.result, ledger, frozen: true };
  const newest = ledger.epochs.reduce((m, r) => Math.max(m, r.epoch), -1);
  if (input.epoch < newest) return { ok: false, reason: "stale-epoch" };

  const released = new Set<string>();
  for (const r of ledger.epochs) if (r.result.ok) for (const p of r.result.picks) released.add(p.videoId);
  const members = [...new Set(input.members)].sort();
  const sets = members.map((m) => input.contributions.get(m) ?? null);
  // `rng` is unused when noiseSeed is set; pass a guard that fails loudly if it isn't.
  const noRng: Rng = () => {
    throw new Error("unreachable: sticky noise uses noiseSeed");
  };
  const result = circlePicks(sets, policy, noRng, { noiseSeed: `${input.noiseSeed}\u0000${input.epoch}`, exclude: released });
  const record: CircleEpochRecord = { epoch: input.epoch, membership: circleMembershipId(members), result };
  return { ok: true, result, ledger: { epochs: [...ledger.epochs, record] }, frozen: false };
}

/**
 * Turn circle picks into ranker candidates. Every pick gets the same `strength`
 * (default `CIRCLE_PICK_STRENGTH`): picks carry no counts. `via` names the circle,
 * never a member.
 */
export function circleCandidates(
  result: CircleResult,
  circleName: string,
  videos: ReadonlyMap<string, Video>,
  strength: number = CIRCLE_PICK_STRENGTH,
): Candidate[] {
  if (!result.ok) return [];
  const s = Math.min(1, Math.max(0, Number.isFinite(strength) ? strength : CIRCLE_PICK_STRENGTH));
  const out: Candidate[] = [];
  for (const pick of result.picks) {
    const video = videos.get(pick.videoId);
    if (!video) continue;
    out.push({
      video,
      source: { kind: "circle", via: `${circleName} (${result.members} members)`, strength: s },
    });
  }
  return out;
}
