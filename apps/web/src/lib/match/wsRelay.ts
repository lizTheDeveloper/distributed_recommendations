// A `RelayLike` (packages/match) over real Nostr relays: NIP-01 EVENT / REQ / CLOSE
// over WebSockets, with NIP-42 AUTH when a relay asks for it.
//
// - publish: sends to every configured relay, waits for each one's OK; succeeds if
//   any relay stored the event.
// - query: one REQ per relay, collects until EOSE (or CLOSED / timeout), sends CLOSE,
//   merges and de-duplicates by id, and re-checks the filter locally.
// - AUTH: only on demand. A relay that answers `auth-required:` (in OK or CLOSED)
//   gets a kind-22242 event signed by `authSigner` for its last challenge, and the
//   publish or REQ is retried once. Authenticating tells that relay which key you
//   are, so it never happens unless the relay requires it.
// - Size: events over 64 KiB are refused before sending and ignored when received.
//
// The socket is injectable (`socket`), so tests drive a fake relay without a network.

import type { NostrSigner, RelayFilter, RelayLike, SignedEvent } from "./pkg.ts";
import { MAX_EVENT_BYTES, eventBytes } from "./pkg.ts";

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

export type RelayState = "idle" | "connecting" | "open" | "closed" | "error";

export interface RelayStatus {
  url: string;
  state: RelayState;
  message?: string;
  authed: boolean;
  lastOkAt?: number;
}

export interface WsRelayOptions {
  urls: readonly string[];
  /** Default: the browser's `WebSocket`. */
  socket?: SocketFactory;
  /** Signs NIP-42 AUTH events, only when a relay requires it. */
  authSigner?: () => NostrSigner | null;
  /** Per-operation timeout. Default 8 s. */
  timeoutMs?: number;
  now?: () => Date;
  onStatus?: (s: RelayStatus) => void;
}

const OPEN = 1;
const MAX_MESSAGE_CHARS = 256 * 1024;
const HEX64 = /^[0-9a-f]{64}$/;

function isEvent(x: unknown): x is SignedEvent {
  if (typeof x !== "object" || x === null) return false;
  const e = x as Record<string, unknown>;
  return (
    typeof e.id === "string" &&
    HEX64.test(e.id) &&
    typeof e.pubkey === "string" &&
    HEX64.test(e.pubkey) &&
    typeof e.sig === "string" &&
    /^[0-9a-f]{128}$/.test(e.sig) &&
    Number.isInteger(e.kind) &&
    Number.isInteger(e.created_at) &&
    typeof e.content === "string" &&
    Array.isArray(e.tags) &&
    e.tags.every((t) => Array.isArray(t) && t.every((v) => typeof v === "string"))
  );
}

/** NIP-01 filter match for the fields `RelayFilter` has. */
export function matchesFilter(e: SignedEvent, f: RelayFilter): boolean {
  if (f.kinds && !f.kinds.includes(e.kind)) return false;
  if (f["#p"] && !e.tags.some((t) => t[0] === "p" && f["#p"]!.includes(t[1]))) return false;
  if (f.since !== undefined && e.created_at < f.since) return false;
  if (f.until !== undefined && e.created_at > f.until) return false;
  return true;
}

