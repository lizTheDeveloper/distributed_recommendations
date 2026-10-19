// NIP-51 video curation sets (kind 30005) for a creator's picks.
//
// Spec: https://github.com/nostr-protocol/nips/blob/master/51.md (read 2026-10-19)
// - "Curation sets | 30005 | groups of videos picked by users as interesting
//   and/or belonging to the same category | "e" (kind:21 videos)".
// - Sets are addressable: each has a `d` identifier and "can optionally have a
//   "title", an "image" and a "description"" tag.
// - "When new items are added to an existing list, clients SHOULD append them to
//   the end of the list, so they are stored in chronological order."
// - Public items live in tags; private items are NIP-44-encrypted in `content`.
//   We publish public items only (`content` is "").
//
// NIP-51 has no per-item timestamp or disclosure field, so this package adds one
// documented tag per pick (PROVISIONAL, same status as taste-list v1):
//
//   ["pick", <ref>, <canonical watch URL>, <addedAt>, <flags>, <note>?]
//
//   ref      the first value of the pick's `a` tag (`kind:pubkey:d`), or of its `e`
//            tag (event id) when it has no `a` tag; must match a ref in this event
//   url      canonical PeerTube watch URL (`items[].id` in taste-list v1)
//   addedAt  Unix seconds as a decimal integer, or "" when unknown (`items[].addedAt`)
//   flags    "" or a comma-separated subset of `sponsored`, `affiliated`
//            (`items[].sponsored` / `items[].affiliated`)
//   note     optional, ≤ 280 characters (`items[].note`)
//
// The tag name is multi-letter, so relays don't index it and clients that don't
// know it ignore it. Video refs follow NIP-01: `["a", "<kind>:<pubkey>:<d>", <relay>]`
// for the bridge's addressable 34235/34236 events (d = PeerTube uuid), and
// `["e", <id>, <relay>, <pubkey>]` when the event id is known (NIP-51 lists `e`
// refs for kind 21). apps/web's Follow-taste resolver reads both.

import { fail, string } from '../../core/src/validate.ts';
import { ValidationError } from '../../core/src/validate.ts';
import { signWith } from '../../bridge/src/event.ts';
import type { Sha256, Signer } from '../../bridge/src/event.ts';
import type { EventTemplate, SignedEvent } from '../../bridge/src/types.ts';
import { ADDRESSABLE_VIDEO_KINDS, VIDEO_KINDS, parseWatchUrl, videoUrlFromEvent } from './peertube.ts';
import { PICKS_LIMITS, validatePicksSet } from './picks.ts';
import { MAX_TIMESTAMP, newestFirst, oldestFirst, parseTasteList } from './tastelist.ts';
import type { TasteList } from './tastelist.ts';
import type { Pick, PicksSet, VideoRef } from './types.ts';

export const KIND_VIDEO_CURATION_SET = 30005;
export const KIND_DELETION = 5;
export const PICK_TAG = 'pick';
export const PICK_FLAGS = ['sponsored', 'affiliated'] as const;

export const CURATION_LIMITS = {
  /** Serialized signed event (JSON). Many relays cap events at 64–128 KiB. */
  maxEventBytes: 64 * 1024,
  /** Distinct `a`/`e` refs (a pick may carry one of each). */
  maxRefs: 2 * PICKS_LIMITS.maxItems,
  maxTags: 4 * PICKS_LIMITS.maxItems + 16,
  maxTagValue: 1024,
} as const;

const HEX64 = /^[0-9a-f]{64}$/;
const HEX128 = /^[0-9a-f]{128}$/;
const A_RE = /^(\d{1,5}):([0-9a-f]{64}):([^\s]{1,200})$/;
const RELAY_RE = /^wss?:\/\/[^\s]+$/;
const INT_RE = /^(0|[1-9][0-9]{0,9})$/;

/** `30005:<pubkey>:<d>`: the set's address (apps/web shows these as refs). */
export function curationSetAddress(pubkey: string, d: string): string {
  return `${KIND_VIDEO_CURATION_SET}:${pubkey}:${d}`;
}

function refValue(v: VideoRef): string | null {
  if (v.d !== undefined && ADDRESSABLE_VIDEO_KINDS.includes(v.kind)) return `${v.kind}:${v.pubkey}:${v.d}`;
  return v.id ?? null;
}

function flagsOf(p: Pick): string {
  return PICK_FLAGS.filter((f) => p[f]).join(',');
}

const bytes = (s: string) => new TextEncoder().encode(s).length;

export interface BuildOptions {
  /** `created_at`, Unix seconds (default: now). */
  createdAt?: number;
}

