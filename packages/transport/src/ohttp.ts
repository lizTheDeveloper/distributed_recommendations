// Oblivious HTTP (RFC 9458) plumbing over ohttp-ts (MIT, thibmeu) and hpke (MIT,
// panva). This file adds what the library leaves to the caller:
//
// - key configuration fetch **through the OHTTP relay** (fetching it from the
//   gateway directly would show the gateway your IP) and **pinning**: a client
//   only encapsulates to a config whose SHA-256 is in its pin list, so a gateway
//   can't hand one user a unique key to tag them (key consistency, RFC 9458 §7 and
//   draft-ietf-privacypass-key-consistency);
// - one cipher suite, X25519 / HKDF-SHA256 / AES-128-GCM, which every gateway in
//   docs/TRANSPORT.md serves;
// - an in-process gateway with the same endpoints as Cloudflare's
//   privacy-gateway-server (`/gateway`, `/ohttp-keys`), for tests and for runs
//   without Docker. Production runs the Go gateway (infra/ohttp/gateway).

import { AEAD_AES_128_GCM, CipherSuite, KDF_HKDF_SHA256, KEM_DHKEM_X25519_HKDF_SHA256 } from 'hpke';
import type { KeyConfigWithPrivate } from 'ohttp-ts';
import { KeyConfig, MediaType, OHTTPClient, OHTTPServer } from 'ohttp-ts';

export const SUITE = new CipherSuite(KEM_DHKEM_X25519_HKDF_SHA256, KDF_HKDF_SHA256, AEAD_AES_128_GCM);

export type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export class KeyConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KeyConfigError';
  }
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>));
  return [...d].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export interface SelectedKeyConfig {
  config: KeyConfig;
  /** SHA-256 (hex) of the serialized single config: what pins name. */
  pin: string;
}

/**
 * Pick the config our suite can use from an `application/ohttp-keys` body (a
 * length-prefixed list, RFC 9458 §3.2) or a single bare config, and check its pin.
 * `pins` empty or undefined means trust on first use: the caller should persist
 * the returned pin and pass it next time.
 */
export async function selectKeyConfig(body: Uint8Array, pins?: readonly string[]): Promise<SelectedKeyConfig> {
  let candidates: KeyConfig[] = [];
  try {
    candidates = KeyConfig.parseMultiple(body);
  } catch {
    /* maybe a single config */
  }
  if (candidates.length === 0) {
    try {
      candidates = [KeyConfig.parse(body)];
    } catch {
      throw new KeyConfigError('key configuration is malformed');
    }
  }
  let config: KeyConfig;
  try {
    config = KeyConfig.select(SUITE, candidates);
  } catch {
    throw new KeyConfigError('gateway offers no X25519/HKDF-SHA256/AES-128-GCM key');
  }
  const pin = await sha256Hex(KeyConfig.serialize(config));
  if (pins && pins.length > 0 && !pins.includes(pin)) {
    throw new KeyConfigError(`gateway key ${pin.slice(0, 16)}… is not pinned: refusing to encapsulate`);
  }
  return { config, pin };
}

/** Fetch and pin a key configuration. Pass the OHTTP relay's key URL, not the gateway's. */
export async function fetchKeyConfig(url: string, opts: { fetch?: Fetch; pins?: readonly string[]; timeoutMs?: number } = {}): Promise<SelectedKeyConfig> {
  const f = opts.fetch ?? (globalThis.fetch as Fetch);
  const res = await f(url, {
    method: 'GET',
    headers: { accept: 'application/ohttp-keys' },
    credentials: 'omit',
    cache: 'no-store',
    signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000),
  } as RequestInit);
  if (!res.ok) throw new KeyConfigError(`key configuration fetch failed: HTTP ${res.status}`);
  const body = new Uint8Array(await res.arrayBuffer());
  if (body.length === 0 || body.length > 8_192) throw new KeyConfigError('key configuration has an unexpected size');
  return selectKeyConfig(body, opts.pins);
}

/**
 * An OHTTP client for one pinned config. Binary HTTP padding is off: the inner
 * JSON is already padded to fixed buckets (protocol.ts), which works with any
 * gateway's BHTTP parser.
 */
export function ohttpClient(config: KeyConfig): OHTTPClient {
  return new OHTTPClient(SUITE, config, { padding: 0 });
}

export { MediaType };

// ---------------------------------------------------------------------------
// In-process gateway (tests, Docker-less development)
// ---------------------------------------------------------------------------

