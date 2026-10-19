import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { HistoryEntry } from '../src/core.ts';
import { CIRCLE_KINDS } from '../src/kinds.ts';
import { decodeVector, fromSigned, sumVectors } from '../src/masking.ts';
import { decodeRoundMasked, decodeRoundOpen } from '../src/messages.ts';
import { CircleRoundEngine } from '../src/round.ts';
import { FakeCircle, HOUR, T0, endorse, hexId, testClock, video } from './helpers.ts';

const N = 12;
const CANDIDATES = Array.from({ length: 30 }, (_, i) => video(i + 1));
const POPULAR = [1, 2, 3, 4, 5];

interface Contribution {
  input: Uint8Array;
  noise: Int32Array;
  masked: Uint32Array;
}

function setup(n = N) {
  const clock = testClock(T0);
  const contributions = new Map<string, Contribution[]>();
  const engines = Array.from({ length: n }, (_, i) => {
    const identity = hexId(i + 1);
    contributions.set(identity, []);
    return new CircleRoundEngine({
      circleId: 'c1'.repeat(16),
      identity,
      localSecret: new Uint8Array(32).fill(i + 1),
      since: new Date(T0.getTime() - 24 * HOUR),
      inspect: (c) => contributions.get(c.identity)!.push(c),
    });
  });
  const circle = new FakeCircle(engines);
  // Member i endorses the 5 popular items (if i < 8) plus one niche item of its own.
  const histories = new Map<string, HistoryEntry[]>();
  engines.forEach((e, i) => {
    const at = new Date(T0.getTime() - HOUR);
    histories.set(e.identity, [...endorse(i < 8 ? POPULAR : [], at), ...endorse([10 + i], at)]);
  });
  return { clock, engines, circle, histories, contributions };
}

async function runRound(s: ReturnType<typeof setup>, opener = 0) {
  const out = await s.engines[opener].open(s.circle.view(), { candidates: CANDIDATES, now: s.clock.now() });
  await s.circle.broadcast(s.engines[opener].identity, out, s.clock.now());
  s.clock.advance(HOUR + 1000); // past keyDeadline
  await s.circle.tickAll(s.clock.now(), s.histories);
  return decodeRoundOpen(out[0].content).roundId;
}

test('a 12-member round releases the same picks everywhere; masks cancel; thresholds apply', async () => {
  const s = setup();
  const roundId = await runRound(s);
  const results = s.engines.map((e) => e.round(roundId)!);
  for (const r of results) assert.equal(r.status, 'released');
  const picks = results.map((r) => JSON.stringify(r.result));
  assert.equal(new Set(picks).size, 1, 'every member computes the same release');
  const result = results[0].result!;
  assert.ok(result.ok);
  const picked = new Set(result.picks.map((p) => p.videoId));
  for (const p of POPULAR) assert.ok(picked.has(video(p)), `popular ${p} picked`);

  // Masks cancel: Σ masked = Σ (input + noise share) (mod 2^32).
  const all = [...s.contributions.values()].map((c) => c[0]);
  const plain = all.map((c) => Uint32Array.from(c.input, (x, i) => fromSigned(x + c.noise[i])));
  assert.deepEqual(sumVectors(all.map((c) => c.masked), CANDIDATES.length), sumVectors(plain, CANDIDATES.length));
  // ... and the thresholded noised count is what decided each pick (t = 3 for 12 members).
  const sum = sumVectors(plain, CANDIDATES.length);
  CANDIDATES.forEach((id, i) => assert.equal(picked.has(id), (sum[i] | 0) >= 3, id));
  // The noise really is there: total noise is not identically zero.
  const noiseTotal = all.reduce((acc, c) => acc + c.noise.reduce((a, b) => a + Math.abs(b), 0), 0);
  assert.ok(noiseTotal > 0);
});

test('structural: what a member receives never contains another member\'s raw input', async () => {
  const s = setup();
  await runRound(s);
  for (const e of s.engines) {
    for (const m of s.circle.seen.get(e.identity)!) {
      if (m.kind !== CIRCLE_KINDS.roundMasked) {
        // round-open carries only the public candidate list; round-key only a public key.
        continue;
      }
      const msg = decodeRoundMasked(m.content);
      const v = decodeVector(msg.vector, CANDIDATES.length);
      const raw = s.contributions.get(m.sender)![0].input;
      // A masked vector's entries are full-width ring elements, not 0/1-plus-noise.
      const small = [...v].filter((x) => Math.abs(x | 0) < 1000).length;
      assert.equal(small, 0, `masked vector from ${m.sender.slice(-2)} looks unmasked`);
      assert.notDeepEqual(Uint32Array.from(raw), v);
      // No video id appears in a key or masked message.
      assert.ok(!m.content.includes('https://'));
    }
  }
});

