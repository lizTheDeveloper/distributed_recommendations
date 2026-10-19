// End to end, offline: the bridge publishes videos, a creator publishes picks, a
// viewer's app reads them back with apps/web's current Follow-taste resolver, and
// core ranks them with pick-dated recency. Relays are in memory (MemoryRelay) or a
// fake WebSocket relay (packages/bridge's test double); nothing touches the network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MemoryRelay,
  buildSetDeletion,
  npubDecode,
  npubEncode,
  parseTasteListJson,
  picksFromTasteList,
  publishPicks,
  readCreatorPicks,
  relayPublisher,
  relaysQuery,
  resolvePicks,
} from '../src/index.ts';
import type { PublishFn } from '../src/index.ts';
import { signWith } from '../../bridge/src/event.ts';
import { verifySignedEvent } from '../src/node-signers.ts';
import { FakeRelay } from '../../bridge/test/helpers.ts';
import { DEFAULT_RECIPE, rank, seededRng } from '../../core/src/index.ts';
import type { Candidate, Video } from '../../core/src/index.ts';
import { CHAPTERED, LANDSCAPE, NOW_S, PORTRAIT, bridge, bridged, curator, fx } from './helpers.ts';

const web = await import('../../../apps/web/src/lib/creatortaste.ts');
const webBech32 = await import('../../../apps/web/src/lib/bech32.ts');

const CPK = await curator.getPublicKey();
const BPK = await bridge.getPublicKey();

/** The creator's hosted list: v1 JSON with PeerTube URLs (one short /w/ link, one not bridged). */
const HOSTED = JSON.stringify({
  v: 1,
  name: 'Slow craft picks',
  description: 'Between kiln firings',
  items: [
    { id: 'https://framatube.org/w/rMSQhMAcPZGuZ36Anqdj2J', affiliated: true, addedAt: NOW_S - 86400, note: 'Best cob oven build' },
    { id: fx(PORTRAIT).url, sponsored: true, addedAt: NOW_S - 3600 },
    { id: 'https://peertube.example/videos/watch/11111111-2222-4333-8444-555555555555', addedAt: NOW_S - 7200 },
  ],
});

async function world() {
  const relay = new MemoryRelay(verifySignedEvent);
  for (const f of [LANDSCAPE, PORTRAIT, CHAPTERED]) assert.equal((await relay.publish(await bridged(f))).ok, true);
  const sent: string[] = [];
  const publish: PublishFn = async (relays, e) => {
    sent.push(...relays);
    return [await relay.publish(e)];
  };
  return { relay, publish, sent, query: (f: Record<string, unknown>) => relay.query(f) };
}

test('npub encoding agrees with apps/web', () => {
  const n = npubEncode(CPK);
  assert.equal(webBech32.findNpub(`support me: nostr:${n}`), CPK);
  assert.equal(npubDecode(n), CPK);
  assert.equal(npubDecode(n.slice(0, -1) + (n.endsWith('q') ? 'p' : 'q')), null);
});

