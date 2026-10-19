import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getPublicKey } from 'nostr-tools/pure';
import type { AbstractSimplePool } from 'nostr-tools/abstract-pool';
import * as nip46 from 'nostr-tools/nip46';
import { signWith } from '../src/event.ts';
import { BRIDGE_LABEL_NAMESPACE, toVideoEvent } from '../src/mapping.ts';
import { bunkerSigner, parseBunkerUrl, verifySignedEvent } from '../src/nostr-signer.ts';
import { emptyState } from '../src/state.ts';
import { sync } from '../src/sync.ts';
import { FakeBunker, FakePeerTube, FakeRelay, fx, hexKey, skBytes } from './helpers.ts';

const asPool = (b: FakeBunker) => b as unknown as AbstractSimplePool;
const BUNKER_SK = hexKey(7);
const USER_SK = hexKey(9);
const USER_PK = getPublicKey(skBytes(USER_SK));

test('nostr-tools 2.25.2 exports what the bunker signer relies on', () => {
  const pkg = JSON.parse(readFileSync(new URL('../node_modules/nostr-tools/package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.version, '2.25.2');
  assert.equal(typeof nip46.BunkerSigner.fromBunker, 'function');
  assert.ok(nip46.BUNKER_REGEX instanceof RegExp);
  assert.equal(typeof nip46.BunkerSigner.prototype.connect, 'function');
  assert.equal(typeof nip46.BunkerSigner.prototype.signEvent, 'function');
});

test('parseBunkerUrl: bunker:// only, needs ws(s) relays, never a NIP-05 lookup', () => {
  const pk = 'ab'.repeat(32);
  assert.deepEqual(parseBunkerUrl(`bunker://${pk}?relay=wss%3A%2F%2Fr.test&relay=wss://s.test&secret=x1`), {
    pubkey: pk,
    relays: ['wss://r.test', 'wss://s.test'],
    secret: 'x1',
  });
  assert.equal(parseBunkerUrl(`bunker://${pk}?relay=wss://r.test`).secret, null);
  assert.throws(() => parseBunkerUrl('alice@example.com'), /bunker:\/\//);
  assert.throws(() => parseBunkerUrl(`bunker://${pk}`), /no relay/);
  assert.throws(() => parseBunkerUrl(`bunker://${pk}?relay=https://r.test`), /ws/);
});

test('bunker mode: real BunkerSigner over a fake pool; user key differs from bunker key', async () => {
  const b = new FakeBunker(BUNKER_SK, USER_SK);
  const signer = await bunkerSigner(b.url(), { pool: asPool(b), timeoutMs: 2000 });
  assert.equal(await signer.getPublicKey(), USER_PK);
  assert.notEqual(USER_PK, b.remotePubkey);
  const e = await signWith(signer, { kind: 1, created_at: 1700000000, tags: [], content: 'via bunker' }, { verify: verifySignedEvent });
  assert.equal(e.pubkey, USER_PK);
  assert.deepEqual(b.methods, ['connect', 'get_public_key', 'sign_event']);
  await signer.close();
  assert.equal(b.destroyed, false, 'an injected pool is not destroyed');
});

test('bunker mode: wrong secret, silent bunker and a bunker that signs with another key all fail', async () => {
  const wrong = new FakeBunker(BUNKER_SK, USER_SK, 'right');
  await assert.rejects(bunkerSigner(wrong.url().replace('secret=right', 'secret=nope'), { pool: asPool(wrong), timeoutMs: 2000 }), /invalid secret/);

  const silent = new FakeBunker(BUNKER_SK, USER_SK);
  silent.silent = true;
  await assert.rejects(bunkerSigner(silent.url(), { pool: asPool(silent), timeoutMs: 50 }), /no answer from remote signer/);

  const evil = new FakeBunker(BUNKER_SK, USER_SK);
  const signer = await bunkerSigner(evil.url(), { pool: asPool(evil), timeoutMs: 2000 });
  evil.signWithSk = skBytes(hexKey(11));
  await assert.rejects(signWith(signer, { kind: 1, created_at: 1700000000, tags: [], content: 'x' }), /different pubkey/);
  await signer.close();
});

test('bunker mode end to end: sync publishes and deletes as the creator, no p tag or bridge label', async () => {
  const b = new FakeBunker(BUNKER_SK, USER_SK);
  const signer = await bunkerSigner(b.url(), { pool: asPool(b), timeoutMs: 2000 });
  const pt = FakePeerTube.framaconf();
  const relay = new FakeRelay();
  const state = emptyState();
  const o = {
    publish: true,
    fetchExtras: false,
    limit: 1,
    verify: verifySignedEvent,
    state,
    client: { fetch: pt.fetch, minIntervalMs: 0 },
    relay: { WebSocket: relay.socketCtor(), timeoutMs: 500 },
  };
  const r = await sync('framatube.org', 'framaconf', signer, [relay.url], o);
  assert.equal(r[0].status, 'published');
  assert.equal(r[0].event!.pubkey, USER_PK);
  assert.ok(!r[0].event!.tags.some((t) => t[0] === 'p' || t[0] === 'proxy' || t[1] === BRIDGE_LABEL_NAMESPACE));
  pt.videos.delete(pt.uuids[0]);
  const d = await sync('framatube.org', 'framaconf', signer, [relay.url], o);
  assert.equal(d.at(-1)!.status, 'deleted');
  assert.equal(d.at(-1)!.event!.pubkey, USER_PK);
  await signer.close();
});

test('instance mode: p tag for the creator, disclosure in alt, NIP-48 proxy and NIP-32 label', () => {
  const v = fx('framatube-landscape.video.json');
  const creator = 'cd'.repeat(32);
  const t = toVideoEvent(v, { createdAt: 1, creatorPubkey: creator, instanceSigned: { operator: 'bridge.example' } });
  const tag = (n: string) => t.tags.filter((x) => x[0] === n);
  assert.deepEqual(tag('p'), [['p', creator]]);
  assert.match(tag('alt')[0][1], /Bridged to Nostr by bridge\.example with its own key; not signed by the creator\.$/);
  assert.deepEqual(tag('proxy'), [['proxy', v.url, 'activitypub']]);
  assert.ok(tag('L').some((x) => x[1] === BRIDGE_LABEL_NAMESPACE));
  assert.ok(tag('l').some((x) => x[1] === 'instance-signed' && x[2] === BRIDGE_LABEL_NAMESPACE));

  const own = toVideoEvent(v, { createdAt: 1 });
  assert.ok(!own.tags.some((x) => x[0] === 'proxy' || x[0] === 'p' || x[1] === BRIDGE_LABEL_NAMESPACE));
  assert.doesNotMatch(own.tags.find((x) => x[0] === 'alt')![1], /Bridged/);
});

// The CLI must refuse before touching the network, so these run offline.
function cli(args: string[], env: Record<string, string> = {}) {
  const path = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
  const { NOSTR_SECRET_KEY: _a, NOSTR_BUNKER_URL: _b, ...rest } = process.env;
  return spawnSync(process.execPath, ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', path, ...args], {
    env: { ...rest, ...env },
    encoding: 'utf8',
    timeout: 20_000,
  });
}

test('CLI: secrets on argv are refused; publish needs an explicit signer mode; instance needs an operator', () => {
  const base = ['sync', '--instance', 'pt.invalid', '--channel', 'c'];
  for (const flag of ['--nsec', '--secret-key', '--bunker']) {
    const r = cli([...base, flag, 'x']);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /never accepted on the command line/);
  }
  let r = cli([...base, '--publish', '--relay', 'ws://127.0.0.1:9'], { NOSTR_SECRET_KEY: hexKey(3) });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--publish requires --signer/);
  r = cli([...base, '--signer', 'instance', '--ephemeral-key']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /requires --operator/);
  r = cli([...base, '--signer', 'bunker']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /NOSTR_BUNKER_URL/);
  r = cli([...base, '--signer', 'key', '--creator-pubkey', 'cd'.repeat(32)], { NOSTR_SECRET_KEY: hexKey(3) });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /use --signer instance/);
});
