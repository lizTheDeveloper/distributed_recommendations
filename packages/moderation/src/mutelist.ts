// Import a public NIP-51 mute list (kind 10000), checked against
// https://raw.githubusercontent.com/nostr-protocol/nips/master/51.md on 2026-10-19.
// Expected tags: "p" (pubkeys), "t" (hashtags), "word" (lowercase string), "e" (threads).
//
// Only the PUBLIC tags are read. Private items are NIP-44-encrypted to the author
// in `content`; we never try to read someone else's. Threads (`e`) don't apply to
// videos and are ignored.

import type { MuteImport } from './blocks.ts';
import { BLOCK_LIMITS, normalizeBlockValue } from './blocks.ts';
import type { NostrEvent, QueryFn, VerifyFn } from './types.ts';
import { HEX64 } from './text.ts';

export const KIND_MUTE_LIST = 10000;

export interface ParseMuteListOptions {
  verify: VerifyFn;
  /** If given, the event must be by this pubkey (hex). */
  author?: string;
}

/** A `MuteImport` from a kind-10000 event, or null when it isn't a valid, signed mute list. */
export function parseMuteList(e: NostrEvent, opts: ParseMuteListOptions): MuteImport | null {
  if (!e || e.kind !== KIND_MUTE_LIST || !HEX64.test(e.pubkey) || !HEX64.test(e.id)) return null;
  if (opts.author && e.pubkey !== opts.author.toLowerCase()) return null;
  if (!opts.verify(e)) return null;
  const npubs = new Set<string>();
  const tags = new Set<string>();
  const keywords = new Set<string>();
  const M = BLOCK_LIMITS.maxPerList;
  for (const t of e.tags) {
    try {
      if (t[0] === 'p' && npubs.size < M && t[1] !== e.pubkey) npubs.add(normalizeBlockValue('npub', t[1] ?? ''));
      else if (t[0] === 't' && tags.size < M) tags.add(normalizeBlockValue('tag', t[1] ?? ''));
      else if (t[0] === 'word' && keywords.size < M) keywords.add(normalizeBlockValue('keyword', t[1] ?? ''));
    } catch {
      /* skip malformed entries; a list with one bad tag still imports */
    }
  }
  return { from: e.pubkey, eventId: e.id, createdAt: e.created_at, npubs: [...npubs], tags: [...tags], keywords: [...keywords] };
}

export interface FetchMuteListOptions {
  /** Hex pubkey whose public mute list to import. */
  pubkey: string;
  relays: readonly string[];
  query: QueryFn;
  verify: VerifyFn;
}

/** The newest valid mute list by `pubkey` (it is a replaceable event), or null. */
export async function fetchMuteList(opts: FetchMuteListOptions): Promise<MuteImport | null> {
  const pk = opts.pubkey.toLowerCase();
  if (!HEX64.test(pk)) throw new TypeError('pubkey must be hex (use parsePubkey on an npub)');
  const events = await opts.query(opts.relays, { kinds: [KIND_MUTE_LIST], authors: [pk], limit: 5 });
  let best: MuteImport | null = null;
  for (const e of events) {
    const m = parseMuteList(e, { verify: opts.verify, author: pk });
    if (m && (!best || m.createdAt > best.createdAt || (m.createdAt === best.createdAt && m.eventId < best.eventId))) best = m;
  }
  return best;
}
