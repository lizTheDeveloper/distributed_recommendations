// Small NIP-01 relay client over the WHATWG WebSocket (global in Node >= 22 and
// browsers). Only what the bridge needs: EVENT -> OK, REQ -> EVENT* EOSE, plus
//
// - NIP-42 AUTH: the relay may send ["AUTH", <challenge>] at any time. When a
//   write is answered with `OK false "auth-required: …"` (or a REQ with
//   `CLOSED "auth-required: …"`) and an `authSigner` is configured, we sign a
//   kind-22242 event with tags `relay` and `challenge`, send ["AUTH", e], wait
//   for its OK and then retry the write/REQ once on the same connection. We
//   authenticate lazily (only when asked) so the relay learns no more than it
//   needs; a write is signed by the same key anyway.
// - Retries with exponential backoff and jitter for transient failures:
//   connection errors, timeouts, the socket closing before OK, and OK messages
//   with the NIP-01 `rate-limited:` or `error:` prefixes. Permanent rejections
//   (`invalid:`, `blocked:`, `pow:`, `restricted:`, `auth-required:` after a
//   failed AUTH) are not retried.
//
// Proxy: Node's global WebSocket goes through the same undici global dispatcher
// as fetch, so NODE_USE_ENV_PROXY=1 (set by the `sync` npm script) makes it use
// HTTPS_PROXY/NO_PROXY. Checked on Node 22.22.0: with an unreachable proxy,
// both fetch and WebSocket fail only when NODE_USE_ENV_PROXY=1 is set.

import type { Signer } from './event.ts';
import type { SignedEvent } from './types.ts';

export type WebSocketCtor = new (url: string) => WebSocket;

export const KIND_CLIENT_AUTH = 22242;

