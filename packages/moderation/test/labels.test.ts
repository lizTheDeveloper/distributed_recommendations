import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  KIND_LABEL,
  LabelIndex,
  buildLabelEvent,
  buildLabelIndex,
  fetchLabels,
  parseLabelEvent,
  parsePubkey,
  queryRelays,
  relayQuery,
  selfLabels,
  toNpub,
  verifyNostrEvent,
} from '../src/index.ts';
import type { NostrEvent } from '../src/index.ts';
import { FakeRelays, keypair, sign } from './helpers.ts';

const labeler = keypair(20);
const other = keypair(21);
const URL1 = 'https://tube.example/videos/watch/11111111-1111-1111-1111-111111111111';

function raw(tags: string[][], k = labeler, ts = 100): NostrEvent {
  return sign({ kind: KIND_LABEL, created_at: ts, tags, content: '' }, k);
}

test('parseLabelEvent: l tags need a mark matching an L tag', () => {
  const e = raw([
    ['L', 'match-feed.moderation'],
    ['l', 'spam', 'match-feed.moderation'],
    ['l', 'orphan', 'other.ns'],
    ['l', 'nomark'],
    ['r', URL1],
  ]);
  const ls = parseLabelEvent(e);
  assert.deepEqual(
    ls.map((l) => [l.namespace, l.value]),
    [['match-feed.moderation', 'spam']],
  );
  assert.deepEqual(ls[0].targets, [`r:${URL1}`]);
  assert.equal(ls[0].labeler, labeler.pk);
});

test('parseLabelEvent: no L tag and no mark implies ugc; # namespaces are associations, not moderation', () => {
  assert.deepEqual(
    parseLabelEvent(raw([['l', 'funny'], ['p', other.pk]])).map((l) => l.namespace),
    ['ugc'],
  );
  assert.deepEqual(parseLabelEvent(raw([['L', '#t'], ['l', 'permies', '#t'], ['p', other.pk]])), []);
});

test('parseLabelEvent: needs a valid target; normalizes targets; rejects unsafe strings', () => {
  assert.deepEqual(parseLabelEvent(raw([['L', 'x'], ['l', 'spam', 'x']])), []);
  assert.deepEqual(parseLabelEvent(raw([['L', 'x'], ['l', 'spam', 'x'], ['e', 'nothex']])), []);
  const l = parseLabelEvent(raw([['L', 'x'], ['l', 'spam', 'x'], ['l', 'bad‮', 'x'], ['r', 'HTTPS://Tube.Example/videos/watch/1#t=3'], ['t', '#Crypto'], ['a', `30005:${other.pk}:faves`]]));
  assert.equal(l.length, 1);
  assert.deepEqual(l[0].targets, ['r:https://tube.example/videos/watch/1', 't:crypto', `a:30005:${other.pk}:faves`]);
});

test('buildLabelEvent round-trips through parseLabelEvent', () => {
  const t = buildLabelEvent([{ type: 'r', value: URL1 }, { type: 'p', value: other.pk, relay: 'wss://r.example' }], 'match-feed.moderation', ['nudity', 'ai-generated'], {
    createdAt: 5,
    content: 'per our policy',
    expiresAt: 999,
  });
  const e = sign(t, labeler);
  const ls = parseLabelEvent(e);
  assert.deepEqual(ls.map((l) => l.value), ['nudity', 'ai-generated']);
  assert.equal(ls[0].reason, 'per our policy');
  assert.equal(ls[0].expiresAt, 999);
  assert.throws(() => buildLabelEvent([], 'x', ['y']), /target/);
  assert.throws(() => buildLabelEvent([{ type: 'e', value: 'nope' }], 'x', ['y']), /bad e target/);
});

test('buildLabelIndex keeps only verified labels from subscribed labelers, honours deletions and expiry', () => {
  const good = raw([['L', 'ns'], ['l', 'spam', 'ns'], ['r', URL1]]);
  const stranger = raw([['L', 'ns'], ['l', 'spam', 'ns'], ['r', URL1]], other);
  const tampered = { ...raw([['L', 'ns'], ['l', 'gore', 'ns'], ['r', URL1]]), content: 'changed' };
  const expired = raw([['L', 'ns'], ['l', 'old', 'ns'], ['r', URL1], ['expiration', '50']]);
  const retracted = raw([['L', 'ns'], ['l', 'oops', 'ns'], ['r', URL1]], labeler, 101);
  const deletion = sign({ kind: 5, created_at: 102, tags: [['e', retracted.id]], content: '' }, labeler);
  const fakeDeletion = sign({ kind: 5, created_at: 102, tags: [['e', good.id]], content: '' }, other);
  const idx = buildLabelIndex([good, stranger, tampered, expired, retracted, deletion, fakeDeletion], { labelers: [labeler.pk], verify: verifyNostrEvent, now: 100 });
  assert.deepEqual(idx.labelsFor([`r:${URL1}`]).map((l) => l.value), ['spam']);
});

