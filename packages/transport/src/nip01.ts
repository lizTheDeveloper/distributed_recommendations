// One NIP-01 connection to one relay: EVENT/OK, REQ/EVENT/EOSE/CLOSED, CLOSE.
// Shared by the gateway target's upstream client (`upstream.ts`) and the direct
// live client (`live.ts`). No NIP-42 AUTH here: the target must never authenticate
// as a user, and the live client leaves AUTH to the app (docs/TRANSPORT.md).

import type { NostrEvent, QueryFilter } from './protocol.ts';
import { MAX_EVENT_BYTES, eventBytes, isEvent } from './protocol.ts';

/** The subset of the WHATWG `WebSocket` both Node 22's global and `ws` provide. */
export interface SocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(): void;
  onopen: ((ev?: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev?: unknown) => void) | null;
  onerror: ((ev?: unknown) => void) | null;
}

export type SocketFactory = (url: string) => SocketLike;

export const defaultSocketFactory: SocketFactory = (url) => {
  const WS = (globalThis as { WebSocket?: new (u: string) => unknown }).WebSocket;
  if (!WS) throw new Error('no global WebSocket: pass a socket factory');
  return new WS(url) as SocketLike;
};

const OPEN = 1;
/** A relay message can carry one event of up to 64 KiB plus framing. */
const MAX_MESSAGE_CHARS = 2 * MAX_EVENT_BYTES + 4_096;

export interface SubHandlers {
  onEvent(e: NostrEvent): void;
  onEose?(): void;
  /** The relay closed the subscription, or the connection dropped. */
  onClosed?(reason: string): void;
}

