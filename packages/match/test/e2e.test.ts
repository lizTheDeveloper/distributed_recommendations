// Two simulated users and an in-memory relay, end to end, with real OpenMined PSI:
// request → preview → accept → sketches → similarity → rank → pause → renew → revoke.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_RECIPE, rank, seededRng, sketchItems } from '../src/core.ts';
import { MatchClient } from '../src/client.ts';
import { InMemoryRelay } from '../src/relay.ts';
import { openMinedPsi } from '../src/psi.ts';
import { GIFT_WRAP_KIND } from '../src/kinds.ts';
import { history, identity, idGen, range, testClock, video, videoMeta } from './helpers.ts';

test('two users: request, preview, accept, sketches, rank, pause, renew, revoke', async () => {
  const clock = testClock();
  const relay = new InMemoryRelay({ now: clock.now });
  const psi = await openMinedPsi();
  const aliceId = identity();
  const bobId = identity();
  const alice = await MatchClient.create({ identity: aliceId.signer, relay, psi, now: clock.now, rng: seededRng(1), newId: idGen(11) });
  const bob = await MatchClient.create({ identity: bobId.signer, relay, psi, now: clock.now, rng: seededRng(2), newId: idGen(22) });

  // Alice endorsed 0..59, Bob 30..99: 30 in common.
  const aliceHistory = history(range(0, 60), clock.now());
  const bobHistory = history(range(30, 100), clock.now());
  const aliceItems = aliceHistory.map((h) => h.videoId);
  const bobItems = bobHistory.map((h) => h.videoId);

  // 1. Alice requests a match and a preview.
  const matchId = await alice.requestMatch(bob.self);
  await alice.requestPreview(matchId, aliceItems);
  let r = await bob.sync();
  assert.deepEqual(
    r.events.map((e) => e.type),
    ['match-requested', 'preview-requested'],
  );
  assert.equal(bob.book.matches[matchId].peer, alice.self);
  assert.equal(bob.previewBudget(), 8);

  // 2. Bob (the target) accepts the preview. He runs PSI as the party that learns
  //    |A ∩ B|, noises it on his device, and sends only the noised result.
  await bob.respondToPreview(matchId, true, bobItems);
  assert.equal(bob.previewBudget(), 7, 'an accepted preview uses the yearly budget');
  await alice.sync(); // receives Bob's PSI request, answers
  await bob.sync(); // computes, noises, replies
  r = await alice.sync();
  const result = r.events.find((e) => e.type === 'preview-result');
  assert.ok(result && result.type === 'preview-result');
  assert.equal(result.result.floor, 5);
  // 30 in common plus discrete-Laplace(ε=0.5) noise; the exact 30 is never sent.
  assert.equal(result.result.belowFloor, false);
  assert.ok(Math.abs(result.result.value! - 30) < 30, `noised value ${result.result.value}`);
  assert.equal(alice.book.matches[matchId].preview?.stage, 'done');
  assert.equal(bob.book.matches[matchId].preview?.stage, 'done');

  // 3. Bob consents with his own settings; the match becomes active on both sides.
  await bob.acceptMatch(matchId, { consent: { windowDays: 60, includeFinished: false, excludedTags: [], excludedHours: [], paused: false } });
  r = await alice.sync();
  assert.ok(r.events.some((e) => e.type === 'match-active'));
  const a = alice.book.matches[matchId];
  const b = bob.book.matches[matchId];
  assert.equal(a.status, 'active');
  assert.equal(b.status, 'active');
  assert.equal(a.expiresAt, b.expiresAt);
  assert.equal(a.expiresAt! - Math.floor(clock.now().getTime() / 1000), 90 * 86_400);
  // Per-match keys: distinct from identities and from each other, each known to the peer.
  assert.equal(a.peerKey, b.myKey!.pubkey);
  assert.equal(b.peerKey, a.myKey!.pubkey);
  assert.notEqual(a.myKey!.pubkey, alice.self);
  assert.notEqual(b.myKey!.pubkey, bob.self);

  // 4. Weekly sketch exchange.
  await alice.sendDueSketches(aliceHistory);
  await bob.sendDueSketches(bobHistory);
  await alice.sync();
  await bob.sync();
  assert.equal(alice.book.matches[matchId].peerEpoch, 1);
  assert.equal(bob.book.matches[matchId].peerEpoch, 1);
  assert.equal(sketchItems(alice.book.matches[matchId].peerSketch!).size, 70);
  assert.deepEqual(await alice.sendDueSketches(aliceHistory), [], 'nothing due again within the week');

  // 5. Similarity and ranking with core.
  const cands = alice.candidates({ myItems: aliceItems, resolveVideo: (id) => videoMeta(id, clock.now()), nameOf: () => 'Bob' });
  assert.equal(cands.length, 40, "Bob's 70 minus the 30 Alice already has");
  const sim = cands[0].source.strength!;
  assert.ok(Math.abs(sim - 30 / 100) < 1e-9, `jaccard 30/100, got ${sim}`);
  const feed = rank(cands, DEFAULT_RECIPE, { now: clock.now(), limit: 10, rng: seededRng(3) });
  assert.equal(feed.length, 10);
  assert.ok(feed.every((item) => item.primary === 'match'));
  assert.ok(feed[0].why.some((line) => line.includes('Bob')));

  // 6. Quiet pause (D2): Alice keeps sending on schedule; content stops changing, envelope is fresh.
  alice.setPaused(matchId, true);
  const before = alice.book.matches[matchId].sketch.lastSent!;
  clock.advance(7);
  const newer = history(range(200, 210), clock.now());
  const wrapsBefore = relay.log.length;
  await alice.sendDueSketches([...newer, ...aliceHistory]);
  assert.equal(relay.log.length, wrapsBefore + 1, 'exactly one on-schedule sketch, no pause signal');
  await bob.sync();
  const seenByBob = bob.book.matches[matchId].peerSketch!;
  assert.equal(seenByBob.epoch, 2);
  assert.notEqual(seenByBob.nonce, before.nonce);
  assert.deepEqual([...sketchItems(seenByBob)].sort(), [...sketchItems(before)].sort(), 'same real items while paused');
  alice.setPaused(matchId, false);

  // 7. Renewal rotates both sides' per-match keys.
  const oldAliceKey = alice.book.matches[matchId].myKey!.pubkey;
  const oldBobKey = bob.book.matches[matchId].myKey!.pubkey;
  clock.advance(60);
  await alice.proposeRenew(matchId);
  r = await bob.sync();
  assert.ok(r.events.some((e) => e.type === 'renew-requested'));
  await bob.acceptRenew(matchId);
  r = await alice.sync();
  assert.ok(r.events.some((e) => e.type === 'renewed'));
  const a2 = alice.book.matches[matchId];
  const b2 = bob.book.matches[matchId];
  assert.notEqual(a2.myKey!.pubkey, oldAliceKey);
  assert.notEqual(b2.myKey!.pubkey, oldBobKey);
  assert.equal(a2.peerKey, b2.myKey!.pubkey);
  assert.equal(b2.peerKey, a2.myKey!.pubkey);
  assert.equal(a2.expiresAt, b2.expiresAt);
  assert.equal(a2.expiresAt! - Math.floor(clock.now().getTime() / 1000), 90 * 86_400);
  // Sketches flow over the new keys.
  await bob.sendDueSketches(bobHistory);
  await alice.sync();
  assert.equal(alice.book.matches[matchId].peerEpoch, 2);

  // 8. Revoke: Bob ends it; both sides wipe keys and sketches.
  await bob.revoke(matchId);
  r = await alice.sync();
  assert.ok(r.events.some((e) => e.type === 'revoked' && e.by === 'peer'));
  for (const c of [alice, bob]) {
    const rec = c.book.matches[matchId];
    assert.equal(rec.status, 'revoked');
    assert.equal(rec.myKey, null);
    assert.equal(rec.peerSketch, undefined);
    assert.equal(rec.sketch.lastSent, undefined);
  }
  assert.equal(alice.candidates({ myItems: aliceItems, resolveVideo: (id) => videoMeta(id, clock.now()) }).length, 0);
  await assert.rejects(alice.sendSketch(matchId, aliceHistory), /not-active/);

  // What the relay saw: only kind-1059 wraps from one-time keys. Alice's identity
  // never appears; Bob's appears only as the `p` of first-contact messages.
  assert.ok(relay.log.every((e) => e.kind === GIFT_WRAP_KIND));
  const authors = new Set(relay.log.map((e) => e.pubkey));
  assert.equal(authors.size, relay.log.length, 'every wrap has a fresh author key');
  const ps = relay.log.map((e) => e.tags.find((t) => t[0] === 'p')![1]);
  assert.ok(!ps.includes(alice.self) && !authors.has(alice.self) && !authors.has(bob.self));
  assert.equal(ps.filter((p) => p === bob.self).length, 3, 'match request, preview request, preview answer (sent before the accept)');
  // Every wrap has one of two sizes (8,192-byte control/64-bucket, or 128 bucket) and stays under 64 KiB.
  const sizes = new Set(relay.log.map((e) => JSON.stringify(e).length));
  assert.ok(sizes.size <= 2, `wrap sizes: ${[...sizes].join(', ')}`);
  assert.ok([...sizes].every((s) => s < 65_536));
});