test('one contribution per epoch: a second round in a released epoch is ignored', async () => {
  const s = setup();
  await runRound(s);
  await assert.rejects(s.engines[1].open(s.circle.view(), { candidates: CANDIDATES, now: s.clock.now() }));
  for (const e of s.engines) assert.deepEqual(e.contributedEpochs(), [5]);
  // Next epoch: the new round pools only endorsements made since the last one.
  s.circle.epoch = 6;
  const at = s.clock.now();
  s.clock.advance(1000);
  for (const [id, h] of s.histories) s.histories.set(id, [...h, ...endorse([20], at)]);
  for (const c of s.contributions.values()) c.length = 0;
  const roundId = await runRound(s);
  const r = s.engines[0].round(roundId)!;
  assert.equal(r.status, 'released');
  const idx20 = CANDIDATES.indexOf(video(20));
  for (const c of s.contributions.values()) {
    const ones = [...c[0].input.keys()].filter((i) => c[0].input[i] === 1);
    assert.deepEqual(ones, [idx20], 'only the new endorsement is pooled');
  }
  assert.ok(r.result!.ok && r.result!.picks.some((p) => p.videoId === video(20)));
  // Items released in epoch 5 are not picked again.
  assert.ok(!r.result!.picks.some((p) => POPULAR.map(video).includes(p.videoId)));
});

test('dropout after the key phase voids the epoch for everyone, and the epoch stays consumed', async () => {
  const s = setup();
  const out = await s.engines[0].open(s.circle.view(), { candidates: CANDIDATES, now: s.clock.now() });
  await s.circle.broadcast(s.engines[0].identity, out, s.clock.now());
  s.circle.silent.add(s.engines[11].identity); // sent its key, now goes offline
  s.clock.advance(HOUR + 1000);
  await s.circle.tickAll(s.clock.now(), s.histories);
  s.clock.advance(HOUR);
  await s.circle.tickAll(s.clock.now(), s.histories);
  for (const e of s.engines.slice(0, 11)) {
    const r = e.listRounds()[0];
    assert.equal(r.status, 'void');
    assert.equal(r.voidReason, 'dropout');
    assert.deepEqual(e.ledger.voided.map((v) => v.epoch), [5]);
    assert.deepEqual(e.contributedEpochs(), [5]);
  }
  // No retry in the same epoch.
  await assert.rejects(s.engines[1].open(s.circle.view(), { candidates: CANDIDATES, now: s.clock.now() }));
});

test('members with different views of the participant set void instead of releasing garbage', async () => {
  const s = setup();
  // Member 3 never receives member 7's round key.
  s.circle.blocked.set(s.engines[3].identity, new Set([s.engines[7].identity]));
  const out = await s.engines[0].open(s.circle.view(), { candidates: CANDIDATES, now: s.clock.now() });
  await s.circle.broadcast(s.engines[0].identity, out, s.clock.now());
  s.clock.advance(HOUR + 1000);
  await s.circle.tickAll(s.clock.now(), s.histories);
  for (const e of s.engines) {
    const r = e.listRounds()[0];
    assert.notEqual(r.status, 'released', `member ${e.identity.slice(-2)} must not release`);
  }
  assert.ok(s.engines.some((e) => e.listRounds()[0].voidReason === 'participant-mismatch'));
});

test('below minMembers nobody sends a masked vector and the epoch publishes nothing', async () => {
  const s = setup();
  for (const e of s.engines.slice(7)) s.circle.silent.add(e.identity); // only 7 take part
  const out = await s.engines[0].open(s.circle.view(), { candidates: CANDIDATES, now: s.clock.now() });
  await s.circle.broadcast(s.engines[0].identity, out, s.clock.now());
  s.clock.advance(HOUR + 1000);
  await s.circle.tickAll(s.clock.now(), s.histories);
  for (const e of s.engines.slice(0, 7)) {
    const r = e.listRounds()[0];
    assert.equal(r.status, 'too-few-members');
    assert.deepEqual(r.result, { ok: false, members: 7, reason: 'too-few-members' });
    assert.deepEqual(e.contributedEpochs(), []);
    assert.equal(s.contributions.get(e.identity)!.length, 0);
  }
});

test('members refuse rounds weaker than their floor, and rounds whose MLS epoch moved on', async () => {
  const s = setup();
  const strict = s.engines[1];
  assert.equal(strict.acceptsPolicy({ v: 1, minMembers: 8, epsilon: 2, maxItemsPerMember: 64 }), false);
  assert.equal(strict.acceptsPolicy({ v: 1, minMembers: 8, epsilon: 1, maxItemsPerMember: 64, revealThreshold: 2 }), false);
  const loose = new CircleRoundEngine({ circleId: 'c1'.repeat(16), identity: s.engines[0].identity, floor: { v: 1, minMembers: 8, epsilon: 2, maxItemsPerMember: 64 } });
  const out = await loose.open(s.circle.view(), { candidates: CANDIDATES, now: s.clock.now() });
  const replies = await strict.receive(s.circle.view(), { ...out[0], sender: loose.identity, createdAt: Math.floor(s.clock.now().getTime() / 1000) }, s.clock.now());
  assert.deepEqual(replies, [], 'no round key for a weaker policy');

  // Epoch changes between key and mask phase: nobody masks.
  const s2 = setup();
  const o2 = await s2.engines[0].open(s2.circle.view(), { candidates: CANDIDATES, now: s2.clock.now() });
  await s2.circle.broadcast(s2.engines[0].identity, o2, s2.clock.now());
  s2.circle.epoch = 6;
  s2.clock.advance(HOUR + 1000);
  await s2.circle.tickAll(s2.clock.now(), s2.histories);
  for (const e of s2.engines) assert.equal(e.listRounds()[0].voidReason, 'epoch-changed');
  for (const c of s2.contributions.values()) assert.equal(c.length, 0);
});