export interface BuildResult {
  template: EventTemplate;
  /** Picks left out of the event (they still go into the JSON list). */
  skipped: { url: string; reason: string }[];
  /** Picks in the event, in tag order (oldest first). */
  included: Pick[];
}

/**
 * Build the unsigned kind-30005 event for a picks set. Picks are written oldest
 * first (NIP-51 chronological order; apps/web reads the last as the newest). A pick
 * without a bridged video ref is skipped and reported. Throws `ValidationError` on
 * an invalid set or when the event would exceed `CURATION_LIMITS.maxEventBytes`.
 */
export function buildCurationSet(input: PicksSet, opts: BuildOptions = {}): BuildResult {
  const set = validatePicksSet(input);
  const tags: string[][] = [['d', set.d], ['title', set.title]];
  if (set.description !== undefined) tags.push(['description', set.description]);
  if (set.image !== undefined) tags.push(['image', set.image]);
  tags.push(['alt', `Video curation set: ${set.title}`]);
  const skipped: BuildResult['skipped'] = [];
  const included: Pick[] = [];
  for (const p of oldestFirst(set.items)) {
    const v = p.video;
    const ref = v ? refValue(v) : null;
    if (!v || !ref) {
      skipped.push({ url: p.url, reason: 'not bridged to Nostr (no NIP-71 video event found)' });
      continue;
    }
    if (v.d !== undefined && ADDRESSABLE_VIDEO_KINDS.includes(v.kind)) tags.push(v.relay ? ['a', ref, v.relay] : ['a', ref]);
    if (v.id !== undefined) tags.push(['e', v.id, v.relay ?? '', v.pubkey]);
    const pick = [PICK_TAG, ref, p.url, p.addedAt === undefined ? '' : String(p.addedAt), flagsOf(p)];
    if (p.note !== undefined) pick.push(p.note);
    tags.push(pick);
    included.push(p);
  }
  const createdAt = opts.createdAt ?? Math.floor(Date.now() / 1000);
  if (!Number.isInteger(createdAt) || createdAt < 0 || createdAt > MAX_TIMESTAMP) fail('createdAt', 'must be Unix seconds');
  const template: EventTemplate = { kind: KIND_VIDEO_CURATION_SET, created_at: createdAt, tags, content: '' };
  // id, pubkey and sig add 64 + 64 + 128 hex characters and their keys.
  const size = bytes(JSON.stringify(template)) + 300;
  if (size > CURATION_LIMITS.maxEventBytes) fail('set', `event would be about ${size} bytes; the limit is ${CURATION_LIMITS.maxEventBytes} (remove picks or shorten notes)`);
  return { template, skipped, included };
}

/**
 * Sign a built set with any `Signer` (NIP-07 `window.nostr`, a NIP-46 bunker, a local
 * key). Checks the signer returned exactly this event (bridge `signWith`); pass
 * `verify` (e.g. `verifySignedEvent`) to also check the Schnorr signature.
 */
export async function signCurationSet(
  signer: Signer,
  template: EventTemplate,
  opts: { sha256?: Sha256; verify?: (e: SignedEvent) => boolean } = {},
): Promise<SignedEvent> {
  if (template.kind !== KIND_VIDEO_CURATION_SET) throw new TypeError('not a kind-30005 template');
  return signWith(signer, template, opts);
}

/** NIP-09 deletion request for a whole set (e.g. "Unpublish my picks"). */
export function buildSetDeletion(pubkey: string, d: string, opts: { createdAt?: number; reason?: string } = {}): EventTemplate {
  if (!HEX64.test(pubkey)) throw new TypeError('pubkey must be 64 lowercase hex characters');
  return {
    kind: KIND_DELETION,
    created_at: opts.createdAt ?? Math.floor(Date.now() / 1000),
    tags: [['a', curationSetAddress(pubkey, d)], ['k', String(KIND_VIDEO_CURATION_SET)]],
    content: opts.reason ?? '',
  };
}

// ---------------------------------------------------------------- parsing

export type CurationRef =
  | { type: 'a'; kind: number; pubkey: string; d: string; relay?: string }
  | { type: 'e'; id: string; relay?: string; pubkey?: string };

export interface PickMeta {
  url: string;
  addedAt?: number;
  sponsored: boolean;
  affiliated: boolean;
  note?: string;
}

export interface ParsedCurationSet {
  id: string;
  pubkey: string;
  createdAt: number;
  d: string;
  title?: string;
  description?: string;
  image?: string;
  /** Public refs in tag order (oldest first), each with its `pick` tag if any. */
  items: { ref: CurationRef; value: string; pick?: PickMeta }[];
}