test('declined and budget-exhausted previews look the same to the requester', async () => {
  const clock = testClock();
  const relay = new InMemoryRelay({ now: clock.now });
  const psi = await openMinedPsi();
  const target = await MatchClient.create({ identity: identity().signer, relay, psi, now: clock.now, rng: seededRng(5) });
  const bobItems = range(0, 40).map(video);

  const outcomes: string[] = [];
  for (let i = 0; i < 9; i++) {
    const requester = await MatchClient.create({ identity: identity().signer, relay, psi, now: clock.now, rng: seededRng(100 + i) });
    const id = await requester.requestMatch(target.self);
    await requester.requestPreview(id, range(20, 60).map(video));
    await target.sync();
    const ev = await target.respondToPreview(id, true, bobItems);
    outcomes.push(ev?.type === 'preview-declined' ? `declined:${ev.refusal}` : 'accepted');
    const r = await requester.sync();
    if (i === 8) {
      assert.deepEqual(
        r.events.map((e) => e.type),
        ['preview-declined'],
      );
      assert.ok(!('refusal' in r.events[0]), 'the requester is not told why');
    }
    clock.advance(1);
  }
  assert.deepEqual(outcomes, [...Array(8).fill('accepted'), 'declined:target-budget']);
  assert.equal(target.previewBudget(), 0);
  // A year later the budget is back.
  clock.advance(366);
  target.tick();
  assert.equal(target.previewBudget(), 8);
});

