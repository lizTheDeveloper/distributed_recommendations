// `OhttpRelay`: packages/match's `RelayLike` over Oblivious HTTP.
//
//   client ──(HTTPS, ciphertext)──▶ OHTTP relay ──▶ OHTTP gateway ──▶ Nostr target ──(WebSocket)──▶ Nostr relays
//          sees: nothing new          sees: client IP,      sees: requests,       sees: events and
//                                     sizes, timing         not the IP            filters, gateway IP
//
// What this class adds on top of encapsulation (docs/TRANSPORT.md):
//
// - **Batching.** publish() and query() calls don't go out one by one. They queue,
//   and a flush packs as many as fit into one request.
//     - `on-demand` (default): a flush happens after a random delay in
//       `batchDelayMs`, so what goes out is decoupled a little from the user's tap.
//     - `constant-rate`: exactly one request per `tickMs` (± `tickJitter`), whether
//       or not anything is queued (empty requests are cover traffic). The OHTTP
//       relay sees the same size at the same rate from every user in this mode;
//       sync() and publish() may wait up to one tick.
// - **Padding.** Every request body is exactly one of REQUEST_BUCKETS bytes
//   (constant-rate: always `uniformRequestBytes`); every response is exactly the
//   size the client asked for, chosen from RESPONSE_BUCKETS. Larger answers come
//   back in pages.
// - **Key pinning.** The key configuration is fetched through the OHTTP relay (or
//   shipped in the app) and must match a pin (ohttp.ts).
// - **Polling** instead of live subscriptions: `subscribe()` polls with jitter.

import type { NostrEvent, OpResult, Op, QueryFilter } from './protocol.ts';
import {
  DEFAULT_TARGET_ORIGIN,
  MAX_OPS,
  MAX_QUERY_OPS,
  REQUEST_BUCKETS,
  RESPONSE_BUCKETS,
  TARGET_PATH,
  bucketFor,
  decodeResponse,
  encodeRequest,
  eventBytes,
  matchesFilter,
  unpaddedBytes,
} from './protocol.ts';
import type { Fetch, SelectedKeyConfig } from './ohttp.ts';
import { fetchKeyConfig, ohttpClient, selectKeyConfig } from './ohttp.ts';
import type { OHTTPClient } from 'ohttp-ts';

/** The `RelayLike` shape from packages/match (structural; no import needed at runtime). */
export interface RelayLikeFilter {
  kinds?: number[];
  '#p'?: string[];
  since?: number;
  until?: number;
}

export interface OhttpRelayOptions {
  /** The OHTTP relay's resource for our gateway, e.g. `https://ohttp-relay.example.net/gateway`. Run by another party. */
  relayUrl: string;
  /** Where to fetch the key configuration. Default: `/ohttp-keys` on the relay's origin (the relay forwards it). */
  keyConfigUrl?: string;
  /** A key configuration shipped with the app (`application/ohttp-keys` or one config). Skips the fetch. */
  keyConfig?: Uint8Array;
  /** Accepted SHA-256 pins of the key config. Empty: trust on first use (read `pin` afterwards and store it). */
  pins?: readonly string[];
  /** Authority the gateway allow-lists for the Nostr target. Default `https://nostr-target.internal`. */
  targetOrigin?: string;
  fetch?: Fetch;
  mode?: 'on-demand' | 'constant-rate';
  /** on-demand: random wait before a flush, to collect ops. Default 100–1,500 ms. */
  batchDelayMs?: { min: number; max: number };
  /** constant-rate: mean time between requests. Default 300,000 (5 min). */
  tickMs?: number;
  /** constant-rate: each interval is tickMs × (1 ± tickJitter). Default 0.25. */
  tickJitter?: number;
  /** constant-rate: request size. Default 40,960 (fits one 33 KB sketch wrap or two control wraps). */
  uniformRequestBytes?: number;
  /** Response size for requests with queries. constant-rate uses it for every request. Default 262,144 (on-demand), 65,536 (constant-rate). */
  responseBytes?: number;
  /** Events per query page. Default 50. */
  pageLimit?: number;
  /** Pages per query() before giving up with what it has. Default 20. */
  maxPages?: number;
  /**
   * Send a filter with several `#p` keys as one query per key, each in its own
   * request, so the gateway can't see the keys together. Costs one request per key.
   * Default false.
   */
  splitKeys?: boolean;
  /** Per HTTP request. Default 30 s. */
  timeoutMs?: number;
  /** [0, 1). Default: crypto.getRandomValues. */
  random?: () => number;
  now?: () => Date;
  /** Observe what leaves the device (tests, the app's network-activity view). Sizes only. */
  onRequest?: (info: { requestBytes: number; responseBytes: number; ops: number }) => void;
}