export interface ParseCurationOptions {
  /** Reject events not signed by this pubkey (the creator's npub). */
  pubkey?: string;
}

/**
 * Strictly validate an untrusted kind-30005 event as a picks set. Structure only:
 * check the signature separately (`verifySignedEvent`) before trusting it.
 *
 * Rejects: wrong kind or pubkey, bad id/sig/pubkey format, missing or repeated `d`,
 * repeated or oversized `title`/`description`/`image`, `a` refs to non-video kinds,
 * malformed `e` refs, duplicate refs, `pick` tags that are malformed, duplicated or
 * don't match a ref (or whose URL's uuid isn't the `a` ref's `d`), more than
 * `CURATION_LIMITS.maxRefs` refs, more than `maxTags` tags, any tag value over
 * `maxTagValue`, or more than `maxEventBytes` in all. Tags of other names (`alt`,
 * `t`, `client`, …) are ignored, so sets made by other NIP-51 clients parse.
 * `content` (private, NIP-44-encrypted items) is never read.
 */
export function parseCurationSet(x: unknown, opts: ParseCurationOptions = {}): ParsedCurationSet {
  const L = CURATION_LIMITS;
  if (typeof x !== 'object' || x === null || Array.isArray(x)) fail('event', 'must be an object');
  const e = x as Record<string, unknown>;
  if (e.kind !== KIND_VIDEO_CURATION_SET) fail('event.kind', `must be ${KIND_VIDEO_CURATION_SET}`);
  if (typeof e.id !== 'string' || !HEX64.test(e.id)) fail('event.id', 'must be 64 lowercase hex characters');
  if (typeof e.pubkey !== 'string' || !HEX64.test(e.pubkey)) fail('event.pubkey', 'must be 64 lowercase hex characters');
  if (typeof e.sig !== 'string' || !HEX128.test(e.sig)) fail('event.sig', 'must be 128 lowercase hex characters');
  if (opts.pubkey !== undefined && e.pubkey !== opts.pubkey) fail('event.pubkey', 'is not the expected author');
  if (typeof e.created_at !== 'number' || !Number.isInteger(e.created_at) || e.created_at < 0 || e.created_at > MAX_TIMESTAMP) {
    fail('event.created_at', 'must be Unix seconds');
  }
  if (typeof e.content !== 'string') fail('event.content', 'must be a string');
  if (!Array.isArray(e.tags)) fail('event.tags', 'must be an array');
  if (e.tags.length > L.maxTags) fail('event.tags', `must have at most ${L.maxTags} tags`);
  let total = bytes(e.content) + 400;
  e.tags.forEach((t: unknown, i: number) => {
    if (!Array.isArray(t) || t.length === 0 || t.length > 8) fail(`event.tags[${i}]`, 'must be a non-empty array of at most 8 strings');
    for (const v of t) {
      if (typeof v !== 'string') fail(`event.tags[${i}]`, 'must contain only strings');
      if (v.length > L.maxTagValue) fail(`event.tags[${i}]`, `values must be at most ${L.maxTagValue} characters`);
      total += bytes(v) + 3;
    }
  });
  if (total > L.maxEventBytes) fail('event', `must be at most ${L.maxEventBytes} bytes`);
  const tags = e.tags as string[][];

  const single = (name: string) => {
    const found = tags.filter((t) => t[0] === name);
    if (found.length > 1) fail(`event.tags.${name}`, 'must appear at most once');
    return found[0];
  };
  const dTag = single('d');
  if (!dTag) fail('event.tags.d', 'is required');
  const out: ParsedCurationSet = {
    id: e.id,
    pubkey: e.pubkey,
    createdAt: e.created_at,
    d: string(dTag[1], 'event.tags.d', PICKS_LIMITS.maxD, undefined, 0),
    items: [],
  };
  const title = single('title');
  if (title) out.title = string(title[1], 'event.tags.title', PICKS_LIMITS.maxTitle);
  const desc = single('description');
  if (desc) out.description = string(desc[1], 'event.tags.description', PICKS_LIMITS.maxDescription);
  const image = single('image');
  if (image) out.image = string(image[1], 'event.tags.image', PICKS_LIMITS.maxUrlLength, /^https:\/\/[^\s]+$/);

  const byValue = new Map<string, ParsedCurationSet['items'][number]>();
  const picks: string[][] = [];
  tags.forEach((t, i) => {
    const p = `event.tags[${i}]`;
    const relayAt = (j: number) => {
      const r = t[j];
      if (r === undefined || r === '') return undefined;
      if (!RELAY_RE.test(r)) fail(`${p}[${j}]`, 'must be a ws:// or wss:// relay URL');
      return r;
    };
    if (t[0] === 'a') {
      const m = A_RE.exec(t[1] ?? '');
      if (!m) fail(p, 'a ref must be "<kind>:<pubkey>:<d>"');
      const kind = Number(m[1]);
      if (!ADDRESSABLE_VIDEO_KINDS.includes(kind)) fail(p, `a ref must be an addressable NIP-71 video (${ADDRESSABLE_VIDEO_KINDS.join('/')})`);
      if (byValue.has(t[1])) fail(p, 'is a duplicate ref');
      const ref: CurationRef = { type: 'a', kind, pubkey: m[2], d: m[3] };
      const relay = relayAt(2);
      if (relay) ref.relay = relay;
      const item = { ref, value: t[1] };
      byValue.set(t[1], item);
      out.items.push(item);
    } else if (t[0] === 'e') {
      if (!HEX64.test(t[1] ?? '')) fail(p, 'e ref must be a 64-hex event id');
      if (byValue.has(t[1])) fail(p, 'is a duplicate ref');
      const ref: CurationRef = { type: 'e', id: t[1] };
      const relay = relayAt(2);
      if (relay) ref.relay = relay;
      if (t[3] !== undefined && t[3] !== '') {
        if (!HEX64.test(t[3])) fail(`${p}[3]`, 'must be a 64-hex pubkey');
        ref.pubkey = t[3];
      }
      const item = { ref, value: t[1] };
      byValue.set(t[1], item);
      out.items.push(item);
    } else if (t[0] === PICK_TAG) {
      picks.push(t);
    }
    // Other tag names (alt, t, client, …) are ignored: other NIP-51 clients add their own.
  });
  if (out.items.length > L.maxRefs) fail('event.tags', `must have at most ${L.maxRefs} refs`);

  picks.forEach((t, i) => {
    const p = `event.tags.pick[${i}]`;
    if (t.length < 5 || t.length > 6) fail(p, 'must be ["pick", ref, url, addedAt, flags, note?]');
    const item = byValue.get(t[1]);
    if (!item) fail(`${p}[1]`, 'does not match an a or e ref in this event');
    if (item.pick) fail(`${p}[1]`, 'has more than one pick tag');
    const w = parseWatchUrl(t[2]);
    if (!w || w.canonical !== t[2]) fail(`${p}[2]`, 'must be a canonical PeerTube watch URL (<origin>/videos/watch/<uuid>)');
    if (t[2].length > PICKS_LIMITS.maxUrlLength) fail(`${p}[2]`, 'is too long');
    if (item.ref.type === 'a' && item.ref.d.toLowerCase() !== w.uuid) fail(`${p}[2]`, "uuid doesn't match the a ref's d");
    const meta: PickMeta = { url: t[2], sponsored: false, affiliated: false };
    if (t[3] !== '') {
      if (!INT_RE.test(t[3]) || Number(t[3]) > MAX_TIMESTAMP) fail(`${p}[3]`, 'must be Unix seconds or ""');
      meta.addedAt = Number(t[3]);
    }
    if (t[4] !== '') {
      const flags = t[4].split(',');
      if (new Set(flags).size !== flags.length || !flags.every((f) => (PICK_FLAGS as readonly string[]).includes(f))) {
        fail(`${p}[4]`, 'must be "" or a comma-separated subset of sponsored, affiliated');
      }
      meta.sponsored = flags.includes('sponsored');
      meta.affiliated = flags.includes('affiliated');
    }
    if (t[5] !== undefined) meta.note = string(t[5], `${p}[5]`, PICKS_LIMITS.maxNote);
    item.pick = meta;
  });
  // An `e` ref the same pick also carries as `a` shares its metadata.
  for (const it of out.items) {
    if (it.pick || it.ref.type !== 'e') continue;
    const idx = out.items.indexOf(it);
    const prev = out.items[idx - 1];
    if (prev?.ref.type === 'a' && prev.pick && it.ref.pubkey === prev.ref.pubkey) it.pick = prev.pick;
  }
  return out;
}

