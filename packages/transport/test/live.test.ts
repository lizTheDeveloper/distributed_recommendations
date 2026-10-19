// LiveRelay: the opt-out direct WebSocket client with live subscriptions and backoff.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LiveRelay, backoffDelay } from '../src/live.ts';
import type { NostrEvent } from '../src/protocol.ts';
import { randomPubkey, sleep, startFakeRelay, waitFor, wrapLike } from './helpers.ts';

test('backoff: full jitter, doubling, capped', () => {
  assert.equal(backoffDelay(0, 1_000, 60_000, () => 0.999999), 999.999);
  assert.equal(backoffDelay(3, 1_000, 60_000, () => 0.5), 4_000);
  assert.equal(backoffDelay(20, 1_000, 60_000, () => 1), 60_000);
  assert.equal(backoffDelay(5, 1_000, 60_000, () => 0), 0);
});

test('publish, query and a live subscription across two relays, de-duplicated', async () => {
  const r1 = await startFakeRelay();
  const r2 = await startFakeRelay();
  const live = new LiveRelay({ urls: [r1.url, r2.url], timeoutMs: 1_000 });
  try {
    const p = randomPubkey();
    const old = wrapLike(p, { createdAt: 1_700_000_000 });
    await r1.store.publish(old);
    const got: NostrEvent[] = [];
    live.subscribe({ kinds: [1059], '#p': [p] }, (e) => got.push(e));
    await waitFor(() => got.length === 1);
    assert.equal(got[0].id, old.id, 'stored events arrive first');

    const ev = wrapLike(p);
    assert.deepEqual(await live.publish(ev), { ok: true, message: '' });
    await waitFor(() => got.length === 2);
    await sleep(50);
    assert.equal(got.length, 2, 'the same event from both relays is delivered once');
    assert.equal(got[1].id, ev.id);

    const q = await live.query({ '#p': [p] });
    assert.deepEqual(
      q.map((e) => e.id),
      [old.id, ev.id],
    );
  } finally {
    live.close();
    await r1.close();
    await r2.close();
  }
});

test('reconnects with backoff after the relay drops, re-subscribes, misses nothing', async () => {
  const relay = await startFakeRelay();
  const states: string[] = [];
  const live = new LiveRelay({
    urls: [relay.url],
    timeoutMs: 1_000,
    backoffMs: { base: 20, max: 100 },
    onStatus: (s) => states.push(s.state),
  });
  try {
    const p = randomPubkey();
    const got: NostrEvent[] = [];
    live.subscribe({ '#p': [p] }, (e) => got.push(e));
    await waitFor(() => relay.connections === 1 && relay.received.some((m) => m[0] === 'REQ'));
    relay.dropAll();
    // Published while we're disconnected: arrives with the stored set on re-REQ.
    const during = wrapLike(p);
    await relay.store.publish(during);
    await waitFor(() => got.some((e) => e.id === during.id), 5_000);
    assert.ok(relay.connections >= 2, 'reconnected');
    assert.ok(states.includes('reconnecting'));
    const after = wrapLike(p);
    assert.ok((await live.publish(after)).ok);
    await waitFor(() => got.some((e) => e.id === after.id));
    assert.equal(new Set(got.map((e) => e.id)).size, got.length);
  } finally {
    live.close();
    await relay.close();
  }
});

test('an unreachable relay keeps retrying in the background without blocking the others', async () => {
  const relay = await startFakeRelay();
  let attempts = 0;
  const live = new LiveRelay({
    urls: [relay.url, 'ws://127.0.0.1:9'],
    timeoutMs: 500,
    backoffMs: { base: 10, max: 40 },
    onStatus: (s) => {
      if (s.url.includes(':9') && s.state === 'reconnecting') attempts = s.attempt;
    },
  });
  try {
    const p = randomPubkey();
    const got: NostrEvent[] = [];
    live.subscribe({ '#p': [p] }, (e) => got.push(e));
    const ev = wrapLike(p);
    const r = await live.publish(ev);
    assert.equal(r.ok, true, 'one relay is enough');
    await waitFor(() => got.length === 1);
    await waitFor(() => attempts >= 3, 5_000);
  } finally {
    live.close();
    await relay.close();
  }
});

test('refuses non-WebSocket relay URLs', () => {
  assert.throws(() => new LiveRelay({ urls: ['https://relay.example'] }), /ws:\/\/ or wss:\/\//);
});
