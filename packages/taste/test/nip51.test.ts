import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CURATION_LIMITS,
  ValidationError,
  buildCurationSet,
  buildSetDeletion,
  curationSetAddress,
  nip07Signer,
  parseCurationSet,
  picksFromCurationSet,
  resolveCurationSet,
  signCurationSet,
  videoFilters,
} from '../src/index.ts';
import type { PicksSet, Signer } from '../src/index.ts';
import { verifySignedEvent } from '../src/node-signers.ts';
import type { EventTemplate, SignedEvent } from '../../bridge/src/types.ts';
import { LANDSCAPE, PORTRAIT, bridge, bridged, curator, fx } from './helpers.ts';

const web = await import('../../../apps/web/src/lib/creatortaste.ts');

const BPK = await bridge.getPublicKey();
const CPK = await curator.getPublicKey();
const U_LAND = fx(LANDSCAPE).url;
const U_PORT = fx(PORTRAIT).url;
const U_OTHER = 'https://tube.tchncs.de/videos/watch/7516913d-a33b-46ca-9159-8a5523797af8';
const D_LAND = 'd0dc4349-56a9-4388-bc76-b6b1d52efb6c';
const D_PORT = '26abe90d-e7c5-4bfb-a47d-bb17a495e338';
const ID = 'e'.repeat(64);

function set(): PicksSet {
  return {
    d: 'picks',
    title: 'Slow craft picks',
    description: 'Between kiln firings',
    image: 'https://craft.example/cover.jpg',
    items: [
      // Newest pick first here on purpose: the event must be oldest first.
      { url: U_PORT, sponsored: true, affiliated: false, addedAt: 1792410000, video: { kind: 34236, pubkey: BPK, d: D_PORT, url: U_PORT } },
      { url: U_LAND, sponsored: false, affiliated: true, addedAt: 1792400000, note: 'Best cob oven build', video: { kind: 34235, pubkey: BPK, d: D_LAND, id: ID, relay: 'wss://relay.example', url: U_LAND } },
      { url: U_OTHER, sponsored: false, affiliated: false, addedAt: 1792405000 },
    ],
  };
}

test('buildCurationSet: NIP-51 tags, oldest first, a + e + pick per item, unbridged skipped', () => {
  const { template, skipped, included } = buildCurationSet(set(), { createdAt: 1792411200 });
  assert.equal(template.kind, 30005);
  assert.equal(template.content, '');
  assert.equal(template.created_at, 1792411200);
  assert.deepEqual(template.tags, [
    ['d', 'picks'],
    ['title', 'Slow craft picks'],
    ['description', 'Between kiln firings'],
    ['image', 'https://craft.example/cover.jpg'],
    ['alt', 'Video curation set: Slow craft picks'],
    ['a', `34235:${BPK}:${D_LAND}`, 'wss://relay.example'],
    ['e', ID, 'wss://relay.example', BPK],
    ['pick', `34235:${BPK}:${D_LAND}`, U_LAND, '1792400000', 'affiliated', 'Best cob oven build'],
    ['a', `34236:${BPK}:${D_PORT}`],
    ['pick', `34236:${BPK}:${D_PORT}`, U_PORT, '1792410000', 'sponsored'],
  ]);
  assert.deepEqual(skipped, [{ url: U_OTHER, reason: 'not bridged to Nostr (no NIP-71 video event found)' }]);
  assert.deepEqual(included.map((p) => p.url), [U_LAND, U_PORT]);
});

test('buildCurationSet: e-only refs for regular kinds, undated picks first, both flags', () => {
  const s: PicksSet = {
    d: 'x',
    title: 'X',
    items: [
      { url: U_LAND, sponsored: true, affiliated: true, addedAt: 5, video: { kind: 21, pubkey: BPK, id: ID, url: U_LAND } },
      { url: U_PORT, sponsored: false, affiliated: false, video: { kind: 34236, pubkey: BPK, d: D_PORT, url: U_PORT } },
    ],
  };
  const { template } = buildCurationSet(s, { createdAt: 10 });
  assert.deepEqual(template.tags.slice(3), [
    ['a', `34236:${BPK}:${D_PORT}`],
    ['pick', `34236:${BPK}:${D_PORT}`, U_PORT, '', ''],
    ['e', ID, '', BPK],
    ['pick', ID, U_LAND, '5', 'sponsored,affiliated'],
  ]);
});

