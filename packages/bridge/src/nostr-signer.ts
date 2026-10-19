// Local-key Signer backed by nostr-tools (Unlicense; deps are paulmillr's
// noble/scure). Only this file imports nostr-tools, so the mapping and id code
// stay dependency-free for use in the app with a NIP-07/NIP-46 signer instead.

import { finalizeEvent, generateSecretKey, getPublicKey, verifyEvent } from 'nostr-tools/pure';
import { decode } from 'nostr-tools/nip19';
import type { Signer } from './event.ts';
import type { EventTemplate, SignedEvent } from './types.ts';

/** Parse a secret key given as 64-char hex or NIP-19 `nsec1…`. */
export function parseSecretKey(input: string): Uint8Array {
  const s = input.trim();
  if (/^[0-9a-fA-F]{64}$/.test(s)) {
    return Uint8Array.from(s.match(/../g)!.map((h) => parseInt(h, 16)));
  }
  if (s.startsWith('nsec1')) {
    const d = decode(s);
    if (d.type === 'nsec') return d.data;
  }
  throw new Error('secret key must be 64 hex characters or an nsec1… string');
}

export function secretKeySigner(secretKey: Uint8Array): Signer {
  const pubkey = getPublicKey(secretKey);
  return {
    async getPublicKey() {
      return pubkey;
    },
    async signEvent(t: EventTemplate): Promise<SignedEvent> {
      return finalizeEvent(t, secretKey) as SignedEvent;
    },
  };
}

/** A throwaway key, for dry runs and tests only. */
export function ephemeralSigner(): Signer {
  return secretKeySigner(generateSecretKey());
}

/** BIP-340 signature + id check (nostr-tools). */
export function verifySignedEvent(e: SignedEvent): boolean {
  return verifyEvent({ ...e, tags: e.tags.map((t) => [...t]) });
}
