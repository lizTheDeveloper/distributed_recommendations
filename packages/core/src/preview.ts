// Policy for match previews (PSI-cardinality). See DESIGN.md, Match protocol step 1,
// and THREAT_MODEL.md, T2: a preview tells two people roughly how many videos they
// have in common, but previews against a crafted probe set act as an oracle ("did
// you watch X?").
//
// docs/SIMULATION_RESULTS.md, Exp 4 showed:
// - One *exact* cardinality answers "did they watch X" with certainty, and the
//   minimum set size buys nothing (a prober pads the probe with its own unwatched
//   uploads). `minSetSize` stays only as hygiene; it is NOT a defense.
// - What bounds the attack is DP noise on the cardinality (discrete Laplace,
//   ε = 0.5) with a floor of 5 (below it, report "<5"), plus a budget of at most 8
//   accepted previews per target per rolling year, across all requesters, counted
//   on the target's device. Then AUC ≤ 0.83 and nothing is inferred at ≥90%
//   confidence, even for a prober who knows 4 of the target's items.
//
// So the target's device runs PSI as the party that learns the cardinality, adds the
// noise (`noisyPreviewCardinality`) and sends back only the noised value. The
// requester never sees the exact count.
//
// Pure functions over a stored state object; no crypto here. The target's device is
// the enforcement point for acceptance, the yearly target budget, set size and the
// per-pair limit, since it refuses to answer. The per-requester limit can only be
// self-enforced by an honest requester client; a target sees only requests made to
// itself, and Sybils defeat per-requester limits anyway.

import type { Rng } from "./types.ts";
import { discreteLaplace } from "./circle.ts";
import { fail, has, number, plainObject } from "./validate.ts";

/**
 * The PSI-cardinality primitive (to be backed by OpenMined PSI, `@openmined/psi.js`).
 * The party calling `createRequest` then `intersectionSize` learns |A ∩ B|; the
 * party calling `answerRequest` learns only the other set's size.
 *
 * For previews the **target** is the party that learns |A ∩ B| (it calls
 * `createRequest`/`intersectionSize` on the requester's answer), so it can noise the
 * result on its own device before replying. The requester learns only the output of
 * `noisyPreviewCardinality`.
 */
export interface PsiCardinality {
  createRequest(items: readonly string[]): Promise<Uint8Array>;
  answerRequest(request: Uint8Array, items: readonly string[]): Promise<{ setup: Uint8Array; response: Uint8Array }>;
  intersectionSize(setup: Uint8Array, response: Uint8Array): Promise<number>;
}

/** Preview policy (wire format: docs/PROTOCOL.md, "Preview policy"). */
export interface PreviewPolicy {
  v: 1;
  /** Both sets need at least this many items. Never below 20. */
  minSetSize: number;
  /** Previews per unordered pair per rolling 7 days. */
  maxPerPairPerWeek: number;
  /** Previews a requester may start per rolling 7 days. */
  maxPerRequesterPerWeek: number;
  /** A request not answered within this many seconds expires. */
  acceptWindowSec: number;
  /**
   * Accepted previews a target allows per rolling 365 days, from all requesters
   * together. Counted on the target's device. 1–8; default 8. Optional on the wire
   * (absent = 8); `parsePreviewPolicy` always fills it.
   */
  maxAcceptedPerTargetPerYear?: number;
  /** DP parameter of the noise on the cardinality. 0.05–0.5; default 0.5. */
  epsilon?: number;
  /** Noised cardinalities below this are reported only as "fewer than floor". 5–100; default 5. */
  floor?: number;
}

/**
 * Hard floor on preview set size. Hygiene only: Exp 4 showed a prober can pad any
 * probe with free decoys, so this is not a privacy defense.
 */
export const PREVIEW_MIN_SET_SIZE = 20;