test('buildCurationSet: size limit and invalid sets', () => {
  const items = Array.from({ length: 256 }, (_, i) => {
    const d = `00000000-0000-0000-0000-${i.toString(16).padStart(12, '0')}`;
    const url = `https://tube.example/videos/watch/${d}`;
    return { url, sponsored: false, affiliated: false, note: 'n'.repeat(280), video: { kind: 34235, pubkey: BPK, d, id: ID.slice(0, 60) + i.toString(16).padStart(4, '0'), url } };
  });
  assert.throws(() => buildCurationSet({ d: 'p', title: 't', items }), /limit is 65536/);
  assert.ok(CURATION_LIMITS.maxEventBytes === 65536);
  assert.throws(() => buildCurationSet({ d: '', title: 't', items: [] }), ValidationError);
  assert.throws(() => buildCurationSet({ ...set(), createdAt: 1 } as unknown as PicksSet), /unknown key/);
  assert.throws(() => buildCurationSet(set(), { createdAt: -1 }), /Unix seconds/);
});

test('signCurationSet: signs with any Signer, verifies, and catches a signer that alters the event', async () => {
  const { template } = buildCurationSet(set(), { createdAt: 1792411200 });
  const e = await signCurationSet(curator, template, { verify: verifySignedEvent });
  assert.equal(e.pubkey, CPK);
  assert.ok(verifySignedEvent(e));
  // A NIP-07 extension is just `window.nostr`.
  const ext = nip07Signer({ getPublicKey: () => curator.getPublicKey(), signEvent: (t: EventTemplate) => curator.signEvent(t) });
  assert.equal((await signCurationSet(ext, template)).id, e.id);
  assert.throws(() => nip07Signer(undefined), /NIP-07/);
  const sneaky: Signer = {
    getPublicKey: () => curator.getPublicKey(),
    signEvent: (t) => curator.signEvent({ ...t, tags: [...t.tags, ['p', 'f'.repeat(64)]] }),
  };
  await assert.rejects(signCurationSet(sneaky, template), /modified the event/);
  await assert.rejects(signCurationSet(curator, { ...template, kind: 30004 }), /30005/);
});

test('parseCurationSet: round trip of our own event, and back to editable picks', async () => {
  const { template } = buildCurationSet(set(), { createdAt: 1792411200 });
  const e = await signCurationSet(curator, template);
  const p = parseCurationSet(e, { pubkey: CPK });
  assert.equal(p.d, 'picks');
  assert.equal(p.title, 'Slow craft picks');
  assert.equal(p.image, 'https://craft.example/cover.jpg');
  assert.deepEqual(p.items.map((i) => i.ref.type), ['a', 'e', 'a']);
  assert.deepEqual(p.items[0].pick, { url: U_LAND, addedAt: 1792400000, sponsored: false, affiliated: true, note: 'Best cob oven build' });
  assert.equal(p.items[1].pick, p.items[0].pick, 'the e ref shares the a ref pick');
  assert.deepEqual(p.items[2].pick, { url: U_PORT, addedAt: 1792410000, sponsored: true, affiliated: false });
  assert.deepEqual(videoFilters(p), [{ ids: [ID] }, { kinds: [34235, 34236], authors: [BPK], '#d': [D_LAND, D_PORT] }]);
  const edit = picksFromCurationSet(p);
  assert.deepEqual(edit.items.map((i) => [i.url, i.video?.kind, i.video?.id]), [
    [U_LAND, 34235, ID],
    [U_PORT, 34236, undefined],
  ]);
  // Rebuilding from the parsed picks gives the same tags.
  assert.deepEqual(buildCurationSet({ ...edit, image: 'https://craft.example/cover.jpg', description: 'Between kiln firings', updatedAt: undefined } as PicksSet, { createdAt: 1 }).template.tags.filter((t) => t[0] !== 'image' && t[0] !== 'description'), template.tags.filter((t) => t[0] !== 'image' && t[0] !== 'description'));
});

