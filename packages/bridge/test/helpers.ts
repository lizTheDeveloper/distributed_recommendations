// Offline test doubles: an in-memory NIP-01 relay (with NIP-09 deletion,
// NIP-42 AUTH and failure injection), a mutable fake PeerTube, and a fake
// NIP-46 remote signer reached through a fake nostr-tools pool.

import { readFileSync } from 'node:fs';
import { finalizeEvent, getPublicKey } from 'nostr-tools/pure';
import { decrypt, encrypt, getConversationKey } from 'nostr-tools/nip44';
import { verifySignedEvent } from '../src/nostr-signer.ts';
import type { FetchLike } from '../src/peertube.ts';
import type { PtVideo, SignedEvent } from '../src/types.ts';

export const fx = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));

export const hexKey = (n: number) => n.toString(16).padStart(64, '0');
export const skBytes = (hex: string) => Uint8Array.from(hex.match(/../g)!.map((h) => parseInt(h, 16)));

// ---------------------------------------------------------------- relay

type Filter = Record<string, unknown>;

function matches(e: SignedEvent, f: Filter): boolean {
  if (Array.isArray(f.ids) && !f.ids.includes(e.id)) return false;
  if (Array.isArray(f.kinds) && !f.kinds.includes(e.kind)) return false;
  if (Array.isArray(f.authors) && !f.authors.includes(e.pubkey)) return false;
  for (const [k, v] of Object.entries(f)) {
    if (!k.startsWith('#') || !Array.isArray(v)) continue;
    const name = k.slice(1);
    if (!e.tags.some((t) => t[0] === name && v.includes(t[1]))) return false;
  }
  return true;
}

const dTag = (e: SignedEvent) => e.tags.find((t) => t[0] === 'd')?.[1] ?? '';
const isAddressable = (k: number) => k >= 30000 && k < 40000;

export class FakeRelay {
  readonly url: string;
  events: SignedEvent[] = [];
  /** Every client message, in order. */
  received: unknown[][] = [];
  connections = 0;
  /** Require NIP-42 AUTH for EVENT and REQ. */
  requireAuth = false;
  /** Pubkeys allowed to AUTH (undefined = any). */
  authAllow: string[] | undefined;
  /** Fail the next N connection attempts. */
  failConnects = 0;
  /** Answer the next N EVENTs with `rate-limited:`. */
  rateLimitNext = 0;
  /** Accept sockets but never answer EVENTs (timeouts). */
  silent = false;

  constructor(url = 'wss://relay.test') {
    this.url = url;
  }

  sentEvents(kind?: number): SignedEvent[] {
    return this.received.filter((m) => m[0] === 'EVENT' && (kind === undefined || (m[1] as SignedEvent).kind === kind)).map((m) => m[1] as SignedEvent);
  }

  private store(e: SignedEvent) {
    if (e.kind === 5) {
      for (const t of e.tags) {
        if (t[0] === 'e') this.events = this.events.filter((x) => !(x.id === t[1] && x.pubkey === e.pubkey));
        if (t[0] === 'a') {
          const [k, pk, ...rest] = t[1].split(':');
          const d = rest.join(':');
          if (pk !== e.pubkey) continue;
          this.events = this.events.filter((x) => !(String(x.kind) === k && x.pubkey === pk && dTag(x) === d && x.created_at <= e.created_at));
        }
      }
      this.events.push(e);
      return;
    }
    // NIP-09: an addressable event older than (or as old as) a stored `a` deletion is dropped.
    if (isAddressable(e.kind)) {
      const addr = `${e.kind}:${e.pubkey}:${dTag(e)}`;
      const deletedUpTo = Math.max(
        -1,
        ...this.events.filter((x) => x.kind === 5 && x.pubkey === e.pubkey && x.tags.some((t) => t[0] === 'a' && t[1] === addr)).map((x) => x.created_at),
      );
      if (e.created_at <= deletedUpTo) return;
      const older = this.events.find((x) => x.kind === e.kind && x.pubkey === e.pubkey && dTag(x) === dTag(e));
      if (older && older.created_at > e.created_at) return;
      this.events = this.events.filter((x) => x !== older);
    }
    this.events.push(e);
  }

