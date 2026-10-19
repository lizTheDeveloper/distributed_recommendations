import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { goneReason, toDeletionRequest } from '../src/deletion.ts';
import { parseSecretKey, secretKeySigner, verifySignedEvent } from '../src/nostr-signer.ts';
import { emptyState, parseState, stateKey } from '../src/state.ts';
import type { BridgeState } from '../src/state.ts';
import { loadState, saveState } from '../src/state-file.ts';
import { sync } from '../src/sync.ts';
import type { SyncOptions } from '../src/sync.ts';
import type { PtVideo } from '../src/types.ts';
import { FakePeerTube, FakeRelay, hexKey } from './helpers.ts';

const SK = hexKey(3);
const signer = secretKeySigner(parseSecretKey(SK));
const noSocket = class {
  constructor() {
    throw new Error('dry run opened a socket');
  }
} as unknown as new (url: string) => WebSocket;

function setup() {
  const pt = FakePeerTube.framaconf();
  const relay = new FakeRelay();
  const state = emptyState();
  let saves = 0;
  const opts = (extra: SyncOptions = {}): SyncOptions => ({
    publish: true,
    fetchExtras: false,
    verify: verifySignedEvent,
    client: { fetch: pt.fetch, minIntervalMs: 0 },
    relay: { WebSocket: relay.socketCtor(), timeoutMs: 1000, backoffMs: 1 },
    state,
    onStateChange: () => void saves++,
    ...extra,
  });
  return { pt, relay, state, opts, saves: () => saves };
}

test('NIP-09 request shape: e + a + k for addressable, e + k for regular', () => {
  const pk = 'f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9';
  const id = 'ab'.repeat(32);
  const t = toDeletionRequest({ kind: 34235, pubkey: pk, eventId: id, address: `34235:${pk}:uuid-1` }, 'gone', 1700000000);
  assert.deepEqual(t, {
    kind: 5,
    created_at: 1700000000,
    tags: [
      ['e', id],
      ['a', `34235:${pk}:uuid-1`],
      ['k', '34235'],
    ],
    content: 'gone',
  });
  assert.deepEqual(toDeletionRequest({ kind: 21, pubkey: pk, eventId: id }, 'x').tags, [
    ['e', id],
    ['k', '21'],
  ]);
  assert.throws(() => toDeletionRequest({ kind: 34235, pubkey: pk, address: `34236:${pk}:u` }, 'x'), /address/);
  assert.throws(() => toDeletionRequest({ kind: 21, pubkey: pk }, 'x'), /needs/);
});

test('goneReason: only removed / not public / blocked trigger a deletion', () => {
  const v = { uuid: 'u', privacy: { id: 1, label: 'Public' } } as PtVideo;
  assert.equal(goneReason(undefined, 404)?.reason, 'removed');
  assert.equal(goneReason(undefined, 410)?.reason, 'removed');
  assert.equal(goneReason(undefined, 403)?.reason, 'not-public');
  assert.equal(goneReason({ ...v, privacy: { id: 2, label: 'Unlisted' } })?.reason, 'not-public');
  assert.equal(goneReason({ ...v, privacy: { id: 3, label: 'Private' } })?.reason, 'not-public');
  assert.equal(goneReason({ ...v, blacklisted: true })?.reason, 'blocked');
  assert.equal(goneReason(v), undefined);
  assert.equal(goneReason({ ...v, state: { id: 2, label: 'To transcode' } }), undefined, 'transient state keeps the event');
  assert.equal(goneReason(undefined, 500), undefined);
});

