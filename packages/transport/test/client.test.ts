// OhttpRelay: RelayLike over OHTTP. Batching, fixed sizes on the wire, paging,
// constant-rate cover traffic, key pinning and rotation, split keys.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REQUEST_BUCKETS } from '../src/protocol.ts';
import { OhttpRelay } from '../src/ohttpRelay.ts';
import { createInProcessGateway, relayFetch } from '../src/ohttp.ts';
import { TARGET_AUTHORITY, randomPubkey, sleep, startStack, waitFor, wrapLike } from './helpers.ts';

const fast = { batchDelayMs: { min: 5, max: 20 } };

test('publish and query through OHTTP; concurrent calls share one padded request', async () => {
  const s = await startStack();
  const sizes: { requestBytes: number; responseBytes: number; ops: number }[] = [];
  const t = new OhttpRelay({ relayUrl: s.relayUrl, fetch: s.fetch, pins: [s.gateway.pin], ...fast, onRequest: (i) => sizes.push(i) });
  try {
    const p = randomPubkey();
    const evs = [wrapLike(p, { contentBytes: 8_000 }), wrapLike(p, { contentBytes: 8_000 }), wrapLike(p, { contentBytes: 8_000 })];
    const results = await Promise.all(evs.map((e) => t.publish(e)));
    assert.deepEqual(
      results.map((r) => r.ok),
      [true, true, true],
    );
    assert.equal(sizes.length, 1, 'three publishes in one request');
    assert.equal(sizes[0].ops, 3);
    assert.equal(sizes[0].requestBytes, 40_960);
    assert.equal(sizes[0].responseBytes, 4_096, 'publish-only batches ask for the smallest response');
    assert.equal(s.relays[0].store.log.length, 3);

    const got = await t.query({ kinds: [1059], '#p': [p] });
    assert.deepEqual(got.map((e) => e.id).sort(), evs.map((e) => e.id).sort());
    assert.equal(sizes.at(-1)!.responseBytes, 262_144);
    assert.equal(t.pin, s.gateway.pin);
  } finally {
    t.close();
    await s.close();
  }
});

test('the OHTTP relay sees only fixed ciphertext sizes, whatever the payload', async () => {
  const s = await startStack();
  const t = new OhttpRelay({ relayUrl: s.relayUrl, fetch: s.fetch, ...fast });
  try {
    const p = randomPubkey();
    await t.publish(wrapLike(p, { contentBytes: 19_000 })); // control-message-sized wrap
    await t.publish(wrapLike(p, { contentBytes: 25_000 }));
    await t.publish(wrapLike(p, { contentBytes: 33_000 })); // 128-bucket-sketch-sized wrap
    await t.query({ '#p': [p] });
    await t.query({ '#p': [randomPubkey()] });
    const gw = s.forwarded.filter((f) => f.path === '/gateway').map((f) => f.bytes);
    // Ciphertext = 7-byte header + 32-byte enc + BHTTP framing + body + 16-byte tag.
    const distinct = [...new Set(gw)];
    assert.ok(distinct.length <= 2, `sizes seen by the relay: ${distinct.join(', ')}`);
    const overhead = gw.map((b, i) => b - [40_960, 40_960, 40_960, 4_096, 4_096][i]);
    assert.equal(new Set(overhead).size, 1, 'constant framing overhead');
  } finally {
    t.close();
    await s.close();
  }
});

test('query pages through more events than one response holds', async () => {
  const s = await startStack();
  const t = new OhttpRelay({ relayUrl: s.relayUrl, fetch: s.fetch, ...fast, responseBytes: 65_536, pageLimit: 10 });
  try {
    const p = randomPubkey();
    const base = Math.floor(Date.now() / 1000) - 10_000;
    const all = [];
    for (let i = 0; i < 37; i++) {
      const e = wrapLike(p, { createdAt: base + Math.floor(i / 3), contentBytes: 3_000 }); // ties on timestamps
      all.push(e);
      await s.relays[0].store.publish(e);
    }
    const got = await t.query({ '#p': [p] });
    assert.equal(got.length, 37);
    assert.deepEqual(new Set(got.map((e) => e.id)), new Set(all.map((e) => e.id)));
    for (let i = 1; i < got.length; i++) assert.ok(got[i - 1].created_at <= got[i].created_at, 'oldest first');
  } finally {
    t.close();
    await s.close();
  }
});

