// Validation of the in-memory picks model (what the Creator studio edits).

import { ValidationError, array, boolean, fail, has, number, plainObject, string } from '../../core/src/validate.ts';
import { ADDRESSABLE_VIDEO_KINDS, VIDEO_KINDS, parseWatchUrl } from './peertube.ts';
import { MAX_TIMESTAMP, TASTE_LIST_LIMITS, newestFirst, parseTasteList } from './tastelist.ts';
import type { TasteList } from './tastelist.ts';
import type { Pick, PicksSet, VideoRef } from './types.ts';

/** Limits shared by both formats. Items, names and notes match taste-list v1. */
export const PICKS_LIMITS = {
  maxItems: TASTE_LIST_LIMITS.maxItems,
  maxTitle: TASTE_LIST_LIMITS.maxName,
  maxAuthor: TASTE_LIST_LIMITS.maxAuthor,
  maxDescription: TASTE_LIST_LIMITS.maxDescription,
  maxNote: TASTE_LIST_LIMITS.maxNote,
  maxUrlLength: TASTE_LIST_LIMITS.maxIdLength,
  /** NIP-51 `d`; apps/web accepts `a` refs with d up to 200 characters. */
  maxD: 200,
  maxRelayUrl: 256,
} as const;

const HEX64 = /^[0-9a-f]{64}$/;
const D_RE = /^[^\s]{1,200}$/;
const HTTPS_RE = /^https:\/\/[^\s]+$/;
const RELAY_RE = /^wss?:\/\/[^\s]+$/;

const SET_KEYS = ['d', 'title', 'description', 'image', 'author', 'updatedAt', 'items'] as const;
const PICK_KEYS = ['url', 'video', 'addedAt', 'sponsored', 'affiliated', 'note'] as const;
const REF_KEYS = ['kind', 'pubkey', 'd', 'id', 'relay', 'url'] as const;

function videoRef(x: unknown, path: string, url: string): VideoRef {
  const o = plainObject(x, path, REF_KEYS, ['kind', 'pubkey', 'url']);
  const kind = number(o.kind, `${path}.kind`, 0, 65535, true);
  if (!VIDEO_KINDS.includes(kind)) fail(`${path}.kind`, `must be a NIP-71 video kind (${VIDEO_KINDS.join(', ')})`);
  const ref: VideoRef = { kind, pubkey: string(o.pubkey, `${path}.pubkey`, 64, HEX64), url: string(o.url, `${path}.url`, PICKS_LIMITS.maxUrlLength) };
  if (ref.url !== url) fail(`${path}.url`, 'must equal the pick url');
  const addressable = ADDRESSABLE_VIDEO_KINDS.includes(kind);
  if (has(o, 'd') && o.d !== undefined) {
    if (!addressable) fail(`${path}.d`, 'only addressable kinds (34235/34236) have a d tag');
    ref.d = string(o.d, `${path}.d`, PICKS_LIMITS.maxD, D_RE);
    if (ref.d.toLowerCase() !== parseWatchUrl(url)!.uuid) fail(`${path}.d`, 'must be the PeerTube uuid of the pick url (bridge convention)');
  } else if (addressable) fail(`${path}.d`, 'is required for addressable kinds');
  if (has(o, 'id') && o.id !== undefined) ref.id = string(o.id, `${path}.id`, 64, HEX64);
  if (!addressable && ref.id === undefined) fail(`${path}.id`, 'is required for regular kinds 21/22');
  if (has(o, 'relay') && o.relay !== undefined) ref.relay = string(o.relay, `${path}.relay`, PICKS_LIMITS.maxRelayUrl, RELAY_RE);
  return ref;
}

/**
 * Strictly validate a picks set (e.g. from the studio's editor state or a saved
 * draft) and canonicalize pick URLs to `<origin>/videos/watch/<uuid>`. Pick URLs must
 * be PeerTube watch URLs, unique after canonicalization. Throws `ValidationError`.
 */
