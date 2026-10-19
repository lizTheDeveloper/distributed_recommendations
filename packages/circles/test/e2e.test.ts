// End to end over real MLS (marmot-ts 0.5.1 / ts-mls) and an in-memory relay pool:
// 12 members, create, add, round, remove (epoch freeze), next round.
// Never touches the network.

import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { CircleMember } from '../src/client.ts';
import type { HistoryEntry, Video } from '../src/core.ts';
import { DEFAULT_RECIPE, rank, seededRng } from '../src/core.ts';
import { CIRCLE_KINDS } from '../src/kinds.ts';
import { decodeVector } from '../src/masking.ts';
import { decodeRoundKey, decodeRoundMasked, decodeRoundOpen } from '../src/messages.ts';
import { InMemoryNostrNetwork } from '../src/network.ts';
import { releaseAggregatedEpoch } from '../src/policy.ts';
import { HOUR, T0, endorse, localIdentity, testClock, video } from './helpers.ts';

const N = 12;
const CANDIDATES = Array.from({ length: 30 }, (_, i) => video(i + 1));
const POPULAR = [1, 2, 3, 4, 5];

const clock = testClock(T0);
const network = new InMemoryNostrNetwork({ now: clock.now });
const members: CircleMember[] = [];
const histories = new Map<string, HistoryEntry[]>();
const inputs = new Map<string, Uint8Array[]>(); // TEST-ONLY view of each member's raw input
const roundKeys = new Set<string>();
let firstRound = '';
let firstEpoch = -1;

async function syncAll(who: CircleMember[] = members) {
  for (const m of who) await m.sync(histories.get(m.identity) ?? []);
}

/** Open → keys → (key deadline) → masked → release, with a couple of sync passes per phase. */
async function runRound(opener: CircleMember, who: CircleMember[]): Promise<string> {
  const roundId = await opener.openRound(CANDIDATES, { keyWindowSec: 3600, maskWindowSec: 3600 });
  clock.advance(60_000);
  await syncAll(who); // receive open, send key
  await syncAll(who); // receive keys
  clock.advance(HOUR);
  await syncAll(who); // key deadline: fix P, send masked
  await syncAll(who); // receive masked, release
  return roundId;
}

before(async () => {
  for (let i = 0; i < N; i++) {
    const { signer } = localIdentity();
    const m = await CircleMember.create({
      signer,
      network,
      now: clock.now,
      inspect: (c) => {
        const list = inputs.get(c.identity) ?? [];
        list.push(c.input);
        inputs.set(c.identity, list);
      },
    });
    members.push(m);
  }
  members.forEach((m, i) => {
    const at = new Date(T0.getTime() + HOUR);
    histories.set(m.identity, [...endorse(i < 8 ? POPULAR : [], at), ...endorse([10 + i], at)]);
  });
});

test('create a circle and add 11 members over MLS; everyone converges on one epoch', async () => {
  const [admin, ...rest] = members;
  for (const m of rest) await m.publishKeyPackage();
  await admin.createCircle('Film club');
  for (const m of rest) await admin.invite(m.identity);
  for (const m of rest) await m.acceptInvite();
  await syncAll();
  const epochs = new Set(members.map((m) => m.epoch()));
  assert.equal(epochs.size, 1, `epochs ${[...epochs]}`);
  assert.equal(admin.epoch(), N - 1, 'one commit (epoch) per add');
  for (const m of members) assert.equal(m.members().length, N);
});

test('a round over MLS releases the same picks on every device, with t = 3 for 12 members', async () => {
  clock.advance(2 * HOUR); // endorsements happened at T0 + 1h, before the round opens
  firstEpoch = members[0].epoch();
  firstRound = await runRound(members[0], members);
  const snaps = members.map((m) => m.rounds().find((r) => r.roundId === firstRound)!);
  for (const s of snaps) assert.equal(s?.status, 'released', `status ${s?.status} ${s?.voidReason ?? ''}`);
  assert.equal(new Set(snaps.map((s) => JSON.stringify(s.result))).size, 1);
  const r = snaps[0].result!;
  assert.ok(r.ok);
  assert.equal(r.members, N);
  const picked = r.picks.map((p) => p.videoId);
  for (const p of POPULAR) assert.ok(picked.includes(video(p)), `popular ${p} picked`);
  assert.deepEqual(picked, [...picked].sort(), 'picks sorted by id (order carries no counts)');
  for (const m of members) assert.deepEqual(m.engine!.contributedEpochs(), [firstEpoch]);
});

test('structural: no member can read another member\'s endorsements from what it received', async () => {
  for (const m of members) {
    for (const msg of m.seen) {
      if (msg.kind === CIRCLE_KINDS.roundOpen) {
        // Only the opener's public candidate list.
        assert.deepEqual(decodeRoundOpen(msg.content).candidates, CANDIDATES);
        continue;
      }
      assert.ok(!msg.content.includes('https://'), 'no video id outside round-open');
      if (msg.kind === CIRCLE_KINDS.roundKey) {
        roundKeys.add(decodeRoundKey(msg.content).roundKey);
        continue;
      }
      const v = decodeVector(decodeRoundMasked(msg.content).vector, CANDIDATES.length);
      const small = [...v].filter((x) => Math.abs(x | 0) < 1000).length;
      assert.equal(small, 0, 'masked vectors are full-width ring elements');
      const raw = inputs.get(msg.sender)![0];
      assert.notDeepEqual(Uint32Array.from(raw), v);
    }
  }
  assert.ok(roundKeys.size >= N);
});

