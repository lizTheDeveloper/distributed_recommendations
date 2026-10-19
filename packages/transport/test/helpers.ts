// Test fixtures: an in-process NIP-01 relay over real WebSockets (backed by
// packages/match's InMemoryRelay), and the whole OHTTP path in one process:
// client → relayFetch (stand-in OHTTP relay) → in-process gateway → target →
// WsUpstream → WebSocket relay. Nothing here touches a public network.

import { WebSocketServer, type WebSocket } from 'ws';
import type { AddressInfo } from 'node:net';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { InMemoryRelay } from '../../match/src/relay.ts';
import type { NostrEvent, QueryFilter } from '../src/protocol.ts';
import { matchesFilter, newestFirst } from '../src/protocol.ts';
import { createInProcessGateway, relayFetch } from '../src/ohttp.ts';
import type { Fetch, InProcessGateway } from '../src/ohttp.ts';
import { createTarget } from '../src/target.ts';
import type { Target, TargetOptions } from '../src/target.ts';
import { WsUpstream } from '../src/upstream.ts';

export interface FakeRelay {
  url: string;
  store: InMemoryRelay;
  /** Every client message the relay received, parsed. */
  received: unknown[][];
  connections: number;
  /** Drop every open connection (simulates a relay restart). */
  dropAll(): void;
  close(): Promise<void>;
}

/** A NIP-01 relay on 127.0.0.1 with live subscriptions. `limit` is honoured newest-first. */
export async function startFakeRelay(opts: { now?: () => Date } = {}): Promise<FakeRelay> {
  const store = new InMemoryRelay({ now: opts.now });
  const wss = new WebSocketServer({ host: '127.0.0.1', port: 0, maxPayload: 256 * 1024 });
  const received: unknown[][] = [];
  const subs = new Map<WebSocket, Map<string, QueryFilter>>();
  const relay: FakeRelay = {
    url: '',
    store,
    received,
    connections: 0,
    dropAll() {
      for (const ws of wss.clients) ws.terminate();
    },
    close: () =>
      new Promise((resolve) => {
        for (const ws of wss.clients) ws.terminate();
        wss.close(() => resolve());
      }),
  };
  wss.on('connection', (ws) => {
    relay.connections++;
    subs.set(ws, new Map());
    ws.on('close', () => subs.delete(ws));
    ws.on('message', async (data) => {
      let msg: unknown;
      try {
        msg = JSON.parse(String(data));
      } catch {
        return;
      }
      if (!Array.isArray(msg)) return;
      received.push(msg);
      if (msg[0] === 'EVENT') {
        const ev = msg[1] as NostrEvent;
        const r = await store.publish(ev);
        ws.send(JSON.stringify(['OK', ev.id, r.ok, r.message]));
        if (r.ok && !r.message.startsWith('duplicate')) {
          for (const [client, m] of subs) {
            for (const [id, f] of m) if (matchesFilter(ev, f)) client.send(JSON.stringify(['EVENT', id, ev]));
          }
        }
      } else if (msg[0] === 'REQ') {
        const [, id, f] = msg as [string, string, QueryFilter];
        let evs = (await store.query(f)).filter((e) => matchesFilter(e as NostrEvent, f)) as NostrEvent[];
        evs = evs.sort(newestFirst);
        if (f.limit !== undefined) evs = evs.slice(0, f.limit);
        for (const e of evs) ws.send(JSON.stringify(['EVENT', id, e]));
        ws.send(JSON.stringify(['EOSE', id]));
        subs.get(ws)?.set(id, f);
      } else if (msg[0] === 'CLOSE') {
        subs.get(ws)?.delete(msg[1] as string);
      }
    });
  });
  await new Promise<void>((r) => wss.once('listening', () => r()));
  relay.url = `ws://127.0.0.1:${(wss.address() as AddressInfo).port}`;
  return relay;
}

export const TARGET_AUTHORITY = 'nostr-target.internal';

export interface Stack {
  relays: FakeRelay[];
  target: Target;
  gateway: InProcessGateway;
  /** fetch for clients: goes through the stand-in OHTTP relay. */
  fetch: Fetch;
  /** What the OHTTP relay forwarded (path and ciphertext size). */
  forwarded: { path: string; bytes: number }[];
  relayUrl: string;
  close(): Promise<void>;
}

export async function startStack(opts: { relays?: number; target?: Partial<TargetOptions>; now?: () => Date; seed?: Uint8Array } = {}): Promise<Stack> {
  const relays = await Promise.all(Array.from({ length: opts.relays ?? 1 }, () => startFakeRelay({ now: opts.now })));
  const upstream = new WsUpstream({ relays: relays.map((r) => r.url), timeoutMs: 2_000 });
  const target = createTarget({ upstream, ...opts.target });
  const gateway = await createInProcessGateway({ target: (r) => target.handle(r), allowedAuthority: TARGET_AUTHORITY, seed: opts.seed });
  const forwarded: { path: string; bytes: number }[] = [];
  const fetch = relayFetch((r) => gateway.handle(r), { onForward: (i) => forwarded.push(i) });
  return {
    relays,
    target,
    gateway,
    fetch,
    forwarded,
    relayUrl: 'https://ohttp-relay.test/gateway',
    async close() {
      target.close();
      await Promise.all(relays.map((r) => r.close()));
    },
  };
}

/** A signed kind-1059-shaped event to `p` (not a real gift wrap: tests of transport only). */
export function wrapLike(p: string, opts: { createdAt?: number; contentBytes?: number; kind?: number; secret?: Uint8Array } = {}): NostrEvent {
  const sk = opts.secret ?? generateSecretKey();
  const ev = finalizeEvent(
    {
      kind: opts.kind ?? 1059,
      created_at: opts.createdAt ?? Math.floor(Date.now() / 1000),
      tags: [
        ['p', p],
        ['expiration', String(Math.floor(Date.now() / 1000) + 14 * 86_400)],
      ],
      content: 'x'.repeat(opts.contentBytes ?? 100),
    },
    sk,
  );
  return { id: ev.id, pubkey: ev.pubkey, created_at: ev.created_at, kind: ev.kind, tags: ev.tags, content: ev.content, sig: ev.sig };
}

export function randomPubkey(): string {
  return getPublicKey(generateSecretKey());
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Poll `cond` until true or `ms` elapse. */
export async function waitFor(cond: () => boolean, ms = 3_000): Promise<void> {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('timed out waiting');
    await sleep(10);
  }
}
