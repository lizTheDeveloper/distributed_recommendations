// The Nostr gateway target: publish → relay OKs, query → events then CLOSE, size
// limits, kinds, signatures, rate limits that don't use the peer address, no logs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ExchangeResponse, Op } from '../src/protocol.ts';
import { RESPONSE_BUCKETS, decodeResponse, encodeRequest, padJson } from '../src/protocol.ts';
import { TokenBuckets } from '../src/ratelimit.ts';
import { createTarget } from '../src/target.ts';
import type { Target } from '../src/target.ts';
import { WsUpstream } from '../src/upstream.ts';
import { randomPubkey, startFakeRelay, waitFor, wrapLike } from './helpers.ts';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';

async function call(target: Target, ops: Op[], opts: { size?: number; respBytes?: number } = {}): Promise<{ status: number; body: ExchangeResponse }> {
  const respBytes = opts.respBytes ?? 262_144;
  const res = await target.handle(
    new Request('http://target/v1/exchange', { method: 'POST', headers: { 'content-type': 'application/json' }, body: encodeRequest({ v: 1, respBytes, ops }, opts.size ?? 81_920) }),
  );
  const bytes = new Uint8Array(await res.arrayBuffer());
  assert.equal(bytes.length, respBytes, 'every target response is exactly the asked size');
  return { status: res.status, body: decodeResponse(bytes, respBytes) };
}

test('publish goes to every configured relay over WebSocket and returns their OKs', async () => {
  const r1 = await startFakeRelay();
  const r2 = await startFakeRelay();
  const target = createTarget({ upstream: new WsUpstream({ relays: [r1.url, r2.url], timeoutMs: 1_000 }) });
  try {
    const p = randomPubkey();
    const ev = wrapLike(p, { contentBytes: 33_000 });
    const { status, body } = await call(target, [{ op: 'publish', event: ev }]);
    assert.equal(status, 200);
    assert.equal(body.status, 'ok');
    const pub = body.results[0];
    assert.ok(pub.op === 'publish' && pub.ok);
    assert.deepEqual(
      pub.relays.map((r) => [r.relay, r.ok]),
      [
        [r1.url, true],
        [r2.url, true],
      ],
    );
    assert.equal(r1.store.log.length, 1);
    assert.equal(r2.store.log[0].id, ev.id);
    // A duplicate is still OK.
    const again = (await call(target, [{ op: 'publish', event: ev }])).body.results[0];
    assert.ok(again.op === 'publish' && again.ok && again.relays[0].message.startsWith('duplicate'));
  } finally {
    target.close();
    await r1.close();
    await r2.close();
  }
});

test('one relay down: publish still succeeds through the other, and says which failed', async () => {
  const up = await startFakeRelay();
  const target = createTarget({ upstream: new WsUpstream({ relays: [up.url, 'ws://127.0.0.1:9'], timeoutMs: 500 }) });
  try {
    const r = (await call(target, [{ op: 'publish', event: wrapLike(randomPubkey()) }])).body.results[0];
    assert.ok(r.op === 'publish');
    assert.equal(r.ok, true);
    assert.equal(r.relays[1].ok, false);
    assert.match(r.relays[1].message, /^error: /);
  } finally {
    target.close();
    await up.close();
  }
});

test('query returns matching events newest first, honours since/limit, CLOSEs the REQ, and pages', async () => {
  const relay = await startFakeRelay();
  const target = createTarget({ upstream: new WsUpstream({ relays: [relay.url], timeoutMs: 1_000 }) });
  try {
    const p = randomPubkey();
    const other = randomPubkey();
    const base = Math.floor(Date.now() / 1000) - 1_000;
    for (let i = 0; i < 30; i++) await relay.store.publish(wrapLike(p, { createdAt: base + i }));
    await relay.store.publish(wrapLike(other, { createdAt: base }));

    const { body } = await call(target, [{ op: 'query', filter: { '#p': [p], since: base + 10, limit: 5 } }]);
    const q = body.results[0];
    assert.ok(q.op === 'query' && q.ok);
    assert.deepEqual(
      q.events.map((e) => e.created_at),
      [29, 28, 27, 26, 25].map((i) => base + i),
    );
    assert.equal(q.more, true, 'limit reached: more may exist');
    assert.ok(q.events.every((e) => e.kind === 1059), 'kinds defaulted to the allowed set');

    const req = relay.received.find((m) => m[0] === 'REQ')!;
    assert.deepEqual(req[2], { '#p': [p], since: base + 10, limit: 5, kinds: [1059] });
    await waitFor(() => relay.received.some((m) => m[0] === 'CLOSE' && m[1] === req[1])); // REQ closed after EOSE

    const rest = (await call(target, [{ op: 'query', filter: { '#p': [p], since: base + 10, until: base + 25, limit: 50 } }])).body.results[0];
    assert.ok(rest.op === 'query');
    assert.equal(rest.events.length, 16);
    assert.equal(rest.more, false);
  } finally {
    target.close();
    await relay.close();
  }
});

