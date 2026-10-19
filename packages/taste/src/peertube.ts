// PeerTube watch URLs and their bridged NIP-71 addresses.
//
// packages/bridge publishes each public PeerTube video as an addressable NIP-71
// event: kind 34235 (normal) or 34236 (short: portrait and <= 180 s by default),
// `d` = the PeerTube video uuid, signed by the creator's key or an instance key,
// with `["origin", "peertube", <uuid>, <canonical url>]` and `["r", <canonical url>]`
// tags. `--regular` runs emit kinds 21/22 instead, with the same origin and r tags.
// So a creator who picks a PeerTube URL can find its bridged event by (kind, pubkey,
// uuid) when the bridge key is known, and by `#d` = uuid otherwise.

import { selectKind } from '../../bridge/src/mapping.ts';
import type { ToVideoEventOptions } from '../../bridge/src/mapping.ts';
import {
  KIND_ADDRESSABLE_SHORT_VIDEO,
  KIND_ADDRESSABLE_VIDEO,
  KIND_SHORT_VIDEO,
  KIND_VIDEO,
} from '../../bridge/src/types.ts';
import type { PtVideo, SignedEvent } from '../../bridge/src/types.ts';
import type { VideoRef } from './types.ts';

export const ADDRESSABLE_VIDEO_KINDS: readonly number[] = [KIND_ADDRESSABLE_VIDEO, KIND_ADDRESSABLE_SHORT_VIDEO];
export const REGULAR_VIDEO_KINDS: readonly number[] = [KIND_VIDEO, KIND_SHORT_VIDEO];
/** NIP-71 kinds the web app's Follow-taste resolver accepts. */
export const VIDEO_KINDS: readonly number[] = [...REGULAR_VIDEO_KINDS, ...ADDRESSABLE_VIDEO_KINDS];

/** PeerTube's short-uuid alphabet (flickrBase58; checked against fixtures' `shortUUID`). */
const B58 = '123456789abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHORT_RE = /^[1-9a-km-zA-HJ-NP-Z]{1,22}$/;
const HEX64 = /^[0-9a-f]{64}$/;

/** PeerTube short UUID (22 chars, base58) -> uuid. Null when it isn't one. */
export function shortUuidToUuid(short: string): string | null {
  if (!SHORT_RE.test(short)) return null;
  let n = 0n;
  for (const c of short) n = n * 58n + BigInt(B58.indexOf(c));
  if (n >= 1n << 128n) return null;
  const h = n.toString(16).padStart(32, '0');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** uuid -> PeerTube short UUID (padded to 22 characters, as PeerTube does). */
export function uuidToShortUuid(uuid: string): string {
  const u = uuid.toLowerCase();
  if (!UUID_RE.test(u)) throw new TypeError('not a uuid');
  let n = BigInt('0x' + u.replace(/-/g, ''));
  let out = '';
  while (n > 0n) {
    out = B58[Number(n % 58n)] + out;
    n /= 58n;
  }
  return out.padStart(22, B58[0]);
}

export interface WatchUrl {
  /** `https://host[:port]` of the video's origin instance. */
  origin: string;
  uuid: string;
  /** `<origin>/videos/watch/<uuid>`: the form PeerTube's `url` field and the bridge use. */
  canonical: string;
}

/**
 * Parse a PeerTube watch URL: `/videos/watch/<uuid|shortUUID>` or `/w/<uuid|shortUUID>`
 * (query and fragment ignored). Returns the canonical `/videos/watch/<uuid>` form.
 * Null for anything else. It doesn't check the host is PeerTube, and a URL on a
 * mirror instance isn't the origin: use `canonicalFromApi` when you have the API
 * object.
 */
export function parseWatchUrl(url: string): WatchUrl | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  if (u.username || u.password) return null;
  const m = /^\/(?:videos\/watch|w)\/([A-Za-z0-9-]{6,64})\/?$/.exec(u.pathname);
  if (!m) return null;
  const id = m[1];
  const uuid = UUID_RE.test(id.toLowerCase()) ? id.toLowerCase() : shortUuidToUuid(id);
  if (!uuid) return null;
  return { origin: u.origin, uuid, canonical: `${u.origin}/videos/watch/${uuid}` };
}