/** Filters for the video events a parsed set references (one per ref type). */
export function videoFilters(set: ParsedCurationSet): Record<string, unknown>[] {
  const ids = [...new Set(set.items.flatMap((i) => (i.ref.type === 'e' ? [i.ref.id] : [])))];
  const addrs = set.items.flatMap((i) => (i.ref.type === 'a' ? [i.ref] : []));
  const out: Record<string, unknown>[] = [];
  if (ids.length) out.push({ ids });
  if (addrs.length) {
    out.push({
      kinds: [...new Set(addrs.map((a) => a.kind))],
      authors: [...new Set(addrs.map((a) => a.pubkey))],
      '#d': [...new Set(addrs.map((a) => a.d))],
    });
  }
  return out;
}

export interface ResolveOptions {
  /** Signature check for video events (e.g. `verifySignedEvent`). */
  verify: (e: SignedEvent) => boolean | Promise<boolean>;
  /**
   * Use the `pick` tag's URL when the video event can't be found (the curator's
   * signed claim, the same trust as a taste-list v1 URL). Default true.
   */
  usePickUrl?: boolean;
}

/**
 * Picks of a parsed set, newest first: each ref is mapped to its PeerTube URL through
 * the (signature-checked) video event, the `a` ref's newest version by its own author;
 * a `pick` URL that disagrees with the video event drops the pick. Duplicates by URL
 * keep the newest. `addedAt` is the pick's, else the set's `created_at` (what
 * apps/web does today). Returns a taste-list v1 object (validated).
 */