test('a response too small for the events truncates and sets more', async () => {
  const relay = await startFakeRelay();
  const target = createTarget({ upstream: new WsUpstream({ relays: [relay.url], timeoutMs: 1_000 }) });
  try {
    const p = randomPubkey();
    for (let i = 0; i < 6; i++) await relay.store.publish(wrapLike(p, { contentBytes: 19_000, createdAt: 1_700_000_000 + i }));
    const q = (await call(target, [{ op: 'query', filter: { '#p': [p] } }], { respBytes: 65_536 })).body.results[0];
    assert.ok(q.op === 'query');
    assert.equal(q.events.length, 3);
    assert.equal(q.more, true);
    assert.equal(q.events[0].created_at, 1_700_000_005);
  } finally {
    target.close();
    await relay.close();
  }
});

test('size limits: unpadded bodies, > 80 KiB bodies and > 64 KiB events are refused; nothing reaches the relay', async () => {
  const relay = await startFakeRelay();
  const target = createTarget({ upstream: new WsUpstream({ relays: [relay.url], timeoutMs: 1_000 }) });
  try {
    let res = await target.handle(new Request('http://t/v1/exchange', { method: 'POST', body: JSON.stringify({ v: 1, respBytes: 4096, ops: [], pad: '' }) }));
    assert.equal(res.status, 400);
    assert.equal((await res.arrayBuffer()).byteLength, 4_096, 'errors are padded too');
    res = await target.handle(new Request('http://t/v1/exchange', { method: 'POST', body: new Uint8Array(81_921) }));
    assert.equal(res.status, 413);
    const big = wrapLike(randomPubkey(), { contentBytes: 65_536 });
    res = await target.handle(new Request('http://t/v1/exchange', { method: 'POST', body: padJson({ v: 1, respBytes: 65_536, ops: [{ op: 'publish', event: big }] }, 81_920) }));
    assert.equal(res.status, 400);
    assert.equal((await res.arrayBuffer()).byteLength, 65_536, 'padded to the size the client asked for');
    assert.equal((await target.handle(new Request('http://t/other', { method: 'POST' }))).status, 404);
    assert.equal((await target.handle(new Request('http://t/v1/exchange', { method: 'GET' }))).status, 405);
    assert.equal((await target.handle(new Request('http://t/health'))).status, 200);
    assert.equal(relay.received.length, 0);
  } finally {
    target.close();
    await relay.close();
  }
});

test('kinds and signatures: only allowed kinds, only valid signatures are forwarded', async () => {
  const relay = await startFakeRelay();
  const target = createTarget({ upstream: new WsUpstream({ relays: [relay.url], timeoutMs: 1_000 }) });
  try {
    const p = randomPubkey();
    const note = wrapLike(p, { kind: 1 });
    const forged = { ...wrapLike(p), content: 'changed after signing' };
    const { body } = await call(target, [
      { op: 'publish', event: note },
      { op: 'publish', event: forged },
      { op: 'query', filter: { '#p': [p], kinds: [1] } },
    ]);
    assert.match((body.results[0] as { message: string }).message, /^blocked/);
    assert.match((body.results[1] as { message: string }).message, /^invalid/);
    assert.match((body.results[2] as { message: string }).message, /^blocked/);
    assert.equal(relay.received.length, 0);
  } finally {
    target.close();
    await relay.close();
  }
});