/** Hard limits on the preview's output protection (docs/SIMULATION_RESULTS.md, Exp 4). */
export const PREVIEW_PRIVACY = {
  /** Largest allowed (and default) ε for the cardinality noise. */
  maxEpsilon: 0.5,
  /** Smallest allowed (and default) reporting floor. */
  minFloor: 5,
  /** Largest allowed (and default) number of accepted previews per target per year. */
  maxAcceptedPerTargetPerYear: 8,
} as const;

export const DEFAULT_PREVIEW_POLICY: PreviewPolicy = {
  v: 1,
  minSetSize: PREVIEW_MIN_SET_SIZE,
  maxPerPairPerWeek: 1,
  maxPerRequesterPerWeek: 5,
  acceptWindowSec: 7 * 86_400,
  maxAcceptedPerTargetPerYear: PREVIEW_PRIVACY.maxAcceptedPerTargetPerYear,
  epsilon: PREVIEW_PRIVACY.maxEpsilon,
  floor: PREVIEW_PRIVACY.minFloor,
};

/**
 * Validate an untrusted preview policy. The three privacy fields are optional on the
 * wire (absent = the default) and always present in the result.
 */
export function parsePreviewPolicy(json: unknown): PreviewPolicy {
  const required = ["v", "minSetSize", "maxPerPairPerWeek", "maxPerRequesterPerWeek", "acceptWindowSec"] as const;
  const keys = [...required, "maxAcceptedPerTargetPerYear", "epsilon", "floor"] as const;
  const o = plainObject(json, "previewPolicy", keys, required);
  if (o.v !== 1) fail("previewPolicy.v", "must be 1");
  const P = PREVIEW_PRIVACY;
  const opt = (k: string) => has(o, k) && o[k] !== undefined;
  return {
    v: 1,
    minSetSize: number(o.minSetSize, "previewPolicy.minSetSize", PREVIEW_MIN_SET_SIZE, 100_000, true),
    maxPerPairPerWeek: number(o.maxPerPairPerWeek, "previewPolicy.maxPerPairPerWeek", 1, 7, true),
    maxPerRequesterPerWeek: number(o.maxPerRequesterPerWeek, "previewPolicy.maxPerRequesterPerWeek", 1, 50, true),
    acceptWindowSec: number(o.acceptWindowSec, "previewPolicy.acceptWindowSec", 60, 30 * 86_400, true),
    maxAcceptedPerTargetPerYear: opt("maxAcceptedPerTargetPerYear")
      ? number(o.maxAcceptedPerTargetPerYear, "previewPolicy.maxAcceptedPerTargetPerYear", 1, P.maxAcceptedPerTargetPerYear, true)
      : P.maxAcceptedPerTargetPerYear,
    epsilon: opt("epsilon") ? number(o.epsilon, "previewPolicy.epsilon", 0.05, P.maxEpsilon) : P.maxEpsilon,
    floor: opt("floor") ? number(o.floor, "previewPolicy.floor", P.minFloor, 100, true) : P.minFloor,
  };
}

/** Coarse bucket shown to users (coarsening after noise is free post-processing). */
export type PreviewBucket = "fewer-than-floor" | "a-few" | "some" | "a-lot";

/** What the requester learns from one preview. Never the exact cardinality. */
export interface NoisyCardinality {
  /** True when the noised value fell below the floor ("<5"); `value` is then absent. */
  belowFloor: boolean;
  /** The noised cardinality, when at or above the floor. */
  value?: number;
  bucket: PreviewBucket;
  /** Display text, e.g. "<5", "a few in common". */
  label: string;
}

/**
 * Noise a PSI cardinality on the target's device before it leaves: add
 * discrete-Laplace noise with `policy.epsilon` (default 0.5), then report anything
 * below `policy.floor` (default 5) as "<5". Buckets: below floor / floor–9 "a few" /
 * 10–19 "some" / 20+ "a lot". Use `cryptoRng()` in production.
 */
export function noisyPreviewCardinality(
  trueCount: number,
  rng: Rng,
  policy: PreviewPolicy = DEFAULT_PREVIEW_POLICY,
): NoisyCardinality {
  const p = parsePreviewPolicy(policy);
  if (!Number.isInteger(trueCount) || trueCount < 0) throw new RangeError("trueCount must be a non-negative integer");
  const floor = p.floor!;
  const noised = trueCount + discreteLaplace(p.epsilon!, rng);
  return previewDisplay(noised < floor, noised < floor ? null : noised, floor);
}

