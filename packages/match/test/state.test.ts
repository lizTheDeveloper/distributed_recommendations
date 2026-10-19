// The pure state machine, driven directly: outbox messages are handed to the peer
// as if unwrapped (seal key = sender key, recipient = `to`), no crypto transport.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PREVIEW_POLICY, buildSketch, encodeSketch, noisyPreviewCardinality, seededRng, sketchItems } from '../src/core.ts';
import { generateMatchKey } from '../src/keys.ts';
import { MATCH_KINDS } from '../src/kinds.ts';
import { decodeControl } from '../src/messages.ts';
import type { IncomingMessage, MatchBook, OutgoingMessage, Transition } from '../src/state.ts';
import {
  acceptMatch,
  acceptRenew,
  answerMatchPreview,
  buildMatchSketch,
  completeTargetPreview,
  createMatchBook,
  inboxKeys,
  previewDisplay,
  proposeRenew,
  receiveMessage,
  requestMatch,
  requestMatchPreview,
  respondToMatchPreview,
  revokeMatch,
  setConsent,
  setPaused,
  startTargetPreviewRun,
  tick,
} from '../src/state.ts';
import { DAY, T0, history, idGen, range, video } from './helpers.ts';

const at = (days: number) => new Date(T0.getTime() + days * DAY);

function okT(t: Transition): Extract<Transition, { ok: true }> {
  if (!t.ok) assert.fail(`refused: ${t.reason}`);
  return t;
}

function deliver(m: OutgoingMessage, senderIdentity: string): IncomingMessage {
  return { kind: m.kind, content: m.content, sealPubkey: m.from.type === 'identity' ? senderIdentity : m.from.key.pubkey, recipientPubkey: m.to };
}

interface Pair {
  a: MatchBook;
  b: MatchBook;
  matchId: string;
  A: string;
  B: string;
}

function people(): { a: MatchBook; b: MatchBook; A: string; B: string } {
  const A = generateMatchKey().pubkey;
  const B = generateMatchKey().pubkey;
  return { a: createMatchBook(A), b: createMatchBook(B), A, B };
}

/** Request + accept, at T0. */
function activePair(): Pair {
  const { a, b, A, B } = people();
  const matchId = idGen(1)();
  const req = okT(requestMatch(a, { matchId, peer: B, myKey: generateMatchKey(), now: T0 }));
  const inc = okT(receiveMessage(b, deliver(req.outbox[0], A), { now: T0 }));
  const acc = okT(acceptMatch(inc.book, matchId, { myKey: generateMatchKey(), now: T0 }));
  const act = okT(receiveMessage(req.book, deliver(acc.outbox[0], B), { now: T0 }));
  return { a: act.book, b: acc.book, matchId, A, B };
}

test('request refusals', () => {
  const { a, A, B } = people();
  const id = idGen(2)();
  const k = generateMatchKey();
  assert.deepEqual(requestMatch(a, { matchId: id, peer: A, myKey: k, now: T0 }), { ok: false, reason: 'self-request' });
  assert.deepEqual(requestMatch(a, { matchId: id, peer: B, myKey: k, now: T0, durationDays: 91 }), { ok: false, reason: 'bad-duration' });
  const bad = { windowDays: 0, includeFinished: false, excludedTags: [], excludedHours: [], paused: false };
  assert.deepEqual(requestMatch(a, { matchId: id, peer: B, myKey: k, now: T0, consent: bad }), { ok: false, reason: 'consent-window' });
  const r = okT(requestMatch(a, { matchId: id, peer: B, myKey: k, now: T0 }));
  assert.deepEqual(requestMatch(r.book, { matchId: id, peer: B, myKey: k, now: T0 }), { ok: false, reason: 'duplicate-id' });
  assert.deepEqual(requestMatch(r.book, { matchId: idGen(3)(), peer: B, myKey: k, now: T0 }), { ok: false, reason: 'already-matched' });
  // The request is sealed by my identity, sent to the peer's identity, and carries my match key.
  const out = r.outbox[0];
  assert.equal(out.from.type, 'identity');
  assert.equal(out.to, B);
  assert.equal(decodeControl('matchRequest', out.content, { now: T0 }).matchKey, k.pubkey);
});