test('rate limits are keyed on recipient / filter and globally, never on the peer address', async () => {
  const relay = await startFakeRelay();
  let t = 0;
  const target = createTarget({
    upstream: new WsUpstream({ relays: [relay.url], timeoutMs: 1_000 }),
    limits: { global: { rate: 1, burst: 5 }, perRecipient: { rate: 0.1, burst: 2 }, perQuery: { rate: 0.1, burst: 1 }, now: () => t },
  });
  try {
    const victim = randomPubkey();
    const other = randomPubkey();
    const r = async (ops: Op[]) => (await call(target, ops)).body;
    // Two publishes to the victim pass, the third is refused; another recipient is unaffected.
    assert.ok((await r([{ op: 'publish', event: wrapLike(victim) }])).results[0].ok);
    assert.ok((await r([{ op: 'publish', event: wrapLike(victim) }])).results[0].ok);
    const third = (await r([{ op: 'publish', event: wrapLike(victim) }, { op: 'publish', event: wrapLike(other) }])).results;
    assert.match((third[0] as { message: string }).message, /^rate-limited/);
    assert.equal(third[1].ok, true);
    // Same #p set twice: second refused. A different set passes.
    assert.ok((await r([{ op: 'query', filter: { '#p': [victim] } }])).results[0].ok);
    assert.match(((await r([{ op: 'query', filter: { '#p': [victim] } }])).results[0] as { message: string }).message, /^rate-limited/);
    // Global: the 5 requests so far used the burst.
    const g = await call(target, []);
    assert.equal(g.status, 429);
    assert.equal(g.body.status, 'rate-limited');
    // Time refills.
    t += 20_000;
    assert.ok((await r([{ op: 'publish', event: wrapLike(victim) }])).results[0].ok);
  } finally {
    target.close();
    await relay.close();
  }
});

test('token buckets refill, evict idle entries and stay bounded', () => {
  let now = 0;
  const b = new TokenBuckets({ rate: 1, burst: 2 }, { now: () => now, maxEntries: 3 });
  assert.ok(b.take('a'));
  assert.ok(b.take('a'));
  assert.ok(!b.take('a'));
  now += 1_000;
  assert.ok(b.take('a'));
  for (const k of ['b', 'c', 'd', 'e']) b.take(k);
  assert.ok(b.size <= 3);
});

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as { port: number }).port;
      srv.close(() => resolve(port));
    });
  });
}

test('the target process (bin/target.ts) logs one startup line and nothing about requests', async () => {
  const relay = await startFakeRelay();
  const port = await freePort();
  const child = spawn(process.execPath, ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', 'bin/target.ts'], {
    env: { PATH: process.env.PATH, NOSTR_RELAYS: `${relay.url},ws://127.0.0.1:9`, PORT: String(port), HOST: '127.0.0.1', UPSTREAM_TIMEOUT_MS: '300' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', (d) => (out += d));
  try {
    await waitFor(() => out.includes('listening'), 10_000);
    const p = randomPubkey();
    const ev = wrapLike(p);
    const post = (body: string | Uint8Array) => fetch(`http://127.0.0.1:${port}/v1/exchange`, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
    const ok = await post(encodeRequest({ v: 1, respBytes: 4_096, ops: [{ op: 'publish', event: ev }, { op: 'query', filter: { '#p': [p] } }] }, 4_096));
    assert.equal(ok.status, 200);
    const r = decodeResponse(new Uint8Array(await ok.arrayBuffer()), 4_096);
    assert.equal(r.results[0].ok, true);
    assert.equal((await post('garbage')).status, 400);
    assert.equal((await post(new Uint8Array(200_000))).status, 413);
    assert.equal((await fetch(`http://127.0.0.1:${port}/nope`)).status, 404);
  } finally {
    child.kill('SIGTERM');
    await new Promise((r) => child.once('exit', r));
    await relay.close();
  }
  const lines = out.trim().split('\n');
  assert.equal(lines.length, 1, out);
  assert.match(lines[0], /^target: listening on :\d+, 2 upstream relay\(s\), kinds 1059$/);
});