test('LabelIndex.labelsFor deduplicates the same label across targets', () => {
  const e = raw([['L', 'ns'], ['l', 'spam', 'ns'], ['r', URL1], ['p', other.pk]]);
  const idx = new LabelIndex(parseLabelEvent(e));
  assert.equal(idx.labelsFor([`r:${URL1}`, `p:${other.pk}`]).length, 1);
  assert.equal(idx.size, 1);
});

test('selfLabels: NIP-36 content-warning and own L/l tags target the event itself', () => {
  const v = sign({ kind: 34235, created_at: 1, tags: [['d', 'x'], ['content-warning', 'Marked as sensitive (NSFW) on PeerTube'], ['L', 'ISO-639-1'], ['l', 'en', 'ISO-639-1']], content: '' }, other);
  const ls = selfLabels(v);
  assert.deepEqual(ls.map((l) => [l.namespace, l.value, l.self]), [['ISO-639-1', 'en', true], ['content-warning', 'content-warning', true]]);
  assert.deepEqual(ls[1].targets, [`e:${v.id}`]);
  assert.equal(ls[1].reason, 'Marked as sensitive (NSFW) on PeerTube');
});

test('npub parsing for labeler subscriptions', () => {
  const npub = toNpub(labeler.pk);
  assert.match(npub, /^npub1/);
  assert.equal(parsePubkey(npub), labeler.pk);
  assert.equal(parsePubkey(labeler.pk.toUpperCase()), labeler.pk);
  assert.throws(() => parsePubkey('nsec1abc'), TypeError);
});

test('fetchLabels asks relays by labeler only (never by video) and builds the index', async () => {
  const relays = new FakeRelays();
  const e1 = raw([['L', 'ns'], ['l', 'spam', 'ns'], ['r', URL1]]);
  const e2 = raw([['L', 'ns'], ['l', 'gore', 'ns'], ['r', URL1]], labeler, 150);
  relays.add('wss://a.example', e1);
  relays.add('wss://b.example', e1, e2, raw([['L', 'ns'], ['l', 'x', 'ns'], ['r', URL1]], other));
  relays.down.add('wss://down.example');
  const idx = await fetchLabels({
    labelers: [labeler.pk],
    relays: ['wss://a.example', 'wss://b.example', 'wss://down.example'],
    query: relayQuery({ WebSocket: relays.ctor(), timeoutMs: 500 }),
    verify: verifyNostrEvent,
    now: 200,
  });
  assert.deepEqual(idx.labelsFor([`r:${URL1}`]).map((l) => l.value).sort(), ['gore', 'spam']);
  const reqs = relays.received.filter((r) => r.msg[0] === 'REQ');
  assert.equal(reqs.length, 2);
  for (const r of reqs) {
    const filter = r.msg[2] as Record<string, unknown>;
    assert.deepEqual(filter.kinds, [1985, 5]);
    assert.deepEqual(filter.authors, [labeler.pk]);
    assert.ok(!Object.keys(filter).some((k) => k.startsWith('#')), 'no per-video tag filters');
  }
  assert.ok(relays.received.some((r) => r.msg[0] === 'CLOSE'));
});

test('queryRelays returns what a silent relay sent before the timeout, and rejects non-ws URLs', async () => {
  const relays = new FakeRelays();
  const e = raw([['L', 'ns'], ['l', 'spam', 'ns'], ['r', URL1]]);
  relays.add('wss://slow.example', e);
  relays.silent.add('wss://slow.example');
  const got = await queryRelays(['wss://slow.example'], { kinds: [1985] }, { WebSocket: relays.ctor(), timeoutMs: 50 });
  assert.deepEqual(got.map((x) => x.id), [e.id]);
  await assert.rejects(queryRelays(['https://relay.example'], {}), /ws/);
});
