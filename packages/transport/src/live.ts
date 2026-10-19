// `LiveRelay`: direct WebSocket connections to Nostr relays with live
// subscriptions, for users who opt out of Oblivious HTTP.
//
// Tradeoff (docs/TRANSPORT.md): events arrive within a second instead of on the
// next poll, and there's no gateway to trust, but **every relay sees your IP
// address**, linked to the `#p` keys you subscribe to and the events you publish.
// Use it only when the user chose it, or behind Tor or a VPN they trust.
//
// - Implements packages/match's `RelayLike` (publish to all, query merges).
// - `subscribe()` keeps a REQ open on every relay. When a connection drops it
//   reconnects with exponential backoff and full jitter (1 s doubling to 60 s),
//   re-sends the REQ, and de-duplicates events it already delivered.
// - No NIP-42 AUTH: authenticating tells the relay which key you are. The web
//   app's adapter (apps/web/src/lib/match/wsRelay.ts) already does AUTH on demand
//   for publish/query; see docs/TRANSPORT.md "Hooks for the web app".

import type { NostrEvent, QueryFilter } from './protocol.ts';
import { MAX_EVENT_BYTES, eventBytes, matchesFilter } from './protocol.ts';
import type { SocketFactory } from './nip01.ts';
import { RelayConnection } from './nip01.ts';
import { checkRelayUrl } from './upstream.ts';

export interface LiveRelayOptions {
  urls: readonly string[];
  socket?: SocketFactory;
  /** Per operation. Default 8 s. */
  timeoutMs?: number;
  /** Backoff base and cap. Default 1,000 and 60,000 ms. */
  backoffMs?: { base: number; max: number };
  random?: () => number;
  onStatus?: (s: { url: string; state: 'open' | 'reconnecting' | 'closed'; attempt: number }) => void;
}

interface LiveSub {
  filter: QueryFilter;
  onEvent: (e: NostrEvent) => void;
  seen: Set<string>;
  stops: Map<string, () => void>;
}

class LiveConn {
  readonly conn: RelayConnection;
  attempt = 0;
  timer: ReturnType<typeof setTimeout> | null = null;
  constructor(url: string, opts: LiveRelayOptions) {
    this.conn = new RelayConnection(url, { socket: opts.socket, timeoutMs: opts.timeoutMs ?? 8_000 });
  }
}

/** Full-jitter exponential backoff: uniform in [0, min(max, base·2^attempt)]. */
export function backoffDelay(attempt: number, base: number, max: number, random: () => number): number {
  return random() * Math.min(max, base * 2 ** attempt);
}

export class LiveRelay {
  private readonly conns: LiveConn[];
  private readonly subs = new Set<LiveSub>();
  private readonly opts: LiveRelayOptions;
  private readonly random: () => number;
  private closed = false;

  constructor(opts: LiveRelayOptions) {
    this.opts = opts;
    this.random = opts.random ?? (() => crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32);
    this.conns = [...new Set(opts.urls.map(checkRelayUrl))].map((u) => {
      const c = new LiveConn(u, opts);
      c.conn.onDisconnect = () => this.reconnectLater(c);
      return c;
    });
  }

  get urls(): string[] {
    return this.conns.map((c) => c.conn.url);
  }

  async publish(event: NostrEvent): Promise<{ ok: boolean; message: string }> {
    if (this.conns.length === 0) return { ok: false, message: 'no relays configured' };
    if (eventBytes(event) > MAX_EVENT_BYTES) return { ok: false, message: 'invalid: event too large' };
    const rs = await Promise.all(this.conns.map((c) => c.conn.publish(event)));
    if (rs.some((r) => r.ok)) return { ok: true, message: '' };
    return { ok: false, message: rs.map((r, i) => `${this.conns[i].conn.url}: ${r.message}`).join('; ') };
  }

  async query(filter: QueryFilter): Promise<NostrEvent[]> {
    const lists = await Promise.all(this.conns.map((c) => c.conn.query(filter).catch(() => null)));
    if (this.conns.length && lists.every((l) => l === null)) throw new Error('no relay answered');
    const byId = new Map<string, NostrEvent>();
    for (const l of lists) for (const e of l?.events ?? []) if (matchesFilter(e, filter) && !byId.has(e.id)) byId.set(e.id, e);
    return [...byId.values()].sort((a, b) => a.created_at - b.created_at || (a.id < b.id ? -1 : 1));
  }

  /** Keep a subscription open on every relay; returns a stop function. */
  subscribe(filter: QueryFilter, onEvent: (e: NostrEvent) => void): () => void {
    const sub: LiveSub = { filter, onEvent, seen: new Set(), stops: new Map() };
    this.subs.add(sub);
    for (const c of this.conns) void this.attach(c, sub);
    return () => {
      this.subs.delete(sub);
      for (const stop of sub.stops.values()) stop();
      sub.stops.clear();
    };
  }

  private async attach(c: LiveConn, sub: LiveSub): Promise<void> {
    if (this.closed || !this.subs.has(sub) || sub.stops.has(c.conn.url)) return;
    try {
      await c.conn.open();
    } catch {
      this.reconnectLater(c);
      return;
    }
    if (!this.subs.has(sub) || sub.stops.has(c.conn.url)) return;
    c.attempt = 0;
    this.opts.onStatus?.({ url: c.conn.url, state: 'open', attempt: 0 });
    const stop = c.conn.subscribe(sub.filter, {
      onEvent: (e) => {
        if (sub.seen.has(e.id) || !matchesFilter(e, sub.filter)) return;
        sub.seen.add(e.id);
        sub.onEvent(e);
      },
      onClosed: () => {
        sub.stops.delete(c.conn.url);
        // A relay-side CLOSED on a live connection: retry this sub with backoff.
        if (c.conn.isOpen) this.reconnectLater(c);
      },
    });
    sub.stops.set(c.conn.url, stop);
  }

  private reconnectLater(c: LiveConn): void {
    if (this.closed || c.timer || this.subs.size === 0) return;
    for (const s of this.subs) s.stops.delete(c.conn.url);
    const { base, max } = this.opts.backoffMs ?? { base: 1_000, max: 60_000 };
    const delay = backoffDelay(c.attempt, base, max, this.random);
    c.attempt++;
    this.opts.onStatus?.({ url: c.conn.url, state: 'reconnecting', attempt: c.attempt });
    c.timer = setTimeout(() => {
      c.timer = null;
      for (const s of this.subs) void this.attach(c, s);
    }, delay);
  }

  close(): void {
    this.closed = true;
    for (const s of this.subs) for (const stop of s.stops.values()) stop();
    this.subs.clear();
    for (const c of this.conns) {
      if (c.timer) clearTimeout(c.timer);
      c.timer = null;
      c.conn.close();
      this.opts.onStatus?.({ url: c.conn.url, state: 'closed', attempt: c.attempt });
    }
  }
}