export function validatePicksSet(x: unknown): PicksSet {
  const L = PICKS_LIMITS;
  const o = plainObject(x, 'set', SET_KEYS, ['d', 'title', 'items']);
  const set: PicksSet = { d: string(o.d, 'set.d', L.maxD, D_RE), title: string(o.title, 'set.title', L.maxTitle), items: [] };
  if (has(o, 'description') && o.description !== undefined) set.description = string(o.description, 'set.description', L.maxDescription);
  if (has(o, 'image') && o.image !== undefined) set.image = string(o.image, 'set.image', L.maxUrlLength, HTTPS_RE);
  if (has(o, 'author') && o.author !== undefined) set.author = string(o.author, 'set.author', L.maxAuthor);
  if (has(o, 'updatedAt') && o.updatedAt !== undefined) set.updatedAt = number(o.updatedAt, 'set.updatedAt', 0, MAX_TIMESTAMP, true);
  const seen = new Set<string>();
  array(o.items, 'set.items', L.maxItems).forEach((raw, i) => {
    const p = `set.items[${i}]`;
    const it = plainObject(raw, p, PICK_KEYS, ['url']);
    const w = parseWatchUrl(string(it.url, `${p}.url`, L.maxUrlLength));
    if (!w) fail(`${p}.url`, 'must be a PeerTube watch URL (/videos/watch/… or /w/…)');
    if (w.canonical.length > L.maxUrlLength) fail(`${p}.url`, `must be at most ${L.maxUrlLength} characters`);
    if (seen.has(w.canonical)) fail(`${p}.url`, 'is a duplicate');
    seen.add(w.canonical);
    const pick: Pick = {
      url: w.canonical,
      sponsored: has(it, 'sponsored') ? boolean(it.sponsored, `${p}.sponsored`) : false,
      affiliated: has(it, 'affiliated') ? boolean(it.affiliated, `${p}.affiliated`) : false,
    };
    if (has(it, 'video') && it.video !== undefined) {
      const v = plainObject(it.video, `${p}.video`, REF_KEYS);
      pick.video = videoRef({ ...v, url: has(v, 'url') ? (parseWatchUrl(String(v.url))?.canonical ?? v.url) : w.canonical }, `${p}.video`, w.canonical);
    }
    if (has(it, 'addedAt') && it.addedAt !== undefined) pick.addedAt = number(it.addedAt, `${p}.addedAt`, 0, MAX_TIMESTAMP, true);
    if (has(it, 'note') && it.note !== undefined) pick.note = string(it.note, `${p}.note`, L.maxNote);
    set.items.push(pick);
  });
  return set;
}

// ---------------------------------------------------------------- export as taste-list v1

export interface ToTasteListOptions {
  /** `author` when the set has none (e.g. the signer's npub, so viewers can request a match). */
  author?: string;
  /** `updatedAt` when the set has none (Unix seconds). */
  updatedAt?: number;
}

/**
 * The set as a taste-list v1 object, newest pick first (undated picks last, in
 * their given order). Flags are written only when true, `note`/`addedAt` only when
 * present. The result is validated with `parseTasteList` before it is returned, so
 * it never produces a list the web app would reject. Pick URLs are validated and
 * canonicalized first (`validatePicksSet`).
 */
export function toTasteList(input: PicksSet, opts: ToTasteListOptions = {}): TasteList {
  return parseTasteList(wireObject(input, opts));
}

/** The wire object (false flags omitted), validated with `parseTasteList`. */
function wireObject(input: PicksSet, opts: ToTasteListOptions): Record<string, unknown> {
  const set = validatePicksSet(input);
  const author = set.author ?? opts.author;
  const updatedAt = set.updatedAt ?? opts.updatedAt;
  const out: Record<string, unknown> = { v: 1, name: set.title };
  if (author !== undefined) out.author = author;
  if (set.description !== undefined) out.description = set.description;
  if (updatedAt !== undefined) out.updatedAt = updatedAt;
  out.items = newestFirst(set.items).map((p) => {
    const it: Record<string, unknown> = { id: p.url };
    if (p.note !== undefined) it.note = p.note;
    if (p.sponsored) it.sponsored = true;
    if (p.affiliated) it.affiliated = true;
    if (p.addedAt !== undefined) it.addedAt = p.addedAt;
    return it;
  });
  parseTasteList(out);
  return out;
}

/** `toTasteList` as JSON text, checked against the 64 KiB limit. */
export function serializeTasteList(set: PicksSet, opts: ToTasteListOptions = {}, space?: number): string {
  const text = JSON.stringify(wireObject(set, opts), null, space);
  if (new TextEncoder().encode(text).length > TASTE_LIST_LIMITS.maxJsonBytes) {
    fail('list', `must be at most ${TASTE_LIST_LIMITS.maxJsonBytes} bytes (remove picks or shorten notes)`);
  }
  return text;
}

export { ValidationError };