/** The canonical watch URL from a PeerTube API video object (`url` is the origin's). */
export function canonicalFromApi(v: Pick<PtVideo, 'url' | 'uuid'>): string | null {
  const w = parseWatchUrl(v.url);
  return w && w.uuid === v.uuid.toLowerCase() ? w.canonical : null;
}

/** `kind:pubkey:d` coordinate of an addressable event. */
export function addressOf(ref: Pick<VideoRef, 'kind' | 'pubkey' | 'd'>): string {
  return `${ref.kind}:${ref.pubkey}:${ref.d}`;
}

/**
 * Both addresses the bridge could have used for this URL under `bridgePubkey`
 * (34235 normal and 34236 short), when you don't know which kind it picked.
 * Prefer `predictBridgedRef` (needs the API object) or `findBridgedVideo` (asks relays).
 */
export function bridgedAddresses(url: string, bridgePubkey: string): VideoRef[] {
  const w = parseWatchUrl(url);
  if (!w) throw new TypeError(`not a PeerTube watch URL: ${url}`);
  if (!HEX64.test(bridgePubkey)) throw new TypeError('bridgePubkey must be 64 lowercase hex characters');
  return ADDRESSABLE_VIDEO_KINDS.map((kind) => ({ kind, pubkey: bridgePubkey, d: w.uuid, url: w.canonical }));
}

/**
 * The address the bridge would give this PeerTube video object (GET
 * /api/v1/videos/{id}), using the bridge's own kind rule. Pass the same
 * `kind`/`shortMaxDuration` options the bridge ran with.
 */
export function predictBridgedRef(
  v: PtVideo,
  bridgePubkey: string,
  opts: Pick<ToVideoEventOptions, 'kind' | 'shortMaxDuration'> = {},
): VideoRef {
  if (!HEX64.test(bridgePubkey)) throw new TypeError('bridgePubkey must be 64 lowercase hex characters');
  const url = canonicalFromApi(v);
  if (!url) throw new TypeError('video object has no canonical watch URL');
  const kind = selectKind(v, { ...opts, addressable: true });
  return { kind, pubkey: bridgePubkey, d: v.uuid.toLowerCase(), url };
}

/**
 * The PeerTube watch URL a NIP-71 event points back to: its
 * `["origin", "peertube", uuid, url]` tag first, then an `r` tag that is a watch
 * URL (same rule as apps/web `videoUrlFromEvent`). Canonicalized.
 */
export function videoUrlFromEvent(e: Pick<SignedEvent, 'kind' | 'tags'>): string | null {
  if (!VIDEO_KINDS.includes(e.kind)) return null;
  for (const t of e.tags) {
    if (t[0] === 'origin' && t[1] === 'peertube' && t[3]) {
      const w = parseWatchUrl(t[3]);
      if (w && (!t[2] || t[2].toLowerCase() === w.uuid)) return w.canonical;
    }
  }
  for (const t of e.tags) if (t[0] === 'r' && t[1]) {
    const w = parseWatchUrl(t[1]);
    if (w) return w.canonical;
  }
  return null;
}

export type QueryFn = (filter: Record<string, unknown>) => Promise<SignedEvent[]>;

export interface FindBridgedOptions {
  /** Relay query (e.g. `relaysQuery(urls)`, or a `MemoryRelay`). */
  query: QueryFn;
  /** Signature check for events read from relays (e.g. `verifySignedEvent`). */
  verify: (e: SignedEvent) => boolean | Promise<boolean>;
  /**
   * Bridge keys you trust, in order of preference (the creator's own key first,
   * then instance bridges). Without them any author whose event points back to
   * this exact URL is a candidate, and two different authors are ambiguous.
   */
  bridgePubkeys?: readonly string[];
  /** Also look for regular kinds 21/22 by `#r` (bridge `--regular`). Default true. */
  regular?: boolean;
}