test('structural: the relay sees only MLS ciphertext from one-time keys, no ids or round keys', () => {
  const kinds = new Set(network.log.map((e) => e.kind));
  for (const k of kinds) assert.ok([30443, 445, 1059].includes(k), `unexpected kind ${k} on the relay`);
  const identities = new Set(members.map((m) => m.identity));
  for (const e of network.log) {
    const json = JSON.stringify(e);
    assert.ok(!json.includes('tube.example'), 'no video id on the relay');
    for (const k of roundKeys) assert.ok(!json.includes(k), 'no round key on the relay');
    if (e.kind === 445) assert.ok(!identities.has(e.pubkey), 'group events are signed by one-time keys');
  }
});

test('remove a member: new epoch, the removed member is out and reads nothing new; epoch freeze holds', async () => {
  const admin = members[0];
  const leaver = members[N - 1];
  const before = admin.epoch();
  await admin.remove(leaver.identity);
  await syncAll();
  assert.equal(admin.epoch(), before + 1);
  assert.ok(leaver.removed, 'the removed member notices it is out');
  for (const m of members.slice(0, N - 1)) {
    assert.equal(m.epoch(), before + 1);
    assert.equal(m.members().length, N - 1);
    assert.ok(!m.members().includes(leaver.identity));
  }
  // Freeze: the released epoch can't be recomputed with the new membership.
  const ledger = admin.engine!.ledger;
  const again = releaseAggregatedEpoch(
    ledger,
    { epoch: firstEpoch, participants: admin.members(), noisedCounts: new Map([[video(29), 99]]) },
    { v: 1, minMembers: 8, epsilon: 1, maxItemsPerMember: 64 },
  );
  assert.ok(again.ok && again.frozen);
  assert.deepEqual(again.result, ledger.released.epochs[0].result);
});

test('next round in the new epoch: 11 members, only new endorsements, earlier picks never again', async () => {
  const stay = members.slice(0, N - 1);
  const leaver = members[N - 1];
  const leaverSeen = leaver.seen.length;
  const at = clock.now();
  clock.advance(60_000);
  for (const m of members) histories.set(m.identity, [...histories.get(m.identity)!, ...endorse([20, 1], at)]);
  const roundId = await runRound(stay[0], members);
  const snaps = stay.map((m) => m.rounds().find((r) => r.roundId === roundId)!);
  for (const s of snaps) assert.equal(s?.status, 'released', `status ${s?.status} ${s?.voidReason ?? ''}`);
  const r = snaps[0].result!;
  assert.ok(r.ok);
  assert.equal(r.members, N - 1);
  const picked = r.picks.map((p) => p.videoId);
  assert.ok(picked.includes(video(20)));
  assert.ok(!picked.includes(video(1)), 'released in the previous epoch, never picked again');
  // Each member pooled exactly its new endorsements, minus already released items.
  for (const m of stay) {
    const latest = inputs.get(m.identity)!.at(-1)!;
    const ones = [...latest.keys()].filter((i) => latest[i] === 1).map((i) => CANDIDATES[i]);
    assert.deepEqual(ones, [video(20)]);
  }
  // The removed member received nothing from the new epoch, and cannot decrypt it
  // even when it tries: its last group state predates the removal commit.
  assert.equal(leaver.seen.length, leaverSeen);
  const newEvents = network.log.filter((e) => e.kind === 445 && e.created_at >= Math.floor(at.getTime() / 1000));
  assert.ok(newEvents.length >= 3 * (N - 1));
  let decrypted = 0;
  for await (const res of leaver.group!.ingest(newEvents as never)) {
    if (res.kind === 'processed' && res.result.kind === 'applicationMessage') decrypted++;
  }
  assert.equal(decrypted, 0);
  assert.deepEqual(leaver.engine!.contributedEpochs(), [firstEpoch]);
});

test('circle picks feed core rank() as unattributed circle candidates', () => {
  const videos = new Map<string, Video>(
    CANDIDATES.map((id, i) => [id, { id, title: `Video ${i + 1}`, creator: `creator${i}@tube.example`, durationSec: 600, publishedAt: T0, tags: [] }]),
  );
  const cands = members[0].candidates('Film club', videos);
  assert.ok(cands.length >= POPULAR.length + 1);
  for (const c of cands) {
    assert.equal(c.source.kind, 'circle');
    assert.match(c.source.via!, /^Film club \(\d+ members\)$/);
  }
  const feed = rank(cands, DEFAULT_RECIPE, { now: clock.now(), limit: 10, rng: seededRng(1) });
  assert.ok(feed.length > 0);
  const names = new Set(members.map((m) => m.identity));
  for (const item of feed) {
    assert.equal(item.primary, 'circle');
    for (const line of item.why) for (const id of names) assert.ok(!line.includes(id.slice(0, 8)));
  }
});