test('the book holds only JSON values', () => {
  const p = activePair();
  assert.deepEqual(JSON.parse(JSON.stringify(p.a)), p.a);
});

test('an accept is only taken from the target identity, within 90 days and the requested duration', () => {
  const { a, b, A, B } = people();
  const matchId = idGen(4)();
  const req = okT(requestMatch(a, { matchId, peer: B, myKey: generateMatchKey(), now: T0, durationDays: 30 }));
  const inc = okT(receiveMessage(b, deliver(req.outbox[0], A), { now: T0 }));
  const acc = okT(acceptMatch(inc.book, matchId, { myKey: generateMatchKey(), now: T0, durationDays: 60 }));
  assert.equal(acc.book.matches[matchId].expiresAt, Math.floor(T0.getTime() / 1000) + 30 * 86_400, 'the shorter duration wins');
  const msg = deliver(acc.outbox[0], B);
  const stranger = generateMatchKey().pubkey;
  assert.deepEqual(receiveMessage(req.book, { ...msg, sealPubkey: stranger }, { now: T0 }), { ok: false, reason: 'unexpected-sender' });
  okT(receiveMessage(req.book, msg, { now: T0 }));
  // Too late to accept.
  assert.deepEqual(acceptMatch(inc.book, matchId, { myKey: generateMatchKey(), now: at(8) }), { ok: false, reason: 'expired' });
});

test('sketch receive: epoch replay, identity seal, stranger key and identity inbox are rejected (T15)', () => {
  const p = activePair();
  const s1 = okT(buildMatchSketch(p.a, p.matchId, { history: history(range(0, 20), T0), rng: seededRng(1), now: T0 }));
  const m = deliver(s1.outbox[0], p.A);
  assert.equal(m.kind, MATCH_KINDS.sketch);
  const r1 = okT(receiveMessage(p.b, m, { now: T0 }));
  assert.equal(r1.book.matches[p.matchId].peerEpoch, 1);
  const replay = receiveMessage(r1.book, m, { now: T0 });
  assert.ok(!replay.ok && /not newer/.test(replay.reason), JSON.stringify(replay));
  assert.deepEqual(receiveMessage(p.b, { ...m, sealPubkey: p.A }, { now: T0 }), { ok: false, reason: 'unexpected-sender' });
  assert.deepEqual(receiveMessage(p.b, { ...m, sealPubkey: generateMatchKey().pubkey }, { now: T0 }), { ok: false, reason: 'unexpected-sender' });
  assert.deepEqual(receiveMessage(p.b, { ...m, recipientPubkey: p.B }, { now: T0 }), { ok: false, reason: 'unknown-match' });
  // Expired sketch (core validateSketch).
  const late = receiveMessage(p.b, m, { now: at(15) });
  assert.ok(!late.ok && /expired/.test(late.reason));
  // A 256-bucket sketch (MLS only) is refused over NIP-17.
  const consent = p.a.matches[p.matchId].consent;
  const mls = buildSketch(history(range(0, 200), T0), consent, { epoch: 0 }, { now: T0, rng: seededRng(4), transport: 'mls' }).sketch;
  assert.equal(mls.items.length, 256);
  const r256 = receiveMessage(p.b, { ...m, content: encodeSketch(mls) }, { now: T0 });
  assert.ok(!r256.ok && /at most 15872 bytes/.test(r256.reason), JSON.stringify(r256));
});

