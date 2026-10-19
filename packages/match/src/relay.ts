// A small in-memory Nostr relay for tests and simulations. It never touches the
// network. It behaves like a typical public relay where that matters here:
// - rejects events that don't verify, or whose JSON exceeds 64 KiB
// - honours NIP-40 `expiration` (rejects expired events, hides them from queries)
// - answers filters on `kinds`, `#p`, `since`, `until`
// It also keeps a log of everything it accepted, so tests can check what a relay
// operator would see (A6 in THREAT_MODEL).

import { verifyEvent } from 'nostr-tools/pure';
import type { SignedEvent } from './keys.ts';
import { MAX_EVENT_BYTES, eventBytes } from './wrap.ts';

export interface RelayFilter {
  kinds?: number[];
  '#p'?: string[];
  since?: number;
  until?: number;
}

export interface RelayLike {
  publish(event: SignedEvent): Promise<{ ok: boolean; message: string }>;
  query(filter: RelayFilter): Promise<SignedEvent[]>;
}

function expiration(e: SignedEvent): number | undefined {
  const t = e.tags.find((x) => x[0] === 'expiration');
  const n = t ? Number(t[1]) : NaN;
  return Number.isInteger(n) ? n : undefined;
}

function matches(e: SignedEvent, f: RelayFilter): boolean {
  if (f.kinds && !f.kinds.includes(e.kind)) return false;
  if (f['#p'] && !e.tags.some((t) => t[0] === 'p' && f['#p']!.includes(t[1]))) return false;
  if (f.since !== undefined && e.created_at < f.since) return false;
  if (f.until !== undefined && e.created_at > f.until) return false;
  return true;
}

export class InMemoryRelay implements RelayLike {
  readonly maxEventBytes: number;
  private readonly clock: () => Date;
  private readonly events = new Map<string, SignedEvent>();
  /** Every accepted event, in arrival order: what the relay operator sees. */
  readonly log: SignedEvent[] = [];

  constructor(opts: { now?: () => Date; maxEventBytes?: number } = {}) {
    this.clock = opts.now ?? (() => new Date());
    this.maxEventBytes = opts.maxEventBytes ?? MAX_EVENT_BYTES;
  }

  private nowSec(): number {
    return Math.floor(this.clock().getTime() / 1000);
  }

  async publish(event: SignedEvent): Promise<{ ok: boolean; message: string }> {
    const size = eventBytes(event);
    if (size > this.maxEventBytes) return { ok: false, message: `invalid: event too large (${size} bytes)` };
    if (!verifyEvent({ ...event, tags: event.tags.map((t) => [...t]) })) return { ok: false, message: 'invalid: bad signature' };
    const exp = expiration(event);
    if (exp !== undefined && exp <= this.nowSec()) return { ok: false, message: 'invalid: event has expired' };
    if (this.events.has(event.id)) return { ok: true, message: 'duplicate: already have this event' };
    this.events.set(event.id, event);
    this.log.push(event);
    return { ok: true, message: '' };
  }

  async query(filter: RelayFilter): Promise<SignedEvent[]> {
    const now = this.nowSec();
    return [...this.events.values()]
      .filter((e) => {
        const exp = expiration(e);
        return exp === undefined || exp > now;
      })
      .filter((e) => matches(e, filter))
      .sort((a, b) => a.created_at - b.created_at || (a.id < b.id ? -1 : 1));
  }

  /** Re-insert a stored event as if a malicious relay replayed it. */
  async replay(event: SignedEvent): Promise<void> {
    this.events.set(event.id, event);
  }
}