export class TransportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransportError';
  }
}

interface Pending {
  op: Op;
  resolve: (r: OpResult) => void;
  reject: (e: Error) => void;
}

function cryptoRandom(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32;
}

function sortAsc(a: NostrEvent, b: NostrEvent): number {
  return a.created_at - b.created_at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

export class OhttpRelay {
  private readonly o: Required<
    Pick<OhttpRelayOptions, 'relayUrl' | 'targetOrigin' | 'mode' | 'batchDelayMs' | 'tickMs' | 'tickJitter' | 'uniformRequestBytes' | 'responseBytes' | 'pageLimit' | 'maxPages' | 'splitKeys' | 'timeoutMs'>
  >;
  private readonly opts: OhttpRelayOptions;
  private readonly fetchFn: Fetch;
  private readonly random: () => number;
  private readonly queue: Pending[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private flushing = false;
  private closed = false;
  private clientP: Promise<{ client: OHTTPClient; key: SelectedKeyConfig }> | null = null;
  private readonly polls = new Set<() => void>();
  /** The pin of the key config in use (after the first request). Persist it for TOFU. */
  pin: string | undefined;

  constructor(opts: OhttpRelayOptions) {
    const relay = new URL(opts.relayUrl);
    if (relay.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(relay.hostname)) {
      throw new TransportError('the OHTTP relay URL must be https (plain http only for localhost development)');
    }
    const constant = opts.mode === 'constant-rate';
    this.opts = opts;
    this.o = {
      relayUrl: opts.relayUrl,
      targetOrigin: (opts.targetOrigin ?? DEFAULT_TARGET_ORIGIN).replace(/\/$/, ''),
      mode: opts.mode ?? 'on-demand',
      batchDelayMs: opts.batchDelayMs ?? { min: 100, max: 1_500 },
      tickMs: opts.tickMs ?? 300_000,
      tickJitter: opts.tickJitter ?? 0.25,
      uniformRequestBytes: opts.uniformRequestBytes ?? 40_960,
      responseBytes: opts.responseBytes ?? (constant ? 65_536 : 262_144),
      pageLimit: opts.pageLimit ?? 50,
      maxPages: opts.maxPages ?? 20,
      splitKeys: opts.splitKeys ?? false,
      timeoutMs: opts.timeoutMs ?? 30_000,
    };
    if (!REQUEST_BUCKETS.includes(this.o.uniformRequestBytes)) throw new TransportError(`uniformRequestBytes must be one of ${REQUEST_BUCKETS.join(', ')}`);
    if (!RESPONSE_BUCKETS.includes(this.o.responseBytes)) throw new TransportError(`responseBytes must be one of ${RESPONSE_BUCKETS.join(', ')}`);
    this.fetchFn = opts.fetch ?? (globalThis.fetch as Fetch);
    this.random = opts.random ?? cryptoRandom;
    if (constant) this.schedule();
  }

  // ---- RelayLike -----------------------------------------------------------

  async publish(event: NostrEvent): Promise<{ ok: boolean; message: string }> {
    let r: OpResult;
    try {
      r = await this.enqueue({ op: 'publish', event });
    } catch (e) {
      return { ok: false, message: `error: ${(e as Error).message}` };
    }
    if (r.op !== 'publish') return { ok: false, message: 'error: mismatched result' };
    if (r.ok) return { ok: true, message: r.relays.find((x) => x.ok)?.message ?? '' };
    const detail = r.message ?? r.relays.map((x) => `${x.relay}: ${x.message}`).join('; ');
    return { ok: false, message: detail || 'error: no relay accepted the event' };
  }

  /** All matching events, oldest first, paging as needed (like packages/match's InMemoryRelay). */
  async query(filter: RelayLikeFilter & QueryFilter): Promise<NostrEvent[]> {
    const keys = filter['#p'];
    const filters = this.o.splitKeys && keys && keys.length > 1 ? keys.map((p) => ({ ...filter, '#p': [p] })) : [filter];
    const lists = await Promise.all(filters.map((f) => this.queryPaged(f)));
    const byId = new Map<string, NostrEvent>();
    for (const l of lists) for (const e of l) if (!byId.has(e.id)) byId.set(e.id, e);
    return [...byId.values()].sort(sortAsc);
  }

  // ---- Polling "subscription" -------------------------------------------------

  /**
   * Poll `filter` every `intervalMs` (± jitter) and hand new events to `onEvents`.
   * Gift wraps backdate `created_at` by up to 2 days (NIP-59), so each poll asks
   * for `since = now − lookbackSec` (default 2 days + 1 hour) and de-duplicates.
   * Returns a stop function.
   */
  subscribe(
    filter: RelayLikeFilter & QueryFilter,
    onEvents: (events: NostrEvent[]) => void,
    opts: { intervalMs?: number; jitter?: number; lookbackSec?: number; onError?: (e: Error) => void } = {},
  ): () => void {
    const interval = opts.intervalMs ?? 60_000;
    const jitter = opts.jitter ?? 0.5;
    const lookback = opts.lookbackSec ?? 2 * 86_400 + 3_600;
    const seen = new Set<string>();
    let stopped = false;
    let t: ReturnType<typeof setTimeout> | null = null;
    const now = () => Math.floor((this.opts.now?.() ?? new Date()).getTime() / 1000);
    const run = async () => {
      if (stopped) return;
      try {
        const evs = await this.query({ ...filter, since: Math.max(filter.since ?? 0, now() - lookback) });
        const fresh = evs.filter((e) => !seen.has(e.id));
        for (const e of fresh) seen.add(e.id);
        if (fresh.length && !stopped) onEvents(fresh);
      } catch (e) {
        opts.onError?.(e as Error);
      }
      if (!stopped) t = setTimeout(run, interval * (1 - jitter + 2 * jitter * this.random()));
    };
    t = setTimeout(run, interval * jitter * this.random());
    const stop = () => {
      stopped = true;
      if (t) clearTimeout(t);
      this.polls.delete(stop);
    };
    this.polls.add(stop);
    return stop;
  }

  /** Stop timers and fail anything still queued. */
  close(): void {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    for (const stop of [...this.polls]) stop();
    for (const p of this.queue.splice(0)) p.reject(new TransportError('transport closed'));
  }

  // ---- Internals -----------------------------------------------------------

  private async queryPaged(filter: QueryFilter): Promise<NostrEvent[]> {
    const got = new Map<string, NostrEvent>();
    let until = filter.until;
    const limit = Math.min(filter.limit ?? this.o.pageLimit, this.o.pageLimit);
    for (let page = 0; page < this.o.maxPages; page++) {
      const f: QueryFilter = { ...filter, limit, ...(until !== undefined ? { until } : {}) };
      const r = await this.enqueue({ op: 'query', filter: f });
      if (r.op !== 'query') throw new TransportError('mismatched result');
      if (!r.ok) throw new TransportError(r.message ?? 'query failed');
      let fresh = 0;
      for (const e of r.events) {
        if (!matchesFilter(e, filter) || got.has(e.id)) continue;
        got.set(e.id, e);
        fresh++;
      }
      if (filter.limit !== undefined && got.size >= filter.limit) break;
      if (!r.more || r.events.length === 0 || fresh === 0) break;
      // Next page: everything at or before the oldest timestamp seen (inclusive;
      // duplicates at the boundary are dropped above).
      until = Math.min(...r.events.map((e) => e.created_at));
    }
    return [...got.values()];
  }

  private maxRequestBytes(): number {
    return this.o.mode === 'constant-rate' ? this.o.uniformRequestBytes : Math.max(...REQUEST_BUCKETS);
  }

  private enqueue(op: Op): Promise<OpResult> {
    if (this.closed) return Promise.reject(new TransportError('transport closed'));
    if (op.op === 'publish' && eventBytes(op.event) > 65_536) return Promise.reject(new TransportError('event over 64 KiB'));
    return new Promise((resolve, reject) => {
      this.queue.push({ op, resolve, reject });
      if (this.o.mode === 'on-demand' && !this.timer && !this.flushing) this.schedule();
    });
  }

  private schedule(): void {
    if (this.closed || this.timer) return;
    let delay: number;
    if (this.o.mode === 'constant-rate') {
      const j = this.o.tickJitter;
      delay = this.o.tickMs * (1 - j + 2 * j * this.random());
    } else {
      const { min, max } = this.o.batchDelayMs;
      delay = min + (max - min) * this.random();
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, delay);
  }

  /** Take as many queued ops as fit one request. */
  private takeBatch(): { batch: Pending[]; size: number; respBytes: number } {
    const cap = this.maxRequestBytes();
    const constant = this.o.mode === 'constant-rate';
    const batch: Pending[] = [];
    let queries = 0;
    const respFor = (b: Pending[]) => (constant || b.some((p) => p.op.op === 'query') ? this.o.responseBytes : RESPONSE_BUCKETS[0]);
    const sizeOf = (b: Pending[]) => unpaddedBytes({ v: 1, respBytes: respFor(b), ops: b.map((p) => p.op) });
    while (this.queue.length && batch.length < MAX_OPS) {
      const next = this.queue[0];
      if (next.op.op === 'query' && queries >= MAX_QUERY_OPS) break;
      // splitKeys: never put two single-key queries in one request.
      if (this.o.splitKeys && next.op.op === 'query' && queries >= 1) break;
      const trial = [...batch, next];
      if (sizeOf(trial) > cap && batch.length > 0) break;
      batch.push(this.queue.shift()!);
      if (next.op.op === 'query') queries++;
    }
    const unpadded = sizeOf(batch);
    let size = constant ? this.o.uniformRequestBytes : bucketFor(unpadded, REQUEST_BUCKETS);
    // One op bigger than the uniform size (a 64 KiB event in constant-rate mode)
    // goes out in the next bucket up: rare, and visible as such.
    if (size === undefined || size < unpadded) size = bucketFor(unpadded, REQUEST_BUCKETS);
    if (size === undefined) throw new TransportError('request too large');
    return { batch, size, respBytes: respFor(batch) };
  }

  private async flush(): Promise<void> {
    if (this.flushing) return;
    this.flushing = true;
    try {
      const constant = this.o.mode === 'constant-rate';
      // on-demand: drain everything queued now; constant-rate: exactly one request per tick.
      do {
        let taken;
        try {
          taken = this.takeBatch();
        } catch (e) {
          const p = this.queue.shift();
          p?.reject(e as Error);
          continue;
        }
        const { batch, size, respBytes } = taken;
        if (batch.length === 0 && !constant) break;
        try {
          const res = await this.exchange(
            batch.map((p) => p.op),
            size,
            respBytes,
          );
          if (res.status !== 'ok' || res.results.length !== batch.length) {
            const err = new TransportError(res.status === 'ok' ? 'gateway answered a different number of results' : `gateway: ${res.status}`);
            for (const p of batch) p.reject(err);
          } else {
            batch.forEach((p, i) => p.resolve(res.results[i]));
          }
        } catch (e) {
          for (const p of batch) p.reject(e instanceof Error ? e : new TransportError(String(e)));
        }
      } while (!constant && this.queue.length > 0 && !this.closed);
    } finally {
      this.flushing = false;
      if (this.o.mode === 'constant-rate') this.schedule();
      else if (this.queue.length > 0) this.schedule();
    }
  }

  private keyClient(): Promise<{ client: OHTTPClient; key: SelectedKeyConfig }> {
    this.clientP ??= (async () => {
      const key = this.opts.keyConfig
        ? await selectKeyConfig(this.opts.keyConfig, this.opts.pins)
        : await fetchKeyConfig(this.opts.keyConfigUrl ?? new URL('/ohttp-keys', this.o.relayUrl).toString(), {
            fetch: this.fetchFn,
            pins: this.opts.pins,
            timeoutMs: this.o.timeoutMs,
          });
      this.pin = key.pin;
      return { client: ohttpClient(key.config), key };
    })().catch((e) => {
      this.clientP = null;
      throw e;
    });
    return this.clientP;
  }

  private async exchange(ops: Op[], size: number, respBytes: number) {
    const body = encodeRequest({ v: 1, respBytes, ops }, size);
    for (let attempt = 0; ; attempt++) {
      const { client } = await this.keyClient();
      const inner = new Request(this.o.targetOrigin + TARGET_PATH, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      });
      const { init, context } = await client.encapsulateRequest(inner);
      const res = await this.fetchFn(this.o.relayUrl, {
        ...init,
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
        signal: AbortSignal.timeout(this.o.timeoutMs),
      } as RequestInit);
      if (!res.ok) {
        await res.arrayBuffer().catch(() => undefined);
        // A rotated gateway key shows up as a 4xx from the gateway. Re-fetch the
        // config once (it must still match a pin) and retry.
        if (attempt === 0 && res.status >= 400 && res.status < 500 && !this.opts.keyConfig) {
          this.clientP = null;
          continue;
        }
        throw new TransportError(`OHTTP relay or gateway answered HTTP ${res.status}`);
      }
      let innerRes: Response;
      try {
        innerRes = await context.decapsulateResponse(res);
      } catch {
        throw new TransportError('could not decapsulate the gateway response');
      }
      const bytes = new Uint8Array(await innerRes.arrayBuffer());
      this.opts.onRequest?.({ requestBytes: size, responseBytes: bytes.length, ops: ops.length });
      if (innerRes.status === 403) throw new TransportError('gateway refused the target (check targetOrigin)');
      try {
        return decodeResponse(bytes, respBytes);
      } catch (e) {
        throw new TransportError(`target answered HTTP ${innerRes.status}: ${(e as Error).message}`);
      }
    }
  }
}
