import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signWith } from '../../bridge/src/event.ts';
import {
  MemoryRelay,
  bridgedAddresses,
  matchesFilter,
  canonicalFromApi,
  findBridgedVideo,
  parseWatchUrl,
  predictBridgedRef,
  shortUuidToUuid,
  uuidToShortUuid,
  videoUrlFromEvent,
} from '../src/index.ts';
import { verifySignedEvent } from '../src/node-signers.ts';
import { FIXTURES, LANDSCAPE, PORTRAIT, bridge, bridged, fx, stranger } from './helpers.ts';

test('short UUIDs decode and encode against every fixture (PeerTube flickrBase58)', () => {
  for (const f of FIXTURES) {
    const v = fx(f) as unknown as { uuid: string; shortUUID: string };
    assert.equal(shortUuidToUuid(v.shortUUID), v.uuid, f);
    assert.equal(uuidToShortUuid(v.uuid), v.shortUUID, f);
  }
  assert.equal(uuidToShortUuid('00000000-0000-0000-0000-000000000001'), '1111111111111111111112');
  assert.equal(shortUuidToUuid('1111111111111111111112'), '00000000-0000-0000-0000-000000000001');
  assert.equal(shortUuidToUuid('0OIl'), null, 'not in the alphabet');
  assert.equal(shortUuidToUuid('zzzzzzzzzzzzzzzzzzzzzzzz'), null, 'too long');
});

test('parseWatchUrl canonicalizes /w/, short ids, upper case and trailing junk', () => {
  const canonical = 'https://framatube.org/videos/watch/d0dc4349-56a9-4388-bc76-b6b1d52efb6c';
  for (const u of [
    canonical,
    'https://framatube.org/w/rMSQhMAcPZGuZ36Anqdj2J',
    'https://framatube.org/videos/watch/rMSQhMAcPZGuZ36Anqdj2J/',
    'https://framatube.org/w/D0DC4349-56A9-4388-BC76-B6B1D52EFB6C?start=30#x',
    'https://FRAMATUBE.org/w/rMSQhMAcPZGuZ36Anqdj2J',
  ]) {
    assert.deepEqual(parseWatchUrl(u), { origin: 'https://framatube.org', uuid: 'd0dc4349-56a9-4388-bc76-b6b1d52efb6c', canonical }, u);
  }
  for (const u of [
    'https://framatube.org/c/framaconf/videos',
    'https://framatube.org/videos/embed/d0dc4349-56a9-4388-bc76-b6b1d52efb6c',
    'ftp://framatube.org/w/rMSQhMAcPZGuZ36Anqdj2J',
    'https://user:pw@framatube.org/w/rMSQhMAcPZGuZ36Anqdj2J',
    'not a url',
  ]) {
    assert.equal(parseWatchUrl(u), null, u);
  }
  assert.equal(canonicalFromApi(fx(LANDSCAPE)), canonical);
});

test('predictBridgedRef uses the bridge kind rule and d = uuid', () => {
  const pk = '1'.repeat(64);
  assert.deepEqual(predictBridgedRef(fx(LANDSCAPE), pk), {
    kind: 34235,
    pubkey: pk,
    d: 'd0dc4349-56a9-4388-bc76-b6b1d52efb6c',
    url: 'https://framatube.org/videos/watch/d0dc4349-56a9-4388-bc76-b6b1d52efb6c',
  });
  assert.equal(predictBridgedRef(fx(PORTRAIT), pk).kind, 34236);
  assert.equal(predictBridgedRef(fx(PORTRAIT), pk, { kind: 'normal' }).kind, 34235);
  assert.deepEqual(
    bridgedAddresses('https://tube.tchncs.de/w/5LYcavSCrLGFTGus7iBMsY', pk).map((r) => `${r.kind}:${r.d}`),
    ['34235:26abe90d-e7c5-4bfb-a47d-bb17a495e338', '34236:26abe90d-e7c5-4bfb-a47d-bb17a495e338'],
  );
  assert.throws(() => bridgedAddresses('https://x.example/nope', pk), /watch URL/);
  assert.throws(() => predictBridgedRef(fx(LANDSCAPE), 'npub1xyz'), /hex/);
});

test('videoUrlFromEvent reads the bridge origin tag, then r', async () => {
  const e = await bridged(LANDSCAPE);
  assert.equal(videoUrlFromEvent(e), fx(LANDSCAPE).url);
  const rOnly = { ...e, tags: e.tags.filter((t) => t[0] !== 'origin') };
  assert.equal(videoUrlFromEvent(rOnly), fx(LANDSCAPE).url);
  const mismatch = { ...e, tags: e.tags.map((t) => (t[0] === 'origin' ? ['origin', 'peertube', '00000000-0000-0000-0000-000000000000', t[3]] : t)).filter((t) => t[0] !== 'r') };
  assert.equal(videoUrlFromEvent(mismatch), null, 'origin uuid must match its URL');
  assert.equal(videoUrlFromEvent({ ...e, kind: 1 }), null);
});

