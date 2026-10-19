// The inner HTTP API between a client and the Nostr gateway target: one endpoint,
// `POST /v1/exchange`, carrying a batch of publish and query operations as JSON.
// It only ever travels inside Oblivious HTTP, so the OHTTP relay sees ciphertext and
// the gateway sees this JSON without the client's IP.
//
// Every request and every response body is padded to an exact size from a fixed
// list of buckets, so neither the OHTTP relay nor a network observer learns from
// sizes whether a request published a 19 KB control message, a 33 KB sketch, or
// nothing at all, nor how many wraps came back. The client chooses the response
// size; the target fills it exactly (truncating and setting `more`), so the reply
// size carries no information from the server side either.
//
// Shapes:
//   request  {"v":1,"respBytes":N,"ops":[Op...],"pad":"000..."}
//   Op       {"op":"publish","event":{...}}
//          | {"op":"query","filter":{kinds?,#p?,ids?,authors?,since?,until?,limit?}}
//   response {"v":1,"status":"ok"|"rate-limited"|"bad-request","results":[Result...],"pad":"000..."}
//   Result   {"op":"publish","ok":bool,"relays":[{"relay":url,"ok":bool,"message":str}]}
//          | {"op":"query","ok":bool,"events":[...newest first],"more":bool,"message"?:str}

/** NIP-01 event, signed. Structurally the same as `@match-feed/match`'s `SignedEvent`. */
export interface NostrEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

/** The NIP-01 filter fields the gateway forwards. A superset of match's `RelayFilter`. */
export interface QueryFilter {
  ids?: string[];
  authors?: string[];
  kinds?: number[];
  '#p'?: string[];
  since?: number;
  until?: number;
  limit?: number;
}

export type Op = { op: 'publish'; event: NostrEvent } | { op: 'query'; filter: QueryFilter };

export interface RelayOk {
  relay: string;
  ok: boolean;
  message: string;
}

export type OpResult =
  | { op: 'publish'; ok: boolean; relays: RelayOk[]; message?: string }
  | { op: 'query'; ok: boolean; events: NostrEvent[]; more: boolean; message?: string };

export type ExchangeStatus = 'ok' | 'rate-limited' | 'bad-request' | 'unavailable';

export interface ExchangeRequest {
  v: 1;
  respBytes: number;
  ops: Op[];
}

export interface ExchangeResponse {
  v: 1;
  status: ExchangeStatus;
  results: OpResult[];
}

/** docs/PROTOCOL.md: a gift wrap's JSON is at most 65,536 bytes. */
export const MAX_EVENT_BYTES = 65_536;

/**
 * Request body sizes (bytes). 4 KiB: polls and no-ops. 40 KiB: one 33,305-byte
 * sketch wrap, or two 19,649-byte control wraps. 80 KiB: one maximum-size event.
 */
export const REQUEST_BUCKETS: readonly number[] = [4_096, 40_960, 81_920];

/**
 * Response body sizes (bytes). The top bucket stays under ohttp-ts's default 1 MiB
 * Binary HTTP limit with room for headers.
 */
export const RESPONSE_BUCKETS: readonly number[] = [4_096, 65_536, 262_144, 983_040];

export const MAX_OPS = 8;
export const MAX_QUERY_OPS = 4;
export const MAX_FILTER_VALUES = 256;
export const MAX_KINDS = 16;
export const MAX_LIMIT = 500;

export const TARGET_PATH = '/v1/exchange';
/**
 * The authority clients put in the encapsulated request. It is a name, not a
 * place: the gateway allow-lists it and rewrites it to the target's internal
 * address (Cloudflare privacy-gateway-server `TARGET_REWRITES`).
 */
export const DEFAULT_TARGET_ORIGIN = 'https://nostr-target.internal';

const HEX64 = /^[0-9a-f]{64}$/;
const HEX128 = /^[0-9a-f]{128}$/;
const encoder = new TextEncoder();

export function utf8Length(s: string): number {
  return encoder.encode(s).length;
}

export function eventBytes(e: object): number {
  return utf8Length(JSON.stringify(e));
}

export class ProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProtocolError';
  }
}

/** Smallest bucket ≥ n, or undefined when n fits none. */
export function bucketFor(n: number, buckets: readonly number[]): number | undefined {
  return buckets.find((b) => b >= n);
}

/**
 * Serialize `obj` with a trailing `"pad"` of ASCII zeros so the UTF-8 encoding is
 * exactly `size` bytes. Throws when the unpadded encoding is already larger.
 */
export function padJson(obj: Record<string, unknown>, size: number): string {
  const base = JSON.stringify({ ...obj, pad: '' });
  const n = size - utf8Length(base);
  if (n < 0) throw new ProtocolError(`message is ${size - n} bytes, over the ${size}-byte bucket`);
  return base.slice(0, -2) + '0'.repeat(n) + '"}';
}

/** Bytes a message takes before padding (with an empty pad). */
export function unpaddedBytes(obj: Record<string, unknown>): number {
  return utf8Length(JSON.stringify({ ...obj, pad: '' }));
}

