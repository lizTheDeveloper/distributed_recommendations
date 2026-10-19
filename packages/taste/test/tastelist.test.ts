import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TASTE_LIST_LIMITS,
  ValidationError,
  parseTasteList,
  parseTasteListJson,
  picksFromTasteList,
  serializeTasteList,
  toTasteList,
  validatePicksSet,
} from '../src/index.ts';
import type { PicksSet } from '../src/index.ts';

// apps/web's current parser, imported read-only: everything this package emits must
// parse there, and both parsers must agree on every vector.
const web = await import('../../../apps/web/src/lib/tastelist.ts');

const URL1 = 'https://framatube.org/videos/watch/d0dc4349-56a9-4388-bc76-b6b1d52efb6c';
const URL2 = 'https://tube.tchncs.de/videos/watch/26abe90d-e7c5-4bfb-a47d-bb17a495e338';
const URL3 = 'https://tube.tchncs.de/videos/watch/7516913d-a33b-46ca-9159-8a5523797af8';

const VALID: unknown[] = [
  { v: 1, name: 'x', items: [] },
  {
    v: 1,
    name: 'Slow craft picks',
    author: 'hearth@craft.tube',
    description: "What I've been watching between kiln firings",
    updatedAt: 1792411200,
    items: [{ id: URL1, note: 'Best cob oven build', sponsored: false, affiliated: true, addedAt: 1792400000 }],
  },
  { v: 1, name: 'n'.repeat(80), items: [{ id: 'http://a.example/videos/watch/abcdef' }] },
  { v: 1, name: 'n', items: Array.from({ length: 256 }, (_, i) => ({ id: `https://a.example/videos/watch/${i}` })) },
];

const INVALID: [string, unknown][] = [
  ['wrong version', { v: 2, name: 'x', items: [] }],
  ['unknown key', { v: 1, name: 'x', items: [], extra: 1 }],
  ['unknown item key', { v: 1, name: 'x', items: [{ id: URL1, title: 't' }] }],
  ['empty name', { v: 1, name: '', items: [] }],
  ['long name', { v: 1, name: 'n'.repeat(81), items: [] }],
  ['bidi in name', { v: 1, name: 'a‮b', items: [] }],
  ['control in note', { v: 1, name: 'x', items: [{ id: URL1, note: 'a\u0007' }] }],
  ['non-http id', { v: 1, name: 'x', items: [{ id: 'javascript:alert(1)' }] }],
  ['duplicate id', { v: 1, name: 'x', items: [{ id: URL1 }, { id: URL1 }] }],
  ['flag not boolean', { v: 1, name: 'x', items: [{ id: URL1, sponsored: 'yes' }] }],
  ['addedAt ms', { v: 1, name: 'x', items: [{ id: URL1, addedAt: 1792400000000 }] }],
  ['addedAt float', { v: 1, name: 'x', items: [{ id: URL1, addedAt: 1.5 }] }],
  ['too many items', { v: 1, name: 'x', items: Array.from({ length: 257 }, (_, i) => ({ id: `https://a.example/${i}` })) }],
  ['long note', { v: 1, name: 'x', items: [{ id: URL1, note: 'n'.repeat(281) }] }],
  ['not an object', [1, 2]],
  ['missing items', { v: 1, name: 'x' }],
];

test('valid vectors parse identically here and in apps/web', () => {
  for (const v of VALID) assert.deepEqual(parseTasteList(v), web.parseTasteList(v));
});

test('invalid vectors fail here and in apps/web', () => {
  for (const [why, v] of INVALID) {
    assert.throws(() => parseTasteList(v), ValidationError, why);
    assert.throws(() => web.parseTasteList(v), why);
  }
});

test('JSON text: size checked before parsing, bad JSON rejected', () => {
  const big = JSON.stringify({ v: 1, name: 'x', items: [], description: 'd' }).replace('"d"', `"${'d'.repeat(TASTE_LIST_LIMITS.maxJsonBytes)}"`);
  assert.throws(() => parseTasteListJson(big), /at most 65536 bytes/);
  assert.throws(() => web.parseTasteListJson(big));
  assert.throws(() => parseTasteListJson('{'), /not valid JSON/);
  assert.throws(() => parseTasteListJson(1 as unknown as string), /JSON text/);
});