function randomSubId(): string {
  const b = new Uint8Array(8);
  globalThis.crypto.getRandomValues(b);
  return "mf-" + [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

interface Sub {
  events: SignedEvent[];
  finish: (closedReason?: string) => void;
}

class Conn {
  ws: SocketLike | null = null;
  private opening: Promise<void> | null = null;
  private challenge: string | null = null;
  private challengeWaiters: (() => void)[] = [];
  private readonly okWaiters = new Map<string, (r: { ok: boolean; message: string }) => void>();
  private readonly subs = new Map<string, Sub>();
  readonly status: RelayStatus;
  readonly url: string;
  private readonly opts: WsRelayOptions;

  constructor(url: string, opts: WsRelayOptions) {
    this.url = url;
    this.opts = opts;
    this.status = { url, state: "idle", authed: false };
  }

  private get timeout() {
    return this.opts.timeoutMs ?? 8000;
  }

  private setStatus(state: RelayState, message?: string) {
    this.status.state = state;
    this.status.message = message;
    this.opts.onStatus?.({ ...this.status });
  }

  open(): Promise<void> {
    if (this.ws && this.ws.readyState === OPEN) return Promise.resolve();
    if (this.opening) return this.opening;
    this.setStatus("connecting");
    this.opening = new Promise<void>((resolve, reject) => {
      let settled = false;
      const done = (err?: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (err) {
          this.setStatus("error", err);
          reject(new Error(err));
        } else resolve();
      };
      const timer = setTimeout(() => {
        done("timed out connecting");
        try {
          ws?.close();
        } catch {
          /* ignore */
        }
      }, this.timeout);
      let ws: SocketLike | undefined;
      try {
        ws = (this.opts.socket ?? ((u: string) => new WebSocket(u) as unknown as SocketLike))(this.url);
      } catch (e) {
        done(e instanceof Error ? e.message : "couldn't open a connection");
        return;
      }
      const sock = ws;
      sock.onopen = () => {
        this.ws = sock;
        this.setStatus("open");
        done();
      };
      sock.onerror = () => done("connection failed");
      sock.onclose = () => {
        done("connection closed");
        if (this.ws === sock) this.ws = null;
        this.challenge = null;
        this.status.authed = false;
        if (this.status.state !== "error") this.setStatus("closed");
        for (const w of this.okWaiters.values()) w({ ok: false, message: "error: connection closed" });
        this.okWaiters.clear();
        for (const s of this.subs.values()) s.finish("error: connection closed");
        this.subs.clear();
      };
      sock.onmessage = (ev) => this.handle(ev.data);
    }).finally(() => {
      this.opening = null;
    });
    return this.opening;
  }

  private send(msg: unknown[]) {
    if (!this.ws || this.ws.readyState !== OPEN) throw new Error("not connected");
    this.ws.send(JSON.stringify(msg));
  }

  private handle(data: unknown) {
    if (typeof data !== "string" || data.length > MAX_MESSAGE_CHARS) return;
    let msg: unknown;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }
    if (!Array.isArray(msg) || typeof msg[0] !== "string") return;
    switch (msg[0]) {
      case "EVENT": {
        const sub = typeof msg[1] === "string" ? this.subs.get(msg[1]) : undefined;
        if (sub && isEvent(msg[2]) && eventBytes(msg[2]) <= MAX_EVENT_BYTES) sub.events.push(msg[2]);
        break;
      }
      case "EOSE": {
        if (typeof msg[1] === "string") this.subs.get(msg[1])?.finish();
        break;
      }
      case "CLOSED": {
        if (typeof msg[1] === "string") this.subs.get(msg[1])?.finish(String(msg[2] ?? ""));
        break;
      }
      case "OK": {
        const w = typeof msg[1] === "string" ? this.okWaiters.get(msg[1]) : undefined;
        if (w) {
          this.okWaiters.delete(msg[1] as string);
          w({ ok: msg[2] === true, message: typeof msg[3] === "string" ? msg[3] : "" });
        }
        break;
      }
      case "AUTH": {
        if (typeof msg[1] === "string" && msg[1].length <= 512) {
          this.challenge = msg[1];
          this.status.authed = false;
          for (const w of this.challengeWaiters.splice(0)) w();
        }
        break;
      }
      default:
        break; // NOTICE and anything else: ignored
    }
  }

  private waitOk(id: string): Promise<{ ok: boolean; message: string }> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.okWaiters.delete(id);
        resolve({ ok: false, message: "error: no OK from relay (timed out)" });
      }, this.timeout);
      this.okWaiters.set(id, (r) => {
        clearTimeout(timer);
        resolve(r);
      });
    });
  }

  private waitChallenge(ms: number): Promise<void> {
    if (this.challenge) return Promise.resolve();
    return new Promise((resolve) => {
      const t = setTimeout(resolve, ms);
      this.challengeWaiters.push(() => {
        clearTimeout(t);
        resolve();
      });
    });
  }

  /** NIP-42: answer the relay's challenge. Returns whether the relay accepted it. */
  async auth(): Promise<boolean> {
    const signer = this.opts.authSigner?.();
    if (!signer) return false;
    await this.waitChallenge(1500);
    if (!this.challenge) return false;
    const now = Math.floor((this.opts.now?.() ?? new Date()).getTime() / 1000);
    const ev = await signer.signEvent({
      kind: 22242,
      created_at: now,
      tags: [
        ["relay", this.url],
        ["challenge", this.challenge],
      ],
      content: "",
    });
    const wait = this.waitOk(ev.id);
    this.send(["AUTH", ev]);
    const r = await wait;
    this.status.authed = r.ok;
    this.opts.onStatus?.({ ...this.status });
    return r.ok;
  }

  async publish(ev: SignedEvent): Promise<{ ok: boolean; message: string }> {
    await this.open();
    const once = async () => {
      const wait = this.waitOk(ev.id);
      this.send(["EVENT", ev]);
      return wait;
    };
    let r = await once();
    if (!r.ok && r.message.startsWith("auth-required") && (await this.auth())) r = await once();
    if (r.ok) this.status.lastOkAt = Date.now();
    return r;
  }

  async query(filter: RelayFilter): Promise<SignedEvent[]> {
    await this.open();
    const run = (): Promise<{ events: SignedEvent[]; closed?: string }> =>
      new Promise((resolve) => {
        const subId = randomSubId();
        let finished = false;
        const sub: Sub = {
          events: [],
          finish: (closed) => {
            if (finished) return;
            finished = true;
            clearTimeout(timer);
            this.subs.delete(subId);
            if (closed === undefined) {
              try {
                this.send(["CLOSE", subId]);
              } catch {
                /* connection gone */
              }
            }
            resolve({ events: sub.events, closed });
          },
        };
        const timer = setTimeout(() => sub.finish(), this.timeout);
        this.subs.set(subId, sub);
        try {
          this.send(["REQ", subId, filter]);
        } catch {
          sub.finish("error: not connected");
        }
      });
    let r = await run();
    if (r.closed?.startsWith("auth-required") && (await this.auth())) r = await run();
    if (r.closed && r.closed.startsWith("error")) throw new Error(r.closed);
    if (r.closed === undefined) this.status.lastOkAt = Date.now();
    return r.events;
  }

  close() {
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
    this.ws = null;
  }
}

