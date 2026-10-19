// Deterministic randomness from standard, audited primitives only (@noble):
// - HKDF-SHA-256 (RFC 5869) derives one 32-byte key per purpose;
// - ChaCha20 (RFC 8439) keystream under that key, zero nonce, is the PRG.
// A key is used for exactly one stream, so the fixed nonce is safe (no nonce
// reuse across different plaintexts: there is no plaintext, only keystream).
//
// This replaces core's `keyedRng` (THREAT_MODEL T20, a hand-written SHA-256 in
// counter mode) for everything in this package.

import { chacha20 } from '@noble/ciphers/chacha.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { concatBytes, utf8ToBytes } from '@noble/hashes/utils.js';

/** Domain-separation prefix for every HKDF `info` in this package. */
export const KDF_PREFIX = 'match-feed/circles/v1/';

/** HKDF-SHA-256 → 32-byte key. `label` is domain-separated by KDF_PREFIX. */
export function deriveKey(ikm: Uint8Array, salt: Uint8Array, label: string, ...context: Uint8Array[]): Uint8Array {
  return hkdf(sha256, ikm, salt, concatBytes(utf8ToBytes(KDF_PREFIX + label), new Uint8Array([0]), ...context), 32);
}

const ZERO_NONCE = new Uint8Array(12);

/** `length` bytes of ChaCha20 keystream for `key`, starting at block `counter`. */
export function keystream(key: Uint8Array, length: number, counter = 0): Uint8Array {
  if (key.length !== 32) throw new RangeError('keystream key must be 32 bytes');
  return chacha20(key, ZERO_NONCE, new Uint8Array(length), undefined, counter);
}

/** Keystream as little-endian uint32 words. */
export function keystreamU32(key: Uint8Array, words: number): Uint32Array {
  const bytes = keystream(key, words * 4);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = new Uint32Array(words);
  for (let i = 0; i < words; i++) out[i] = view.getUint32(i * 4, true);
  return out;
}

const CHUNK_BYTES = 4096; // 64 ChaCha blocks
const CHUNK_BLOCKS = CHUNK_BYTES / 64;

/**
 * A synchronous stream of uniform doubles in [0, 1) with 53 random bits each,
 * read from a ChaCha20 keystream. Deterministic given the key (that is what makes
 * noise "sticky": the same key gives the same draws).
 */
export class KeyedStream {
  private readonly key: Uint8Array;
  private buf: Uint8Array = new Uint8Array(0);
  private view: DataView = new DataView(new ArrayBuffer(0));
  private pos = 0;
  private block = 0;

  constructor(key: Uint8Array) {
    if (key.length !== 32) throw new RangeError('KeyedStream key must be 32 bytes');
    this.key = key;
  }

  private refill(): void {
    if (this.block + CHUNK_BLOCKS > 0xffffffff) throw new RangeError('keystream exhausted');
    this.buf = keystream(this.key, CHUNK_BYTES, this.block);
    this.view = new DataView(this.buf.buffer, this.buf.byteOffset, this.buf.byteLength);
    this.block += CHUNK_BLOCKS;
    this.pos = 0;
  }

  /** Uniform in [0, 1), 53 bits. */
  next(): number {
    if (this.pos + 8 > this.buf.length) this.refill();
    const hi = this.view.getUint32(this.pos, true) >>> 5; // 27 bits
    const lo = this.view.getUint32(this.pos + 4, true) >>> 6; // 26 bits
    this.pos += 8;
    return (hi * 67108864 + lo) / 9007199254740992;
  }

  /** As a core-compatible `Rng` function. */
  rng(): () => number {
    return () => this.next();
  }
}

export { concatBytes, utf8ToBytes };