test('quiet pause (D2): same real items, fresh envelope, minus newly excluded videos; no message', () => {
  const p = activePair();
  const h1 = history(range(0, 20), T0);
  const s1 = okT(buildMatchSketch(p.a, p.matchId, { history: h1, rng: seededRng(1), now: T0 }));
  const paused = okT(setPaused(s1.book, p.matchId, true));
  assert.equal(paused.outbox.length, 0);
  const consent = { ...paused.book.matches[p.matchId].consent, excludedVideos: [video(3)] };
  const excl = okT(setConsent(paused.book, p.matchId, consent));
  const h2 = [...history(range(100, 120), at(7)), ...h1];
  const s2 = okT(buildMatchSketch(excl.book, p.matchId, { history: h2, rng: seededRng(2), now: at(7) }));
  const before = s1.book.matches[p.matchId].sketch.lastSent!;
  const after = s2.book.matches[p.matchId].sketch.lastSent!;
  assert.equal(after.epoch, 2);
  assert.notEqual(after.nonce, before.nonce);
  const expected = [...sketchItems(before)].filter((x) => x !== video(3)).sort();
  assert.deepEqual([...sketchItems(after)].sort(), expected);
  assert.equal(s2.outbox[0].content.length, s1.outbox[0].content.length);
});

test('ids that JSON must escape never go into a sketch', () => {
  const p = activePair();
  const h = [
    { videoId: 'https://tube.example/videos/watch/"quoted"', at: new Date(T0.getTime() - 1000), kind: 'endorse' as const, tags: [] },
    ...history([1], T0),
  ];
  const s = okT(buildMatchSketch(p.a, p.matchId, { history: h, rng: seededRng(1), now: T0 }));
  assert.deepEqual([...sketchItems(s.book.matches[p.matchId].sketch.lastSent!)], [video(1)]);
});

test('preview: target-side budget of 8 per rolling year, across all requesters (core policy)', () => {
  let target = createMatchBook(generateMatchKey().pubkey);
  const results: string[] = [];
  for (let i = 0; i < 10; i++) {
    const A = generateMatchKey().pubkey;
    const a = createMatchBook(A);
    const matchId = idGen(100 + i)();
    const req = okT(requestMatch(a, { matchId, peer: target.self, myKey: generateMatchKey(), now: at(i) }));
    const pr = okT(requestMatchPreview(req.book, matchId, { previewId: idGen(200 + i)(), now: at(i) }));
    target = okT(receiveMessage(target, deliver(req.outbox[0], A), { now: at(i) })).book;
    target = okT(receiveMessage(target, deliver(pr.outbox[0], A), { now: at(i) })).book;
    const resp = okT(respondToMatchPreview(target, matchId, { accept: true, psiRequest: 'AAAA', now: at(i) }));
    target = resp.book;
    const wire = decodeControl('previewResponse', resp.outbox[0].content, { now: at(i) });
    results.push(wire.accept ? 'accept' : `decline(${resp.event?.type === 'preview-declined' ? resp.event.refusal : ''})`);
    if (!wire.accept) assert.equal(wire.psiRequest, '');
  }
  assert.deepEqual(results, [...Array(8).fill('accept'), 'decline(target-budget)', 'decline(target-budget)']);
});