test('constant-rate mode: one uniform request per tick, cover traffic when idle', async () => {
  const s = await startStack();
  const sizes: { requestBytes: number; responseBytes: number; ops: number }[] = [];
  const t = new OhttpRelay({ relayUrl: s.relayUrl, fetch: s.fetch, mode: 'constant-rate', tickMs: 40, tickJitter: 0.25, onRequest: (i) => sizes.push(i) });
  try {
    await waitFor(() => sizes.length >= 2);
    assert.ok(sizes.slice(0, 2).every((x) => x.ops === 0), 'idle ticks are empty cover requests');
    const p = randomPubkey();
    const [r1, r2] = await Promise.all([t.publish(wrapLike(p, { contentBytes: 19_000 })), t.query({ '#p': [p] })]);
    assert.ok(r1.ok);
    assert.ok(Array.isArray(r2));
    await sleep(100);
    assert.ok(sizes.every((x) => x.requestBytes === 40_960 && x.responseBytes === 65_536), JSON.stringify(sizes));
  } finally {
    t.close();
    await s.close();
  }
  const n = s.forwarded.length;
  await sleep(120);
  assert.equal(s.forwarded.length, n, 'close() stops the ticks');
});

test('splitKeys sends each key in its own request', async () => {
  const s = await startStack();
  const t = new OhttpRelay({ relayUrl: s.relayUrl, fetch: s.fetch, ...fast, splitKeys: true });
  try {
    const keys = [randomPubkey(), randomPubkey(), randomPubkey()];
    for (const k of keys) await s.relays[0].store.publish(wrapLike(k));
    const got = await t.query({ '#p': keys });
    assert.equal(got.length, 3);
    const reqs = s.relays[0].received.filter((m) => m[0] === 'REQ').map((m) => (m[2] as { '#p': string[] })['#p']);
    assert.deepEqual(
      reqs.map((r) => r.length),
      [1, 1, 1],
    );
    assert.equal(s.forwarded.filter((f) => f.path === '/gateway').length, 3);
  } finally {
    t.close();
    await s.close();
  }
});

test('an unpinned gateway key is refused before anything is sent', async () => {
  const s = await startStack();
  const t = new OhttpRelay({ relayUrl: s.relayUrl, fetch: s.fetch, ...fast, pins: ['00'.repeat(32)] });
  try {
    const r = await t.publish(wrapLike(randomPubkey()));
    assert.equal(r.ok, false);
    assert.match(r.message, /not pinned/);
    assert.deepEqual(
      s.forwarded.map((f) => f.path),
      ['/ohttp-keys'],
    );
    assert.equal(s.relays[0].received.length, 0);
  } finally {
    t.close();
    await s.close();
  }
});

test('gateway key rotation: one re-fetch, accepted only if the new key is pinned', async () => {
  const s = await startStack({ seed: new Uint8Array(32).fill(1) });
  // The gateway rotates: a new instance with a new seed in front of the same target.
  const rotated = await createInProcessGateway({ target: (r) => s.target.handle(r), allowedAuthority: TARGET_AUTHORITY, seed: new Uint8Array(32).fill(2) });
  let current = s.gateway;
  const fetch = relayFetch((r) => current.handle(r));
  const pinned = new OhttpRelay({ relayUrl: s.relayUrl, fetch, ...fast, pins: [s.gateway.pin, rotated.pin] });
  const onlyOld = new OhttpRelay({ relayUrl: s.relayUrl, fetch, ...fast, pins: [s.gateway.pin] });
  try {
    assert.ok((await pinned.publish(wrapLike(randomPubkey()))).ok);
    assert.ok((await onlyOld.publish(wrapLike(randomPubkey()))).ok);
    current = rotated;
    assert.ok((await pinned.publish(wrapLike(randomPubkey()))).ok, 'retried with the new pinned key');
    assert.equal(pinned.pin, rotated.pin);
    const r = await onlyOld.publish(wrapLike(randomPubkey()));
    assert.equal(r.ok, false);
    assert.match(r.message, /not pinned/);
  } finally {
    pinned.close();
    onlyOld.close();
    await s.close();
  }
});

test('a relay URL must be https except for localhost', () => {
  assert.throws(() => new OhttpRelay({ relayUrl: 'http://relay.example.net/gateway' }), /https/);
  assert.doesNotThrow(() => new OhttpRelay({ relayUrl: 'http://127.0.0.1:8081/gateway' }).close());
  assert.throws(() => new OhttpRelay({ relayUrl: 'https://r.example/gateway', uniformRequestBytes: 5_000 }), new RegExp(String(REQUEST_BUCKETS[0])));
});