export interface RelayOptions {
  /** Per-step timeout: connect, OK, EOSE, AUTH challenge (default 10 s). */
  timeoutMs?: number;
  WebSocket?: WebSocketCtor;
  /** Signer for NIP-42 AUTH. Without one, `auth-required:` is a permanent failure. */
  authSigner?: Signer;
  /** Extra attempts after the first for transient failures (default 2). */
  retries?: number;
  /** First backoff delay; doubles per attempt, with jitter (default 1000 ms). */
  backoffMs?: number;
  /** Upper bound for one backoff delay (default 15 s). */
  maxBackoffMs?: number;
  /** Injected for tests. */
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

export interface PublishResult {
  relay: string;
  ok: boolean;
  message: string;
  /** Number of connection attempts made (absent when nothing was sent). */
  attempts?: number;
  /** True when the relay asked for NIP-42 AUTH and accepted ours. */
  authenticated?: boolean;
}

class TransientError extends Error {}

function assertRelayUrl(url: string): void {
  const u = new URL(url);
  if (u.protocol !== 'wss:' && u.protocol !== 'ws:') throw new Error(`relay URL must be ws:// or wss://: ${url}`);
}

const prefixOf = (message: string) => /^([a-z-]+):/.exec(message)?.[1] ?? '';
const TRANSIENT_PREFIXES = new Set(['rate-limited', 'error']);

export function backoffDelay(attempt: number, opts: RelayOptions): number {
  const base = opts.backoffMs ?? 1000;
  const cap = opts.maxBackoffMs ?? 15_000;
  const exp = Math.min(cap, base * 2 ** attempt);
  const r = (opts.random ?? Math.random)();
  return Math.round(exp / 2 + (r * exp) / 2); // "equal jitter"
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** One WebSocket connection with message routing and NIP-42 state. */
class RelayConnection {
  readonly url: string;
  private ws!: WebSocket;
  private readonly opts: RelayOptions;
  private challenge: string | undefined;
  private challengeWaiters: ((c: string) => void)[] = [];
  private handlers = new Set<(msg: unknown[]) => void>();
  private closeHandlers = new Set<() => void>();
  closed = false;
  authenticated = false;

  private constructor(url: string, opts: RelayOptions) {
    this.url = url;
    this.opts = opts;
  }

  static async open(url: string, opts: RelayOptions): Promise<RelayConnection> {
    assertRelayUrl(url);
    const WS = opts.WebSocket ?? (globalThis.WebSocket as WebSocketCtor | undefined);
    if (!WS) throw new Error('no WebSocket implementation available');
    const c = new RelayConnection(url, opts);
    await new Promise<void>((resolve, reject) => {
      let ws: WebSocket;
      try {
        ws = new WS(url);
      } catch (err) {
        reject(new TransientError(`connection error: ${(err as Error).message}`));
        return;
      }
      c.ws = ws;
      const timer = setTimeout(() => {
        ws.close();
        reject(new TransientError('connect timeout'));
      }, opts.timeoutMs ?? 10_000);
      ws.addEventListener('open', () => {
        clearTimeout(timer);
        resolve();
      });
      ws.addEventListener('error', () => {
        clearTimeout(timer);
        reject(new TransientError('connection error'));
      });
      ws.addEventListener('close', () => {
        clearTimeout(timer);
        c.closed = true;
        for (const h of [...c.closeHandlers]) h();
        reject(new TransientError('connection closed'));
      });
      ws.addEventListener('message', (m: MessageEvent) => {
        let msg: unknown;
        try {
          msg = JSON.parse(String(m.data));
        } catch {
          return;
        }
        if (!Array.isArray(msg)) return;
        if (msg[0] === 'AUTH' && typeof msg[1] === 'string') {
          c.challenge = msg[1];
          for (const w of c.challengeWaiters.splice(0)) w(msg[1]);
          return;
        }
        for (const h of [...c.handlers]) h(msg);
      });
    });
    return c;
  }

  send(msg: unknown): void {
    this.ws.send(JSON.stringify(msg));
  }

  close(): void {
    try {
      this.ws.close();
    } catch {
      /* ignore */
    }
  }

  /** Wait for the first message `pick` accepts, or reject on close/timeout. */
  waitFor<T>(pick: (msg: unknown[]) => T | undefined, what: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        this.handlers.delete(onMsg);
        this.closeHandlers.delete(onClose);
      };
      const onMsg = (msg: unknown[]) => {
        const v = pick(msg);
        if (v !== undefined) {
          cleanup();
          resolve(v);
        }
      };
      const onClose = () => {
        cleanup();
        reject(new TransientError(`connection closed before ${what}`));
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new TransientError(`timeout waiting for ${what}`));
      }, this.opts.timeoutMs ?? 10_000);
      if (this.closed) return onClose();
      this.handlers.add(onMsg);
      this.closeHandlers.add(onClose);
    });
  }

  private async getChallenge(): Promise<string> {
    if (this.challenge !== undefined) return this.challenge;
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('relay asked for auth but sent no AUTH challenge')), this.opts.timeoutMs ?? 10_000);
      this.challengeWaiters.push((c) => {
        clearTimeout(timer);
        resolve(c);
      });
    });
  }

  /** NIP-42: sign and send a kind-22242 event for the current challenge. */
  async authenticate(): Promise<{ ok: boolean; message: string }> {
    const signer = this.opts.authSigner;
    if (!signer) return { ok: false, message: 'relay requires NIP-42 auth and no auth signer is configured' };
    const challenge = await this.getChallenge();
    const auth = await signer.signEvent({
      kind: KIND_CLIENT_AUTH,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['relay', this.url],
        ['challenge', challenge],
      ],
      content: '',
    });
    const reply = this.waitFor((m) => (m[0] === 'OK' && m[1] === auth.id ? { ok: m[2] === true, message: String(m[3] ?? '') } : undefined), 'AUTH OK');
    this.send(['AUTH', auth]);
    const r = await reply;
    this.authenticated = r.ok;
    return r;
  }

  /** EVENT -> OK, with one AUTH-and-retry on `auth-required:`. */
  async sendEvent(event: SignedEvent): Promise<{ ok: boolean; message: string }> {
    const once = () => {
      const reply = this.waitFor((m) => (m[0] === 'OK' && m[1] === event.id ? { ok: m[2] === true, message: String(m[3] ?? '') } : undefined), 'OK');
      this.send(['EVENT', event]);
      return reply;
    };
    let r = await once();
    if (!r.ok && prefixOf(r.message) === 'auth-required' && !this.authenticated) {
      const a = await this.authenticate();
      if (!a.ok) return { ok: false, message: `auth-required: AUTH rejected (${a.message || r.message})` };
      r = await once();
    }
    return r;
  }

  /** REQ -> EVENT* EOSE, with one AUTH-and-retry on `CLOSED auth-required:`. */
  async req(filter: Record<string, unknown>): Promise<SignedEvent[]> {
    const run = async (): Promise<{ events: SignedEvent[]; closed?: string }> => {
      const sub = `mfb-${Math.random().toString(36).slice(2, 10)}`;
      const events: SignedEvent[] = [];
      const end = this.waitFor<{ closed?: string }>((m) => {
        if (m[1] !== sub) return undefined;
        if (m[0] === 'EVENT' && m[2] && typeof m[2] === 'object') events.push(m[2] as SignedEvent);
        else if (m[0] === 'EOSE') return {};
        else if (m[0] === 'CLOSED') return { closed: String(m[2] ?? '') };
        return undefined;
      }, 'EOSE');
      this.send(['REQ', sub, filter]);
      const r = await end;
      if (r.closed === undefined && !this.closed) this.send(['CLOSE', sub]);
      return { events, closed: r.closed };
    };
    let r = await run();
    if (r.closed !== undefined && prefixOf(r.closed) === 'auth-required' && !this.authenticated) {
      const a = await this.authenticate();
      if (!a.ok) throw new Error(`auth-required: AUTH rejected (${a.message})`);
      r = await run();
    }
    if (r.closed !== undefined) {
      const err = TRANSIENT_PREFIXES.has(prefixOf(r.closed)) ? TransientError : Error;
      throw new err(`subscription closed: ${r.closed}`);
    }
    return r.events;
  }
}