export async function resolveCurationSet(set: ParsedCurationSet, videoEvents: readonly SignedEvent[], opts: ResolveOptions): Promise<TasteList> {
  const byId = new Map<string, SignedEvent>();
  const byAddr = new Map<string, SignedEvent>();
  for (const v of videoEvents) {
    if (!v || !VIDEO_KINDS.includes(v.kind)) continue;
    byId.set(v.id, v);
    if (ADDRESSABLE_VIDEO_KINDS.includes(v.kind)) {
      const key = `${v.kind}:${v.pubkey}:${v.tags.find((t) => t[0] === 'd')?.[1] ?? ''}`;
      const prev = byAddr.get(key);
      if (!prev || prev.created_at < v.created_at) byAddr.set(key, v);
    }
  }
  const items: TasteList['items'] = [];
  const seen = new Set<string>();
  for (const it of [...set.items].reverse()) {
    const r = it.ref;
    const ev = r.type === 'e' ? byId.get(r.id) : byAddr.get(`${r.kind}:${r.pubkey}:${r.d}`);
    let url: string | null = null;
    const author = r.pubkey;
    if (ev && (author === undefined || ev.pubkey === author) && (await opts.verify(ev))) {
      url = videoUrlFromEvent(ev);
      if (url && it.pick && it.pick.url !== url) continue;
    }
    if (!url && it.pick && opts.usePickUrl !== false) url = it.pick.url;
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const m = it.pick;
    const item: TasteList['items'][number] = { id: url, sponsored: m?.sponsored ?? false, affiliated: m?.affiliated ?? false, addedAt: m?.addedAt ?? set.createdAt };
    if (m?.note !== undefined) item.note = m.note;
    items.push(item);
    if (items.length >= PICKS_LIMITS.maxItems) break;
  }
  const list: Record<string, unknown> = { v: 1, name: set.title || set.d || 'Video picks', updatedAt: set.createdAt, items: newestFirst(items) };
  if (set.description !== undefined) list.description = set.description;
  return parseTasteList(list);
}

/** A parsed set back to the editable model (refs kept; for "edit my published picks"). */
export function picksFromCurationSet(set: ParsedCurationSet): PicksSet {
  const out: PicksSet = { d: set.d, title: set.title || set.d || 'Video picks', updatedAt: set.createdAt, items: [] };
  if (set.description !== undefined) out.description = set.description;
  if (set.image !== undefined) out.image = set.image;
  const byUrl = new Map<string, Pick>();
  for (const it of set.items) {
    if (!it.pick) continue;
    const r = it.ref;
    let p = byUrl.get(it.pick.url);
    if (!p) {
      p = { url: it.pick.url, sponsored: it.pick.sponsored, affiliated: it.pick.affiliated };
      if (it.pick.addedAt !== undefined) p.addedAt = it.pick.addedAt;
      if (it.pick.note !== undefined) p.note = it.pick.note;
      byUrl.set(it.pick.url, p);
      out.items.push(p);
    }
    if (r.type === 'a') {
      p.video = { ...(p.video ?? {}), kind: r.kind, pubkey: r.pubkey, d: r.d, url: it.pick.url, ...(r.relay ? { relay: r.relay } : {}) };
    } else if (p.video && p.video.pubkey === (r.pubkey ?? p.video.pubkey)) {
      p.video.id = r.id;
    }
  }
  return out;
}

export { ValidationError };