function randomSubId(): string {
  const b = new Uint8Array(8);
  globalThis.crypto.getRandomValues(b);
  return 's' + [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

export class RelayConnection {
  readonly url: string;
  private ws: SocketLike | null = null;
  private opening: Promise<void> | null = null;
  private readonly okWaiters = new Map<string, (r: { ok: boolean; message: string }) => void>();
  private readonly subs = new Map<string, SubHandlers>();
  private readonly socket: SocketFactory;
  private readonly timeoutMs: number;
  /** Called once per drop of an open connection. */
  onDisconnect: (() => void) | null = null;

  constructor(url: string, opts: { socket?: SocketFactory; timeoutMs?: number } = {}) {
    this.url = url;
    this.socket = opts.socket ?? defaultSocketFactory;
    this.timeoutMs = opts.timeoutMs ?? 8_000;
  }

  get isOpen(): boolean {
    return this.ws !== null && this.ws.readyState === OPEN;
  }

  open(): Promise<void> {
    if (this.isOpen) return Promise.resolve();
    if (this.opening) return this.opening;
    this.opening = new Promise<void>((resolve, reject) => {
      let settled = false;
      let sock: SocketLike;
      const done = (err?: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (err) reject(new Error(err));
        else resolve();
      };
      const timer = setTimeout(() => {
        done('timed out connecting');
        try {
          sock?.close();
        } catch {
          /* ignore */
        }
      }, this.timeoutMs);
      try {
        sock = this.socket(this.url);
      } catch (e) {
        done((e as Error).message || 'could not connect');
        return;
      }
      sock.onopen = () => {
        this.ws = sock;
        done();
      };
      sock.onerror = () => done('connection failed');
      sock.onclose = () => {
        done('connection closed');
        const wasOpen = this.ws === sock;
        if (wasOpen) this.ws = null;
        for (const w of this.okWaiters.values()) w({ ok: false, message: 'error: connection closed' });
        this.okWaiters.clear();
        const subs = [...this.subs.values()];
        this.subs.clear();
        for (const s of subs) s.onClosed?.('error: connection closed');
        if (wasOpen) this.onDisconnect?.();
      };
      sock.onmessage = (ev) => this.handle(ev.data);
    }).finally(() => {
      this.opening = null;
    });
    return this.opening;
  }

  private send(msg: unknown[]): void {
    if (!this.ws || this.ws.readyState !== OPEN) throw new Error('not connected');
    this.ws.send(JSON.stringify(msg));
  }

  private handle(data: unknown): void {
    if (typeof data !== 'string' || data.length > MAX_MESSAGE_CHARS) return;
    let msg: unknown;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }
    if (!Array.isArray(msg) || typeof msg[0] !== 'string') return;
    switch (msg[0]) {
      case 'EVENT': {
        const sub = typeof msg[1] === 'string' ? this.subs.get(msg[1]) : undefined;
        if (sub && isEvent(msg[2]) && eventBytes(msg[2]) <= MAX_EVENT_BYTES) sub.onEvent(msg[2]);
        break;
      }
      case 'EOSE': {
        if (typeof msg[1] === 'string') this.subs.get(msg[1])?.onEose?.();
        break;
      }
      case 'CLOSED': {
        if (typeof msg[1] === 'string') {
          const sub = this.subs.get(msg[1]);
          this.subs.delete(msg[1]);
          sub?.onClosed?.(String(msg[2] ?? ''));
        }
        break;
      }
      case 'OK': {
        const w = typeof msg[1] === 'string' ? this.okWaiters.get(msg[1]) : undefined;
        if (w) {
          this.okWaiters.delete(msg[1] as string);
          w({ ok: msg[2] === true, message: typeof msg[3] === 'string' ? msg[3].slice(0, 300) : '' });
        }
        break;
      }
      default:
        break; // NOTICE, AUTH and anything else: ignored
    }
  }

  /** EVENT → OK. Never throws; failures come back as `{ok: false}`. */
  async publish(ev: NostrEvent): Promise<{ ok: boolean; message: string }> {
    try {
      await this.open();
    } catch (e) {
      return { ok: false, message: `error: ${(e as Error).message}` };
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.okWaiters.delete(ev.id);
        resolve({ ok: false, message: 'error: no OK from relay (timed out)' });
      }, this.timeoutMs);
      this.okWaiters.set(ev.id, (r) => {
        clearTimeout(timer);
        resolve(r);
      });
      try {
        this.send(['EVENT', ev]);
      } catch (e) {
        this.okWaiters.delete(ev.id);
        clearTimeout(timer);
        resolve({ ok: false, message: `error: ${(e as Error).message}` });
      }
    });
  }

  /** Open a subscription. Returns a function that sends CLOSE. The connection must be open. */
  subscribe(filter: QueryFilter, h: SubHandlers): () => void {
    const id = randomSubId();
    this.subs.set(id, h);
    try {
      this.send(['REQ', id, filter]);
    } catch (e) {
      this.subs.delete(id);
      queueMicrotask(() => h.onClosed?.(`error: ${(e as Error).message}`));
    }
    return () => {
      if (!this.subs.delete(id)) return;
      try {
        this.send(['CLOSE', id]);
      } catch {
        /* connection gone */
      }
    };
  }

  /** REQ until EOSE (or CLOSED / timeout), then CLOSE. Rejects only when it never connected. */
  async query(filter: QueryFilter): Promise<{ events: NostrEvent[]; complete: boolean; closed?: string }> {
    await this.open();
    return new Promise((resolve) => {
      const events: NostrEvent[] = [];
      let finished = false;
      const finish = (complete: boolean, closed?: string) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        stop();
        resolve({ events, complete, ...(closed !== undefined ? { closed } : {}) });
      };
      const timer = setTimeout(() => finish(false), this.timeoutMs);
      const stop = this.subscribe(filter, {
        onEvent: (e) => events.push(e),
        onEose: () => finish(true),
        onClosed: (reason) => finish(false, reason),
      });
    });
  }

  close(): void {
    const ws = this.ws;
    this.ws = null;
    try {
      ws?.close();
    } catch {
      /* ignore */
    }
  }
}