export interface InProcessGatewayOptions {
  /** Called with each decapsulated inner request. */
  target: (req: Request) => Promise<Response>;
  /** Only this authority (host[:port]) is forwarded; others get 403, like ALLOWED_TARGET_ORIGINS. */
  allowedAuthority: string;
  /** 32+ bytes: derive the key deterministically (like the Go gateway's SEED_SECRET_KEY). */
  seed?: Uint8Array;
  keyId?: number;
  /** Encapsulated request size cap. Default 128 KiB. */
  maxRequestBytes?: number;
}

export interface InProcessGateway {
  /** Serve `/gateway` (POST message/ohttp-req) and `/ohttp-keys` (GET). */
  handle(req: Request): Promise<Response>;
  readonly keys: Uint8Array;
  readonly pin: string;
}

export async function createInProcessGateway(opts: InProcessGatewayOptions): Promise<InProcessGateway> {
  const keyId = opts.keyId ?? 1;
  const kc: KeyConfigWithPrivate = opts.seed ? await KeyConfig.derive(SUITE, opts.seed, keyId) : await KeyConfig.generate(SUITE, keyId);
  const server = new OHTTPServer([kc], { padding: 0 });
  const keys = KeyConfig.serializeMultiple([kc]);
  const pin = await sha256Hex(KeyConfig.serialize(kc));
  const max = opts.maxRequestBytes ?? 131_072;
  return {
    keys,
    pin,
    async handle(req: Request): Promise<Response> {
      const path = new URL(req.url).pathname;
      if (path === '/ohttp-keys' && req.method === 'GET') {
        return new Response(keys as Uint8Array<ArrayBuffer>, { headers: { 'content-type': 'application/ohttp-keys', 'cache-control': 'max-age=86400' } });
      }
      if (path !== '/gateway') return new Response('not found', { status: 404 });
      if (req.method !== 'POST' || req.headers.get('content-type') !== MediaType.REQUEST) return new Response('bad request', { status: 400 });
      const len = Number(req.headers.get('content-length') ?? NaN);
      if (Number.isFinite(len) && len > max) return new Response('too large', { status: 413 });
      const body = new Uint8Array(await req.arrayBuffer());
      if (body.length > max) return new Response('too large', { status: 413 });
      let inner: Request;
      let ctx: { encapsulateResponse(r: Response): Promise<Response> };
      try {
        const d = await server.decapsulateRequest(new Request(req.url, { method: 'POST', headers: { 'content-type': MediaType.REQUEST }, body }));
        inner = d.request;
        ctx = d.context;
      } catch {
        return new Response('bad request', { status: 400 });
      }
      const authority = new URL(inner.url).host;
      const out = authority === opts.allowedAuthority ? await opts.target(inner) : new Response('forbidden', { status: 403 });
      // Strip everything but the content type, as a gateway should.
      const clean = new Response(await out.arrayBuffer(), {
        status: out.status,
        headers: out.headers.get('content-type') ? { 'content-type': out.headers.get('content-type')! } : {},
      });
      return ctx.encapsulateResponse(clean);
    },
  };
}

/**
 * An OHTTP relay as a fetch function: forwards exactly the two gateway resources
 * and drops every client header except the content type. This is the dev and test
 * stand-in for a relay run by another party (infra/ohttp/relay runs Caddy).
 */
export function relayFetch(gateway: (req: Request) => Promise<Response>, opts: { onForward?: (info: { path: string; bytes: number }) => void } = {}): Fetch {
  return async (input, init) => {
    const req = input instanceof Request ? input : new Request(input, init);
    const url = new URL(req.url);
    const path = url.pathname;
    if (!(path === '/gateway' && req.method === 'POST') && !(path === '/ohttp-keys' && req.method === 'GET')) {
      return new Response('not found', { status: 404 });
    }
    const body = req.method === 'POST' ? new Uint8Array(await req.arrayBuffer()) : undefined;
    opts.onForward?.({ path, bytes: body?.length ?? 0 });
    const ct = req.headers.get('content-type');
    const res = await gateway(
      new Request(`http://gateway.internal${path}`, {
        method: req.method,
        headers: ct ? { 'content-type': ct } : {},
        ...(body ? { body: body as Uint8Array<ArrayBuffer> } : {}),
      }),
    );
    const out = new Uint8Array(await res.arrayBuffer());
    const rct = res.headers.get('content-type');
    return new Response(out as Uint8Array<ArrayBuffer>, { status: res.status, headers: rct ? { 'content-type': rct } : {} });
  };
}