test('findBridgedVideo: trusted key, short URL, e id and kind from the relay', async () => {
  const relay = new MemoryRelay(verifySignedEvent);
  const land = await bridged(LANDSCAPE);
  const port = await bridged(PORTRAIT);
  await relay.publish(land);
  await relay.publish(port);
  const pk = await bridge.getPublicKey();
  const opts = { query: (f: Record<string, unknown>) => relay.query(f), verify: verifySignedEvent, bridgePubkeys: [pk] };
  const r = await findBridgedVideo('https://tube.tchncs.de/w/5LYcavSCrLGFTGus7iBMsY', opts);
  assert.deepEqual(r.ref, { kind: 34236, pubkey: pk, d: '26abe90d-e7c5-4bfb-a47d-bb17a495e338', id: port.id, url: fx(PORTRAIT).url });
  assert.equal(r.ambiguous, false);
  const none = await findBridgedVideo('https://tube.tchncs.de/videos/watch/7516913d-a33b-46ca-9159-8a5523797af8', opts);
  assert.equal(none.ref, null);
  assert.deepEqual(none.candidates, []);
});

test('findBridgedVideo: look-alikes, forged signatures and other authors', async () => {
  // A careless relay that returns whatever it was sent: findBridgedVideo must check.
  const stored: import('../../bridge/src/types.ts').SignedEvent[] = [];
  const relay = { publish: async (e: (typeof stored)[number]) => void stored.push(e), query: async (f: Record<string, unknown>) => stored.filter((e) => matchesFilter(e, f)) };
  const pk = await bridge.getPublicKey();
  const real = await bridged(LANDSCAPE);
  // Same d, but its origin points at another video: never a candidate.
  const lookalikeT = { ...real, tags: real.tags.map((t) => (t[0] === 'origin' ? ['origin', 'peertube', t[2], 'https://evil.example/videos/watch/' + t[2]] : t[0] === 'r' ? ['r', 'https://evil.example/videos/watch/' + real.tags.find((x) => x[0] === 'd')![1]] : t)) };
  const lookalike = await signWith(stranger, { kind: lookalikeT.kind, created_at: lookalikeT.created_at + 5, tags: lookalikeT.tags, content: '' });
  // Claims the bridge key but the signature is forged.
  const forged = { ...real, created_at: real.created_at + 10, id: 'f'.repeat(64) };
  await relay.publish(real);
  await relay.publish(lookalike);
  await relay.publish(forged);
  const q = (f: Record<string, unknown>) => relay.query(f);
  const untrusted = await findBridgedVideo(fx(LANDSCAPE).url, { query: q, verify: verifySignedEvent });
  assert.deepEqual(untrusted.candidates.map((c) => c.id), [real.id]);
  assert.equal(untrusted.ref?.id, real.id);

  // A second author bridging the same video: ambiguous without a trusted key.
  const copy = await bridged(LANDSCAPE, stranger);
  await relay.publish(copy);
  const amb = await findBridgedVideo(fx(LANDSCAPE).url, { query: q, verify: verifySignedEvent });
  assert.equal(amb.ambiguous, true);
  assert.equal(amb.ref, null);
  assert.equal(amb.candidates.length, 2);
  const pref = await findBridgedVideo(fx(LANDSCAPE).url, { query: q, verify: verifySignedEvent, bridgePubkeys: [await stranger.getPublicKey(), pk] });
  assert.equal(pref.ref?.pubkey, await stranger.getPublicKey(), 'first trusted key wins');
});

test('findBridgedVideo: regular kinds (bridge --regular) are found by #r and referenced by e', async () => {
  const relay = new MemoryRelay(verifySignedEvent);
  const reg = await bridged(LANDSCAPE, bridge, { addressable: false });
  await relay.publish(reg);
  const r = await findBridgedVideo(fx(LANDSCAPE).url, { query: (f) => relay.query(f), verify: verifySignedEvent });
  assert.deepEqual(r.ref, { kind: 21, pubkey: await bridge.getPublicKey(), id: reg.id, url: fx(LANDSCAPE).url });
  const off = await findBridgedVideo(fx(LANDSCAPE).url, { query: (f) => relay.query(f), verify: verifySignedEvent, regular: false });
  assert.equal(off.ref, null);
});
