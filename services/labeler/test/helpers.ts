// Offline test doubles: deterministic keys, an in-memory NIP-01 relay network
// (EVENT/OK, REQ/EOSE with tag filters, NIP-09 deletions) reached through a fake
// WebSocket, and a fake NIP-46 bunker. Nothing here touches the network; no test
// publishes to a public relay.

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { finalizeEvent, getPublicKey } from 'nostr-tools/pure';
import { decrypt, encrypt, getConversationKey } from 'nostr-tools/nip44';
import { buildReport, verifyNostrEvent } from '../../../packages/moderation/src/index.ts';
import type { EventTemplate, NostrEvent, ReportTarget, ReportType } from '../../../packages/moderation/src/index.ts';
import { parseConfig } from '../src/config.ts';
import type { LabelerConfig } from '../src/config.ts';

export const hexKey = (n: number) => n.toString(16).padStart(64, '0');
export const skBytes = (hex: string) => Uint8Array.from(hex.match(/../g)!.map((h) => parseInt(h, 16)));

export interface Keypair {
  hex: string;
  sk: Uint8Array;
  pk: string;
}
export function keypair(n: number): Keypair {
  const hex = hexKey(n);
  const sk = skBytes(hex);
  return { hex, sk, pk: getPublicKey(sk) };
}

export function sign(t: EventTemplate, k: Keypair): NostrEvent {
  return finalizeEvent({ ...t, tags: t.tags.map((x) => [...x]) }, k.sk) as NostrEvent;
}

export const LABELER = keypair(0x1abe1);
export const NOW = Math.floor(Date.parse('2026-10-19T12:00:00Z') / 1000);
export const VIDEO_URL = 'https://tube.example/videos/watch/11111111-1111-1111-1111-111111111111';
export const RELAY = 'wss://labels.test';
export const INTAKE = 'wss://reports.test';

export function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'labeler-test-'));
}

export function config(over: Record<string, unknown> = {}): LabelerConfig {
  return parseConfig({ v: 1, labeler: LABELER.pk, publishRelays: [RELAY], intakeRelays: [INTAKE], store: ':memory:', ...over });
}

/** A NIP-56 report built by packages/moderation, addressed to the labeler with an extra typeless p tag. */
export function report(reporter: Keypair, target: ReportTarget, type: ReportType, opts: { createdAt?: number; content?: string; address?: boolean } = {}): NostrEvent {
  const t = buildReport(target, type, { createdAt: opts.createdAt ?? NOW - 60, content: opts.content ?? '' });
  if (opts.address !== false) t.tags.push(['p', LABELER.pk]);
  return sign(t, reporter);
}

// ---------------------------------------------------------------- relays

type Filter = Record<string, unknown>;

function matches(e: NostrEvent, f: Filter): boolean {
  if (Array.isArray(f.ids) && !f.ids.includes(e.id)) return false;
  if (Array.isArray(f.kinds) && !f.kinds.includes(e.kind)) return false;
  if (Array.isArray(f.authors) && !f.authors.includes(e.pubkey)) return false;
  if (typeof f.since === 'number' && e.created_at < f.since) return false;
  if (typeof f.until === 'number' && e.created_at > f.until) return false;
  for (const [k, v] of Object.entries(f)) {
    if (!k.startsWith('#') || !Array.isArray(v)) continue;
    if (!e.tags.some((t) => t[0] === k.slice(1) && v.includes(t[1]))) return false;
  }
  return true;
}

/** In-memory relays by URL. */
export class MemoryRelays {
  stored = new Map<string, NostrEvent[]>();
  received: { url: string; msg: unknown[] }[] = [];
  /** Relays that delete events named by a kind-5 from the same author (most do). */
  honorDeletions = true;
  /** URLs that refuse every EVENT. */
  rejecting = new Set<string>();
  /** URLs that fail to connect. */
  down = new Set<string>();

  add(url: string, ...events: NostrEvent[]) {
    this.stored.set(url, [...(this.stored.get(url) ?? []), ...events]);
  }
  events(url: string): NostrEvent[] {
    return this.stored.get(url) ?? [];
  }
  sent(kind?: number): NostrEvent[] {
    return this.received.filter((r) => r.msg[0] === 'EVENT' && (kind === undefined || (r.msg[1] as NostrEvent).kind === kind)).map((r) => r.msg[1] as NostrEvent);
  }