/**
 * Bucket and label for a preview value as the requester receives it: the target's
 * `belowFloor` flag, the noised value (null below the floor) and the target's floor.
 * Uses the same thresholds as `noisyPreviewCardinality` (which calls it), so the
 * requester's display can't drift from the target's. It adds no noise: pass only a
 * value that `noisyPreviewCardinality` produced. A value below `floor` is shown as
 * below the floor. Throws `RangeError` on a floor below `PREVIEW_PRIVACY.minFloor`
 * or a value that is not a non-negative integer.
 */
export function previewDisplay(
  belowFloor: boolean,
  value: number | null | undefined,
  floor: number = PREVIEW_PRIVACY.minFloor,
): NoisyCardinality {
  if (!Number.isInteger(floor) || floor < PREVIEW_PRIVACY.minFloor) {
    throw new RangeError(`floor must be an integer >= ${PREVIEW_PRIVACY.minFloor}`);
  }
  if (belowFloor || value === null || value === undefined || value < floor) {
    return { belowFloor: true, bucket: "fewer-than-floor", label: `<${floor}` };
  }
  if (!Number.isInteger(value)) throw new RangeError("value must be an integer");
  const bucket: PreviewBucket = value < Math.max(10, floor + 1) ? "a-few" : value < 20 ? "some" : "a-lot";
  const label = bucket === "a-few" ? "a few in common" : bucket === "some" ? "some in common" : "a lot in common";
  return { belowFloor: false, value, bucket, label };
}

export type PreviewStatus = "pending" | "accepted" | "declined" | "done";

export interface PreviewRequest {
  id: string;
  requester: string;
  target: string;
  /** Unix seconds. */
  requestedAt: number;
  status: PreviewStatus;
  /** Unix seconds when the target accepted; counts against the yearly target budget. */
  acceptedAt?: number;
}

export interface PreviewState {
  requests: PreviewRequest[];
}

export type PreviewRefusal =
  | "self-request"
  | "duplicate-id"
  | "pair-limit"
  | "requester-limit"
  | "unknown-request"
  | "not-target"
  | "not-pending"
  | "not-accepted"
  | "expired"
  | "set-too-small"
  | "target-budget";

export type PreviewResult = { ok: true; state: PreviewState } | { ok: false; reason: PreviewRefusal };

const WEEK_SEC = 7 * 86_400;
const YEAR_SEC = 365 * 86_400;

function sec(d: Date): number {
  return Math.floor(d.getTime() / 1000);
}

function samePair(r: PreviewRequest, a: string, b: string): boolean {
  return (r.requester === a && r.target === b) || (r.requester === b && r.target === a);
}

export function emptyPreviewState(): PreviewState {
  return { requests: [] };
}

function consumedBudget(r: PreviewRequest): boolean {
  return r.status === "accepted" || r.status === "done";
}

function acceptedTime(r: PreviewRequest): number {
  return r.acceptedAt ?? r.requestedAt;
}

/**
 * Drop records no limit needs any more: older than 7 days, except accepted ones,
 * which count against the target's yearly budget and are kept for 365 days.
 */
export function prunePreviews(state: PreviewState, now: Date): PreviewState {
  const week = sec(now) - WEEK_SEC;
  const year = sec(now) - YEAR_SEC;
  return {
    requests: state.requests.filter((r) => r.requestedAt > week || (consumedBudget(r) && acceptedTime(r) > year)),
  };
}

/** Accepted previews `target` may still grant in the rolling year (target-side budget). */
export function previewBudgetRemaining(
  state: PreviewState,
  target: string,
  now: Date,
  policy: PreviewPolicy = DEFAULT_PREVIEW_POLICY,
): number {
  const p = parsePreviewPolicy(policy);
  const year = sec(now) - YEAR_SEC;
  const used = state.requests.filter((r) => r.target === target && consumedBudget(r) && acceptedTime(r) > year).length;
  return Math.max(0, p.maxAcceptedPerTargetPerYear! - used);
}

