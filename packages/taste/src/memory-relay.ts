// An in-memory NIP-01 relay: tests, the offline artifact build, and the studio's
// "preview as a viewer" without touching the network. Verifies every event it
// accepts (inject `verifySignedEvent`), keeps the newest version of addressable
// events, and honours NIP-09 deletion requests (`e` and `a` refs, same author).

import type { SignedEvent } from '../../bridge/src/types.ts';
import type { PublishResult } from '../../bridge/src/relay.ts';

export type Filter = Record<string, unknown>;

const dTag = (e: SignedEvent) => e.tags.find((t) => t[0] === 'd')?.[1] ?? '';
const isAddressable = (k: number) => k >= 30000 && k < 40000;
const isReplaceable = (k: number) => k === 0 || k === 3 || (k >= 10000 && k < 20000);

export function matchesFilter(e: SignedEvent, f: Filter): boolean {
  if (Array.isArray(f.ids) && !f.ids.includes(e.id)) return false;
  if (Array.isArray(f.kinds) && !f.kinds.includes(e.kind)) return false;
  if (Array.isArray(f.authors) && !f.authors.includes(e.pubkey)) return false;
  if (typeof f.since === 'number' && e.created_at < f.since) return false;
  if (typeof f.until === 'number' && e.created_at > f.until) return false;
  for (const [k, v] of Object.entries(f)) {
    if (!/^#[a-zA-Z]$/.test(k) || !Array.isArray(v)) continue;
    if (!e.tags.some((t) => t[0] === k.slice(1) && v.includes(t[1]))) return false;
  }
  return true;
}

export class MemoryRelay {
  readonly url: string;
  private events: SignedEvent[] = [];
  private readonly verify: (e: SignedEvent) => boolean | Promise<boolean>;

  constructor(verify: (e: SignedEvent) => boolean | Promise<boolean>, url = 'memory://relay') {
    this.verify = verify;
    this.url = url;
  }

  get size(): number {
    return this.events.length;
  }

  async publish(e: SignedEvent): Promise<PublishResult> {
    const copy: SignedEvent = JSON.parse(JSON.stringify(e));
    if (!(await this.verify(copy))) return { relay: this.url, ok: false, message: 'invalid: bad signature' };
    if (this.events.some((x) => x.id === copy.id)) return { relay: this.url, ok: true, message: 'duplicate: already have it' };
    if (copy.kind === 5) {
      for (const t of copy.tags) {
        if (t[0] === 'e') this.events = this.events.filter((x) => !(x.id === t[1] && x.pubkey === copy.pubkey));
        if (t[0] === 'a') {
          const [k, pk, ...rest] = (t[1] ?? '').split(':');
          if (pk !== copy.pubkey) continue;
          const d = rest.join(':');
          this.events = this.events.filter((x) => !(String(x.kind) === k && x.pubkey === pk && dTag(x) === d && x.created_at <= copy.created_at));
        }
      }
    } else if (isAddressable(copy.kind) || isReplaceable(copy.kind)) {
      const same = (x: SignedEvent) => x.kind === copy.kind && x.pubkey === copy.pubkey && (!isAddressable(copy.kind) || dTag(x) === dTag(copy));
      const deleted = this.events.some(
        (x) => x.kind === 5 && x.pubkey === copy.pubkey && x.created_at >= copy.created_at && x.tags.some((t) => t[0] === 'a' && t[1] === `${copy.kind}:${copy.pubkey}:${dTag(copy)}`),
      );
      if (deleted) return { relay: this.url, ok: false, message: 'blocked: deleted' };
      const older = this.events.find(same);
      if (older && (older.created_at > copy.created_at || (older.created_at === copy.created_at && older.id < copy.id))) {
        return { relay: this.url, ok: false, message: 'duplicate: have a newer version' };
      }
      this.events = this.events.filter((x) => !same(x));
    }
    this.events.push(copy);
    return { relay: this.url, ok: true, message: '' };
  }

  /** Matching events, newest first, honouring `limit`. Copies, so callers can't mutate the store. */
  async query(filter: Filter): Promise<SignedEvent[]> {
    const out = this.events.filter((e) => matchesFilter(e, filter)).sort((a, b) => b.created_at - a.created_at);
    const limited = typeof filter.limit === 'number' ? out.slice(0, filter.limit) : out;
    return JSON.parse(JSON.stringify(limited));
  }
}