  ctor(): new (url: string) => WebSocket {
    const net = this;
    class MemorySocket extends EventTarget {
      readonly url: string;
      private closed = false;
      constructor(url: string) {
        super();
        this.url = url;
        queueMicrotask(() => {
          if (net.down.has(url)) {
            this.dispatchEvent(new Event('error'));
            this.close();
            return;
          }
          this.dispatchEvent(new Event('open'));
        });
      }
      private reply(msg: unknown[]) {
        queueMicrotask(() => {
          if (!this.closed) this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(msg) }));
        });
      }
      send(data: string) {
        const msg = JSON.parse(data) as unknown[];
        net.received.push({ url: this.url, msg });
        if (msg[0] === 'EVENT') {
          const e = msg[1] as NostrEvent;
          if (!verifyNostrEvent(e)) return this.reply(['OK', e?.id, false, 'invalid: bad signature']);
          if (net.rejecting.has(this.url)) return this.reply(['OK', e.id, false, 'blocked: test relay refuses']);
          let list = net.events(this.url);
          if (e.kind === 5 && net.honorDeletions) {
            const ids = new Set(e.tags.filter((t) => t[0] === 'e').map((t) => t[1]));
            list = list.filter((x) => !(ids.has(x.id) && x.pubkey === e.pubkey));
          }
          if (!list.some((x) => x.id === e.id)) list = [...list, e];
          net.stored.set(this.url, list);
          return this.reply(['OK', e.id, true, '']);
        }
        if (msg[0] === 'REQ') {
          const [, sub, ...filters] = msg as [string, string, ...Filter[]];
          let out = net.events(this.url).filter((e) => filters.some((f) => matches(e, f)));
          const limit = filters[0]?.limit;
          if (typeof limit === 'number') out = out.slice(-limit);
          for (const e of out) this.reply(['EVENT', sub, e]);
          this.reply(['EOSE', sub]);
        }
      }
      close() {
        if (this.closed) return;
        this.closed = true;
        queueMicrotask(() => this.dispatchEvent(new Event('close')));
      }
    }
    return MemorySocket as unknown as new (url: string) => WebSocket;
  }
}

// ---------------------------------------------------------------- bunker

interface PoolSub {
  filter: Filter;
  onevent: (e: NostrEvent) => void;
}

/** A NIP-46 remote signer reached through a fake nostr-tools pool (the surface BunkerSigner uses). */
export class FakeBunker {
  readonly remoteSk: Uint8Array;
  readonly remotePubkey: string;
  userSk: Uint8Array;
  secret: string | null;
  methods: string[] = [];
  private subs = new Set<PoolSub>();

  constructor(remote: Keypair, user: Keypair, secret: string | null = 'sekret') {
    this.remoteSk = remote.sk;
    this.remotePubkey = remote.pk;
    this.userSk = user.sk;
    this.secret = secret;
  }
  url(): string {
    return `bunker://${this.remotePubkey}?relay=${encodeURIComponent('wss://bunker-relay.test')}` + (this.secret ? `&secret=${this.secret}` : '');
  }
  subscribe(_relays: string[], filter: Filter, params: { onevent?: (e: NostrEvent) => void }) {
    const sub: PoolSub = { filter, onevent: params.onevent ?? (() => {}) };
    this.subs.add(sub);
    return { close: () => void this.subs.delete(sub) };
  }
  publish(_relays: string[], event: NostrEvent): Promise<string>[] {
    queueMicrotask(() => this.handle(event));
    return [Promise.resolve('')];
  }
  destroy() {}

  private handle(req: NostrEvent) {
    if (req.kind !== 24133 || !req.tags.some((t) => t[0] === 'p' && t[1] === this.remotePubkey)) return;
    const ck = getConversationKey(this.remoteSk, req.pubkey);
    const { id, method, params } = JSON.parse(decrypt(req.content, ck)) as { id: string; method: string; params: string[] };
    this.methods.push(method);
    let result: string | undefined;
    let error: string | undefined;
    if (method === 'connect') {
      if (params[0] !== this.remotePubkey) error = 'wrong remote pubkey';
      else if (this.secret && params[1] !== this.secret) error = 'invalid secret';
      else result = 'ack';
    } else if (method === 'get_public_key') result = getPublicKey(this.userSk);
    else if (method === 'sign_event') result = JSON.stringify(finalizeEvent(JSON.parse(params[0]), this.userSk));
    else error = `unsupported method ${method}`;
    const resp = finalizeEvent(
      { kind: 24133, created_at: Math.floor(Date.now() / 1000), tags: [['p', req.pubkey]], content: encrypt(JSON.stringify({ id, result, error }), ck) },
      this.remoteSk,
    ) as NostrEvent;
    for (const s of this.subs) if (matches(resp, s.filter)) s.onevent(resp);
  }
}