  socketCtor(): new (url: string) => WebSocket {
    const relay = this;
    return class FakeSocket extends EventTarget {
      readonly OPEN = 1;
      readyState = 0;
      private authed: string[] = [];
      private challenge = `chal-${Math.random().toString(36).slice(2)}`;
      private url: string;
      constructor(url: string) {
        super();
        this.url = url;
        relay.connections++;
        if (relay.failConnects > 0) {
          relay.failConnects--;
          queueMicrotask(() => {
            this.readyState = 3;
            this.dispatchEvent(new Event('error'));
            this.dispatchEvent(new Event('close'));
          });
          return;
        }
        queueMicrotask(() => {
          this.readyState = 1;
          this.dispatchEvent(new Event('open'));
          if (relay.requireAuth) this.reply(['AUTH', this.challenge]);
        });
      }
      private reply(m: unknown) {
        queueMicrotask(() => this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(m) })));
      }
      send(data: string) {
        const msg = JSON.parse(data);
        relay.received.push(msg);
        if (msg[0] === 'AUTH') {
          const e = msg[1] as SignedEvent;
          const tag = (n: string) => e.tags.find((t) => t[0] === n)?.[1];
          let why = '';
          if (!verifySignedEvent(e)) why = 'invalid: bad signature';
          else if (e.kind !== 22242) why = 'invalid: wrong kind';
          else if (tag('challenge') !== this.challenge) why = 'invalid: wrong challenge';
          else if (tag('relay') !== this.url) why = 'invalid: wrong relay';
          else if (Math.abs(e.created_at - Date.now() / 1000) > 600) why = 'invalid: stale';
          else if (relay.authAllow && !relay.authAllow.includes(e.pubkey)) why = 'restricted: not on the allow list';
          if (!why) this.authed.push(e.pubkey);
          this.reply(['OK', e.id, !why, why]);
        } else if (msg[0] === 'EVENT') {
          const e = msg[1] as SignedEvent;
          if (relay.silent) return;
          if (relay.requireAuth && this.authed.length === 0) return this.reply(['OK', e.id, false, 'auth-required: please AUTH']);
          if (relay.rateLimitNext > 0) {
            relay.rateLimitNext--;
            return this.reply(['OK', e.id, false, 'rate-limited: slow down']);
          }
          const ok = verifySignedEvent(e);
          if (ok) relay.store(e);
          this.reply(['OK', e.id, ok, ok ? '' : 'invalid: bad signature']);
        } else if (msg[0] === 'REQ') {
          const [, sub, ...filters] = msg as [string, string, ...Filter[]];
          if (relay.requireAuth && this.authed.length === 0) return this.reply(['CLOSED', sub, 'auth-required: please AUTH']);
          for (const e of relay.events) if (filters.some((f) => matches(e, f))) this.reply(['EVENT', sub, e]);
          this.reply(['EOSE', sub]);
        }
      }
      close() {
        this.readyState = 3;
      }
    } as unknown as new (url: string) => WebSocket;
  }
}

// ---------------------------------------------------------------- PeerTube

export type FakeVideo = PtVideo | { status: number; html?: boolean };

/**
 * A channel whose videos can be changed between runs. The channel listing,
 * like PeerTube's for anonymous users, shows only public, non-blocked videos.
 */
export class FakePeerTube {
  readonly order: string[] = [];
  readonly videos = new Map<string, FakeVideo>();
  requests: string[] = [];

  /** Three public videos built from the real framaconf fixtures. */
  static framaconf(): FakePeerTube {
    const pt = new FakePeerTube();
    const channel = fx('framatube-framaconf.channel-videos.json');
    const detail = fx('framatube-landscape.video.json') as PtVideo;
    for (const s of channel.data as PtVideo[]) {
      pt.order.push(s.uuid);
      pt.videos.set(s.uuid, { ...detail, uuid: s.uuid, name: s.name, url: `https://framatube.org/videos/watch/${s.uuid}`, privacy: { id: 1, label: 'Public' } });
    }
    return pt;
  }

  get uuids(): string[] {
    return [...this.order];
  }

  patch(uuid: string, change: Partial<PtVideo>) {
    this.videos.set(uuid, { ...(this.videos.get(uuid) as PtVideo), ...change });
  }

