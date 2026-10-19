// The only file that imports nostr-tools (2.25.2, pinned). Everything else takes a
// `VerifyFn`, so an app can supply its own.

import { verifyEvent } from 'nostr-tools/pure';
import { decode, npubEncode } from 'nostr-tools/nip19';
import type { NostrEvent } from './types.ts';
import { HEX64 } from './text.ts';

/**
 * BIP-340 signature and id check. nostr-tools caches its verdict in a symbol
 * property on the event object, and object spread copies it, so a tampered copy
 * of an event that once verified would pass (THREAT_MODEL T25). Always verify a
 * fresh object holding only the NIP-01 fields.
 */
export function verifyNostrEvent(e: NostrEvent): boolean {
  if (!e || typeof e !== 'object' || !Array.isArray(e.tags)) return false;
  if (!e.tags.every((t) => Array.isArray(t) && t.every((x) => typeof x === 'string'))) return false;
  if (typeof e.content !== 'string' || !Number.isInteger(e.created_at) || !Number.isInteger(e.kind)) return false;
  try {
    return verifyEvent({
      id: e.id,
      pubkey: e.pubkey,
      created_at: e.created_at,
      kind: e.kind,
      tags: e.tags.map((t) => [...t]),
      content: e.content,
      sig: e.sig,
    });
  } catch {
    return false;
  }
}

/** Accepts `npub1…` or 64-char hex; returns lowercase hex. Throws otherwise. */
export function parsePubkey(input: string): string {
  const s = input.trim();
  if (HEX64.test(s.toLowerCase())) return s.toLowerCase();
  if (s.startsWith('npub1')) {
    const d = decode(s);
    if (d.type === 'npub') return d.data;
  }
  throw new TypeError('expected an npub1… string or 64 hex characters');
}

/** Hex pubkey to `npub1…`, for display. */
export function toNpub(hex: string): string {
  return npubEncode(hex);
}