test('preview: the target noises on-device; only the noised, floored value is sent', () => {
  const { a, b, A, B } = people();
  const matchId = idGen(5)();
  const req = okT(requestMatch(a, { matchId, peer: B, myKey: generateMatchKey(), now: T0 }));
  const pr = okT(requestMatchPreview(req.book, matchId, { previewId: idGen(6)(), now: T0 }));
  let tb = okT(receiveMessage(b, deliver(req.outbox[0], A), { now: T0 })).book;
  tb = okT(receiveMessage(tb, deliver(pr.outbox[0], A), { now: T0 })).book;
  const resp = okT(respondToMatchPreview(tb, matchId, { accept: true, psiRequest: 'AAAA', now: T0 }));
  assert.equal(resp.outbox[0].from.type, 'identity', 'the target has not announced a match key yet');
  assert.equal(resp.outbox[0].to, req.book.matches[matchId].myKey!.pubkey, "sent to the requester's match key");
  const ra = okT(receiveMessage(pr.book, deliver(resp.outbox[0], B), { now: T0 }));
  assert.equal(ra.event?.type, 'preview-accepted');
  const ans = okT(answerMatchPreview(ra.book, matchId, { setSize: 40, psiSetup: 'AAAA', psiResponse: 'AAAA', now: T0 }));
  const rb = okT(receiveMessage(resp.book, deliver(ans.outbox[0], A), { now: T0 }));
  // Too small a target set: core startPreviewRun refuses and nothing is sent.
  const tiny = okT(startTargetPreviewRun(rb.book, matchId, { targetSetSize: 19, now: T0 }));
  assert.equal(tiny.event?.type, 'preview-failed');
  assert.equal(tiny.outbox.length, 0);
  // Normal run: many draws with the true count 7 show noise, never a 0-4 value on the wire.
  const run = okT(startTargetPreviewRun(rb.book, matchId, { targetSetSize: 40, now: T0 }));
  const seenValues = new Set<string>();
  for (let s = 0; s < 60; s++) {
    const done = okT(completeTargetPreview(run.book, matchId, { trueCount: 7, rng: seededRng(s), now: T0 }));
    const wire = decodeControl('previewResult', done.outbox[0].content, { now: T0 });
    assert.ok(wire.belowFloor ? wire.value === null : wire.value! >= 5);
    seenValues.add(String(wire.value));
  }
  assert.ok(seenValues.size > 3, `noise: ${[...seenValues]}`);
  assert.ok(seenValues.has('null'), 'sometimes below the floor');
  // Each acceptance allows exactly one run.
  assert.deepEqual(startTargetPreviewRun(run.book, matchId, { targetSetSize: 40, now: T0 }), { ok: false, reason: 'no-answered-preview' });
});

test('previewDisplay matches core noisyPreviewCardinality buckets and labels', () => {
  const rng = seededRng(9);
  for (let n = 0; n < 40; n++) {
    const noisy = noisyPreviewCardinality(n, rng, DEFAULT_PREVIEW_POLICY);
    assert.deepEqual(previewDisplay(noisy.belowFloor, noisy.value ?? null, 5), noisy);
  }
});

test('preview policy cannot be weakened (core parsePreviewPolicy)', () => {
  assert.throws(() => createMatchBook(generateMatchKey().pubkey, { ...DEFAULT_PREVIEW_POLICY, epsilon: 1 }));
  assert.throws(() => createMatchBook(generateMatchKey().pubkey, { ...DEFAULT_PREVIEW_POLICY, floor: 4 }));
  assert.throws(() => createMatchBook(generateMatchKey().pubkey, { ...DEFAULT_PREVIEW_POLICY, maxAcceptedPerTargetPerYear: 9 }));
});

test('renew rotates keys; old keys keep working through the grace period, then stop', () => {
  const p = activePair();
  const oldA = p.a.matches[p.matchId].myKey!;
  const prop = okT(proposeRenew(p.a, p.matchId, { renewId: idGen(7)(), myNewKey: generateMatchKey(), now: at(80) }));
  const pending = prop.book.matches[p.matchId].renew!.myNewKey!;
  assert.ok(inboxKeys(prop.book, at(80)).matchKeys.some((k) => k.pubkey === pending.pubkey), 'listens on the pending key');
  const rq = okT(receiveMessage(p.b, deliver(prop.outbox[0], p.A), { now: at(80) }));
  assert.equal(rq.event?.type, 'renew-requested');
  const acc = okT(acceptRenew(rq.book, p.matchId, { myNewKey: generateMatchKey(), now: at(80) }));
  const done = okT(receiveMessage(prop.book, deliver(acc.outbox[0], p.B), { now: at(80) }));
  const a2 = done.book.matches[p.matchId];
  assert.equal(a2.myKey!.pubkey, pending.pubkey);
  assert.equal(a2.myPrevKey!.pubkey, oldA.pubkey);
  assert.equal(a2.expiresAt, Math.floor(at(80).getTime() / 1000) + 90 * 86_400);
  // B's sketch sealed with B's *old* key still arrives during the grace period.
  const b2 = acc.book.matches[p.matchId];
  const oldBKey = b2.myPrevKey!;
  const stale = okT(buildMatchSketch(p.b, p.matchId, { history: history(range(0, 5), at(80)), rng: seededRng(3), now: at(80) }));
  okT(receiveMessage(done.book, deliver(stale.outbox[0], p.B), { now: at(81) }));
  assert.equal(stale.outbox[0].from.type === 'match' && stale.outbox[0].from.key.pubkey, oldBKey.pubkey);
  // After the grace period the old keys are dropped.
  const later = tick(done.book, { now: at(95) }).book;
  assert.equal(later.matches[p.matchId].myPrevKey, undefined);
  assert.equal(later.matches[p.matchId].peerPrevKey, undefined);
  assert.ok(!inboxKeys(later, at(95)).matchKeys.some((k) => k.pubkey === oldA.pubkey));
  // The match did not expire at day 90 because it was renewed.
  assert.equal(later.matches[p.matchId].status, 'active');
});

