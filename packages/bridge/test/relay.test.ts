import { test } from 'node:test';
import assert from 'node:assert/strict';
import { finalizeEvent } from 'nostr-tools/pure';
import { parseSecretKey, secretKeySigner, verifySignedEvent } from '../src/nostr-signer.ts';
import { backoffDelay, publishToRelay, query } from '../src/relay.ts';
import type { RelayOptions } from '../src/relay.ts';
import { emptyState } from '../src/state.ts';
import { sync } from '../src/sync.ts';
import type { SignedEvent } from '../src/types.ts';
import { FakePeerTube, FakeRelay, hexKey, skBytes } from './helpers.ts';

const SK = hexKey(3);
const signer = secretKeySigner(parseSecretKey(SK));
const note = (content = 'hi') => finalizeEvent({ kind: 1, created_at: Math.floor(Date.now() / 1000), tags: [], content }, skBytes(SK)) as SignedEvent;

function opts(relay: FakeRelay, extra: RelayOptions = {}): RelayOptions & { sleeps: number[] } {
  const sleeps: number[] = [];
  return { WebSocket: relay.socketCtor(), timeoutMs: 300, backoffMs: 100, random: () => 0.5, sleep: async (ms) => void sleeps.push(ms), sleeps, ...extra };
}

test('NIP-42: auth-required on EVENT -> AUTH with relay + challenge tags -> resend once', async () => {
  const relay = new FakeRelay();
  relay.requireAuth = true;
  const e = note();
  const r = await publishToRelay(relay.url, e, opts(relay, { authSigner: signer }));
  assert.deepEqual(r, { relay: relay.url, ok: true, message: '', attempts: 1, authenticated: true });
  assert.deepEqual(relay.received.map((m) => m[0]), ['EVENT', 'AUTH', 'EVENT']);
  const auth = relay.received[1][1] as SignedEvent;
  assert.equal(auth.kind, 22242);
  assert.ok(verifySignedEvent(auth));
  assert.equal(auth.pubkey, await signer.getPublicKey());
  assert.deepEqual(auth.tags.map((t) => t[0]), ['relay', 'challenge']);
  assert.equal(auth.tags[0][1], relay.url);
  assert.ok(relay.events.some((x) => x.id === e.id));
  assert.equal(relay.connections, 1);
});

test('NIP-42: without an auth signer, auth-required is a permanent failure (no retry)', async () => {
  const relay = new FakeRelay();
  relay.requireAuth = true;
  const o = opts(relay);
  const r = await publishToRelay(relay.url, note(), o);
  assert.equal(r.ok, false);
  assert.match(r.message, /^auth-required:/);
  assert.equal(r.attempts, 1);
  assert.equal(o.sleeps.length, 0);
  assert.ok(!relay.received.some((m) => m[0] === 'AUTH'));
});

test('NIP-42: a rejected AUTH (restricted key) is reported, not looped', async () => {
  const relay = new FakeRelay();
  relay.requireAuth = true;
  relay.authAllow = ['00'.repeat(32)];
  const r = await publishToRelay(relay.url, note(), opts(relay, { authSigner: signer }));
  assert.equal(r.ok, false);
  assert.match(r.message, /auth-required: AUTH rejected \(restricted:/);
  assert.equal(relay.received.filter((m) => m[0] === 'AUTH').length, 1);
});

test('NIP-42: CLOSED auth-required on REQ -> AUTH -> REQ again', async () => {
  const relay = new FakeRelay();
  const e = note('stored');
  relay.events.push(e);
  relay.requireAuth = true;
  const got = await query(relay.url, { kinds: [1] }, opts(relay, { authSigner: signer }));
  assert.deepEqual(got.map((x) => x.id), [e.id]);
  assert.deepEqual(relay.received.map((m) => m[0]), ['REQ', 'AUTH', 'REQ', 'CLOSE']);
  await assert.rejects(query(relay.url, { kinds: [1] }, opts(relay)), /auth-required/);
});

test('retries: connection failures back off exponentially, then succeed', async () => {
  const relay = new FakeRelay();
  relay.failConnects = 2;
  const o = opts(relay);
  const r = await publishToRelay(relay.url, note(), o);
  assert.equal(r.ok, true);
  assert.equal(r.attempts, 3);
  assert.deepEqual(o.sleeps, [75, 150]); // equal jitter with random 0.5: 100*2^n * 0.75
});

test('retries: give up after `retries` extra attempts', async () => {
  const relay = new FakeRelay();
  relay.failConnects = 10;
  const o = opts(relay, { retries: 2 });
  const r = await publishToRelay(relay.url, note(), o);
  assert.equal(r.ok, false);
  assert.match(r.message, /connection/);
  assert.equal(r.attempts, 3);
  assert.equal(relay.connections, 3);
});

test('retries: rate-limited OK is retried; invalid OK is not; timeouts are', async () => {
  const relay = new FakeRelay();
  relay.rateLimitNext = 1;
  let o = opts(relay);
  let r = await publishToRelay(relay.url, note(), o);
  assert.deepEqual([r.ok, r.attempts, o.sleeps.length], [true, 2, 1]);

  const bad = { ...note(), content: 'tampered' };
  o = opts(relay);
  r = await publishToRelay(relay.url, bad, o);
  assert.deepEqual([r.ok, r.attempts, r.message], [false, 1, 'invalid: bad signature']);

  const silent = new FakeRelay();
  silent.silent = true;
  o = opts(silent, { retries: 1, timeoutMs: 20 });
  r = await publishToRelay(silent.url, note(), o);
  assert.deepEqual([r.ok, r.attempts, r.message], [false, 2, 'timeout waiting for OK']);
});

test('backoffDelay stays within [exp/2, exp] and is capped', () => {
  for (const random of [0, 0.5, 0.999]) {
    for (let n = 0; n < 8; n++) {
      const exp = Math.min(15_000, 1000 * 2 ** n);
      const d = backoffDelay(n, { random: () => random });
      assert.ok(d >= exp / 2 && d <= exp, `${n}:${d}`);
    }
  }
  assert.equal(backoffDelay(20, { random: () => 1, maxBackoffMs: 5000 }), 5000);
});

test('sync against a relay that requires AUTH: the event signer authenticates; relayAuth:false turns it off', async () => {
  const pt = FakePeerTube.framaconf();
  const relay = new FakeRelay();
  relay.requireAuth = true;
  const base = {
    publish: true,
    fetchExtras: false,
    limit: 1,
    verify: verifySignedEvent,
    client: { fetch: pt.fetch, minIntervalMs: 0 },
    relay: { WebSocket: relay.socketCtor(), timeoutMs: 300, backoffMs: 1 },
  };
  const off = await sync('framatube.org', 'framaconf', signer, [relay.url], { ...base, relayAuth: false, state: emptyState() });
  assert.equal(off[0].relays![0].ok, false);
  assert.match(off[0].relays![0].message, /auth-required/);

  const state = emptyState();
  const on = await sync('framatube.org', 'framaconf', signer, [relay.url], { ...base, state });
  assert.equal(on[0].status, 'published');
  assert.equal(on[0].relays![0].ok, true);
  assert.equal(on[0].relays![0].authenticated, true);
  assert.equal(Object.values(state.entries).length, 1);
  // The relaysNeedingEvent REQ also authenticated, so a rerun sees the stored event.
  const again = await sync('framatube.org', 'framaconf', signer, [relay.url], { ...base, state });
  assert.equal(again[0].relays![0].message, 'unchanged; not re-sent');
});
