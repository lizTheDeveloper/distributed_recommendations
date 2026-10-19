import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BlockMatcher,
  KIND_MUTE_LIST,
  addBlock,
  emptyBlockState,
  fetchMuteList,
  importMuteList,
  parseBlockState,
  parseBlockStateJson,
  parseMuteList,
  removeBlock,
  removeMuteImport,
  serializeBlockState,
  verifyNostrEvent,
} from '../src/index.ts';
import { keypair, sign } from './helpers.ts';
import type { NostrEvent, NostrFilter } from '../src/index.ts';

const friend = keypair(30);
const spammer = keypair(31);

test('addBlock normalizes values and is immutable and idempotent', () => {
  const s0 = emptyBlockState();
  let s = addBlock(s0, 'creator', '@Troll@Tube.Example');
  s = addBlock(s, 'instance', 'https://Spam.Example/');
  s = addBlock(s, 'tag', '#Crypto');
  s = addBlock(s, 'keyword', '  Get  RICH ');
  s = addBlock(s, 'npub', spammer.pk.toUpperCase());
  assert.deepEqual(s0, emptyBlockState());
  assert.deepEqual(s.creators, ['troll@tube.example']);
  assert.deepEqual(s.instances, ['spam.example']);
  assert.deepEqual(s.tags, ['crypto']);
  assert.deepEqual(s.keywords, ['get rich']);
  assert.deepEqual(s.npubs, [spammer.pk]);
  assert.equal(addBlock(s, 'tag', 'crypto'), s);
  assert.deepEqual(removeBlock(s, 'creator', 'troll@TUBE.example').creators, []);
  assert.throws(() => addBlock(s, 'creator', 'no-host'), /handle/);
  assert.throws(() => addBlock(s, 'keyword', 'a'), /keyword/);
  assert.throws(() => addBlock(s, 'npub', 'npub1xyz'), /hex/);
  assert.throws(() => addBlock(s, 'instance', 'not a host'), /host/);
});

test('BlockState serializes to JSON and parses back strictly', () => {
  let s = addBlock(emptyBlockState(), 'video', 'https://tube.example/videos/watch/abc');
  s = addBlock(s, 'tasteList', `30005:${spammer.pk}:deals`);
  const text = serializeBlockState(s);
  assert.deepEqual(parseBlockStateJson(text), s);
  assert.throws(() => parseBlockState({ ...s, extra: 1 }), /unknown key/);
  assert.throws(() => parseBlockState({ ...s, v: 2 }), /v/);
  assert.throws(() => parseBlockState({ ...s, creators: ['bad'] }), /handle/);
  assert.throws(() => parseBlockStateJson('{"v":1,"keywords":["' + 'x'.repeat(1024 * 1024) + '"]}'), /too large/);
});

test('BlockMatcher: whole-word keywords, subdomain instance blocks, tag folding', () => {
  let s = addBlock(emptyBlockState(), 'keyword', 'ass');
  s = addBlock(s, 'keyword', 'free money');
  s = addBlock(s, 'instance', 'spam.example');
  s = addBlock(s, 'tag', 'NSFW');
  const m = new BlockMatcher(s);
  assert.equal(m.keyword(['A class on ass-embly?']), undefined === m ? 1 : m.keyword(['A class on ass-embly?']));
  assert.equal(m.keyword(['first class']), undefined);
  assert.deepEqual(m.keyword(['Get FREE   money now']), { list: 'keyword', value: 'free money' });
  assert.deepEqual(m.instance('video.spam.example'), { list: 'instance', value: 'spam.example' });
  assert.equal(m.instance('notspam.example'), undefined);
  assert.deepEqual(m.tag('#nsfw'), { list: 'tag', value: 'nsfw' });
  assert.equal(m.keyword(['Ｆｒｅｅ　ｍｏｎｅｙ']) !== undefined, true, 'fullwidth text is NFKC-folded');
});

function muteList(k = friend, ts = 100, tags: string[][] = []): NostrEvent {
  return sign({ kind: KIND_MUTE_LIST, created_at: ts, tags, content: 'ciphertext-of-private-items' }, k);
}

test('parseMuteList reads public p/t/word tags, skips threads and junk, never decrypts content', () => {
  const e = muteList(friend, 100, [['p', spammer.pk], ['p', 'junk'], ['t', '#Scam'], ['word', 'airdrop'], ['e', 'f'.repeat(64)], ['p', friend.pk]]);
  const m = parseMuteList(e, { verify: verifyNostrEvent });
  assert.deepEqual(m, { from: friend.pk, eventId: e.id, createdAt: 100, npubs: [spammer.pk], tags: ['scam'], keywords: ['airdrop'] });
  assert.equal(parseMuteList({ ...e, content: 'x' }, { verify: verifyNostrEvent }), null, 'bad signature');
  assert.equal(parseMuteList(e, { verify: verifyNostrEvent, author: spammer.pk }), null, 'wrong author');
  assert.equal(parseMuteList(sign({ kind: 3, created_at: 1, tags: [], content: '' }, friend), { verify: verifyNostrEvent }), null);
});

test('importMuteList: newer list from the same author replaces the old one; matcher records the source', () => {
  const v1 = parseMuteList(muteList(friend, 100, [['p', spammer.pk]]), { verify: verifyNostrEvent })!;
  const v2 = parseMuteList(muteList(friend, 200, [['word', 'airdrop']]), { verify: verifyNostrEvent })!;
  let s = importMuteList(emptyBlockState(), v2);
  assert.equal(importMuteList(s, v1), s, 'older list ignored');
  s = importMuteList(importMuteList(emptyBlockState(), v1), v2);
  assert.equal(s.imports.length, 1);
  const m = new BlockMatcher(s);
  assert.equal(m.npub(spammer.pk), undefined);
  assert.deepEqual(m.keyword(['Huge AIRDROP today']), { list: 'keyword', value: 'airdrop', from: friend.pk });
  assert.deepEqual(parseBlockStateJson(serializeBlockState(s)), s);
  assert.deepEqual(removeMuteImport(s, friend.pk).imports, []);
});

test('fetchMuteList asks for kind 10000 by that author and keeps the newest valid one', async () => {
  const filters: NostrFilter[] = [];
  const events = [muteList(friend, 100, [['t', 'a']]), muteList(friend, 300, [['t', 'b']]), { ...muteList(friend, 400, [['t', 'c']]), sig: '0'.repeat(128) }, muteList(spammer, 500, [['t', 'd']])];
  const m = await fetchMuteList({
    pubkey: friend.pk,
    relays: ['wss://r.example'],
    verify: verifyNostrEvent,
    query: async (_r, f) => {
      filters.push(f);
      return events;
    },
  });
  assert.deepEqual(m?.tags, ['b']);
  assert.deepEqual(filters[0], { kinds: [10000], authors: [friend.pk], limit: 5 });
  await assert.rejects(fetchMuteList({ pubkey: 'npub1x', relays: [], verify: verifyNostrEvent, query: async () => [] }), /hex/);
});
