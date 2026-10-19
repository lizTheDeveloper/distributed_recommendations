// Minimal NIP-01 read client: REQ -> EVENT* -> EOSE -> CLOSE, over the WHATWG
// WebSocket (global in browsers and Node >= 22). Read-only: this package never
// publishes anything. Events are deduplicated by id; signatures are NOT checked
// here (callers verify, see `buildLabelIndex` and `parseMuteList`).

import type { NostrEvent, NostrFilter, QueryFn } from './types.ts';

export type WebSocketCtor = new (url: string) => WebSocket;

export interface QueryOptions {
  WebSocket?: WebSocketCtor;
  /** Per relay, from connect to EOSE (default 8 s). A relay that times out contributes what it sent. */
  timeoutMs?: number;
  /** Most events kept per relay (default 5,000). */
  maxEventsPerRelay?: number;
  /** Events whose JSON exceeds this are dropped (default 64 KiB, a common relay limit). */
  maxEventBytes?: number;
}

function assertRelayUrl(url: string): void {
  const u = new URL(url);
  if (u.protocol !== 'wss:' && u.protocol !== 'ws:') throw new TypeError(`relay URL must be ws:// or wss://: ${url}`);
}

function looksLikeEvent(e: unknown): e is NostrEvent {
  const o = e as NostrEvent;
  return (
    !!o &&
    typeof o === 'object' &&
    typeof o.id === 'string' &&
    typeof o.pubkey === 'string' &&
    typeof o.sig === 'string' &&
    typeof o.content === 'string' &&
    Number.isInteger(o.kind) &&
    Number.isInteger(o.created_at) &&
    Array.isArray(o.tags)
  );
}

function queryOne(url: string, filter: NostrFilter, opts: QueryOptions): Promise<NostrEvent[]> {
  const WS = opts.WebSocket ?? (globalThis.WebSocket as WebSocketCtor | undefined);
  if (!WS) return Promise.reject(new Error('no WebSocket implementation available'));
  const max = opts.maxEventsPerRelay ?? 5000;
  const maxBytes = opts.maxEventBytes ?? 65_536;
  const subId = 'mod' + Math.random().toString(36).slice(2, 10);
  return new Promise((resolve) => {
    const out: NostrEvent[] = [];
    let done = false;
    let ws: WebSocket;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        ws.send(JSON.stringify(['CLOSE', subId]));
      } catch {
        /* not open */
      }
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      resolve(out);
    };
    const timer = setTimeout(finish, opts.timeoutMs ?? 8000);
    try {
      ws = new WS(url);
    } catch {
      clearTimeout(timer);
      resolve(out);
      return;
    }
    ws.addEventListener('open', () => ws.send(JSON.stringify(['REQ', subId, filter])));
    ws.addEventListener('error', finish);
    ws.addEventListener('close', finish);
    ws.addEventListener('message', (m: MessageEvent) => {
      const raw = String(m.data);
      if (raw.length > maxBytes + 256) return;
      let msg: unknown;
      try {
        msg = JSON.parse(raw);
      } catch {
        return;
      }
      if (!Array.isArray(msg) || msg[1] !== subId) return;
      if (msg[0] === 'EVENT' && looksLikeEvent(msg[2])) {
        if (out.length < max) out.push(msg[2]);
        if (out.length >= max) finish();
      } else if (msg[0] === 'EOSE' || msg[0] === 'CLOSED') {
        finish();
      }
    });
  });
}

/** Query several relays in parallel and merge the results (unique by id). */
export async function queryRelays(relays: readonly string[], filter: NostrFilter, opts: QueryOptions = {}): Promise<NostrEvent[]> {
  const urls = [...new Set(relays)];
  urls.forEach(assertRelayUrl);
  const results = await Promise.all(urls.map((u) => queryOne(u, filter, opts).catch(() => [] as NostrEvent[])));
  const seen = new Map<string, NostrEvent>();
  for (const list of results) for (const e of list) if (!seen.has(e.id)) seen.set(e.id, e);
  return [...seen.values()];
}

/** A `QueryFn` bound to options, for passing to `fetchLabels` / `fetchMuteList`. */
export function relayQuery(opts: QueryOptions = {}): QueryFn {
  return (relays, filter) => queryRelays(relays, filter, opts);
}
