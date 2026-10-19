// The Match lifecycle as a pure state machine over a serializable `MatchBook`.
//
//   requester                                   target
//   ---------                                   ------
//   requestMatch ── match-request ────────────▶ (incoming)
//   [requestMatchPreview ── preview-request ──▶ core requestPreview]
//   [                ◀── preview-response ──── respondToMatchPreview (core respondToPreview:
//                                               acceptance, yearly budget of 8)]
//   [answerMatchPreview ── preview-answer ────▶ startTargetPreviewRun (core startPreviewRun)
//                                               completeTargetPreview (core noisyPreviewCardinality,
//                     ◀── preview-result ────── ε = 0.5, floor 5: only the noised value leaves)]
//   (active) ◀──────────── match-accept ─────── acceptMatch (consent settings) (active)
//   buildMatchSketch ◀──── sketch ────────────▶ buildMatchSketch   (each epoch, weekly)
//   proposeRenew / acceptRenew ── renew ──────  (new expiry, new per-match keys)
//   revokeMatch ── revoke ────────────────────▶ (revoked; keys wiped)
//   tick: 90-day expiry, request expiry, key grace periods, pruning.
//   setPaused: quiet pause (D2), local only; nothing on the wire changes shape.
//
// Every transition takes `now` (and any randomness or keys) as inputs and returns
// `{ ok: true, book, outbox, event }` or `{ ok: false, reason }`. The outbox holds
// encoded rumor contents plus the key to seal with and the key to wrap to; the
// effectful layer (`client.ts`) gift-wraps and publishes them. Nothing here does I/O.
//
// The book holds per-match secret keys and the last sketches: store it encrypted at
// rest (THREAT_MODEL T9).

import type { MatchKeyPair } from './keys.ts';
import type { ControlKindName, ControlMessages } from './messages.ts';
import { MESSAGE_LIMITS, controlKind, decodeControl, encodeControl } from './messages.ts';
import { MATCH_KINDS, matchKindName } from './kinds.ts';
import type { NoisyCardinality, PreviewBucket, PreviewPolicy, PreviewState, Rng, SketchConsent, SketchState, TasteSketch, HistoryEntry } from './core.ts';
import {
  DEFAULT_PREVIEW_POLICY,
  ValidationError,
  buildSketch,
  decodeSketch,
  emptyPreviewState,
  encodeSketch,
  noisyPreviewCardinality,
  parsePreviewPolicy,
  previewBudgetRemaining,
  prunePreviews,
  requestPreview,
  respondToPreview,
  startPreviewRun,
} from './core.ts';

export const MATCH_TIMING = {
  /** Longest match, and longest renewal (DESIGN.md: 90 days unless renewed). */
  maxDurationDays: MESSAGE_LIMITS.maxDurationDays,
  /** An unanswered match request expires after this (same as the preview accept window). */
  requestTtlSec: 7 * 86_400,
  /** Every gift wrap's NIP-40 expiration is `now + wrapTtlSec`, so all wraps look alike. */
  wrapTtlSec: 14 * 86_400,
  /** Fixed sketch schedule (PROTOCOL.md: weekly by default, whether or not anything changed). */
  sketchIntervalSec: 7 * 86_400,
  /** After a key rotation, the old keys still receive / verify for this long (in-flight messages). */
  keyGraceSec: 14 * 86_400,
  /** Ended matches are kept (without keys or data) this long, to reject replays of their messages. */
  tombstoneSec: 30 * 86_400,
  clockSkewSec: MESSAGE_LIMITS.clockSkewSec,
} as const;

/** Default consent: endorsements only, 60-day window, nothing excluded, not paused. */
export const DEFAULT_CONSENT: SketchConsent = {
  windowDays: 60,
  includeFinished: false,
  excludedTags: [],
  excludedHours: [],
  excludedVideos: [],
  paused: false,
};

export type MatchStatus = 'requested' | 'incoming' | 'active' | 'declined' | 'revoked' | 'expired';
export type MatchRole = 'requester' | 'target';

export type PreviewStage =
  | 'requested' // sent (requester) or received (target), not answered yet
  | 'accepted' // target accepted and sent its PSI request
  | 'answered' // requester sent its PSI answer
  | 'running' // target passed core startPreviewRun and is computing
  | 'done'
  | 'declined'
  | 'failed';

export interface MatchPreview {
  id: string;
  role: MatchRole;
  stage: PreviewStage;
  requestedAt: number;
  /** Target side: the requester's self-reported real set size. */
  requesterSetSize?: number;
  /** Requester side: what the target sent back. */
  result?: NoisyCardinality & { floor: number };
}

export interface PendingRenew {
  renewId: string;
  proposedBy: 'me' | 'peer';
  issuedAt: number;
  expiresAt: number;
  /** My next key (when I proposed). */
  myNewKey?: MatchKeyPair;
  /** The peer's next key (when the peer proposed). */
  peerNewKey?: string;
}

export interface MatchRecord {
  matchId: string;
  role: MatchRole;
  /** The peer's identity public key. */
  peer: string;
  status: MatchStatus;
  requestedAt: number;
  durationDays: number;
  activatedAt?: number;
  /** When an active match ends unless renewed. */
  expiresAt?: number;
  endedAt?: number;
  /** My current per-match key; null once the match has ended (keys wiped). */
  myKey: MatchKeyPair | null;
  myPrevKey?: MatchKeyPair & { until: number };
  /** The peer's per-match key, once announced. */
  peerKey?: string;
  peerPrevKey?: { pubkey: string; until: number };
  /** My sharing settings for this match. Local only; never sent. */
  consent: SketchConsent;
  /** My sketch sender state (core). */
  sketch: SketchState;
  lastSketchSentAt?: number;
  /** Highest epoch accepted from the peer (replay protection, T15). */
  peerEpoch: number;
  peerSketch?: TasteSketch;
  peerSketchAt?: number;
  preview?: MatchPreview;
  renew?: PendingRenew;
}