async function withRetries<T>(opts: RelayOptions, fn: (attempt: number) => Promise<T>, isTransientResult?: (r: T) => boolean): Promise<{ value: T; attempts: number }> {
  const retries = Math.max(0, opts.retries ?? 2);
  const sleep = opts.sleep ?? defaultSleep;
  for (let attempt = 0; ; attempt++) {
    try {
      const value = await fn(attempt);
      if (attempt < retries && isTransientResult?.(value)) {
        await sleep(backoffDelay(attempt, opts));
        continue;
      }
      return { value, attempts: attempt + 1 };
    } catch (err) {
      if (!(err instanceof TransientError) || attempt >= retries) throw Object.assign(err as Error, { attempts: attempt + 1 });
      await sleep(backoffDelay(attempt, opts));
    }
  }
}

/** Send ["EVENT", e] and wait for the relay's ["OK", id, accepted, message], retrying transient failures. */
export async function publishToRelay(relay: string, event: SignedEvent, opts: RelayOptions = {}): Promise<PublishResult> {
  let authenticated = false;
  try {
    const { value, attempts } = await withRetries(
      opts,
      async () => {
        const c = await RelayConnection.open(relay, opts);
        try {
          const r = await c.sendEvent(event);
          authenticated ||= c.authenticated;
          return r;
        } finally {
          c.close();
        }
      },
      (r) => !r.ok && TRANSIENT_PREFIXES.has(prefixOf(r.message)),
    );
    const res: PublishResult = { relay, ok: value.ok, message: value.message, attempts };
    if (authenticated) res.authenticated = true;
    return res;
  } catch (err) {
    const res: PublishResult = { relay, ok: false, message: (err as Error).message, attempts: (err as { attempts?: number }).attempts };
    if (authenticated) res.authenticated = true;
    return res;
  }
}

export async function publish(relays: string[], event: SignedEvent, opts: RelayOptions = {}): Promise<PublishResult[]> {
  return Promise.all(relays.map((r) => publishToRelay(r, event, opts)));
}

/** One-shot REQ: collect stored events until EOSE, then CLOSE. Retries transient failures; throws otherwise. */
export async function query(relay: string, filter: Record<string, unknown>, opts: RelayOptions = {}): Promise<SignedEvent[]> {
  const { value } = await withRetries(opts, async () => {
    const c = await RelayConnection.open(relay, opts);
    try {
      return await c.req(filter);
    } finally {
      c.close();
    }
  });
  return value;
}
