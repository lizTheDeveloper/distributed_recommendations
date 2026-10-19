// Policy for match previews (PSI-cardinality). See DESIGN.md, Match protocol step 1,
// and THREAT_MODEL.md, T2: a preview tells two people only how many videos they have
// in common, but repeated previews against a changing probe set act as an oracle
// ("did you watch X?"). So previews need the target's acceptance, both sets must have
// at least 20 items, and they are rate-limited per pair and per requester.
//
// Pure functions over a stored state object; no crypto here. The target's device is
// the enforcement point for acceptance, set size and the per-pair limit, since it
// refuses to answer. The per-requester limit can only be self-enforced by an honest
// requester client; a target sees only requests made to itself.

import { fail, number, plainObject } from "./validate.ts";

/**
 * The PSI-cardinality primitive (to be backed by OpenMined PSI, `@openmined/psi.js`).
 * Requester: `createRequest` then `intersectionSize`. Target: `answerRequest`.
 * The requester learns only |A ∩ B|; the target learns only |A|.
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
}

/** Hard floor on preview set size. */
export const PREVIEW_MIN_SET_SIZE = 20;

export const DEFAULT_PREVIEW_POLICY: PreviewPolicy = {
  v: 1,
  minSetSize: PREVIEW_MIN_SET_SIZE,
  maxPerPairPerWeek: 1,
  maxPerRequesterPerWeek: 5,
  acceptWindowSec: 7 * 86_400,
};

/** Validate an untrusted preview policy. */
export function parsePreviewPolicy(json: unknown): PreviewPolicy {
  const keys = ["v", "minSetSize", "maxPerPairPerWeek", "maxPerRequesterPerWeek", "acceptWindowSec"] as const;
  const o = plainObject(json, "previewPolicy", keys, keys);
  if (o.v !== 1) fail("previewPolicy.v", "must be 1");
  return {
    v: 1,
    minSetSize: number(o.minSetSize, "previewPolicy.minSetSize", PREVIEW_MIN_SET_SIZE, 100_000, true),
    maxPerPairPerWeek: number(o.maxPerPairPerWeek, "previewPolicy.maxPerPairPerWeek", 1, 7, true),
    maxPerRequesterPerWeek: number(o.maxPerRequesterPerWeek, "previewPolicy.maxPerRequesterPerWeek", 1, 50, true),
    acceptWindowSec: number(o.acceptWindowSec, "previewPolicy.acceptWindowSec", 60, 30 * 86_400, true),
  };
}

export type PreviewStatus = "pending" | "accepted" | "declined" | "done";

export interface PreviewRequest {
  id: string;
  requester: string;
  target: string;
  /** Unix seconds. */
  requestedAt: number;
  status: PreviewStatus;
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
  | "set-too-small";

export type PreviewResult = { ok: true; state: PreviewState } | { ok: false; reason: PreviewRefusal };

const WEEK_SEC = 7 * 86_400;

function sec(d: Date): number {
  return Math.floor(d.getTime() / 1000);
}

function samePair(r: PreviewRequest, a: string, b: string): boolean {
  return (r.requester === a && r.target === b) || (r.requester === b && r.target === a);
}

export function emptyPreviewState(): PreviewState {
  return { requests: [] };
}

/** Drop records older than the rate-limit window. */
export function prunePreviews(state: PreviewState, now: Date): PreviewState {
  const from = sec(now) - WEEK_SEC;
  return { requests: state.requests.filter((r) => r.requestedAt > from) };
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
  const recent = prunePreviews(state, req.now).requests;
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

function update(state: PreviewState, id: string, status: PreviewStatus): PreviewState {
  return { requests: state.requests.map((r) => (r.id === id ? { ...r, status } : r)) };
}

/** The target accepts or declines a pending request. */
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
  return { ok: true, state: update(state, id, res.accept ? "accepted" : "declined") };
}

/**
 * Check, right before running PSI, that the request was accepted, is still fresh
 * and that both sets meet the minimum size. On success the request is marked done,
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
