// Keys (THREAT_MODEL T10).
//
// Two kinds of key:
// - The long-term **identity key** (the user's npub). It only ever seals the two
//   messages that bind a match to a person: the match request (sent by the
//   requester) and the match accept (sent by the target), plus the target's
//   preview replies sent before it has accepted. It can live in a NIP-07
//   extension or a NIP-46/NIP-55 remote signer.
// - A fresh **per-match key** for each side of each match, generated at random on
//   the device (`generateMatchKey`, nostr-tools `generateSecretKey`). Its public
//   half is announced only *inside* the encrypted request / accept, so the binding
//   "this match key belongs to that identity" is authenticated by the identity
//   key's seal signature and is never visible to relays. Every later message
//   (sketches, renewals, revocation) is sealed by the sender's match key and
//   gift-wrapped *to* the peer's match key.
//
// No key derivation, no new crypto: keys are independent random secp256k1 keys,
// and all encryption is NIP-44 v2 via nostr-tools.

import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import * as nip44 from 'nostr-tools/nip44';
import { bytesToHex, hexToBytes } from 'nostr-tools/utils';

export interface EventTemplate {
  kind: number;
  created_at: number;
  tags: string[][];
  content: string;
}

export interface SignedEvent extends EventTemplate {
  id: string;
  pubkey: string;
  sig: string;
}

/**
 * Anything that can sign and NIP-44-encrypt for one key. The shape is NIP-07's
 * `window.nostr` (`getPublicKey`, `signEvent`, `nip44.encrypt/decrypt`), which
 * NIP-46 remote signers also offer, so an identity key never has to be handed to
 * this package. `getPublicKey`/`signEvent` match `@match-feed/bridge`'s `Signer`.
 */
export interface NostrSigner {
  getPublicKey(): Promise<string>;
  signEvent(event: EventTemplate): Promise<SignedEvent>;
  nip44: {
    encrypt(pubkey: string, plaintext: string): Promise<string>;
    decrypt(pubkey: string, ciphertext: string): Promise<string>;
  };
}

/** A per-match key pair, hex. Serializable; store it only in encrypted-at-rest storage (T9). */
export interface MatchKeyPair {
  secret: string;
  pubkey: string;
}

/** NIP-44 v2's plaintext limit. nostr-tools 2.25 accepts more; we don't, to stay interoperable. */
export const NIP44_MAX_PLAINTEXT = 65_535;

function checkPlaintext(plaintext: string): void {
  if (new TextEncoder().encode(plaintext).length > NIP44_MAX_PLAINTEXT) {
    throw new RangeError(`NIP-44 plaintext over ${NIP44_MAX_PLAINTEXT} bytes`);
  }
}

/** A local-key signer (nostr-tools). For per-match keys, tests and simulations. */
export function localSigner(secretKey: Uint8Array | string): NostrSigner {
  const sk = typeof secretKey === 'string' ? hexToBytes(secretKey) : secretKey;
  const pubkey = getPublicKey(sk);
  return {
    async getPublicKey() {
      return pubkey;
    },
    async signEvent(t: EventTemplate): Promise<SignedEvent> {
      return finalizeEvent({ kind: t.kind, created_at: t.created_at, tags: t.tags, content: t.content }, sk) as SignedEvent;
    },
    nip44: {
      async encrypt(peer: string, plaintext: string) {
        checkPlaintext(plaintext);
        return nip44.v2.encrypt(plaintext, nip44.v2.utils.getConversationKey(sk, peer));
      },
      async decrypt(peer: string, ciphertext: string) {
        return nip44.v2.decrypt(ciphertext, nip44.v2.utils.getConversationKey(sk, peer));
      },
    },
  };
}

/** A fresh random per-match key. */
export function generateMatchKey(): MatchKeyPair {
  const sk = generateSecretKey();
  return { secret: bytesToHex(sk), pubkey: getPublicKey(sk) };
}

export function matchKeySigner(key: MatchKeyPair): NostrSigner {
  return localSigner(key.secret);
}
