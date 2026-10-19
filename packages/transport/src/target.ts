// The Nostr gateway target: the HTTP resource that sits behind an Oblivious HTTP
// gateway and turns decapsulated `POST /v1/exchange` requests into NIP-01 traffic
// to a configured relay set (docs/TRANSPORT.md).
//
// - Stateless per request. It keeps no per-client state; the only memory is the
//   rate-limit table (HMAC'd keys, evicted when idle) and pooled relay sockets.
// - Logs nothing about requests. No access log, no bodies, no keys, no errors with
//   request data. One startup line names the configured relays.
// - Bounded: request bodies are exactly one of REQUEST_BUCKETS (≤ 80 KiB), events
//   ≤ 64 KiB (docs/PROTOCOL.md), at most 8 ops and 4 queries, filters must name
//   ids, authors or #p, and only allowed kinds pass (default: gift wraps, 1059).
// - Rate limits keyed on recipients and filters, never on the peer address: the
//   peer is the OHTTP gateway (ratelimit.ts).

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { verifyEvent } from 'nostr-tools/pure';
import type { ExchangeResponse, NostrEvent, OpResult, QueryFilter } from './protocol.ts';
import { REQUEST_BUCKETS, RESPONSE_BUCKETS, ProtocolError, TARGET_PATH, decodeRequest, encodeResponse } from './protocol.ts';
import type { RateLimitConfig } from './ratelimit.ts';
import { TargetRateLimiter } from './ratelimit.ts';
import type { Upstream } from './upstream.ts';

export interface TargetOptions {
  upstream: Upstream;
  /** Kinds clients may publish and query. Default [1059] (NIP-59 gift wraps). Empty array: any kind. */
  allowedKinds?: readonly number[];
  limits?: RateLimitConfig;
  /** Signature check before forwarding. Default nostr-tools `verifyEvent`. */
  verify?: (e: NostrEvent) => boolean;
}

export interface Target {
  handle(req: Request): Promise<Response>;
  close(): void;
}

const MAX_BODY = Math.max(...REQUEST_BUCKETS);
const JSON_HEADERS = { 'content-type': 'application/json', 'cache-control': 'no-store' };

function reply(status: number, body: ExchangeResponse, size: number): Response {
  return new Response(encodeResponse(body, size), { status, headers: JSON_HEADERS });
}