export class WsRelay implements RelayLike {
  private readonly conns: Conn[];

  constructor(opts: WsRelayOptions) {
    this.conns = [...new Set(opts.urls)].map((u) => new Conn(u, opts));
  }

  get urls(): string[] {
    return this.conns.map((c) => c.url);
  }

  statuses(): RelayStatus[] {
    return this.conns.map((c) => ({ ...c.status }));
  }

  async publish(event: SignedEvent): Promise<{ ok: boolean; message: string }> {
    if (this.conns.length === 0) return { ok: false, message: "no relays configured" };
    const size = eventBytes(event);
    if (size > MAX_EVENT_BYTES) return { ok: false, message: `invalid: event too large (${size} bytes)` };
    const results = await Promise.all(
      this.conns.map((c) => c.publish(event).catch((e: Error) => ({ ok: false, message: `error: ${e.message}` }))),
    );
    if (results.some((r) => r.ok)) return { ok: true, message: "" };
    return { ok: false, message: results.map((r, i) => `${this.conns[i].url}: ${r.message}`).join("; ") };
  }

  async query(filter: RelayFilter): Promise<SignedEvent[]> {
    const lists = await Promise.all(this.conns.map((c) => c.query(filter).catch(() => null)));
    if (this.conns.length && lists.every((l) => l === null)) throw new Error("no relay answered");
    const byId = new Map<string, SignedEvent>();
    for (const list of lists) for (const e of list ?? []) if (matchesFilter(e, filter) && !byId.has(e.id)) byId.set(e.id, e);
    return [...byId.values()].sort((a, b) => a.created_at - b.created_at || (a.id < b.id ? -1 : 1));
  }

  close(): void {
    for (const c of this.conns) c.close();
  }
}