export interface FindBridgedResult {
  url: string;
  uuid: string;
  /** The chosen ref, or null (not bridged, or ambiguous without `bridgePubkeys`). */
  ref: VideoRef | null;
  /** Every verified event that points back to this URL, newest per author and kind first. */
  candidates: VideoRef[];
  ambiguous: boolean;
}

/**
 * Resolve a PeerTube URL to its bridged NIP-71 video event on the given relays.
 * Every candidate's signature is checked and it must point back to exactly this
 * video (origin tag uuid and URL), so a look-alike event with the same `d` from
 * someone else is never picked unless no trusted key is given and it is the only one.
 */
export async function findBridgedVideo(url: string, opts: FindBridgedOptions): Promise<FindBridgedResult> {
  const w = parseWatchUrl(url);
  if (!w) throw new TypeError(`not a PeerTube watch URL: ${url}`);
  const trusted = opts.bridgePubkeys?.length ? [...opts.bridgePubkeys] : undefined;
  if (trusted?.some((p) => !HEX64.test(p))) throw new TypeError('bridgePubkeys must be 64 lowercase hex characters');
  const base: Record<string, unknown> = trusted ? { authors: trusted } : {};
  const events = [...(await opts.query({ ...base, kinds: [...ADDRESSABLE_VIDEO_KINDS], '#d': [w.uuid] }))];
  if (opts.regular !== false) {
    const r = await opts.query({ ...base, kinds: [...REGULAR_VIDEO_KINDS], '#r': [w.canonical] });
    events.push(...r);
  }
  const newest = new Map<string, SignedEvent>();
  const seen = new Set<string>();
  for (const e of events) {
    if (!e || seen.has(e.id) || !VIDEO_KINDS.includes(e.kind)) continue;
    seen.add(e.id);
    if (trusted && !trusted.includes(e.pubkey)) continue;
    const addressable = ADDRESSABLE_VIDEO_KINDS.includes(e.kind);
    const d = e.tags.find((t) => t[0] === 'd')?.[1];
    if (addressable && d?.toLowerCase() !== w.uuid) continue;
    if (videoUrlFromEvent(e) !== w.canonical) continue;
    if (!(await opts.verify(e))) continue;
    const key = addressable ? `${e.kind}:${e.pubkey}` : `${e.kind}:${e.pubkey}:${e.id}`;
    const prev = newest.get(key);
    if (!prev || prev.created_at < e.created_at || (prev.created_at === e.created_at && prev.id > e.id)) newest.set(key, e);
  }
  const rank = (pk: string) => (trusted ? trusted.indexOf(pk) : 0);
  const sorted = [...newest.values()].sort(
    (a, b) =>
      rank(a.pubkey) - rank(b.pubkey) ||
      Number(ADDRESSABLE_VIDEO_KINDS.includes(b.kind)) - Number(ADDRESSABLE_VIDEO_KINDS.includes(a.kind)) ||
      b.created_at - a.created_at,
  );
  const candidates: VideoRef[] = sorted.map((e) =>
    ADDRESSABLE_VIDEO_KINDS.includes(e.kind)
      ? { kind: e.kind, pubkey: e.pubkey, d: e.tags.find((t) => t[0] === 'd')![1], id: e.id, url: w.canonical }
      : { kind: e.kind, pubkey: e.pubkey, id: e.id, url: w.canonical },
  );
  const authors = new Set(candidates.map((c) => c.pubkey));
  const ambiguous = !trusted && authors.size > 1;
  return { url: w.canonical, uuid: w.uuid, ref: ambiguous ? null : (candidates[0] ?? null), candidates, ambiguous };
}
