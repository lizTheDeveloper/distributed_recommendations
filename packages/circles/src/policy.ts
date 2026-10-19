// Core's circle output policy, applied to an AGGREGATE (noised counts that came out
// of the masked sum) instead of raw member sets.
//
// Core's `releaseCircleEpoch` takes raw per-member sets plus a noise seed: that is
// what the simulation needs, and exactly what a deployment must not have (T19).
// This module re-applies the same rules using core's own building blocks
// (`parseCirclePolicy`, `revealThresholdFor`, `circleMembershipId`, the
// `CircleLedger` record format and `circleCandidates`):
// - k floor: fewer than `minMembers` participants → no output;
// - threshold on the NOISED count, derived from the participant count unless set;
// - picks only, sorted by id; counts are dropped here and never returned;
// - epoch freeze: an epoch is released at most once; asking again returns the
//   stored result; an epoch older than the newest released or voided one is refused;
// - items released in earlier epochs are never picked again.
// A voided epoch (dropout or inconsistency after masked vectors went out) is also
// final: it is recorded and never retried, because a member who withheld its own
// vector can still unmask the others' sum (docs/CIRCLES.md, "Dropouts").
//
// Suggested follow-up (not done here, other packages are out of scope): move
// `releaseAggregatedEpoch` into core next to `releaseCircleEpoch`.

import type { Candidate, CircleEpochRecord, CircleLedger, CirclePolicy, CircleResult, Video } from './core.ts';
import { circleCandidates, circleMembershipId, emptyCircleLedger, parseCirclePolicy, revealThresholdFor } from './core.ts';

export type VoidReason = 'dropout' | 'participant-mismatch' | 'duplicate-vector' | 'bad-vector';

export interface VoidRecord {
  epoch: number;
  membership: string;
  reason: VoidReason;
}

/** Per-circle, per-device release history. Store encrypted at rest (T9). */
export interface CirclesLedger {
  /** Core-format records of released epochs (ok or too-few-members). */
  released: CircleLedger;
  /** Epochs whose round was voided after masked vectors were sent. */
  voided: VoidRecord[];
}

export function emptyCirclesLedger(): CirclesLedger {
  return { released: emptyCircleLedger(), voided: [] };
}

export function newestEpoch(ledger: CirclesLedger): number {
  let m = -1;
  for (const r of ledger.released.epochs) m = Math.max(m, r.epoch);
  for (const r of ledger.voided) m = Math.max(m, r.epoch);
  return m;
}

/** Every video id released as a pick in any earlier epoch. */
export function releasedItems(ledger: CirclesLedger): Set<string> {
  const s = new Set<string>();
  for (const r of ledger.released.epochs) if (r.result.ok) for (const p of r.result.picks) s.add(p.videoId);
  return s;
}

export interface AggregateInput {
  epoch: number;
  /** Identities of the round's participants (those whose masked vectors were summed). */
  participants: readonly string[];
  /** Noised count per candidate id, straight from the unmasked sum. Never stored or returned. */
  noisedCounts: ReadonlyMap<string, number>;
}

export type AggregateOutcome =
  | { ok: true; result: CircleResult; ledger: CirclesLedger; frozen: boolean }
  | { ok: false; reason: 'stale-epoch' | 'voided-epoch' };

/**
 * Release one epoch from an aggregate. See the module comment for the rules; they
 * mirror core's `releaseCircleEpoch` one for one.
 */
export function releaseAggregatedEpoch(ledger: CirclesLedger, input: AggregateInput, policy: CirclePolicy): AggregateOutcome {
  const p = parseCirclePolicy(policy);
  if (!Number.isInteger(input.epoch) || input.epoch < 0) throw new RangeError('epoch must be a non-negative integer');
  const existing = ledger.released.epochs.find((r) => r.epoch === input.epoch);
  if (existing) return { ok: true, result: existing.result, ledger, frozen: true };
  if (ledger.voided.some((r) => r.epoch === input.epoch)) return { ok: false, reason: 'voided-epoch' };
  if (input.epoch < newestEpoch(ledger)) return { ok: false, reason: 'stale-epoch' };

  const members = [...new Set(input.participants)].sort();
  let result: CircleResult;
  if (members.length < p.minMembers) {
    result = { ok: false, members: members.length, reason: 'too-few-members' };
  } else {
    const threshold = p.revealThreshold ?? revealThresholdFor(members.length);
    const released = releasedItems(ledger);
    const ids = [...input.noisedCounts.keys()].filter((id) => !released.has(id)).sort();
    result = {
      ok: true,
      members: members.length,
      picks: ids.filter((id) => input.noisedCounts.get(id)! >= threshold).map((videoId) => ({ videoId })),
    };
  }
  const record: CircleEpochRecord = { epoch: input.epoch, membership: circleMembershipId(members), result };
  return {
    ok: true,
    result,
    ledger: { released: { epochs: [...ledger.released.epochs, record] }, voided: ledger.voided },
    frozen: false,
  };
}

/** Record a voided epoch. Idempotent; never overrides a release. */
export function voidEpoch(ledger: CirclesLedger, epoch: number, participants: readonly string[], reason: VoidReason): CirclesLedger {
  if (ledger.released.epochs.some((r) => r.epoch === epoch) || ledger.voided.some((r) => r.epoch === epoch)) return ledger;
  return {
    released: ledger.released,
    voided: [...ledger.voided, { epoch, membership: circleMembershipId([...participants]), reason }],
  };
}

/**
 * Ranker candidates from every released epoch (newest pick strength is the same as
 * oldest: picks carry no counts). `via` names the circle, never a member.
 */
export function circleFeedCandidates(
  ledger: CirclesLedger,
  circleName: string,
  videos: ReadonlyMap<string, Video>,
): Candidate[] {
  const out: Candidate[] = [];
  for (const r of ledger.released.epochs) out.push(...circleCandidates(r.result, circleName, videos));
  return out;
}