/**
 * Record a preview request, or refuse it. Every request counts against the limits,
 * whatever its outcome, so declined requests can't be retried at once.
 */
export function requestPreview(
  state: PreviewState,
  req: { id: string; requester: string; target: string; now: Date },
  policy: PreviewPolicy = DEFAULT_PREVIEW_POLICY,
): PreviewResult {
  const p = parsePreviewPolicy(policy);
  if (req.requester === req.target) return { ok: false, reason: "self-request" };
  if (state.requests.some((r) => r.id === req.id)) return { ok: false, reason: "duplicate-id" };
  const week = sec(req.now) - WEEK_SEC;
  const recent = state.requests.filter((r) => r.requestedAt > week);
  if (recent.filter((r) => samePair(r, req.requester, req.target)).length >= p.maxPerPairPerWeek) {
    return { ok: false, reason: "pair-limit" };
  }
  if (recent.filter((r) => r.requester === req.requester).length >= p.maxPerRequesterPerWeek) {
    return { ok: false, reason: "requester-limit" };
  }
  const record: PreviewRequest = {
    id: req.id,
    requester: req.requester,
    target: req.target,
    requestedAt: sec(req.now),
    status: "pending",
  };
  return { ok: true, state: { requests: [...state.requests, record] } };
}

function update(state: PreviewState, id: string, status: PreviewStatus, acceptedAt?: number): PreviewState {
  return {
    requests: state.requests.map((r) => (r.id === id ? { ...r, status, ...(acceptedAt !== undefined ? { acceptedAt } : {}) } : r)),
  };
}

/**
 * The target accepts or declines a pending request. Accepting is refused with
 * `target-budget` once the target has accepted `maxAcceptedPerTargetPerYear`
 * previews in the rolling year, from anyone. Run this on the target's device,
 * against the target's own state.
 */
export function respondToPreview(
  state: PreviewState,
  id: string,
  res: { by: string; accept: boolean; now: Date },
  policy: PreviewPolicy = DEFAULT_PREVIEW_POLICY,
): PreviewResult {
  const p = parsePreviewPolicy(policy);
  const r = state.requests.find((x) => x.id === id);
  if (!r) return { ok: false, reason: "unknown-request" };
  if (r.target !== res.by) return { ok: false, reason: "not-target" };
  if (r.status !== "pending") return { ok: false, reason: "not-pending" };
  if (sec(res.now) - r.requestedAt > p.acceptWindowSec) return { ok: false, reason: "expired" };
  if (!res.accept) return { ok: true, state: update(state, id, "declined") };
  if (previewBudgetRemaining(state, r.target, res.now, p) <= 0) return { ok: false, reason: "target-budget" };
  return { ok: true, state: update(state, id, "accepted", sec(res.now)) };
}

/**
 * Check, right before running PSI, that the request was accepted, is still fresh
 * and that both sets meet the minimum size (hygiene, not a defense: see above). On success the request is marked done,
 * so each acceptance allows exactly one run.
 */
export function startPreviewRun(
  state: PreviewState,
  id: string,
  run: { now: Date; requesterSetSize: number; targetSetSize: number },
  policy: PreviewPolicy = DEFAULT_PREVIEW_POLICY,
): PreviewResult {
  const p = parsePreviewPolicy(policy);
  const r = state.requests.find((x) => x.id === id);
  if (!r) return { ok: false, reason: "unknown-request" };
  if (r.status !== "accepted") return { ok: false, reason: "not-accepted" };
  if (sec(run.now) - r.requestedAt > p.acceptWindowSec) return { ok: false, reason: "expired" };
  if (run.requesterSetSize < p.minSetSize || run.targetSetSize < p.minSetSize) {
    return { ok: false, reason: "set-too-small" };
  }
  return { ok: true, state: update(state, id, "done") };
}
