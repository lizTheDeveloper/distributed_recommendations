// The target's side towards Nostr: a fixed, operator-configured relay set, reached
// over WebSockets. Clients can never name a relay URL (that would turn the gateway
// into an open proxy and an SSRF tool); they get the configured set.
//
// Connections are shared by all clients and kept open while in use, so the
// upstream relays see one long-lived client (the gateway) rather than one per user.

import type { NostrEvent, QueryFilter, RelayOk } from './protocol.ts';
import { matchesFilter, newestFirst } from './protocol.ts';
import type { SocketFactory } from './nip01.ts';
import { RelayConnection } from './nip01.ts';

export interface Upstream {
  readonly relays: readonly string[];
  publish(event: NostrEvent): Promise<RelayOk[]>;
  /** Newest first, de-duplicated, at most `filter.limit`; `more` when any relay may hold more. */
  query(filter: QueryFilter): Promise<{ events: NostrEvent[]; more: boolean; ok: boolean; message?: string }>;
  close(): void;
}

export interface WsUpstreamOptions {
  relays: readonly string[];
  socket?: SocketFactory;
  /** Per relay operation. Default 5 s. */
  timeoutMs?: number;
  /** Default per-query limit when the client sets none. Default 100. */
  defaultLimit?: number;
  /** After a failed connect, don't retry that relay for this long. Default 5 s. */
  retryAfterMs?: number;
  now?: () => number;
}

export function checkRelayUrl(u: string): string {
  let url: URL;
  try {
    url = new URL(u);
  } catch {
    throw new Error(`not a URL: ${u}`);
  }
  if (url.protocol !== 'wss:' && url.protocol !== 'ws:') throw new Error(`relay URL must be ws:// or wss://: ${u}`);
  if (url.username || url.password) throw new Error('relay URL must not carry credentials');
  return url.toString().replace(/\/$/, '');
}

export class WsUpstream implements Upstream {
  readonly relays: readonly string[];
  private readonly conns: RelayConnection[];
  private readonly downUntil = new Map<string, number>();
  private readonly defaultLimit: number;
  private readonly retryAfterMs: number;
  private readonly clock: () => number;

  constructor(opts: WsUpstreamOptions) {
    if (opts.relays.length === 0) throw new Error('configure at least one upstream relay');
    this.relays = [...new Set(opts.relays.map(checkRelayUrl))];
    this.conns = this.relays.map((u) => new RelayConnection(u, { socket: opts.socket, timeoutMs: opts.timeoutMs ?? 5_000 }));
    this.defaultLimit = opts.defaultLimit ?? 100;
    this.retryAfterMs = opts.retryAfterMs ?? 5_000;
    this.clock = opts.now ?? (() => Date.now());
  }

  private usable(c: RelayConnection): boolean {
    return (this.downUntil.get(c.url) ?? 0) <= this.clock();
  }

  private markDown(c: RelayConnection): void {
    this.downUntil.set(c.url, this.clock() + this.retryAfterMs);
  }

  async publish(event: NostrEvent): Promise<RelayOk[]> {
    return Promise.all(
      this.conns.map(async (c) => {
        if (!this.usable(c)) return { relay: c.url, ok: false, message: 'error: relay unavailable' };
        const r = await c.publish(event);
        if (!r.ok && r.message.startsWith('error: ') && !c.isOpen) this.markDown(c);
        return { relay: c.url, ok: r.ok, message: r.message };
      }),
    );
  }

  async query(filter: QueryFilter): Promise<{ events: NostrEvent[]; more: boolean; ok: boolean; message?: string }> {
    const limit = filter.limit ?? this.defaultLimit;
    const f: QueryFilter = { ...filter, limit };
    const lists = await Promise.all(
      this.conns.map(async (c) => {
        if (!this.usable(c)) return null;
        try {
          return await c.query(f);
        } catch {
          this.markDown(c);
          return null;
        }
      }),
    );
    const answered = lists.filter((l) => l !== null);
    if (answered.length === 0) return { events: [], more: false, ok: false, message: 'error: no relay answered' };
    const byId = new Map<string, NostrEvent>();
    let more = false;
    for (const l of answered) {
      // A relay that hit the limit, timed out or closed early may hold more.
      if (l.events.length >= limit || !l.complete) more = true;
      for (const e of l.events) if (matchesFilter(e, f) && !byId.has(e.id)) byId.set(e.id, e);
    }
    const events = [...byId.values()].sort(newestFirst);
    if (events.length > limit) {
      more = true;
      events.length = limit;
    }
    return { events, more, ok: true };
  }

  close(): void {
    for (const c of this.conns) c.close();
  }
}