export function isEvent(x: unknown): x is NostrEvent {
  if (typeof x !== 'object' || x === null || Array.isArray(x)) return false;
  const e = x as Record<string, unknown>;
  const keys = Object.keys(e);
  if (keys.length !== 7) return false;
  return (
    typeof e.id === 'string' &&
    HEX64.test(e.id) &&
    typeof e.pubkey === 'string' &&
    HEX64.test(e.pubkey) &&
    typeof e.sig === 'string' &&
    HEX128.test(e.sig) &&
    Number.isSafeInteger(e.kind) &&
    (e.kind as number) >= 0 &&
    (e.kind as number) <= 65_535 &&
    Number.isSafeInteger(e.created_at) &&
    (e.created_at as number) >= 0 &&
    typeof e.content === 'string' &&
    Array.isArray(e.tags) &&
    e.tags.every((t) => Array.isArray(t) && t.every((v) => typeof v === 'string'))
  );
}

function hexList(v: unknown, name: string): string[] {
  if (!Array.isArray(v) || v.length === 0 || v.length > MAX_FILTER_VALUES || !v.every((x) => typeof x === 'string' && HEX64.test(x))) {
    throw new ProtocolError(`filter.${name}: 1–${MAX_FILTER_VALUES} lowercase 64-hex strings`);
  }
  return [...v];
}

function timestamp(v: unknown, name: string): number {
  if (!Number.isSafeInteger(v) || (v as number) < 0) throw new ProtocolError(`filter.${name}: a non-negative integer`);
  return v as number;
}

/** Strict filter check: known keys only, bounded lists. Returns a clean copy. */
export function validateFilter(x: unknown): QueryFilter {
  if (typeof x !== 'object' || x === null || Array.isArray(x)) throw new ProtocolError('filter: an object');
  const f = x as Record<string, unknown>;
  const out: QueryFilter = {};
  for (const k of Object.keys(f)) {
    switch (k) {
      case 'ids':
      case 'authors':
        out[k] = hexList(f[k], k);
        break;
      case '#p':
        out['#p'] = hexList(f[k], k);
        break;
      case 'kinds': {
        const v = f.kinds;
        if (!Array.isArray(v) || v.length === 0 || v.length > MAX_KINDS || !v.every((n) => Number.isSafeInteger(n) && n >= 0 && n <= 65_535)) {
          throw new ProtocolError(`filter.kinds: 1–${MAX_KINDS} integers in 0–65535`);
        }
        out.kinds = [...v];
        break;
      }
      case 'since':
      case 'until':
        out[k] = timestamp(f[k], k);
        break;
      case 'limit': {
        const v = f.limit;
        if (!Number.isSafeInteger(v) || (v as number) < 1 || (v as number) > MAX_LIMIT) throw new ProtocolError(`filter.limit: 1–${MAX_LIMIT}`);
        out.limit = v as number;
        break;
      }
      default:
        throw new ProtocolError(`filter: unknown key ${JSON.stringify(k).slice(0, 40)}`);
    }
  }
  if (!out.ids && !out.authors && !out['#p']) throw new ProtocolError('filter: needs ids, authors or #p (no open-ended scans)');
  return out;
}

export function encodeRequest(req: ExchangeRequest, size: number): string {
  return padJson({ v: 1, respBytes: req.respBytes, ops: req.ops }, size);
}

/**
 * Parse a request body. Checks the exact bucket size before parsing, then the
 * schema. Events are checked for shape and size here; signatures are the target's
 * job (they cost CPU, so they run after rate limiting).
 */
export function decodeRequest(body: Uint8Array, buckets: readonly number[] = REQUEST_BUCKETS): ExchangeRequest {
  if (!buckets.includes(body.length)) throw new ProtocolError(`request body must be exactly one of ${buckets.join(', ')} bytes`);
  let x: unknown;
  try {
    x = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body));
  } catch {
    throw new ProtocolError('request body is not UTF-8 JSON');
  }
  if (typeof x !== 'object' || x === null || Array.isArray(x)) throw new ProtocolError('request: an object');
  const r = x as Record<string, unknown>;
  const keys = Object.keys(r);
  if (keys.join(',') !== 'v,respBytes,ops,pad') throw new ProtocolError('request: keys must be exactly v, respBytes, ops, pad');
  if (r.v !== 1) throw new ProtocolError('request: unsupported version');
  if (typeof r.pad !== 'string' || !/^0*$/.test(r.pad)) throw new ProtocolError('request: pad must be zeros');
  if (typeof r.respBytes !== 'number' || !RESPONSE_BUCKETS.includes(r.respBytes)) {
    throw new ProtocolError(`request: respBytes must be one of ${RESPONSE_BUCKETS.join(', ')}`);
  }
  if (!Array.isArray(r.ops) || r.ops.length > MAX_OPS) throw new ProtocolError(`request: ops must be an array of at most ${MAX_OPS}`);
  const ops: Op[] = [];
  let queries = 0;
  for (const o of r.ops) {
    if (typeof o !== 'object' || o === null || Array.isArray(o)) throw new ProtocolError('op: an object');
    const op = o as Record<string, unknown>;
    if (op.op === 'publish' && Object.keys(op).join(',') === 'op,event') {
      if (!isEvent(op.event)) throw new ProtocolError('publish: malformed event');
      if (eventBytes(op.event) > MAX_EVENT_BYTES) throw new ProtocolError(`publish: event over ${MAX_EVENT_BYTES} bytes`);
      ops.push({ op: 'publish', event: op.event });
    } else if (op.op === 'query' && Object.keys(op).join(',') === 'op,filter') {
      if (++queries > MAX_QUERY_OPS) throw new ProtocolError(`request: at most ${MAX_QUERY_OPS} queries`);
      ops.push({ op: 'query', filter: validateFilter(op.filter) });
    } else {
      throw new ProtocolError('op: must be {op:"publish",event} or {op:"query",filter}');
    }
  }
  return { v: 1, respBytes: r.respBytes, ops };
}

