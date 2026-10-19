// The two-user Match scenario, run over any RelayLike pair. Used by the in-process
// e2e test and the Docker e2e test (OHTTP relay → gateway → strfry).

import assert from 'node:assert/strict';
import { MatchClient } from '../../match/src/client.ts';
import { openMinedPsi } from '../../match/src/psi.ts';
import { seededRng, sketchItems } from '../../match/src/core.ts';
import type { RelayLike } from '../../match/src/relay.ts';
import { matchSimilarities } from '../../match/src/candidates.ts';
import { history, identity, idGen, range } from '../../match/test/helpers.ts';

export async function twoUsersExchange(aliceRelay: RelayLike, bobRelay: RelayLike, now: () => Date = () => new Date()): Promise<{ matchId: string }> {
  const psi = await openMinedPsi();
  const alice = await MatchClient.create({ identity: identity().signer, relay: aliceRelay, psi, now, rng: seededRng(1), newId: idGen(11) });
  const bob = await MatchClient.create({ identity: identity().signer, relay: bobRelay, psi, now, rng: seededRng(2), newId: idGen(22) });

  // Alice endorsed 0..59, Bob 30..99: 30 in common.
  const aliceHistory = history(range(0, 60), now());
  const bobHistory = history(range(30, 100), now());

  // 1. Request and a PSI preview, all through the transport.
  const matchId = await alice.requestMatch(bob.self);
  await alice.requestPreview(matchId, aliceHistory.map((h) => h.videoId));
  let r = await bob.sync();
  assert.deepEqual(
    r.events.map((e) => e.type),
    ['match-requested', 'preview-requested'],
  );
  await bob.respondToPreview(matchId, true, bobHistory.map((h) => h.videoId));
  await alice.sync(); // answers Bob's PSI request
  await bob.sync(); // computes, noises, replies
  r = await alice.sync();
  const result = r.events.find((e) => e.type === 'preview-result');
  assert.ok(result && result.type === 'preview-result', 'preview result arrived');

  // 2. Accept; both sides active with per-match keys.
  await bob.acceptMatch(matchId);
  r = await alice.sync();
  assert.ok(r.events.some((e) => e.type === 'match-active'));
  assert.equal(alice.book.matches[matchId].status, 'active');
  assert.equal(bob.book.matches[matchId].status, 'active');

  // 3. Sketches both ways (a 128-bucket sketch is the 33 KB wrap).
  await alice.sendDueSketches(aliceHistory);
  await bob.sendDueSketches(bobHistory);
  await alice.sync();
  await bob.sync();
  assert.equal(sketchItems(alice.book.matches[matchId].peerSketch!).size, 70);
  assert.equal(sketchItems(bob.book.matches[matchId].peerSketch!).size, 60);
  const sim = matchSimilarities(alice.book, aliceHistory.map((h) => h.videoId), { now: now() })[0];
  assert.ok(Math.abs(sim.similarity - 30 / 100) < 1e-9, `jaccard 30/100, got ${sim.similarity}`);

  // 4. Revoke reaches the peer.
  await alice.revoke(matchId);
  r = await bob.sync();
  assert.ok(r.events.some((e) => e.type === 'revoked'));
  return { matchId };
}