  readonly fetch: FetchLike = async (url) => {
    this.requests.push(url);
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { 'content-type': status === 200 ? 'application/json' : 'application/problem+json' } });
    const u = new URL(url);
    if (u.pathname === '/api/v1/video-channels/framaconf/videos') {
      const listed = this.order
        .map((id) => this.videos.get(id))
        .filter((v): v is PtVideo => !!v && 'uuid' in v && v.privacy.id === 1 && !v.blacklisted);
      const start = Number(u.searchParams.get('start'));
      const count = Number(u.searchParams.get('count'));
      return json({ total: listed.length, data: listed.slice(start, start + count) });
    }
    const m = u.pathname.match(/^\/api\/v1\/videos\/([^/]+)(\/captions|\/chapters)?$/);
    if (m) {
      const v = this.videos.get(m[1]);
      if (m[2] === '/captions') return json({ total: 0, data: [] });
      if (m[2] === '/chapters') return json({ chapters: [] });
      if (!v) return json({ type: 'about:blank', title: 'Not Found', detail: 'Video not found', status: 404 }, 404);
      if ('status' in v && !('uuid' in v)) {
        if (v.html) return new Response('<html>blocked by WAF</html>', { status: v.status, headers: { 'content-type': 'text/html' } });
        return json({ title: 'error', status: v.status }, v.status);
      }
      return json(v);
    }
    return json({ error: 'unexpected' }, 404);
  };
}

// ---------------------------------------------------------------- NIP-46

interface PoolSub {
  filter: Record<string, unknown>;
  onevent: (e: SignedEvent) => void;
}

/**
 * Stands in for a nostr-tools SimplePool connected to a bunker's relay, with
 * the remote signer on the other side. It speaks real NIP-46 (kind 24133,
 * NIP-44 encrypted JSON-RPC), so nostr-tools' BunkerSigner runs unmodified.
 */
export class FakeBunker {
  readonly remoteSk: Uint8Array;
  readonly remotePubkey: string;
  /** The user's signing key (may differ from the bunker's own key, as NIP-46 allows). */
  userSk: Uint8Array;
  secret: string | null;
  /** Sign with this key instead (a misbehaving bunker). */
  signWithSk: Uint8Array | undefined;
  /** Never answer. */
  silent = false;
  methods: string[] = [];
  destroyed = false;
  private subs = new Set<PoolSub>();

  constructor(remoteSkHex: string, userSkHex: string, secret: string | null = 'sekret') {
    this.remoteSk = skBytes(remoteSkHex);
    this.remotePubkey = getPublicKey(this.remoteSk);
    this.userSk = skBytes(userSkHex);
    this.secret = secret;
  }

  url(): string {
    return `bunker://${this.remotePubkey}?relay=${encodeURIComponent('wss://bunker-relay.test')}` + (this.secret ? `&secret=${this.secret}` : '');
  }

  // --- the AbstractSimplePool surface BunkerSigner uses ---
  subscribe(_relays: string[], filter: Record<string, unknown>, params: { onevent?: (e: SignedEvent) => void }) {
    const sub: PoolSub = { filter, onevent: params.onevent ?? (() => {}) };
    this.subs.add(sub);
    return { close: () => void this.subs.delete(sub) };
  }
  publish(_relays: string[], event: SignedEvent): Promise<string>[] {
    queueMicrotask(() => this.handle(event));
    return [Promise.resolve('')];
  }
  destroy() {
    this.destroyed = true;
  }

  private handle(req: SignedEvent) {
    if (req.kind !== 24133 || !req.tags.some((t) => t[0] === 'p' && t[1] === this.remotePubkey)) return;
    if (this.silent) return;
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
    else if (method === 'sign_event') result = JSON.stringify(finalizeEvent(JSON.parse(params[0]), this.signWithSk ?? this.userSk));
    else if (method === 'ping') result = 'pong';
    else error = `unsupported method ${method}`;
    const resp = finalizeEvent(
      { kind: 24133, created_at: Math.floor(Date.now() / 1000), tags: [['p', req.pubkey]], content: encrypt(JSON.stringify({ id, result, error }), ck) },
      this.remoteSk,
    ) as SignedEvent;
    for (const s of this.subs) if (matches(resp, s.filter)) s.onevent(resp);
  }
}
