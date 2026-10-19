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
// The noise is a two-sided geometric (discrete Laplace) sample, which avoids the
// floating-point attacks on continuous Laplace (Mironov, CCS 2012). For production,
// prefer OpenDP's audited samplers.

import type { Candidate, Rng, Video } from "./types.ts";
import { fail, number, plainObject } from "./validate.ts";

/** Circle reveal policy (wire format: docs/PROTOCOL.md, "Circle policy"). */
export interface CirclePolicy {
  v: 1;
  /** Fewer present members than this → no output for the round. Never below 8. */
  minMembers: number;
  /** A pick is shown only if its noised count reaches this. */
  revealThreshold: number;
  /** Per-item privacy parameter of the discrete Laplace noise. */
  epsilon: number;
  /**
   * Each member contributes at most this many items per round. A member's total
   * privacy loss per round is at most `epsilon × maxItemsPerMember` (basic composition).
   */
  maxItemsPerMember: number;
}

/** Hard floor on circle size (THREAT_MODEL.md, T3). */
export const CIRCLE_MIN_MEMBERS = 8;

export const DEFAULT_CIRCLE_POLICY: CirclePolicy = {
  v: 1,
  minMembers: CIRCLE_MIN_MEMBERS,
  revealThreshold: 3,
  epsilon: 1,
  maxItemsPerMember: 64,
};

/** Validate an untrusted circle policy (e.g. proposed by a circle admin). */
export function parseCirclePolicy(json: unknown): CirclePolicy {
  const keys = ["v", "minMembers", "revealThreshold", "epsilon", "maxItemsPerMember"] as const;
  const o = plainObject(json, "circlePolicy", keys, keys);
  if (o.v !== 1) fail("circlePolicy.v", "must be 1");
  const minMembers = number(o.minMembers, "circlePolicy.minMembers", CIRCLE_MIN_MEMBERS, 10_000, true);
  return {
    v: 1,
    minMembers,
    revealThreshold: number(o.revealThreshold, "circlePolicy.revealThreshold", 2, minMembers, true),
    epsilon: number(o.epsilon, "circlePolicy.epsilon", 0.01, 5),
    maxItemsPerMember: number(o.maxItemsPerMember, "circlePolicy.maxItemsPerMember", 1, 256, true),
  };
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
  /** True count plus noise; never shown below `revealThreshold`. */
  noisedCount: number;
}

export type CircleResult =
  | { ok: true; members: number; picks: CirclePick[] }
  | { ok: false; members: number; reason: "too-few-members" };

/**
 * Apply the circle policy to one round. `memberSets` has one entry per member of
 * the round's fixed membership; `null` marks a member who dropped out (they count
 * as absent). Output: items whose noised count reaches the threshold, highest first.
 */
export function circlePicks(
  memberSets: ReadonlyArray<Iterable<string> | null | undefined>,
  policy: CirclePolicy,
  rng: Rng,
): CircleResult {
  const p = parseCirclePolicy(policy);
  const present = memberSets.filter((s): s is Iterable<string> => s != null);
  if (present.length < p.minMembers) return { ok: false, members: present.length, reason: "too-few-members" };

  const counts = new Map<string, number>();
  for (const set of present) {
    const mine = [...new Set(set)].slice(0, p.maxItemsPerMember);
    for (const id of mine) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const picks: CirclePick[] = [];
  // Sample in a fixed order so results depend only on the rng seed.
  for (const id of [...counts.keys()].sort()) {
    const noisedCount = counts.get(id)! + discreteLaplace(p.epsilon, rng);
    if (noisedCount >= p.revealThreshold) picks.push({ videoId: id, noisedCount: Math.min(noisedCount, present.length) });
  }
  picks.sort((a, b) => b.noisedCount - a.noisedCount || (a.videoId < b.videoId ? -1 : 1));
  return { ok: true, members: present.length, picks };
}

/**
 * Turn circle picks into ranker candidates. Strength is the noised share of members;
 * `via` names the circle, never a member.
 */
export function circleCandidates(
  result: CircleResult,
  circleName: string,
  videos: ReadonlyMap<string, Video>,
): Candidate[] {
  if (!result.ok) return [];
  const out: Candidate[] = [];
  for (const pick of result.picks) {
    const video = videos.get(pick.videoId);
    if (!video) continue;
    out.push({
      video,
      source: {
        kind: "circle",
        via: `${circleName} (${result.members} members)`,
        strength: Math.min(1, pick.noisedCount / result.members),
      },
    });
  }
  return out;
}