test('deletions: dry run plans, publish sends once, later runs are idempotent', async () => {
  const s = setup();
  const [a, b, c] = s.pt.uuids;
  const first = await sync('framatube.org', 'framaconf', signer, [s.relay.url], s.opts());
  assert.deepEqual(first.map((r) => r.status), ['published', 'published', 'published']);
  assert.equal(Object.keys(s.state.entries).length, 3);
  const pk = await signer.getPublicKey();
  const entryA = s.state.entries[stateKey(pk, a)];
  assert.equal(entryA.status, 'live');
  assert.equal(entryA.address, `34235:${pk}:${a}`);
  assert.equal(entryA.eventId, first[0].event!.id);
  assert.deepEqual(entryA.relays, [s.relay.url]);
  assert.equal(entryA.instance, 'https://framatube.org');
  assert.equal(s.relay.events.length, 3);

  // a: made private (PeerTube answers 403 problem+json); b: deleted (404); c: unlisted.
  s.pt.videos.set(a, { status: 403 });
  s.pt.videos.delete(b);
  s.pt.patch(c, { privacy: { id: 2, label: 'Unlisted' } });

  // Dry run, unsigned: plans deletions from the state, opens no socket, changes nothing.
  const before = JSON.stringify(s.state);
  const dry = await sync('framatube.org', 'framaconf', null, [s.relay.url], s.opts({ publish: false, relay: { WebSocket: noSocket } }));
  assert.deepEqual(dry.map((r) => [r.uuid, r.status, r.reason]), [
    [a, 'delete-planned', 'not-public'],
    [b, 'delete-planned', 'removed'],
    [c, 'delete-planned', 'not-public'],
  ]);
  assert.deepEqual(dry[0].template!.tags, [
    ['e', entryA.eventId],
    ['a', `34235:${pk}:${a}`],
    ['k', '34235'],
  ]);
  assert.equal(JSON.stringify(s.state), before);

  // Dry run, signed: deletion events are signed but not sent.
  const sentBefore = s.relay.received.length;
  const drySigned = await sync('framatube.org', 'framaconf', signer, [s.relay.url], s.opts({ publish: false }));
  assert.ok(drySigned.every((r) => r.status === 'delete-planned' && r.event && verifySignedEvent(r.event)));
  assert.equal(s.relay.received.length, sentBefore);

  // Publish: three kind-5 requests; the relay drops the video events.
  const savesBefore = s.saves();
  const pub = await sync('framatube.org', 'framaconf', signer, [s.relay.url], s.opts());
  assert.deepEqual(pub.map((r) => [r.uuid, r.status]), [
    [a, 'deleted'],
    [b, 'deleted'],
    [c, 'deleted'],
  ]);
  assert.equal(s.saves() - savesBefore, 3);
  const dels = s.relay.sentEvents(5);
  assert.equal(dels.length, 3);
  for (const d of dels) {
    assert.ok(verifySignedEvent(d));
    assert.equal(d.pubkey, pk);
    assert.deepEqual(d.tags.map((t) => t[0]), ['e', 'a', 'k']);
  }
  assert.equal(s.relay.events.filter((e) => e.kind === 34235).length, 0, 'all three video events deleted on the relay');
  const eA = s.state.entries[stateKey(pk, a)];
  assert.equal(eA.status, 'deleted');
  assert.equal(eA.deletion!.reason, 'not-public');
  assert.deepEqual(eA.deletion!.relays, [s.relay.url]);

  // Again: nothing to do, nothing sent, state untouched.
  const n = s.relay.received.length;
  const again = await sync('framatube.org', 'framaconf', signer, [s.relay.url], s.opts());
  assert.deepEqual(again, []);
  assert.equal(s.relay.received.length, n);
  assert.equal(s.saves() - savesBefore, 3);
});

test('re-published after a deletion: created_at is newer than the deletion, so it survives', async () => {
  const s = setup();
  const [a] = s.pt.uuids;
  const pk = await signer.getPublicKey();
  const now = Math.floor(Date.now() / 1000);
  await sync('framatube.org', 'framaconf', signer, [s.relay.url], s.opts({ createdAt: now }));
  s.pt.patch(a, { privacy: { id: 3, label: 'Private' } });
  await sync('framatube.org', 'framaconf', signer, [s.relay.url], s.opts());
  const del = s.state.entries[stateKey(pk, a)].deletion!;
  assert.ok(del);

  s.pt.patch(a, { privacy: { id: 1, label: 'Public' } });
  // Same-second rerun: the bridge must bump created_at past the deletion.
  const back = await sync('framatube.org', 'framaconf', signer, [s.relay.url], s.opts({ createdAt: del.createdAt }));
  const r = back.find((x) => x.uuid === a)!;
  assert.equal(r.status, 'published');
  assert.ok(r.event!.created_at > del.createdAt);
  assert.ok(s.relay.events.some((e) => e.id === r.event!.id), 'relay kept the re-published version');
  const entry = s.state.entries[stateKey(pk, a)];
  assert.equal(entry.status, 'live');
  assert.equal(entry.deletion, undefined);
  assert.equal(entry.eventId, r.event!.id);
});

test('publish idempotency: an unchanged second run sends nothing and does not rewrite state', async () => {
  const s = setup();
  await sync('framatube.org', 'framaconf', signer, [s.relay.url], s.opts({ createdAt: 1700000000 }));
  const saves = s.saves();
  const snapshot = JSON.stringify({ ...s.state, entries: Object.fromEntries(Object.entries(s.state.entries).map(([k, e]) => [k, { ...e, updatedAt: 0 }])) });
  const sent = s.relay.sentEvents().length;
  const second = await sync('framatube.org', 'framaconf', signer, [s.relay.url], s.opts());
  assert.ok(second.every((r) => r.relays![0].message === 'unchanged; not re-sent'));
  assert.equal(s.relay.sentEvents().length, sent);
  assert.equal(s.saves(), saves);
  assert.equal(JSON.stringify({ ...s.state, entries: Object.fromEntries(Object.entries(s.state.entries).map(([k, e]) => [k, { ...e, updatedAt: 0 }])) }), snapshot);
});