test('in-memory relay round trip: resolve, dry run, publish, read back with apps/web and this package', async () => {
  const w = await world();
  const { set, report } = await resolvePicks(picksFromTasteList(parseTasteListJson(HOSTED)), { query: w.query, verify: verifySignedEvent, bridgePubkeys: [BPK] });
  assert.deepEqual(report.map((r) => r.status), ['bridged', 'bridged', 'not-bridged']);

  // Dry run (the default): nothing signed, nothing sent.
  const dry = await publishPicks(set, { signer: curator, relays: ['memory://relay'], createdAt: NOW_S, publish: w.publish });
  assert.equal(dry.dryRun, true);
  assert.equal(dry.event, undefined);
  assert.deepEqual(w.sent, []);
  assert.equal(dry.address, `30005:${CPK}:picks`);
  assert.deepEqual(dry.skipped.map((s) => s.url), ['https://peertube.example/videos/watch/11111111-2222-4333-8444-555555555555']);
  assert.ok(dry.warnings.some((x) => /only in the JSON list/.test(x)));
  assert.ok(dry.warnings.some((x) => /sponsored/.test(x)));
  assert.equal(JSON.parse(dry.json).author, npubEncode(CPK));

  // Publish.
  const res = await publishPicks(set, { signer: curator, relays: ['memory://relay'], dryRun: false, createdAt: NOW_S, publish: w.publish, verify: verifySignedEvent });
  assert.deepEqual(res.results?.map((r) => r.ok), [true]);
  assert.deepEqual(w.sent, ['memory://relay']);

  // A viewer's app, with apps/web's resolver as it is today: source 1 (signed Nostr list).
  const deps = {
    now: () => NOW_S * 1000,
    profile: async () => ({ text: `My picks are signed: ${npubEncode(CPK)}`, displayName: 'Hearth' }),
    relays: ['memory://relay'],
    nostrQuery: (f: Record<string, unknown>) => w.relay.query(f),
    verify: async (e: never) => verifySignedEvent(e),
    playlists: async () => [],
  };
  const r = await web.resolveCreatorTaste('hearth@craft.tube', 'Hearth', deps as never);
  assert.equal(r.taste?.source, 'nostr');
  assert.deepEqual(r.taste?.refs, [`30005:${CPK}:picks`]);
  assert.equal(r.taste?.detail, 'Slow craft picks');
  assert.deepEqual(r.taste?.items.map((i: { id: string }) => i.id), [fx(PORTRAIT).url, fx(LANDSCAPE).url]);

  // This package's strict reader also gets the per-item dates and flags.
  const back = await readCreatorPicks(CPK, { query: w.query, verify: verifySignedEvent });
  assert.deepEqual(back.rejected, []);
  assert.deepEqual(back.sets[0].list.items, [
    { id: fx(PORTRAIT).url, sponsored: true, affiliated: false, addedAt: NOW_S - 3600 },
    { id: fx(LANDSCAPE).url, sponsored: false, affiliated: true, addedAt: NOW_S - 86400, note: 'Best cob oven build' },
  ]);

  // Source 2 (taste-list URL): the JSON from the same publish, hosted at a URL.
  const urlDeps = { ...deps, relays: [], nostrQuery: undefined, profile: async () => ({ text: 'Taste list: https://craft.example/taste.json' }), fetchText: async () => res.json };
  const u = await web.resolveCreatorTaste('hearth@craft.tube', 'Hearth', urlDeps as never);
  assert.equal(u.taste?.source, 'url');
  assert.equal(u.taste?.items.length, 3, 'the unbridged pick is in the JSON list');
  assert.equal(u.taste?.items.find((i: { id: string }) => i.id === fx(PORTRAIT).url)?.sponsored, true);
});

test('updates replace the set; a deletion request clears it', async () => {
  const w = await world();
  const { set } = await resolvePicks(picksFromTasteList(parseTasteListJson(HOSTED)), { query: w.query, verify: verifySignedEvent, bridgePubkeys: [BPK] });
  await publishPicks(set, { signer: curator, relays: ['memory://relay'], dryRun: false, createdAt: NOW_S, publish: w.publish });
  // Add the chaptered video, a fresh pick.
  const more = { ...set, items: [...set.items, { url: fx(CHAPTERED).url, sponsored: false, affiliated: false, addedAt: NOW_S + 60 }] };
  const { set: resolved } = await resolvePicks(more, { query: w.query, verify: verifySignedEvent, bridgePubkeys: [BPK] });
  await publishPicks(resolved, { signer: curator, relays: ['memory://relay'], dryRun: false, createdAt: NOW_S + 60, publish: w.publish });
  const sets = await w.relay.query({ kinds: [30005], authors: [CPK] });
  assert.equal(sets.length, 1, 'addressable: one version per d');
  const back = await readCreatorPicks(CPK, { query: w.query, verify: verifySignedEvent });
  assert.equal(back.sets[0].list.items[0].id, fx(CHAPTERED).url, 'newest pick first');
  // An older replay is refused.
  const stale = await publishPicks(set, { signer: curator, relays: ['memory://relay'], dryRun: false, createdAt: NOW_S - 10, publish: w.publish });
  assert.equal(stale.results?.[0].ok, false);
  // Unpublish.
  const del = await signWith(curator, buildSetDeletion(CPK, 'picks', { createdAt: NOW_S + 120 }));
  assert.equal((await w.relay.publish(del)).ok, true);
  assert.deepEqual((await readCreatorPicks(CPK, { query: w.query, verify: verifySignedEvent })).sets, []);
});