test('parseCurationSet: accepts other clients sets (plain e refs, unknown tags), rejects malformed ones', async () => {
  const base = { id: 'a'.repeat(64), pubkey: CPK, sig: 'b'.repeat(128), kind: 30005, created_at: 1, content: '' };
  const ok = parseCurationSet({ ...base, tags: [['d', 'yaks'], ['t', 'craft'], ['client', 'x'], ['e', ID]] });
  assert.deepEqual(ok.items, [{ ref: { type: 'e', id: ID }, value: ID }]);
  assert.equal(ok.title, undefined);
  const A = `34235:${BPK}:${D_LAND}`;
  const bad: [string, unknown, RegExp][] = [
    ['kind', { ...base, kind: 30004, tags: [['d', 'x']] }, /kind/],
    ['pubkey filter', { ...base, tags: [['d', 'x']] }, /expected author/],
    ['no d', { ...base, tags: [] }, /d: is required/],
    ['two d', { ...base, tags: [['d', 'x'], ['d', 'y']] }, /at most once/],
    ['two titles', { ...base, tags: [['d', 'x'], ['title', 'a'], ['title', 'b']] }, /at most once/],
    ['long title', { ...base, tags: [['d', 'x'], ['title', 't'.repeat(81)]] }, /at most 80/],
    ['bidi description', { ...base, tags: [['d', 'x'], ['description', 'a‮b']] }, /control/],
    ['a to an article', { ...base, tags: [['d', 'x'], ['a', `30023:${BPK}:abc`]] }, /video/],
    ['malformed a', { ...base, tags: [['d', 'x'], ['a', 'nope']] }, /a ref/],
    ['malformed e', { ...base, tags: [['d', 'x'], ['e', 'xyz']] }, /e ref/],
    ['bad relay hint', { ...base, tags: [['d', 'x'], ['e', ID, 'https://x']] }, /relay URL/],
    ['duplicate ref', { ...base, tags: [['d', 'x'], ['e', ID], ['e', ID]] }, /duplicate/],
    ['pick without ref', { ...base, tags: [['d', 'x'], ['pick', A, U_LAND, '', '']] }, /does not match/],
    ['pick uuid mismatch', { ...base, tags: [['d', 'x'], ['a', A], ['pick', A, U_PORT, '', '']] }, /doesn't match/],
    ['pick url not canonical', { ...base, tags: [['d', 'x'], ['a', A], ['pick', A, 'https://framatube.org/w/rMSQhMAcPZGuZ36Anqdj2J', '', '']] }, /canonical/],
    ['pick bad time', { ...base, tags: [['d', 'x'], ['a', A], ['pick', A, U_LAND, '17924e5', '']] }, /Unix seconds/],
    ['pick bad flag', { ...base, tags: [['d', 'x'], ['a', A], ['pick', A, U_LAND, '', 'paid']] }, /subset/],
    ['pick repeated flag', { ...base, tags: [['d', 'x'], ['a', A], ['pick', A, U_LAND, '', 'sponsored,sponsored']] }, /subset/],
    ['two picks', { ...base, tags: [['d', 'x'], ['a', A], ['pick', A, U_LAND, '', ''], ['pick', A, U_LAND, '', '']] }, /more than one/],
    ['short pick', { ...base, tags: [['d', 'x'], ['a', A], ['pick', A, U_LAND]] }, /must be \["pick"/],
    ['long note', { ...base, tags: [['d', 'x'], ['a', A], ['pick', A, U_LAND, '', '', 'n'.repeat(281)]] }, /at most 280/],
    ['non-string tag value', { ...base, tags: [['d', 'x'], ['e', 5]] }, /only strings/],
    ['too many tags', { ...base, tags: [['d', 'x'], ...Array.from({ length: CURATION_LIMITS.maxTags }, () => ['t', 'x'])] }, /at most/],
    ['huge value', { ...base, tags: [['d', 'x'], ['t', 'x'.repeat(2000)]] }, /at most 1024/],
    ['bad sig format', { ...base, sig: 'zz', tags: [['d', 'x']] }, /sig/],
  ];
  for (const [why, x, re] of bad) {
    assert.throws(() => parseCurationSet(x, why === 'pubkey filter' ? { pubkey: BPK } : {}), re, why);
  }
  // Total size: many medium values under the per-tag limit.
  const fat = { ...base, tags: [['d', 'x'], ...Array.from({ length: 100 }, () => ['t', 'x'.repeat(1000)])] };
  assert.throws(() => parseCurationSet(fat), /65536 bytes/);
});

test('resolveCurationSet: maps refs through signed video events, newest first, flags kept', async () => {
  const land = await bridged(LANDSCAPE);
  const port = await bridged(PORTRAIT);
  const s = set();
  s.items[1].video!.id = land.id;
  const { template } = buildCurationSet(s, { createdAt: 1792411200 });
  const parsed = parseCurationSet(await signCurationSet(curator, template));
  const list = await resolveCurationSet(parsed, [land, port], { verify: verifySignedEvent });
  assert.deepEqual(list, {
    v: 1,
    name: 'Slow craft picks',
    description: 'Between kiln firings',
    updatedAt: 1792411200,
    items: [
      { id: U_PORT, sponsored: true, affiliated: false, addedAt: 1792410000 },
      { id: U_LAND, sponsored: false, affiliated: true, addedAt: 1792400000, note: 'Best cob oven build' },
    ],
  });
  // Without the video events, the curator's pick URLs are used (or not, if asked).
  assert.equal((await resolveCurationSet(parsed, [], { verify: verifySignedEvent })).items.length, 2);
  assert.equal((await resolveCurationSet(parsed, [], { verify: verifySignedEvent, usePickUrl: false })).items.length, 0);
  // A forged video event is ignored; a pick whose URL disagrees with its video is dropped.
  const forged = { ...port, sig: '0'.repeat(128) };
  assert.equal((await resolveCurationSet(parsed, [forged], { verify: verifySignedEvent, usePickUrl: false })).items.length, 0);
  const wrongPick = structuredClone(parsed);
  wrongPick.items[2].pick = { ...wrongPick.items[2].pick!, url: U_OTHER };
  const r = await resolveCurationSet(wrongPick, [land, port], { verify: verifySignedEvent });
  assert.deepEqual(r.items.map((i) => i.id), [U_LAND]);
});

test("apps/web's current NIP-51 reader accepts our events (curationSets, refFilters, curationItems)", async () => {
  const land = await bridged(LANDSCAPE);
  const port = await bridged(PORTRAIT);
  const s = set();
  s.items[1].video!.id = land.id;
  const ev = await signCurationSet(curator, buildCurationSet(s, { createdAt: 1792411200 }).template);
  const verify = async (e: SignedEvent) => verifySignedEvent(e);
  const cs = await web.curationSets([ev], CPK, verify as never);
  assert.equal(cs.sets.length, 1);
  assert.equal(cs.sets[0].title, 'Slow craft picks');
  assert.equal(cs.sets[0].d, 'picks');
  // Web reverses tag order: newest pick first.
  assert.deepEqual(cs.sets[0].refs.map((r: { type: string }) => r.type), ['a', 'e', 'a']);
  const filters = web.refFilters(cs.sets[0].refs);
  assert.deepEqual(filters, [{ ids: [land.id] }, { kinds: [34236, 34235], authors: [BPK], '#d': [D_PORT, D_LAND] }]);
  const items = await web.curationItems(cs, [land, port], verify as never);
  assert.deepEqual(items.map((i: { id: string }) => i.id), [U_PORT, U_LAND]);
  assert.equal(curationSetAddress(CPK, 'picks'), `30005:${CPK}:picks`);
});

test('buildSetDeletion: NIP-09 a ref to the set', () => {
  const t = buildSetDeletion(CPK, 'picks', { createdAt: 5 });
  assert.deepEqual(t, { kind: 5, created_at: 5, tags: [['a', `30005:${CPK}:picks`], ['k', '30005']], content: '' });
  assert.throws(() => buildSetDeletion('npub', 'x'), /hex/);
});
