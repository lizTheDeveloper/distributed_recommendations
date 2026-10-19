// Rate limits for the Nostr gateway target, keyed on anything but the client's IP.
//
// Behind Oblivious HTTP the target never sees a client IP: TCP connections come
// from the OHTTP gateway, and the gateway's come from the OHTTP relay. Keying on the
// peer address would put every user in one bucket. So:
//
// - a global bucket caps total load on the upstream Nostr relays;
// - a per-recipient bucket caps publishes to one `p` key (flooding an inbox),
//   keyed on an HMAC of the key with a per-process secret, so the table holds no
//   raw pubkeys and is useless after a restart;
// - a per-query bucket caps repeated queries for the same `#p` set (hammering);
// - the OHTTP relay, which does see client IPs, rate-limits per IP on its side;
//   that is its job and its knowledge, not ours (docs/TRANSPORT.md).
//
// Anonymous per-client limits need unlinkable tokens (Privacy Pass, RFC 9576–9578);
// see docs/TRANSPORT.md "Rate limiting". Buckets live in memory only, are evicted
// when idle, and the table is bounded.

import { createHmac, randomBytes } from 'node:crypto';

export interface BucketSpec {
  /** Tokens added per second. */
  rate: number;
  /** Bucket size. */
  burst: number;
}

export class TokenBuckets {
  private readonly spec: BucketSpec;
  private readonly clock: () => number;
  private readonly maxEntries: number;
  private readonly buckets = new Map<string, { tokens: number; at: number }>();

  constructor(spec: BucketSpec, opts: { now?: () => number; maxEntries?: number } = {}) {
    this.spec = spec;
    this.clock = opts.now ?? (() => Date.now());
    this.maxEntries = opts.maxEntries ?? 100_000;
  }

  /** Take `n` tokens from `key`'s bucket. False when it doesn't have them. */
  take(key: string, n = 1): boolean {
    const now = this.clock();
    let b = this.buckets.get(key);
    if (b) {
      b.tokens = Math.min(this.spec.burst, b.tokens + ((now - b.at) / 1000) * this.spec.rate);
      b.at = now;
      // Re-insert so Map order is least-recently-used first.
      this.buckets.delete(key);
    } else {
      b = { tokens: this.spec.burst, at: now };
    }
    this.buckets.set(key, b);
    if (this.buckets.size > this.maxEntries) this.evict(now);
    if (b.tokens < n) return false;
    b.tokens -= n;
    return true;
  }

  /** Check without taking. */
  peek(key: string, n = 1): boolean {
    const b = this.buckets.get(key);
    if (!b) return this.spec.burst >= n;
    const tokens = Math.min(this.spec.burst, b.tokens + ((this.clock() - b.at) / 1000) * this.spec.rate);
    return tokens >= n;
  }

  private evict(now: number): void {
    // Full buckets carry no state worth keeping; drop those first, then the oldest.
    const fullAfterMs = (this.spec.burst / this.spec.rate) * 1000;
    for (const [k, b] of this.buckets) {
      if (now - b.at >= fullAfterMs) this.buckets.delete(k);
      else break; // LRU order: the rest are newer
    }
    while (this.buckets.size > this.maxEntries) {
      const oldest = this.buckets.keys().next().value as string;
      this.buckets.delete(oldest);
    }
  }

  get size(): number {
    return this.buckets.size;
  }
}

export interface RateLimitConfig {
  /** Whole-target request rate. Default 50/s, burst 200. */
  global?: BucketSpec;
  /** Publishes per recipient key. Default 1 per 2 s, burst 60. */
  perRecipient?: BucketSpec;
  /** Queries per distinct `#p` set. Default 1/s, burst 30. */
  perQuery?: BucketSpec;
  now?: () => number;
}

export const DEFAULT_LIMITS = {
  global: { rate: 50, burst: 200 },
  perRecipient: { rate: 0.5, burst: 60 },
  perQuery: { rate: 1, burst: 30 },
} as const satisfies Record<string, BucketSpec>;

export class TargetRateLimiter {
  private readonly secret = randomBytes(32);
  private readonly global: TokenBuckets;
  private readonly recipient: TokenBuckets;
  private readonly query: TokenBuckets;

  constructor(cfg: RateLimitConfig = {}) {
    const o = { now: cfg.now };
    this.global = new TokenBuckets(cfg.global ?? DEFAULT_LIMITS.global, o);
    this.recipient = new TokenBuckets(cfg.perRecipient ?? DEFAULT_LIMITS.perRecipient, o);
    this.query = new TokenBuckets(cfg.perQuery ?? DEFAULT_LIMITS.perQuery, o);
  }

  private key(parts: readonly string[]): string {
    return createHmac('sha256', this.secret).update([...parts].sort().join(',')).digest('base64url').slice(0, 22);
  }

  /** One request through the target, whatever it carries. */
  admitRequest(): boolean {
    return this.global.take('*');
  }

  /** A publish addressed to these `p` keys (gift wraps carry exactly one). */
  admitPublish(recipients: readonly string[]): boolean {
    const keys = recipients.length ? recipients.map((p) => this.key([p])) : [this.key(['(none)'])];
    if (!keys.every((k) => this.recipient.peek(k))) return false;
    return keys.every((k) => this.recipient.take(k));
  }

  /** A query for this `#p` set (or ids/authors set when no `#p`). */
  admitQuery(selector: readonly string[]): boolean {
    return this.query.take(this.key(selector));
  }
}