/** respBytes from a request we couldn't fully parse, so even errors keep the client's size. */
function sniffRespBytes(body: Uint8Array): number {
  const head = new TextDecoder().decode(body.subarray(0, 64));
  const m = /^\{"v":1,"respBytes":(\d{1,7}),/.exec(head);
  const n = m ? Number(m[1]) : NaN;
  return RESPONSE_BUCKETS.includes(n) ? n : RESPONSE_BUCKETS[0];
}

async function readBody(req: Request, max: number): Promise<Uint8Array | null> {
  const declared = Number(req.headers.get('content-length') ?? NaN);
  if (Number.isFinite(declared) && declared > max) return null;
  if (!req.body) return new Uint8Array(0);
  const chunks: Uint8Array[] = [];
  let n = 0;
  const reader = req.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.length;
    if (n > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(n);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

export function createTarget(opts: TargetOptions): Target {
  const upstream = opts.upstream;
  const allowed = opts.allowedKinds ?? [1059];
  const anyKind = allowed.length === 0;
  const limiter = new TargetRateLimiter(opts.limits);
  const verify = opts.verify ?? ((e: NostrEvent) => verifyEvent({ ...e, tags: e.tags.map((t) => [...t]) }));

  async function publish(event: NostrEvent): Promise<OpResult> {
    if (!anyKind && !allowed.includes(event.kind)) return { op: 'publish', ok: false, relays: [], message: 'blocked: kind not accepted by this gateway' };
    // Verify first: otherwise unsigned junk addressed to a victim would drain the
    // victim's bucket. The global bucket already bounds the CPU this costs.
    if (!verify(event)) return { op: 'publish', ok: false, relays: [], message: 'invalid: bad id or signature' };
    const recipients = event.tags.filter((t) => t[0] === 'p' && typeof t[1] === 'string').map((t) => t[1]);
    if (!limiter.admitPublish(recipients)) return { op: 'publish', ok: false, relays: [], message: 'rate-limited: too many events for this recipient' };
    const relays = await upstream.publish(event);
    return { op: 'publish', ok: relays.some((r) => r.ok), relays };
  }

  async function query(filter: QueryFilter): Promise<OpResult> {
    let f = filter;
    if (!anyKind) {
      if (!f.kinds) f = { ...f, kinds: [...allowed] };
      else if (!f.kinds.every((k) => allowed.includes(k))) return { op: 'query', ok: false, events: [], more: false, message: 'blocked: kind not served by this gateway' };
    }
    const selector = f['#p'] ?? f.ids ?? f.authors ?? [];
    if (!limiter.admitQuery(selector)) return { op: 'query', ok: false, events: [], more: false, message: 'rate-limited: slow down' };
    const r = await upstream.query(f);
    return { op: 'query', ok: r.ok, events: r.events, more: r.more, ...(r.message ? { message: r.message } : {}) };
  }

  async function handle(req: Request): Promise<Response> {
    const path = new URL(req.url).pathname;
    if (path === '/health' && req.method === 'GET') return new Response('ok', { headers: { 'cache-control': 'no-store' } });
    if (path !== TARGET_PATH) return new Response('not found', { status: 404 });
    if (req.method !== 'POST') return new Response('method not allowed', { status: 405, headers: { allow: 'POST' } });
    const body = await readBody(req, MAX_BODY);
    if (body === null) return reply(413, { v: 1, status: 'bad-request', results: [] }, RESPONSE_BUCKETS[0]);
    let parsed;
    try {
      parsed = decodeRequest(body);
    } catch (e) {
      if (e instanceof ProtocolError) return reply(400, { v: 1, status: 'bad-request', results: [] }, sniffRespBytes(body));
      throw e;
    }
    const size = parsed.respBytes;
    if (!limiter.admitRequest()) return reply(429, { v: 1, status: 'rate-limited', results: [] }, size);
    const results = await Promise.all(parsed.ops.map((op) => (op.op === 'publish' ? publish(op.event) : query(op.filter))));
    return reply(200, { v: 1, status: 'ok', results }, size);
  }

  return {
    async handle(req: Request): Promise<Response> {
      try {
        return await handle(req);
      } catch {
        // Deliberately no detail and no logging: errors could carry request data.
        return new Response('internal error', { status: 500, headers: { 'cache-control': 'no-store' } });
      }
    },
    close: () => upstream.close(),
  };
}

/** Serve a target over plain HTTP (the gateway reaches it on a private network). */
export function serveTarget(target: Target, opts: { port: number; host?: string }): Promise<Server> {
  const server = createServer(async (inReq: IncomingMessage, res: ServerResponse) => {
    try {
      const declared = Number(inReq.headers['content-length'] ?? NaN);
      if (Number.isFinite(declared) && declared > MAX_BODY) {
        res.writeHead(413, { connection: 'close' }).end();
        inReq.destroy();
        return;
      }
      const chunks: Buffer[] = [];
      let n = 0;
      for await (const c of inReq) {
        n += (c as Buffer).length;
        if (n > MAX_BODY) {
          res.writeHead(413, { connection: 'close' }).end();
          inReq.destroy();
          return;
        }
        chunks.push(c as Buffer);
      }
      const method = inReq.method ?? 'GET';
      const req = new Request(`http://target${inReq.url ?? '/'}`, {
        method,
        headers: { 'content-type': String(inReq.headers['content-type'] ?? '') },
        ...(method === 'GET' || method === 'HEAD' ? {} : { body: Buffer.concat(chunks) }),
      });
      const out = await target.handle(req);
      const buf = Buffer.from(await out.arrayBuffer());
      const headers: Record<string, string> = {};
      out.headers.forEach((v, k) => {
        headers[k] = v;
      });
      res.writeHead(out.status, { ...headers, 'content-length': String(buf.length) }).end(buf);
    } catch {
      if (!res.headersSent) res.writeHead(500).end();
      else res.destroy();
    }
  });
  server.headersTimeout = 10_000;
  server.requestTimeout = 30_000;
  server.keepAliveTimeout = 30_000;
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port, opts.host ?? '0.0.0.0', () => resolve(server));
  });
}