const SET: PicksSet = {
  d: 'picks',
  title: 'Slow craft picks',
  description: 'Between kiln firings',
  items: [
    { url: 'https://framatube.org/w/rMSQhMAcPZGuZ36Anqdj2J', sponsored: false, affiliated: true, addedAt: 1792400000, note: 'Best cob oven build' },
    { url: URL2, sponsored: true, affiliated: false, addedAt: 1792410000 },
    { url: URL3, sponsored: false, affiliated: false },
  ],
};

test('toTasteList: canonical ids, newest first, flags only when true; parses in apps/web', () => {
  const list = toTasteList(SET, { author: 'npub1example', updatedAt: 1792411200 });
  assert.deepEqual(list, {
    v: 1,
    name: 'Slow craft picks',
    author: 'npub1example',
    description: 'Between kiln firings',
    updatedAt: 1792411200,
    items: [
      { id: URL2, sponsored: true, affiliated: false, addedAt: 1792410000 },
      { id: URL1, note: 'Best cob oven build', sponsored: false, affiliated: true, addedAt: 1792400000 },
      { id: URL3, sponsored: false, affiliated: false },
    ],
  });
  const text = serializeTasteList(SET, { author: 'npub1example', updatedAt: 1792411200 });
  assert.deepEqual(web.parseTasteListJson(text), list);
  assert.ok(!text.includes('"sponsored":false'), 'false flags are omitted');
  // Round trip back to picks.
  const back = picksFromTasteList(parseTasteListJson(text));
  assert.deepEqual(new Set(back.items.map((p) => p.url)), new Set([URL1, URL2, URL3]));
  assert.equal(back.items.find((p) => p.url === URL2)!.sponsored, true);
});

test('serializeTasteList refuses output over 64 KiB', () => {
  const items = Array.from({ length: 256 }, (_, i) => ({
    url: `https://tube.example/videos/watch/${'0'.repeat(8)}-0000-0000-0000-${i.toString(16).padStart(12, '0')}`,
    sponsored: false,
    affiliated: false,
    note: 'n'.repeat(280),
  }));
  assert.throws(() => serializeTasteList({ d: 'p', title: 't', items }), /at most 65536 bytes/);
});

test('validatePicksSet: strict, canonicalizes, rejects non-PeerTube URLs and duplicates', () => {
  const v = validatePicksSet(SET);
  assert.equal(v.items[0].url, URL1);
  const bad: [string, unknown][] = [
    ['not a watch URL', { ...SET, items: [{ url: 'https://example.com/x' }] }],
    ['duplicate after canonicalization', { ...SET, items: [{ url: URL1 }, { url: 'https://framatube.org/w/rMSQhMAcPZGuZ36Anqdj2J' }] }],
    ['unknown key', { ...SET, extra: true }],
    ['bad d', { ...SET, d: 'has space' }],
    ['image not https', { ...SET, image: 'http://x.example/i.png' }],
    ['video d mismatch', { ...SET, items: [{ url: URL1, video: { kind: 34235, pubkey: 'a'.repeat(64), d: '26abe90d-e7c5-4bfb-a47d-bb17a495e338' } }] }],
    ['video kind not NIP-71', { ...SET, items: [{ url: URL1, video: { kind: 1, pubkey: 'a'.repeat(64), id: 'b'.repeat(64) } }] }],
    ['regular kind without id', { ...SET, items: [{ url: URL1, video: { kind: 21, pubkey: 'a'.repeat(64) } }] }],
    ['addressable kind without d', { ...SET, items: [{ url: URL1, video: { kind: 34235, pubkey: 'a'.repeat(64) } }] }],
    ['relay not ws', { ...SET, items: [{ url: URL1, video: { kind: 34235, pubkey: 'a'.repeat(64), d: 'd0dc4349-56a9-4388-bc76-b6b1d52efb6c', relay: 'https://r' } }] }],
  ];
  for (const [why, x] of bad) assert.throws(() => validatePicksSet(x), ValidationError, why);
});