export interface MatchBook {
  v: 1;
  /** My identity public key. */
  self: string;
  matches: Record<string, MatchRecord>;
  /** Core preview state, across all matches: the target's yearly budget is global. */
  previews: PreviewState;
  previewPolicy: PreviewPolicy;
}

/** Which key seals an outgoing message. */
export type Sender = { type: 'identity' } | { type: 'match'; key: MatchKeyPair };

export interface OutgoingMessage {
  matchId: string;
  kind: number;
  /** Encoded rumor content (exactly 8,192 bytes, or a sketch's bucket size). */
  content: string;
  from: Sender;
  /** Recipient key: the `p` tag of the gift wrap. */
  to: string;
  /** NIP-40 expiration of the gift wrap, Unix seconds. */
  expiration: number;
}

export type MatchEvent =
  | { type: 'match-requested'; matchId: string; peer: string; durationDays: number }
  | { type: 'match-active'; matchId: string; peer: string; expiresAt: number }
  | { type: 'preview-requested'; matchId: string; previewId: string; peer: string }
  | { type: 'preview-accepted'; matchId: string; previewId: string; psiRequest: string }
  | { type: 'preview-declined'; matchId: string; previewId: string; refusal?: string }
  | { type: 'preview-answer'; matchId: string; previewId: string; setSize: number; psiSetup: string; psiResponse: string }
  | { type: 'preview-result'; matchId: string; previewId: string; result: NoisyCardinality & { floor: number } }
  | { type: 'preview-failed'; matchId: string; previewId: string; reason: string }
  | { type: 'sketch'; matchId: string; epoch: number }
  | { type: 'renew-requested'; matchId: string; expiresAt: number }
  | { type: 'renewed'; matchId: string; expiresAt: number }
  | { type: 'revoked'; matchId: string; by: 'me' | 'peer' }
  | { type: 'declined'; matchId: string }
  | { type: 'expired'; matchId: string; status: MatchStatus }
  | { type: 'consent-updated'; matchId: string };

export type Transition =
  | { ok: true; book: MatchBook; outbox: OutgoingMessage[]; event?: MatchEvent }
  | { ok: false; reason: string };

export interface IncomingMessage {
  kind: number;
  content: string;
  sealPubkey: string;
  recipientPubkey: string;
}

