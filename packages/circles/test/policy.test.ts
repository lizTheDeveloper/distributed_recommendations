import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_CIRCLE_POLICY } from '../src/core.ts';
import type { Video } from '../src/core.ts';
import { circleFeedCandidates, emptyCirclesLedger, releaseAggregatedEpoch, releasedItems, voidEpoch } from '../src/policy.ts';
import { T0, hexId, video } from './helpers.ts';

const members = (n: number) => Array.from({ length: n }, (_, i) => hexId(i + 1));

test('threshold is applied to the noised count and derived from the participant count', () => {
  const counts = new Map([
    [video(1), 3],
    [video(2), 2],
    [video(3), 4],
    [video(4), -1],
  ]);
  const twelve = releaseAggregatedEpoch(emptyCirclesLedger(), { epoch: 1, participants: members(12), noisedCounts: counts }, DEFAULT_CIRCLE_POLICY);
  assert.ok(twelve.ok && twelve.result.ok);
  assert.deepEqual(twelve.result.picks.map((p) => p.videoId), [video(1), video(3)]); // t = 3
  const sixteen = releaseAggregatedEpoch(emptyCirclesLedger(), { epoch: 1, participants: members(16), noisedCounts: counts }, DEFAULT_CIRCLE_POLICY);
  assert.ok(sixteen.ok && sixteen.result.ok);
  assert.deepEqual(sixteen.result.picks.map((p) => p.videoId), [video(3)]); // t = 4
  // Picks only: no count anywhere in the result.
  assert.ok(!JSON.stringify(twelve.result).includes('Count'));
});

test('fewer than minMembers participants publishes nothing', () => {
  const r = releaseAggregatedEpoch(emptyCirclesLedger(), { epoch: 1, participants: members(7), noisedCounts: new Map([[video(1), 9]]) }, DEFAULT_CIRCLE_POLICY);
  assert.ok(r.ok);
  assert.deepEqual(r.result, { ok: false, members: 7, reason: 'too-few-members' });
});

test('epoch freeze: re-release returns the stored result; older epochs refused; released items never again', () => {
  const c1 = new Map([[video(1), 5], [video(2), 5]]);
  const a = releaseAggregatedEpoch(emptyCirclesLedger(), { epoch: 3, participants: members(12), noisedCounts: c1 }, DEFAULT_CIRCLE_POLICY);
  assert.ok(a.ok && !a.frozen);
  // Same epoch, different membership and counts: frozen, unchanged.
  const again = releaseAggregatedEpoch(a.ledger, { epoch: 3, participants: members(11), noisedCounts: new Map([[video(9), 9]]) }, DEFAULT_CIRCLE_POLICY);
  assert.ok(again.ok && again.frozen);
  assert.deepEqual(again.result, a.result);
  assert.deepEqual(releaseAggregatedEpoch(a.ledger, { epoch: 2, participants: members(12), noisedCounts: c1 }, DEFAULT_CIRCLE_POLICY), { ok: false, reason: 'stale-epoch' });
  const b = releaseAggregatedEpoch(a.ledger, { epoch: 4, participants: members(11), noisedCounts: new Map([[video(1), 9], [video(3), 9]]) }, DEFAULT_CIRCLE_POLICY);
  assert.ok(b.ok && b.result.ok);
  assert.deepEqual(b.result.picks.map((p) => p.videoId), [video(3)]);
  assert.deepEqual([...releasedItems(b.ledger)].sort(), [video(1), video(2), video(3)]);
});

test('a voided epoch is final and blocks older epochs too', () => {
  const l = voidEpoch(emptyCirclesLedger(), 6, members(12), 'dropout');
  assert.deepEqual(releaseAggregatedEpoch(l, { epoch: 6, participants: members(12), noisedCounts: new Map() }, DEFAULT_CIRCLE_POLICY), { ok: false, reason: 'voided-epoch' });
  assert.deepEqual(releaseAggregatedEpoch(l, { epoch: 5, participants: members(12), noisedCounts: new Map() }, DEFAULT_CIRCLE_POLICY), { ok: false, reason: 'stale-epoch' });
  assert.equal(voidEpoch(l, 6, members(3), 'bad-vector'), l);
});

test('picks become circle candidates naming only the circle', () => {
  const r = releaseAggregatedEpoch(emptyCirclesLedger(), { epoch: 1, participants: members(12), noisedCounts: new Map([[video(1), 5]]) }, DEFAULT_CIRCLE_POLICY);
  assert.ok(r.ok);
  const videos = new Map<string, Video>([[video(1), { id: video(1), title: 'v', creator: 'c@x', durationSec: 60, publishedAt: T0, tags: [] }]]);
  const cands = circleFeedCandidates(r.ledger, 'Film club', videos);
  assert.equal(cands.length, 1);
  assert.deepEqual(cands[0].source, { kind: 'circle', via: 'Film club (12 members)', strength: 0.5 });
});
