// An in-memory Nostr relay pool implementing marmot-ts's `NostrNetworkInterface`,
// for tests and simulations. It never touches the network (never point tests at
// public relays). Like packages/match's InMemoryRelay it:
// - rejects events that don't verify (checked on a fresh copy, T25) or whose JSON
//   exceeds 64 KiB;
// - honours NIP-40 `expiration`;
// - keeps a log of everything it accepted: what a relay operator sees (A6).

import { matchFilter } from 'nostr-tools/filter';
import { verifyEvent } from 'nostr-tools/pure';
import type { Filter } from 'nostr-tools/filter';

/** Many relays default to a 64 KiB event limit. */
export const MAX_EVENT_BYTES = 65_536;

export interface NostrEventLike {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

export interface PublishResponse {
  from: string;
  ok: boolean;
  message?: string;
}

interface Sub {
  filters: Filter[];
  next: (e: NostrEventLike) => void;
}

function fresh(e: NostrEventLike): NostrEventLike {
  return {
    id: e.id,
    pubkey: e.pubkey,
    created_at: e.created_at,
    kind: e.kind,
    tags: e.tags.map((t) => [...t]),
    content: e.content,
    sig: e.sig,
  };
}

function expiration(e: NostrEventLike): number | undefined {
  const t = e.tags.find((x) => x[0] === 'expiration');
  const n = t ? Number(t[1]) : NaN;
  return Number.isInteger(n) ? n : undefined;
}

export class InMemoryNostrNetwork {
  private readonly events = new Map<string, NostrEventLike>();
  private subs: Sub[] = [];
  private readonly clock: () => Date;
  /** Every accepted event, in arrival order. */
  readonly log: NostrEventLike[] = [];
  /**
   * Relay URLs this network pretends to be. marmot-ts insists on ws(s) URLs, so we
   * use the reserved `.invalid` TLD (RFC 2606), which can never resolve.
   */
  readonly relays = ['wss://circles-test.invalid'];

  constructor(opts: { now?: () => Date } = {}) {
    this.clock = opts.now ?? (() => new Date());
  }

  private nowSec(): number {
    return Math.floor(this.clock().getTime() / 1000);
  }

  private accept(event: NostrEventLike): { ok: boolean; message: string } {
    const size = new TextEncoder().encode(JSON.stringify(event)).length;
    if (size > MAX_EVENT_BYTES) return { ok: false, message: `invalid: event too large (${size} bytes)` };
    if (!verifyEvent(fresh(event))) return { ok: false, message: 'invalid: bad signature' };
    const exp = expiration(event);
    if (exp !== undefined && exp <= this.nowSec()) return { ok: false, message: 'invalid: event has expired' };
    if (this.events.has(event.id)) return { ok: true, message: 'duplicate' };
    const copy = fresh(event);
    this.events.set(copy.id, copy);
    this.log.push(copy);
    for (const s of this.subs) if (s.filters.some((f) => matchFilter(f, copy as never))) s.next(copy);
    return { ok: true, message: '' };
  }

  async publish(relays: string[], event: NostrEventLike): Promise<Record<string, PublishResponse>> {
    for (const r of relays) if (!this.relays.includes(r)) throw new Error(`refusing to publish outside the in-memory network: ${r}`);
    const res = this.accept(event);
    return Object.fromEntries(relays.map((r) => [r, { from: r, ok: res.ok, message: res.message }]));
  }

  async request(_relays: string[], filters: Filter | Filter[]): Promise<NostrEventLike[]> {
    const fs = Array.isArray(filters) ? filters : [filters];
    const now = this.nowSec();
    return [...this.events.values()]
      .filter((e) => {
        const exp = expiration(e);
        return exp === undefined || exp > now;
      })
      .filter((e) => fs.some((f) => matchFilter(f, e as never)))
      .sort((a, b) => a.created_at - b.created_at || (a.id < b.id ? -1 : 1))
      .map(fresh);
  }

  subscription(_relays: string[], filters: Filter | Filter[]) {
    const fs = Array.isArray(filters) ? filters : [filters];
    return {
      subscribe: (observer: { next?: (e: NostrEventLike) => void }) => {
        const sub: Sub = { filters: fs, next: (e) => observer.next?.(fresh(e)) };
        this.subs.push(sub);
        return {
          unsubscribe: () => {
            this.subs = this.subs.filter((s) => s !== sub);
          },
        };
      },
    };
  }

  async getUserInboxRelays(_pubkey: string): Promise<string[]> {
    return [...this.relays];
  }
}