test('simultaneous renew proposals: the smaller id wins on both sides', () => {
  const p = activePair();
  const [lo, hi] = [idGen(8)(), idGen(9)()].sort();
  const pa = okT(proposeRenew(p.a, p.matchId, { renewId: lo, myNewKey: generateMatchKey(), now: at(1) }));
  const pb = okT(proposeRenew(p.b, p.matchId, { renewId: hi, myNewKey: generateMatchKey(), now: at(1) }));
  assert.deepEqual(receiveMessage(pa.book, deliver(pb.outbox[0], p.B), { now: at(1) }), { ok: false, reason: 'renew-conflict' });
  const atB = okT(receiveMessage(pb.book, deliver(pa.outbox[0], p.A), { now: at(1) }));
  assert.equal(atB.book.matches[p.matchId].renew!.renewId, lo);
  assert.equal(atB.book.matches[p.matchId].renew!.proposedBy, 'peer');
});

test('revoke: only the peer can revoke; keys and sketches are wiped; replays are ignored', () => {
  const p = activePair();
  const s = okT(buildMatchSketch(p.b, p.matchId, { history: history(range(0, 5), T0), rng: seededRng(1), now: T0 }));
  const a1 = okT(receiveMessage(p.a, deliver(s.outbox[0], p.B), { now: T0 })).book;
  const rv = okT(revokeMatch(s.book, p.matchId, { now: T0 }));
  const msg = deliver(rv.outbox[0], p.B);
  assert.deepEqual(receiveMessage(a1, { ...msg, sealPubkey: generateMatchKey().pubkey }, { now: T0 }), { ok: false, reason: 'unexpected-sender' });
  const a2 = okT(receiveMessage(a1, msg, { now: T0 }));
  const rec = a2.book.matches[p.matchId];
  assert.equal(rec.status, 'revoked');
  assert.equal(rec.myKey, null);
  assert.equal(rec.peerSketch, undefined);
  assert.equal(inboxKeys(a2.book, T0).matchKeys.length, 0);
  assert.deepEqual(receiveMessage(a2.book, msg, { now: T0 }), { ok: false, reason: 'ended' });
  assert.deepEqual(buildMatchSketch(a2.book, p.matchId, { history: [], rng: seededRng(1), now: T0 }), { ok: false, reason: 'not-active' });
});

test('withdrawing a request: the target sees it revoked; a replayed request is a duplicate', () => {
  const { a, b, A, B } = people();
  const matchId = idGen(10)();
  const req = okT(requestMatch(a, { matchId, peer: B, myKey: generateMatchKey(), now: T0 }));
  const inc = okT(receiveMessage(b, deliver(req.outbox[0], A), { now: T0 }));
  const rv = okT(revokeMatch(req.book, matchId, { now: T0 }));
  assert.equal(rv.outbox[0].to, B, 'to the identity: the target has no match key yet');
  const gone = okT(receiveMessage(inc.book, deliver(rv.outbox[0], A), { now: T0 }));
  assert.equal(gone.book.matches[matchId].status, 'revoked');
  assert.deepEqual(receiveMessage(gone.book, deliver(req.outbox[0], A), { now: T0 }), { ok: false, reason: 'duplicate-id' });
});