const HEX64 = /^[0-9a-f]{64}$/;
/** No `"`, `\\`, whitespace or control characters (RFC 3986 URLs never need them raw). */
const WIRE_SAFE_ID = /^https?:\/\/[^\s"\\\u0000-\u001f\u007f-\u009f]+$/;

function sec(d: Date): number {
  return Math.floor(d.getTime() / 1000);
}

function refuse(reason: string): Transition {
  return { ok: false, reason };
}

function ok(book: MatchBook, outbox: OutgoingMessage[] = [], event?: MatchEvent): Transition {
  return event ? { ok: true, book, outbox, event } : { ok: true, book, outbox };
}

function withRecord(book: MatchBook, rec: MatchRecord): MatchBook {
  return { ...book, matches: { ...book.matches, [rec.matchId]: rec } };
}

function ended(rec: MatchRecord): boolean {
  return rec.status === 'declined' || rec.status === 'revoked' || rec.status === 'expired';
}

/** End a match: wipe keys, both sketches and any pending renewal (data minimization). */
function endRecord(rec: MatchRecord, status: MatchStatus, now: number): MatchRecord {
  const { myPrevKey: _a, peerPrevKey: _b, peerSketch: _c, peerSketchAt: _d, renew: _e, ...rest } = rec;
  return { ...rest, status, endedAt: now, myKey: null, sketch: { epoch: rec.sketch.epoch } };
}

function control<K extends ControlKindName>(
  rec: MatchRecord,
  name: K,
  msg: ControlMessages[K],
  from: Sender,
  to: string,
  now: number,
): OutgoingMessage {
  return {
    matchId: rec.matchId,
    kind: controlKind(name),
    content: encodeControl(name, msg),
    from,
    to,
    expiration: now + MATCH_TIMING.wrapTtlSec,
  };
}

/**
 * The key I seal with: my match key once I've announced it (the requester announces
 * in the request; the target in its accept), else my identity.
 */
function senderFor(rec: MatchRecord): Sender {
  if (rec.myKey && (rec.role === 'requester' || rec.status === 'active')) return { type: 'match', key: rec.myKey };
  return { type: 'identity' };
}

/** Where I send: the peer's match key once announced, else the peer's identity. */
function recipientFor(rec: MatchRecord): string {
  return rec.peerKey ?? rec.peer;
}

/**
 * Keys the peer may seal a control message with right now: its identity (always
 * authentic, e.g. the target's replies before it has accepted), its current match
 * key and, during the grace period after a rotation, its previous one. Sketches
 * are stricter: match keys only (`receiveSketch`).
 */
function expectedPeerSealKeys(rec: MatchRecord, now: number): string[] {
  const keys = [rec.peer];
  if (rec.peerKey) keys.push(rec.peerKey);
  if (rec.peerPrevKey && rec.peerPrevKey.until > now) keys.push(rec.peerPrevKey.pubkey);
  return keys;
}

/** My keys that may legitimately receive for this match right now. */
function myReceiveKeys(book: MatchBook, rec: MatchRecord, now: number): string[] {
  const keys: string[] = [];
  if (rec.myKey) keys.push(rec.myKey.pubkey);
  if (rec.myPrevKey && rec.myPrevKey.until > now) keys.push(rec.myPrevKey.pubkey);
  if (rec.renew?.myNewKey) keys.push(rec.renew.myNewKey.pubkey);
  // Until the requester has seen the accept, it writes to the target's identity
  // (preview request / answer, a withdrawal). Never used for sketches.
  if (rec.role === 'target') keys.push(book.self);
  return keys;
}

// --- Book ------------------------------------------------------------------------

export function createMatchBook(self: string, previewPolicy: PreviewPolicy = DEFAULT_PREVIEW_POLICY): MatchBook {
  if (!HEX64.test(self)) throw new RangeError('self must be a 64-char hex public key');
  return { v: 1, self, matches: {}, previews: emptyPreviewState(), previewPolicy: parsePreviewPolicy(previewPolicy) };
}

/**
 * Every key this device must listen on and decrypt with: the identity key plus each
 * live match's current, previous (in grace) and pending keys. Subscribe to kind 1059
 * with `#p` = these public keys.
 */
export function inboxKeys(book: MatchBook, now: Date): { identity: string; matchKeys: MatchKeyPair[] } {
  const t = sec(now);
  const keys: MatchKeyPair[] = [];
  for (const rec of Object.values(book.matches)) {
    if (ended(rec)) continue;
    if (rec.myKey) keys.push(rec.myKey);
    if (rec.myPrevKey && rec.myPrevKey.until > t) keys.push({ secret: rec.myPrevKey.secret, pubkey: rec.myPrevKey.pubkey });
    if (rec.renew?.myNewKey) keys.push(rec.renew.myNewKey);
  }
  return { identity: book.self, matchKeys: keys };
}

function liveWithPeer(book: MatchBook, peer: string): MatchRecord | undefined {
  return Object.values(book.matches).find((r) => r.peer === peer && !ended(r));
}

function checkConsent(consent: SketchConsent): string | undefined {
  if (!(consent.windowDays >= 1 && consent.windowDays <= 365)) return 'consent-window';
  if (!consent.excludedHours.every((h) => Number.isInteger(h) && h >= 0 && h <= 23)) return 'consent-hours';
  return undefined;
}

// --- Request / accept / decline ----------------------------------------------------

export function requestMatch(
  book: MatchBook,
  opts: { matchId: string; peer: string; myKey: MatchKeyPair; consent?: SketchConsent; durationDays?: number; now: Date },
): Transition {
  const now = sec(opts.now);
  const durationDays = opts.durationDays ?? MATCH_TIMING.maxDurationDays;
  if (!HEX64.test(opts.matchId) || !HEX64.test(opts.peer)) return refuse('bad-id');
  if (opts.peer === book.self) return refuse('self-request');
  if (book.matches[opts.matchId]) return refuse('duplicate-id');
  if (liveWithPeer(book, opts.peer)) return refuse('already-matched');
  if (!Number.isInteger(durationDays) || durationDays < 1 || durationDays > MATCH_TIMING.maxDurationDays) return refuse('bad-duration');
  const consent = opts.consent ?? DEFAULT_CONSENT;
  const bad = checkConsent(consent);
  if (bad) return refuse(bad);
  const rec: MatchRecord = {
    matchId: opts.matchId,
    role: 'requester',
    peer: opts.peer,
    status: 'requested',
    requestedAt: now,
    durationDays,
    myKey: opts.myKey,
    consent,
    sketch: { epoch: 0 },
    peerEpoch: 0,
  };
  const msg = control(
    rec,
    'matchRequest',
    { v: 1, matchId: rec.matchId, issuedAt: now, matchKey: opts.myKey.pubkey, durationDays },
    { type: 'identity' },
    opts.peer,
    now,
  );
  return ok(withRecord(book, rec), [msg]);
}

/** The target consents, with its own sharing settings, and the match becomes active. */
export function acceptMatch(
  book: MatchBook,
  matchId: string,
  opts: { myKey: MatchKeyPair; consent?: SketchConsent; durationDays?: number; now: Date },
): Transition {
  const rec = book.matches[matchId];
  const now = sec(opts.now);
  if (!rec) return refuse('unknown-match');
  if (rec.role !== 'target' || rec.status !== 'incoming') return refuse('not-incoming');
  if (now - rec.requestedAt > MATCH_TIMING.requestTtlSec) return refuse('expired');
  const days = Math.min(rec.durationDays, opts.durationDays ?? rec.durationDays);
  if (!Number.isInteger(days) || days < 1) return refuse('bad-duration');
  const consent = opts.consent ?? DEFAULT_CONSENT;
  const bad = checkConsent(consent);
  if (bad) return refuse(bad);
  const expiresAt = now + days * 86_400;
  const next: MatchRecord = { ...rec, status: 'active', activatedAt: now, expiresAt, myKey: opts.myKey, consent, durationDays: days };
  const msg = control(
    next,
    'matchAccept',
    { v: 1, matchId, issuedAt: now, matchKey: opts.myKey.pubkey, expiresAt },
    { type: 'identity' },
    recipientFor(next),
    now,
  );
  return ok(withRecord(book, next), [msg], { type: 'match-active', matchId, peer: rec.peer, expiresAt });
}

/** Decline silently: nothing is sent, the requester's request just expires. */
export function declineMatch(book: MatchBook, matchId: string, opts: { now: Date }): Transition {
  const rec = book.matches[matchId];
  if (!rec) return refuse('unknown-match');
  if (rec.role !== 'target' || rec.status !== 'incoming') return refuse('not-incoming');
  return ok(withRecord(book, endRecord(rec, 'declined', sec(opts.now))), [], { type: 'declined', matchId });
}

// --- Consent and quiet pause ---------------------------------------------------------

export function setConsent(book: MatchBook, matchId: string, consent: SketchConsent): Transition {
  const rec = book.matches[matchId];
  if (!rec) return refuse('unknown-match');
  if (ended(rec)) return refuse('ended');
  const bad = checkConsent(consent);
  if (bad) return refuse(bad);
  return ok(withRecord(book, { ...rec, consent }), [], { type: 'consent-updated', matchId });
}

/**
 * Quiet pause (D2). Local only: the sketch schedule continues and each sketch
 * re-sends the same real items in a fresh envelope (core `buildSketch`). Nothing is
 * sent to the peer to say so.
 */
export function setPaused(book: MatchBook, matchId: string, paused: boolean): Transition {
  const rec = book.matches[matchId];
  if (!rec) return refuse('unknown-match');
  return setConsent(book, matchId, { ...rec.consent, paused });
}

// --- Previews (PSI-cardinality) ------------------------------------------------------

/**
 * Requester asks for a preview of a pending match. Recorded in the requester's own
 * core preview state too, so an honest client self-enforces the per-requester and
 * per-pair limits.
 */
export function requestMatchPreview(book: MatchBook, matchId: string, opts: { previewId: string; now: Date }): Transition {
  const rec = book.matches[matchId];
  const now = sec(opts.now);
  if (!rec) return refuse('unknown-match');
  if (rec.role !== 'requester' || rec.status !== 'requested') return refuse('not-requested');
  if (rec.preview) return refuse('preview-exists');
  if (!HEX64.test(opts.previewId)) return refuse('bad-id');
  const r = requestPreview(book.previews, { id: opts.previewId, requester: book.self, target: rec.peer, now: opts.now }, book.previewPolicy);
  if (!r.ok) return refuse(`preview-${r.reason}`);
  const next: MatchRecord = { ...rec, preview: { id: opts.previewId, role: 'requester', stage: 'requested', requestedAt: now } };
  const msg = control(next, 'previewRequest', { v: 1, matchId, issuedAt: now, previewId: opts.previewId }, senderFor(next), recipientFor(next), now);
  return ok({ ...withRecord(book, next), previews: r.state }, [msg]);
}

/** Accepted previews the target may still grant this rolling year (core budget, max 8). */
export function previewBudget(book: MatchBook, now: Date): number {
  return previewBudgetRemaining(book.previews, book.self, now, book.previewPolicy);
}

/**
 * The target answers a preview request. Acceptance is the user's explicit choice;
 * core `respondToPreview` refuses it once the yearly budget is spent, and that
 * refusal goes out as an ordinary decline. `psiRequest` (base64) is the target's
 * PSI request over its padded set, required to accept.
 */
export function respondToMatchPreview(
  book: MatchBook,
  matchId: string,
  opts: { accept: boolean; psiRequest?: string; now: Date },
): Transition {
  const rec = book.matches[matchId];
  const now = sec(opts.now);
  if (!rec) return refuse('unknown-match');
  const p = rec.preview;
  if (rec.role !== 'target' || ended(rec) || !p || p.role !== 'target' || p.stage !== 'requested') return refuse('no-pending-preview');
  const r = respondToPreview(book.previews, p.id, { by: book.self, accept: opts.accept, now: opts.now }, book.previewPolicy);
  let accept = opts.accept;
  let previews = book.previews;
  let refusal: string | undefined;
  if (r.ok) {
    if (opts.accept && !opts.psiRequest) return refuse('psi-request-required');
    previews = r.state;
  } else if (r.reason === 'target-budget') {
    // Budget spent: send a plain decline, so the requester can't tell why.
    refusal = r.reason;
    accept = false;
    const d = respondToPreview(book.previews, p.id, { by: book.self, accept: false, now: opts.now }, book.previewPolicy);
    if (d.ok) previews = d.state;
  } else {
    return refuse(`preview-${r.reason}`);
  }
  const next: MatchRecord = { ...rec, preview: { ...p, stage: accept ? 'accepted' : 'declined' } };
  const msg = control(
    next,
    'previewResponse',
    { v: 1, matchId, issuedAt: now, previewId: p.id, accept, psiRequest: accept ? opts.psiRequest! : '' },
    senderFor(next),
    recipientFor(next),
    now,
  );
  const event: MatchEvent | undefined = accept ? undefined : { type: 'preview-declined', matchId, previewId: p.id, ...(refusal ? { refusal } : {}) };
  return ok({ ...withRecord(book, next), previews }, [msg], event);
}

/** Requester sends its PSI answer (server setup + response over its padded set). */
export function answerMatchPreview(
  book: MatchBook,
  matchId: string,
  opts: { setSize: number; psiSetup: string; psiResponse: string; now: Date },
): Transition {
  const rec = book.matches[matchId];
  const now = sec(opts.now);
  if (!rec) return refuse('unknown-match');
  const p = rec.preview;
  if (rec.role !== 'requester' || ended(rec) || !p || p.stage !== 'accepted') return refuse('no-accepted-preview');
  const next: MatchRecord = { ...rec, preview: { ...p, stage: 'answered' } };
  const msg = control(
    next,
    'previewAnswer',
    { v: 1, matchId, issuedAt: now, previewId: p.id, setSize: opts.setSize, psiSetup: opts.psiSetup, psiResponse: opts.psiResponse },
    senderFor(next),
    recipientFor(next),
    now,
  );
  return ok(withRecord(book, next), [msg]);
}

/**
 * Target, right before computing the intersection: core `startPreviewRun` checks
 * the acceptance is fresh and both sets meet `minSetSize`, and marks it done (one
 * run per acceptance). On refusal nothing is sent.
 */
export function startTargetPreviewRun(book: MatchBook, matchId: string, opts: { targetSetSize: number; now: Date }): Transition {
  const rec = book.matches[matchId];
  if (!rec) return refuse('unknown-match');
  const p = rec.preview;
  if (rec.role !== 'target' || ended(rec) || !p || p.stage !== 'answered' || p.requesterSetSize === undefined) {
    return refuse('no-answered-preview');
  }
  const r = startPreviewRun(
    book.previews,
    p.id,
    { now: opts.now, requesterSetSize: p.requesterSetSize, targetSetSize: opts.targetSetSize },
    book.previewPolicy,
  );
  if (!r.ok) {
    const next: MatchRecord = { ...rec, preview: { ...p, stage: 'failed' } };
    return { ok: true, book: withRecord(book, next), outbox: [], event: { type: 'preview-failed', matchId, previewId: p.id, reason: r.reason } };
  }
  return ok({ ...withRecord(book, { ...rec, preview: { ...p, stage: 'running' } }), previews: r.state });
}

/**
 * Target: noise the true intersection size on this device with core
 * `noisyPreviewCardinality` (discrete Laplace, the policy's ε ≤ 0.5, floor ≥ 5)
 * and send only that. The exact count never enters the outbox. Use `cryptoRng()`.
 */
export function completeTargetPreview(book: MatchBook, matchId: string, opts: { trueCount: number; rng: Rng; now: Date }): Transition {
  const rec = book.matches[matchId];
  const now = sec(opts.now);
  if (!rec) return refuse('unknown-match');
  const p = rec.preview;
  if (rec.role !== 'target' || ended(rec) || !p || p.stage !== 'running') return refuse('preview-not-running');
  const noisy = noisyPreviewCardinality(opts.trueCount, opts.rng, book.previewPolicy);
  const floor = book.previewPolicy.floor!;
  const next: MatchRecord = { ...rec, preview: { ...p, stage: 'done' } };
  const msg = control(
    next,
    'previewResult',
    { v: 1, matchId, issuedAt: now, previewId: p.id, floor, belowFloor: noisy.belowFloor, value: noisy.belowFloor ? null : noisy.value! },
    senderFor(next),
    recipientFor(next),
    now,
  );
  return ok(withRecord(book, next), [msg]);
}

/**
 * Bucket and label for a received noised value. Mirrors core
 * `noisyPreviewCardinality`'s thresholds (core has no exported helper for this).
 */
export function previewDisplay(belowFloor: boolean, value: number | null, floor: number): NoisyCardinality {
  if (belowFloor || value === null) return { belowFloor: true, bucket: 'fewer-than-floor', label: `<${floor}` };
  const bucket: PreviewBucket = value < Math.max(10, floor + 1) ? 'a-few' : value < 20 ? 'some' : 'a-lot';
  const label = bucket === 'a-few' ? 'a few in common' : bucket === 'some' ? 'some in common' : 'a lot in common';
  return { belowFloor: false, value, bucket, label };
}

// --- Sketches ------------------------------------------------------------------------

/** Active matches whose next sketch is due on the fixed schedule. Paused ones included (D2). */
export function dueSketches(book: MatchBook, now: Date): string[] {
  const t = sec(now);
  return Object.values(book.matches)
    .filter((r) => r.status === 'active' && r.expiresAt !== undefined && r.expiresAt > t)
    .filter((r) => r.lastSketchSentAt === undefined || t - r.lastSketchSentAt >= MATCH_TIMING.sketchIntervalSec)
    .map((r) => r.matchId);
}

/**
 * Build this epoch's sketch for one match with core `buildSketch` (NIP-17 transport,
 * 128-item cap, consent filters, quiet pause) and queue it for the peer's match key.
 */
export function buildMatchSketch(
  book: MatchBook,
  matchId: string,
  opts: { history: readonly HistoryEntry[]; rng: Rng; now: Date; ttlSec?: number },
): Transition {
  const rec = book.matches[matchId];
  const now = sec(opts.now);
  if (!rec) return refuse('unknown-match');
  if (rec.status !== 'active' || !rec.myKey || !rec.peerKey) return refuse('not-active');
  if (rec.expiresAt !== undefined && now >= rec.expiresAt) return refuse('expired');
  const ttlSec = Math.min(opts.ttlSec ?? MATCH_TIMING.wrapTtlSec, MATCH_TIMING.wrapTtlSec);
  // Ids with characters JSON must escape would grow again inside the rumor and could
  // push a 128-bucket gift wrap past 64 KiB. Canonical URLs never contain them.
  const history = opts.history.filter((h) => WIRE_SAFE_ID.test(h.videoId));
  const { sketch, state } = buildSketch(history, rec.consent, rec.sketch, { now: opts.now, rng: opts.rng, transport: 'nip17', ttlSec });
  const next: MatchRecord = { ...rec, sketch: state, lastSketchSentAt: now };
  const msg: OutgoingMessage = {
    matchId,
    kind: MATCH_KINDS.sketch,
    content: encodeSketch(sketch),
    from: { type: 'match', key: rec.myKey },
    to: rec.peerKey,
    expiration: sketch.expiresAt,
  };
  return ok(withRecord(book, next), [msg]);
}

// --- Renewal and key rotation --------------------------------------------------------

export function proposeRenew(
  book: MatchBook,
  matchId: string,
  opts: { renewId: string; myNewKey: MatchKeyPair; durationDays?: number; now: Date },
): Transition {
  const rec = book.matches[matchId];
  const now = sec(opts.now);
  if (!rec) return refuse('unknown-match');
  if (rec.status !== 'active' || !rec.myKey || !rec.peerKey) return refuse('not-active');
  if (rec.renew) return refuse('renew-pending');
  if (!HEX64.test(opts.renewId)) return refuse('bad-id');
  const days = opts.durationDays ?? MATCH_TIMING.maxDurationDays;
  if (!Number.isInteger(days) || days < 1 || days > MATCH_TIMING.maxDurationDays) return refuse('bad-duration');
  const expiresAt = now + days * 86_400;
  const next: MatchRecord = { ...rec, renew: { renewId: opts.renewId, proposedBy: 'me', issuedAt: now, expiresAt, myNewKey: opts.myNewKey } };
  const msg = control(
    next,
    'renew',
    { v: 1, matchId, issuedAt: now, renewId: opts.renewId, role: 'propose', matchKey: opts.myNewKey.pubkey, expiresAt },
    { type: 'match', key: rec.myKey },
    rec.peerKey,
    now,
  );
  return ok(withRecord(book, next), [msg]);
}

function rotate(rec: MatchRecord, myNewKey: MatchKeyPair, peerNewKey: string, expiresAt: number, now: number): MatchRecord {
  const until = now + MATCH_TIMING.keyGraceSec;
  const { renew: _r, ...rest } = rec;
  return {
    ...rest,
    expiresAt,
    myKey: myNewKey,
    myPrevKey: rec.myKey ? { ...rec.myKey, until } : undefined,
    peerKey: peerNewKey,
    peerPrevKey: rec.peerKey ? { pubkey: rec.peerKey, until } : undefined,
  };
}

/** Consent to the peer's renewal proposal; both sides switch to their new keys. */
export function acceptRenew(book: MatchBook, matchId: string, opts: { myNewKey: MatchKeyPair; now: Date }): Transition {
  const rec = book.matches[matchId];
  const now = sec(opts.now);
  if (!rec) return refuse('unknown-match');
  const r = rec.renew;
  if (rec.status !== 'active' || !rec.myKey || !rec.peerKey || !r || r.proposedBy !== 'peer' || !r.peerNewKey) return refuse('no-renew-proposal');
  if (r.expiresAt <= now) return refuse('expired');
  // Sent under the current keys: the proposer still listens there and expects my current key.
  const msg = control(
    rec,
    'renew',
    { v: 1, matchId, issuedAt: now, renewId: r.renewId, role: 'accept', matchKey: opts.myNewKey.pubkey, expiresAt: r.expiresAt },
    { type: 'match', key: rec.myKey },
    rec.peerKey,
    now,
  );
  const next = rotate(rec, opts.myNewKey, r.peerNewKey, r.expiresAt, now);
  return ok(withRecord(book, next), [msg], { type: 'renewed', matchId, expiresAt: r.expiresAt });
}

// --- Revoke --------------------------------------------------------------------------

/**
 * End a match now (or withdraw my request). Sends a revoke when the peer knows a
 * key to expect it from, then wipes my keys and both sketches. A target that has
 * not accepted should use `declineMatch` (silent) instead.
 */
export function revokeMatch(book: MatchBook, matchId: string, opts: { now: Date }): Transition {
  const rec = book.matches[matchId];
  const now = sec(opts.now);
  if (!rec) return refuse('unknown-match');
  if (ended(rec)) return refuse('ended');
  if (rec.role === 'target' && rec.status === 'incoming') return declineMatch(book, matchId, opts);
  const msg = control(rec, 'revoke', { v: 1, matchId, issuedAt: now }, senderFor(rec), recipientFor(rec), now);
  return ok(withRecord(book, endRecord(rec, 'revoked', now)), [msg], { type: 'revoked', matchId, by: 'me' });
}

// --- Expiry and housekeeping ---------------------------------------------------------

/**
 * Time-driven transitions: active matches past `expiresAt` expire (keys wiped);
 * unanswered requests and renewals expire after 7 days; old keys leave their grace
 * period; tombstones and core preview records are pruned.
 */
export function tick(book: MatchBook, opts: { now: Date }): { book: MatchBook; events: MatchEvent[] } {
  const now = sec(opts.now);
  const events: MatchEvent[] = [];
  const matches: Record<string, MatchRecord> = {};
  for (const rec0 of Object.values(book.matches)) {
    let rec = rec0;
    if (ended(rec)) {
      if (rec.endedAt !== undefined && now - rec.endedAt > MATCH_TIMING.tombstoneSec) continue;
      matches[rec.matchId] = rec;
      continue;
    }
    if (rec.status === 'active' && rec.expiresAt !== undefined && now >= rec.expiresAt) {
      events.push({ type: 'expired', matchId: rec.matchId, status: rec.status });
      matches[rec.matchId] = endRecord(rec, 'expired', now);
      continue;
    }
    if ((rec.status === 'requested' || rec.status === 'incoming') && now - rec.requestedAt > MATCH_TIMING.requestTtlSec) {
      events.push({ type: 'expired', matchId: rec.matchId, status: rec.status });
      matches[rec.matchId] = endRecord(rec, 'expired', now);
      continue;
    }
    if (rec.renew && now - rec.renew.issuedAt > MATCH_TIMING.requestTtlSec) {
      const { renew: _r, ...rest } = rec;
      rec = rest;
    }
    if (rec.myPrevKey && rec.myPrevKey.until <= now) {
      const { myPrevKey: _k, ...rest } = rec;
      rec = rest;
    }
    if (rec.peerPrevKey && rec.peerPrevKey.until <= now) {
      const { peerPrevKey: _k, ...rest } = rec;
      rec = rest;
    }
    matches[rec.matchId] = rec;
  }
  return { book: { ...book, matches, previews: prunePreviews(book.previews, opts.now) }, events };
}

// --- Receiving -----------------------------------------------------------------------

function findByMatchId(book: MatchBook, matchId: string): MatchRecord | undefined {
  return Object.prototype.hasOwnProperty.call(book.matches, matchId) ? book.matches[matchId] : undefined;
}

function authentic(book: MatchBook, rec: MatchRecord, msg: IncomingMessage, now: number): string | undefined {
  if (!expectedPeerSealKeys(rec, now).includes(msg.sealPubkey)) return 'unexpected-sender';
  if (!myReceiveKeys(book, rec, now).includes(msg.recipientPubkey)) return 'unexpected-recipient';
  return undefined;
}

/**
 * Apply one unwrapped message (from `unwrap`). Checks, in order: the kind, the
 * content schema and freshness, that the match exists and is in the right state,
 * that the seal key is the one expected from this peer at this point, and that it
 * was addressed to one of my keys for this match. Sketches additionally go through
 * core `decodeSketch` (size before parse, bucket, expiry, epoch > last: T15).
 */
export function receiveMessage(book: MatchBook, msg: IncomingMessage, opts: { now: Date }): Transition {
  const name = matchKindName(msg.kind);
  if (!name) return refuse('unknown-kind');
  const now = sec(opts.now);
  if (name === 'sketch') return receiveSketch(book, msg, opts.now);
  let body: ControlMessages[ControlKindName];
  try {
    body = decodeControl(name, msg.content, { now: opts.now });
  } catch (e) {
    return refuse(e instanceof ValidationError ? `invalid: ${e.message}` : 'invalid');
  }

  if (name === 'matchRequest') {
    const m = body as ControlMessages['matchRequest'];
    if (msg.recipientPubkey !== book.self) return refuse('unexpected-recipient');
    if (msg.sealPubkey === book.self) return refuse('self-request');
    if (findByMatchId(book, m.matchId)) return refuse('duplicate-id');
    if (liveWithPeer(book, msg.sealPubkey)) return refuse('already-matched');
    if (now - m.issuedAt > MATCH_TIMING.requestTtlSec) return refuse('expired');
    const rec: MatchRecord = {
      matchId: m.matchId,
      role: 'target',
      peer: msg.sealPubkey,
      status: 'incoming',
      requestedAt: m.issuedAt,
      durationDays: m.durationDays,
      myKey: null,
      peerKey: m.matchKey,
      consent: DEFAULT_CONSENT,
      sketch: { epoch: 0 },
      peerEpoch: 0,
    };
    return ok(withRecord(book, rec), [], { type: 'match-requested', matchId: m.matchId, peer: rec.peer, durationDays: m.durationDays });
  }

  const rec = findByMatchId(book, body.matchId);
  if (!rec) return refuse('unknown-match');
  if (ended(rec)) return refuse('ended');
  const notAuthentic = authentic(book, rec, msg, now);
  if (notAuthentic) return refuse(notAuthentic);

  switch (name) {
    case 'matchAccept': {
      const m = body as ControlMessages['matchAccept'];
      if (rec.role !== 'requester' || rec.status !== 'requested') return refuse('not-requested');
      if (msg.sealPubkey !== rec.peer) return refuse('unexpected-sender');
      if (m.issuedAt - rec.requestedAt > MATCH_TIMING.requestTtlSec + MATCH_TIMING.clockSkewSec) return refuse('expired');
      if (m.expiresAt > m.issuedAt + rec.durationDays * 86_400) return refuse('too-long');
      if (m.expiresAt <= now) return refuse('expired');
      const next: MatchRecord = { ...rec, status: 'active', activatedAt: now, expiresAt: m.expiresAt, peerKey: m.matchKey };
      return ok(withRecord(book, next), [], { type: 'match-active', matchId: rec.matchId, peer: rec.peer, expiresAt: m.expiresAt });
    }
    case 'previewRequest': {
      const m = body as ControlMessages['previewRequest'];
      if (rec.role !== 'target' || rec.status !== 'incoming') return refuse('not-incoming');
      if (rec.preview) return refuse('preview-exists');
      const r = requestPreview(book.previews, { id: m.previewId, requester: rec.peer, target: book.self, now: opts.now }, book.previewPolicy);
      if (!r.ok) return refuse(`preview-${r.reason}`);
      const next: MatchRecord = { ...rec, preview: { id: m.previewId, role: 'target', stage: 'requested', requestedAt: now } };
      return ok({ ...withRecord(book, next), previews: r.state }, [], {
        type: 'preview-requested',
        matchId: rec.matchId,
        previewId: m.previewId,
        peer: rec.peer,
      });
    }
    case 'previewResponse': {
      const m = body as ControlMessages['previewResponse'];
      const p = rec.preview;
      if (rec.role !== 'requester' || !p || p.id !== m.previewId || p.stage !== 'requested') return refuse('no-pending-preview');
      if (!m.accept) {
        return ok(withRecord(book, { ...rec, preview: { ...p, stage: 'declined' } }), [], {
          type: 'preview-declined',
          matchId: rec.matchId,
          previewId: p.id,
        });
      }
      return ok(withRecord(book, { ...rec, preview: { ...p, stage: 'accepted' } }), [], {
        type: 'preview-accepted',
        matchId: rec.matchId,
        previewId: p.id,
        psiRequest: m.psiRequest,
      });
    }
    case 'previewAnswer': {
      const m = body as ControlMessages['previewAnswer'];
      const p = rec.preview;
      if (rec.role !== 'target' || !p || p.id !== m.previewId || p.stage !== 'accepted') return refuse('no-accepted-preview');
      const next: MatchRecord = { ...rec, preview: { ...p, stage: 'answered', requesterSetSize: m.setSize } };
      return ok(withRecord(book, next), [], {
        type: 'preview-answer',
        matchId: rec.matchId,
        previewId: p.id,
        setSize: m.setSize,
        psiSetup: m.psiSetup,
        psiResponse: m.psiResponse,
      });
    }
    case 'previewResult': {
      const m = body as ControlMessages['previewResult'];
      const p = rec.preview;
      if (rec.role !== 'requester' || !p || p.id !== m.previewId || p.stage !== 'answered') return refuse('no-answered-preview');
      const result = { ...previewDisplay(m.belowFloor, m.value, m.floor), floor: m.floor };
      return ok(withRecord(book, { ...rec, preview: { ...p, stage: 'done', result } }), [], {
        type: 'preview-result',
        matchId: rec.matchId,
        previewId: p.id,
        result,
      });
    }
    case 'renew': {
      const m = body as ControlMessages['renew'];
      if (rec.status !== 'active' || !rec.myKey) return refuse('not-active');
      if (m.role === 'propose') {
        if (m.expiresAt <= now) return refuse('expired');
        if (rec.renew?.proposedBy === 'me' && rec.renew.renewId < m.renewId) {
          return refuse('renew-conflict'); // both proposed: the smaller id wins; the peer will accept mine
        }
        const renew: PendingRenew = { renewId: m.renewId, proposedBy: 'peer', issuedAt: m.issuedAt, expiresAt: m.expiresAt, peerNewKey: m.matchKey };
        return ok(withRecord(book, { ...rec, renew }), [], { type: 'renew-requested', matchId: rec.matchId, expiresAt: m.expiresAt });
      }
      const r = rec.renew;
      if (!r || r.proposedBy !== 'me' || r.renewId !== m.renewId || !r.myNewKey) return refuse('no-renew-proposal');
      if (m.expiresAt !== r.expiresAt) return refuse('renew-mismatch');
      const next = rotate(rec, r.myNewKey, m.matchKey, r.expiresAt, now);
      return ok(withRecord(book, next), [], { type: 'renewed', matchId: rec.matchId, expiresAt: r.expiresAt });
    }
    case 'revoke': {
      return ok(withRecord(book, endRecord(rec, 'revoked', now)), [], { type: 'revoked', matchId: rec.matchId, by: 'peer' });
    }
    default:
      return refuse('unexpected-kind');
  }
}

function receiveSketch(book: MatchBook, msg: IncomingMessage, nowDate: Date): Transition {
  const now = sec(nowDate);
  // Sketch content is core's format (no matchId); the match is found by the key it
  // was addressed to. Only match keys receive sketches, never the identity key.
  const rec = Object.values(book.matches).find(
    (r) =>
      !ended(r) &&
      (r.myKey?.pubkey === msg.recipientPubkey ||
        (r.myPrevKey && r.myPrevKey.until > now && r.myPrevKey.pubkey === msg.recipientPubkey) ||
        r.renew?.myNewKey?.pubkey === msg.recipientPubkey),
  );
  if (!rec) return refuse('unknown-match');
  if (rec.status !== 'active') return refuse('not-active');
  if (rec.expiresAt !== undefined && now >= rec.expiresAt) return refuse('expired');
  const sealKeys = [rec.peerKey, rec.peerPrevKey && rec.peerPrevKey.until > now ? rec.peerPrevKey.pubkey : undefined];
  if (!sealKeys.includes(msg.sealPubkey)) return refuse('unexpected-sender');
  let sketch: TasteSketch;
  try {
    sketch = decodeSketch(msg.content, { now: nowDate, lastEpoch: rec.peerEpoch, transport: 'nip17' });
  } catch (e) {
    return refuse(e instanceof ValidationError ? `invalid: ${e.message}` : 'invalid');
  }
  const next: MatchRecord = { ...rec, peerEpoch: sketch.epoch, peerSketch: sketch, peerSketchAt: now };
  return ok(withRecord(book, next), [], { type: 'sketch', matchId: rec.matchId, epoch: sketch.epoch });
}
