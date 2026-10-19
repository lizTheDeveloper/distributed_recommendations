// Signers backed by nostr-tools (Unlicense; deps are paulmillr's noble/scure):
// a local key, and a NIP-46 remote signer ("bunker"). Only this file imports
// nostr-tools, so the mapping, id and relay code stay dependency-free for use
// in the app with a NIP-07 signer instead.

import { finalizeEvent, generateSecretKey, getPublicKey, verifyEvent } from 'nostr-tools/pure';
import { decode } from 'nostr-tools/nip19';
import { BUNKER_REGEX, BunkerSigner } from 'nostr-tools/nip46';
import type { BunkerPointer } from 'nostr-tools/nip46';
import { SimplePool } from 'nostr-tools/pool';
import type { AbstractSimplePool } from 'nostr-tools/abstract-pool';
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

/**
 * BIP-340 signature + id check (nostr-tools). nostr-tools' verifyEvent caches
 * its verdict in a symbol property on the object, and object spread copies
 * symbols, so a tampered copy of an event that once verified would pass
 * (THREAT_MODEL T25). Always verify a fresh object built only from the NIP-01
 * fields. Used for our own signer's output and for events read from relays.
 */
export function verifySignedEvent(e: SignedEvent): boolean {
  if (!e || typeof e !== 'object' || !Array.isArray(e.tags)) return false;
  if (!e.tags.every((t) => Array.isArray(t))) return false;
  return verifyEvent({
    id: e.id,
    pubkey: e.pubkey,
    created_at: e.created_at,
    kind: e.kind,
    tags: e.tags.map((t) => [...t]),
    content: e.content,
    sig: e.sig,
  });
}

/**
 * Parse a `bunker://<remote-signer-pubkey>?relay=wss://…&secret=…` URL (NIP-46).
 * Unlike nostr-tools' parseBunkerInput this never falls back to a NIP-05
 * network lookup, and it insists on at least one ws(s):// relay.
 */
export function parseBunkerUrl(input: string): BunkerPointer {
  const m = input.trim().match(BUNKER_REGEX);
  if (!m) throw new Error('bunker URL must look like bunker://<64-hex pubkey>?relay=wss://…[&secret=…]');
  const qs = new URLSearchParams(m[2]);
  const relays = qs.getAll('relay');
  if (relays.length === 0) throw new Error('bunker URL has no relay= parameter');
  for (const r of relays) {
    const p = new URL(r).protocol;
    if (p !== 'wss:' && p !== 'ws:') throw new Error(`bunker relay must be ws:// or wss://: ${r}`);
  }
  return { pubkey: m[1], relays, secret: qs.get('secret') };
}

export interface BunkerOptions {
  /**
   * Key for the NIP-46 client session (not the signing key). Reusing one lets
   * the remote signer remember this bridge; by default a fresh one is made.
   */
  clientSecretKey?: Uint8Array;
  /** Pool used to talk to the bunker's relays (tests inject a fake). */
  pool?: AbstractSimplePool;
  /** Timeout for each request; the user may have to approve it (default 120 s). */
  timeoutMs?: number;
  /** Called when the bunker asks the user to open an authorization URL. */
  onauth?: (url: string) => void;
}

export type ClosableSigner = Signer & { close(): Promise<void> };

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    p,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`NIP-46 ${what}: no answer from remote signer within ${ms} ms`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/**
 * The creator's own key through a NIP-46 remote signer, using nostr-tools'
 * BunkerSigner (2.25.2: `nostr-tools/nip46` exports BunkerSigner, BUNKER_REGEX,
 * parseBunkerInput). Connects, asks for the user's pubkey once, and returns a
 * Signer. Call close() when done so the process can exit.
 */
export async function bunkerSigner(bunkerUrl: string, opts: BunkerOptions = {}): Promise<ClosableSigner> {
  const bp = parseBunkerUrl(bunkerUrl);
  const ownPool = !opts.pool;
  const pool = opts.pool ?? new SimplePool();
  const ms = opts.timeoutMs ?? 120_000;
  const bunker = BunkerSigner.fromBunker(opts.clientSecretKey ?? generateSecretKey(), bp, { pool, onauth: opts.onauth });
  const close = async () => {
    await bunker.close();
    if (ownPool) pool.destroy();
  };
  try {
    await withTimeout(bunker.connect(), ms, 'connect');
    const pubkey = await withTimeout(bunker.getPublicKey(), ms, 'get_public_key');
    if (!/^[0-9a-f]{64}$/.test(pubkey)) throw new Error('remote signer returned a malformed pubkey');
    return {
      async getPublicKey() {
        return pubkey;
      },
      async signEvent(t: EventTemplate): Promise<SignedEvent> {
        return (await withTimeout(bunker.signEvent(t), ms, 'sign_event')) as SignedEvent;
      },
      close,
    };
  } catch (err) {
    await close();
    throw err;
  }
}