/**
 * Encode a response into exactly `size` bytes. Query results are filled greedily,
 * newest event first, across all query ops in order; whatever doesn't fit is
 * dropped and that result gets `more: true`. Publish results always fit (they're
 * small and bounded by the relay count).
 */
export function encodeResponse(res: ExchangeResponse, size: number): string {
  const skeleton: OpResult[] = res.results.map((r) => (r.op === 'query' ? { ...r, events: [] } : r));
  let used = unpaddedBytes({ v: 1, status: res.status, results: skeleton });
  if (used > size) {
    // Even without events it doesn't fit (absurd relay messages): drop details.
    const bare: OpResult[] = res.results.map((r) =>
      r.op === 'query' ? { op: 'query', ok: false, events: [], more: true, message: 'error: response too large' } : { op: 'publish', ok: r.ok, relays: [] },
    );
    return padJson({ v: 1, status: res.status, results: bare }, size);
  }
  const filled: OpResult[] = skeleton.map((r, i) => {
    const orig = res.results[i];
    if (r.op !== 'query' || orig.op !== 'query') return r;
    const events: NostrEvent[] = [];
    let more = orig.more;
    for (const e of orig.events) {
      const add = eventBytes(e) + (events.length > 0 ? 1 : 0);
      if (used + add > size) {
        more = true;
        continue;
      }
      used += add;
      events.push(e);
    }
    return { ...r, events, more };
  });
  return padJson({ v: 1, status: res.status, results: filled }, size);
}

export function decodeResponse(body: Uint8Array, expectedBytes: number): ExchangeResponse {
  if (body.length !== expectedBytes) throw new ProtocolError(`response is ${body.length} bytes, expected exactly ${expectedBytes}`);
  let x: unknown;
  try {
    x = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body));
  } catch {
    throw new ProtocolError('response is not UTF-8 JSON');
  }
  const r = x as Record<string, unknown>;
  if (typeof r !== 'object' || r === null || r.v !== 1 || !Array.isArray(r.results) || typeof r.status !== 'string') {
    throw new ProtocolError('response: malformed');
  }
  const results: OpResult[] = [];
  for (const o of r.results as unknown[]) {
    const op = o as Record<string, unknown>;
    if (op?.op === 'publish' && typeof op.ok === 'boolean' && Array.isArray(op.relays)) {
      const relays = (op.relays as unknown[]).filter(
        (x): x is RelayOk => typeof x === 'object' && x !== null && typeof (x as RelayOk).relay === 'string' && typeof (x as RelayOk).ok === 'boolean' && typeof (x as RelayOk).message === 'string',
      );
      results.push({ op: 'publish', ok: op.ok, relays, ...(typeof op.message === 'string' ? { message: op.message } : {}) });
    } else if (op?.op === 'query' && typeof op.ok === 'boolean' && Array.isArray(op.events) && typeof op.more === 'boolean') {
      const events = (op.events as unknown[]).filter((e): e is NostrEvent => isEvent(e) && eventBytes(e) <= MAX_EVENT_BYTES);
      results.push({ op: 'query', ok: op.ok, events, more: op.more, ...(typeof op.message === 'string' ? { message: op.message } : {}) });
    } else {
      throw new ProtocolError('response: malformed result');
    }
  }
  return { v: 1, status: r.status as ExchangeStatus, results };
}

/** NIP-01 match for the fields `QueryFilter` has (used to re-check relay answers). */
export function matchesFilter(e: NostrEvent, f: QueryFilter): boolean {
  if (f.ids && !f.ids.includes(e.id)) return false;
  if (f.authors && !f.authors.includes(e.pubkey)) return false;
  if (f.kinds && !f.kinds.includes(e.kind)) return false;
  if (f['#p'] && !e.tags.some((t) => t[0] === 'p' && f['#p']!.includes(t[1]))) return false;
  if (f.since !== undefined && e.created_at < f.since) return false;
  if (f.until !== undefined && e.created_at > f.until) return false;
  return true;
}

/** Newest first, ties by id: NIP-01's order for `limit`, and the order pages use. */
export function newestFirst(a: NostrEvent, b: NostrEvent): number {
  return b.created_at - a.created_at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