test('no deletion on doubt: outside --limit, 5xx, HTML error pages, transient states', async () => {
  const s = setup();
  const [a, b, c] = s.pt.uuids;
  await sync('framatube.org', 'framaconf', signer, [s.relay.url], s.opts());

  // Still public but outside --limit: checked, kept.
  let r = await sync('framatube.org', 'framaconf', signer, [s.relay.url], s.opts({ limit: 1 }));
  assert.deepEqual(r.map((x) => x.status), ['published']);

  s.pt.videos.set(a, { status: 503 });
  s.pt.videos.set(b, { status: 403, html: true });
  s.pt.patch(c, { state: { id: 2, label: 'To transcode' } });
  r = await sync('framatube.org', 'framaconf', signer, [s.relay.url], s.opts());
  // a and b vanish from the listing (the fake only lists public videos it can serve), c is refused.
  assert.equal(s.relay.sentEvents(5).length, 0);
  assert.ok(Object.values(s.state.entries).every((e) => e.status === 'live'));
  const errs = r.filter((x) => x.status === 'error').map((x) => x.uuid);
  assert.ok(errs.includes(a) && errs.includes(b));
  assert.ok(r.some((x) => x.uuid === c && x.status === 'refused'));
});

test('blocked by the instance and regular kinds: deletion with e + k only', async () => {
  const s = setup();
  const [a] = s.pt.uuids;
  await sync('framatube.org', 'framaconf', signer, [s.relay.url], s.opts({ addressable: false, limit: 1 }));
  const pk = await signer.getPublicKey();
  const entry = s.state.entries[stateKey(pk, a)];
  assert.equal(entry.kind, 21);
  assert.equal(entry.address, undefined);
  s.pt.patch(a, { blacklisted: true });
  const r = await sync('framatube.org', 'framaconf', signer, [s.relay.url], s.opts({ addressable: false, limit: 1 }));
  const del = r.find((x) => x.uuid === a)!;
  assert.equal(del.status, 'deleted');
  assert.equal(del.reason, 'blocked');
  assert.deepEqual(del.event!.tags, [
    ['e', entry.eventId],
    ['k', '21'],
  ]);
  assert.ok(!s.relay.events.some((e) => e.id === entry.eventId));
});

test('deletions go to recorded relays too, and only entries signed by this key are touched', async () => {
  const s = setup();
  const other = new FakeRelay('wss://other.test');
  const both = s.opts();
  // Publish to relay.test with key 3.
  await sync('framatube.org', 'framaconf', signer, [s.relay.url], { ...both, limit: 1 });
  // A second key also bridged the same channel into the same state.
  const signer2 = secretKeySigner(parseSecretKey(hexKey(5)));
  await sync('framatube.org', 'framaconf', signer2, [s.relay.url], { ...both, limit: 1 });
  assert.equal(Object.keys(s.state.entries).length, 2);

  s.pt.videos.delete(s.pt.uuids[0]);
  // Run with key 3, naming only another relay: the deletion also goes to the recorded relay.
  const sockets = { a: s.relay.socketCtor(), b: other.socketCtor() };
  const routed = class {
    constructor(url: string) {
      return new (url === other.url ? sockets.b : sockets.a)(url);
    }
  } as unknown as new (url: string) => WebSocket;
  const r = await sync('framatube.org', 'framaconf', signer, [other.url], { ...both, relay: { WebSocket: routed, timeoutMs: 1000 } });
  const del = r.filter((x) => x.status === 'deleted');
  assert.equal(del.length, 1);
  assert.deepEqual(del[0].relays!.map((x) => [x.relay, x.ok]), [
    [other.url, true],
    [s.relay.url, true],
  ]);
  const pk2 = await signer2.getPublicKey();
  assert.equal(Object.values(s.state.entries).find((e) => e.pubkey === pk2)!.status, 'live', "key 5's entry untouched");
});

test('a deletion no relay accepts is reported and retried next run', async () => {
  const s = setup();
  await sync('framatube.org', 'framaconf', signer, [s.relay.url], s.opts({ limit: 1 }));
  s.pt.videos.delete(s.pt.uuids[0]);
  s.relay.failConnects = 100;
  const r = await sync('framatube.org', 'framaconf', signer, [s.relay.url], s.opts({ limit: 1, relay: { WebSocket: s.relay.socketCtor(), retries: 1, backoffMs: 1, timeoutMs: 200 } }));
  assert.equal(r.at(-1)!.status, 'error');
  assert.ok(Object.values(s.state.entries).every((e) => e.status === 'live'));
  s.relay.failConnects = 0;
  const r2 = await sync('framatube.org', 'framaconf', signer, [s.relay.url], s.opts({ limit: 1 }));
  assert.equal(r2.at(-1)!.status, 'deleted');
});

test('state file: atomic save/load round trip; missing file is empty; malformed is an error', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mfb-state-'));
  try {
    const path = join(dir, 'state.json');
    assert.deepEqual(await loadState(path), emptyState());
    const s = setup();
    await sync('framatube.org', 'framaconf', signer, [s.relay.url], s.opts({ limit: 2, onStateChange: (st: BridgeState) => saveState(path, st) }));
    const loaded = await loadState(path);
    assert.deepEqual(loaded, s.state);
    assert.equal(Object.keys(loaded.entries).length, 2);
    assert.doesNotMatch(readFileSync(path, 'utf8'), new RegExp(SK), 'no secret key in the state file');
    assert.throws(() => parseState('{"version":2,"entries":{}}'), /version/);
    assert.throws(() => parseState('{"version":1,"entries":{"x":{"uuid":"u"}}}'), /malformed/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