test('a target that never answers: the request expires on both sides after 7 days', async () => {
  const clock = testClock();
  const relay = new InMemoryRelay({ now: clock.now });
  const psi = await openMinedPsi();
  const alice = await MatchClient.create({ identity: identity().signer, relay, psi, now: clock.now, rng: seededRng(7) });
  const bob = await MatchClient.create({ identity: identity().signer, relay, psi, now: clock.now, rng: seededRng(8) });
  const id = await alice.requestMatch(bob.self);
  await bob.sync();
  clock.advance(8);
  alice.tick();
  bob.tick();
  assert.equal(alice.book.matches[id].status, 'expired');
  assert.equal(bob.book.matches[id].status, 'expired');
  await assert.rejects(bob.acceptMatch(id), /not-incoming/);
});

test('active matches expire after 90 days unless renewed', async () => {
  const clock = testClock();
  const relay = new InMemoryRelay({ now: clock.now });
  const psi = await openMinedPsi();
  const alice = await MatchClient.create({ identity: identity().signer, relay, psi, now: clock.now, rng: seededRng(9) });
  const bob = await MatchClient.create({ identity: identity().signer, relay, psi, now: clock.now, rng: seededRng(10) });
  const id = await alice.requestMatch(bob.self);
  await bob.sync();
  await bob.acceptMatch(id);
  await alice.sync();
  clock.advance(89);
  assert.deepEqual(alice.tick(), []);
  clock.advance(1);
  assert.deepEqual(
    alice.tick().map((e) => e.type),
    ['expired'],
  );
  bob.tick();
  assert.equal(alice.book.matches[id].myKey, null);
  assert.equal(bob.book.matches[id].status, 'expired');
  // Tombstones go after 30 days.
  clock.advance(31);
  alice.tick();
  assert.equal(alice.book.matches[id], undefined);
});

test('the book is plain JSON: a client restored from it keeps working', async () => {
  const clock = testClock();
  const relay = new InMemoryRelay({ now: clock.now });
  const psi = await openMinedPsi();
  const aliceId = identity();
  const alice = await MatchClient.create({ identity: aliceId.signer, relay, psi, now: clock.now, rng: seededRng(12) });
  const bob = await MatchClient.create({ identity: identity().signer, relay, psi, now: clock.now, rng: seededRng(13) });
  const id = await alice.requestMatch(bob.self);
  await bob.sync();
  await bob.acceptMatch(id);
  await alice.sync();
  const saved = JSON.stringify(alice.book);
  const restored = await MatchClient.create({ identity: aliceId.signer, relay, psi, now: clock.now, rng: seededRng(14), book: JSON.parse(saved) });
  await bob.sendSketch(id, history(range(0, 30), clock.now()));
  const r = await restored.sync();
  assert.ok(r.events.some((e) => e.type === 'sketch'));
});