test('a forged or foreign set is never read as the creator picks', async () => {
  const w = await world();
  const { set } = await resolvePicks(picksFromTasteList(parseTasteListJson(HOSTED)), { query: w.query, verify: verifySignedEvent, bridgePubkeys: [BPK] });
  const res = await publishPicks(set, { signer: curator, dryRun: true, signInDryRun: true, createdAt: NOW_S });
  const forged = { ...res.event!, tags: [...res.event!.tags, ['title', 'x']] };
  const careless = { query: async () => [forged, { ...res.event!, pubkey: BPK }] };
  const out = await readCreatorPicks(CPK, { ...careless, verify: verifySignedEvent });
  assert.deepEqual(out.sets, []);
  assert.equal(out.rejected.length, 2);
});

test('publishing needs a signer, relays and a publisher; dry run needs none', async () => {
  const { set } = { set: picksFromTasteList(parseTasteListJson(HOSTED)) };
  const dry = await publishPicks(set, { createdAt: NOW_S });
  assert.equal(dry.pubkey, undefined);
  assert.equal(JSON.parse(dry.json).author, undefined);
  assert.ok(dry.warnings.some((x) => /none of the picks is bridged/.test(x)));
  await assert.rejects(publishPicks(set, { dryRun: false }), /signer/);
  await assert.rejects(publishPicks(set, { dryRun: false, signer: curator }), /relay/);
  await assert.rejects(publishPicks(set, { dryRun: false, signer: curator, relays: ['wss://x.test'] }), /publish function/);
});

test('WebSocket round trip through the bridge relay client (fake relay, no network)', async () => {
  const fake = new FakeRelay('wss://relay.test');
  const opts = { WebSocket: fake.socketCtor(), retries: 0, timeoutMs: 2000 };
  const pub = relayPublisher(opts);
  for (const f of [LANDSCAPE, PORTRAIT]) assert.equal((await pub([fake.url], await bridged(f)))[0].ok, true);
  const query = relaysQuery([fake.url], opts);
  const { set, report } = await resolvePicks(picksFromTasteList(parseTasteListJson(HOSTED)), { query, verify: verifySignedEvent });
  assert.deepEqual(report.map((r) => r.status), ['bridged', 'bridged', 'not-bridged']);
  const res = await publishPicks(set, { signer: curator, relays: [fake.url], dryRun: false, createdAt: NOW_S, publish: pub, verify: verifySignedEvent });
  assert.deepEqual(res.results?.map((r) => [r.relay, r.ok]), [[fake.url, true]]);
  assert.equal(fake.sentEvents(30005).length, 1);
  const back = await readCreatorPicks(CPK, { query, verify: verifySignedEvent });
  assert.deepEqual(back.sets[0].list.items.map((i) => i.id), [fx(PORTRAIT).url, fx(LANDSCAPE).url]);
});

test('core ranks a fresh pick of an old video by when it was picked (addedAt)', async () => {
  const w = await world();
  const { set } = await resolvePicks(picksFromTasteList(parseTasteListJson(HOSTED)), { query: w.query, verify: verifySignedEvent, bridgePubkeys: [BPK] });
  const res = await publishPicks(set, { signer: curator, createdAt: NOW_S });
  const now = new Date(NOW_S * 1000);
  const land = fx(LANDSCAPE);
  const video: Video = { id: land.url, title: land.name, creator: `${land.channel!.name}@${land.channel!.host}`, durationSec: land.duration, publishedAt: new Date(land.publishedAt), tags: [] };
  assert.ok(now.getTime() - video.publishedAt.getTime() > 100 * 86_400_000, 'the fixture is a four-month-old upload');
  const item = res.tasteList.items.find((i) => i.id === land.url)!;
  const cand = (addedAt?: Date): Candidate => ({ video, source: { kind: 'taste', via: 'Hearth', strength: 0.5, ...(addedAt ? { addedAt } : {}) } });
  const [byUpload] = rank([cand()], DEFAULT_RECIPE, { now, limit: 5, rng: seededRng(1) });
  const [byPick] = rank([cand(new Date(item.addedAt! * 1000))], DEFAULT_RECIPE, { now, limit: 5, rng: seededRng(1) });
  assert.ok(byUpload.score < byPick.score / 100, 'decayed from the upload date it scores about 0');
  assert.ok(Math.abs(byPick.score - 0.9 * 0.5 * Math.pow(0.5, 1 / 14)) < 1e-9, 'picked a day ago');
});
