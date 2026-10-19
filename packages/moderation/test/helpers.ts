// Offline test doubles: deterministic keys, event signing, a fake fetch and a
// fake WebSocket relay. Nothing here touches the network.

import { finalizeEvent, getPublicKey } from 'nostr-tools/pure';
import type { EventTemplate, FetchLike, FetchResponseLike, NostrEvent, NostrFilter } from '../src/types.ts';
import type { Video } from '../src/core.ts';

export const hexKey = (n: number) => n.toString(16).padStart(64, '0');
export const skBytes = (hex: string) => Uint8Array.from(hex.match(/../g)!.map((h) => parseInt(h, 16)));

export interface Keypair {
  sk: Uint8Array;
  pk: string;
}
export function keypair(n: number): Keypair {
  const sk = skBytes(hexKey(n));
  return { sk, pk: getPublicKey(sk) };
}

export function sign(t: EventTemplate, k: Keypair): NostrEvent {
  return finalizeEvent({ ...t, tags: t.tags.map((x) => [...x]) }, k.sk) as NostrEvent;
}

export function video(id: string, over: Partial<Video> = {}): Video {
  return {
    id,
    title: over.title ?? `Video ${id.slice(-4)}`,
    creator: over.creator ?? 'alice_channel@tube.example',
    durationSec: 300,
    publishedAt: over.publishedAt ?? new Date('2026-10-15T00:00:00Z'),
    tags: over.tags ?? [],
    ...over,
  };
}

export const NOW = new Date('2026-10-19T00:00:00Z');

// ---------------------------------------------------------------- fetch

export interface Call {
  url: string;
  init?: RequestInit;
}

export function res(status: number, body: unknown): FetchResponseLike {
  return { ok: status >= 200 && status < 300, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) };
}

/** A fake fetch answering by URL prefix: `routes[pathAndQueryPrefix] = (url, init) => response`. */
export function fakeFetch(handler: (url: string, init?: RequestInit) => FetchResponseLike): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    fetch: async (url, init) => {
      calls.push({ url, init });
      return handler(url, init);
    },
  };
}

// ---------------------------------------------------------------- relay

function matches(e: NostrEvent, f: NostrFilter): boolean {
  if (f.ids && !f.ids.includes(e.id)) return false;
  if (f.kinds && !f.kinds.includes(e.kind)) return false;
  if (f.authors && !f.authors.includes(e.pubkey)) return false;
  if (f.since !== undefined && e.created_at < f.since) return false;
  return true;
}

/** In-memory relays keyed by URL, reached through `FakeWebSocket`. */
export class FakeRelays {
  events = new Map<string, NostrEvent[]>();
  received: { url: string; msg: unknown[] }[] = [];
  /** URLs that fail to connect. */
  down = new Set<string>();
  /** URLs that never send EOSE. */
  silent = new Set<string>();

  add(url: string, ...events: NostrEvent[]) {
    this.events.set(url, [...(this.events.get(url) ?? []), ...events]);
  }

  ctor(): new (url: string) => WebSocket {
    const relays = this;
    class FakeWebSocket extends EventTarget {
      readonly url: string;
      constructor(url: string) {
        super();
        this.url = url;
        queueMicrotask(() => {
          if (relays.down.has(url)) {
            this.dispatchEvent(new Event('error'));
            return;
          }
          this.dispatchEvent(new Event('open'));
        });
      }
      send(data: string) {
        const msg = JSON.parse(data) as unknown[];
        relays.received.push({ url: this.url, msg });
        if (msg[0] !== 'REQ') return;
        const [, sub, filter] = msg as [string, string, NostrFilter];
        const out = (relays.events.get(this.url) ?? []).filter((e) => matches(e, filter));
        queueMicrotask(() => {
          for (const e of out) this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(['EVENT', sub, e]) }));
          if (!relays.silent.has(this.url)) this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(['EOSE', sub]) }));
        });
      }
      close() {}
    }
    return FakeWebSocket as unknown as new (url: string) => WebSocket;
  }
}
