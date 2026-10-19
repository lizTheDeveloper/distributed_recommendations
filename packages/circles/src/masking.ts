// Pairwise additive masking (the core of Bonawitz et al., "Practical Secure
// Aggregation for Privacy-Preserving Machine Learning", CCS 2017, without its
// secret-shared dropout recovery and without its self-mask; see docs/CIRCLES.md).
//
// Every participant i holds a fresh X25519 key pair for one round. For each other
// participant j, i derives
//     k_ij = HKDF-SHA-256(ikm = X25519(a_i, A_j), salt = roundContext,
//                         info = "mask" ‖ min(id_i,id_j) ‖ max(id_i,id_j) ‖ A_min ‖ A_max)
//     m_ij = ChaCha20 keystream under k_ij, read as uint32 words
// and sends   y_i = x_i + Σ_{j: id_i < id_j} m_ij − Σ_{j: id_i > id_j} m_ij   (mod 2^32).
// Since m_ij = m_ji, the masks cancel in Σ_i y_i = Σ_i x_i (mod 2^32), provided
// everyone used the same participant set. Any single y_i, seen by anyone who lacks
// at least one of i's pairwise keys, is uniformly distributed (one-time pad).
//
// Primitives: @noble/curves x25519, @noble/hashes HKDF-SHA-256, @noble/ciphers
// ChaCha20. No homebrew cryptography.

import { x25519 } from '@noble/curves/ed25519.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { deriveKey, keystreamU32 } from './prg.ts';

export const RING_BITS = 32;

export interface RoundKeyPair {
  /** 32-byte X25519 secret. Held in memory for one round only; never stored or sent. */
  secretKey: Uint8Array;
  /** 32-byte X25519 public key, hex. Sent in the round-key message. */
  publicKey: string;
}

export function generateRoundKey(): RoundKeyPair {
  const k = x25519.keygen();
  return { secretKey: k.secretKey, publicKey: bytesToHex(k.publicKey) };
}

/** A participant as seen by the masking layer: identity (Nostr pubkey hex) + round key. */
export interface MaskPeer {
  identity: string;
  roundKey: string;
}

function isAllZero(b: Uint8Array): boolean {
  let acc = 0;
  for (const x of b) acc |= x;
  return acc === 0;
}

/** The pairwise mask m_ij (= m_ji) of `length` words. */
export function pairMask(
  mySecret: Uint8Array,
  me: MaskPeer,
  peer: MaskPeer,
  roundContext: Uint8Array,
  length: number,
): Uint32Array {
  if (me.identity === peer.identity) throw new Error('no mask with oneself');
  const peerPub = hexToBytes(peer.roundKey);
  if (peerPub.length !== 32) throw new RangeError('round key must be 32 bytes');
  let shared: Uint8Array;
  try {
    shared = x25519.getSharedSecret(mySecret, peerPub);
  } catch {
    throw new Error('invalid peer round key');
  }
  // RFC 7748 §6.1: reject the all-zero output (low-order peer key).
  if (isAllZero(shared)) throw new Error('invalid peer round key (low order)');
  const [lo, hi] = me.identity < peer.identity ? [me, peer] : [peer, me];
  const key = deriveKey(
    shared,
    roundContext,
    'mask',
    hexToBytes(lo.identity),
    hexToBytes(hi.identity),
    hexToBytes(lo.roundKey),
    hexToBytes(hi.roundKey),
  );
  return keystreamU32(key, length);
}

/**
 * y = x + Σ_{peers above me} m − Σ_{peers below me} m (mod 2^32). `x` is the
 * already-noised input (0/1 endorsements plus this member's noise share, mod 2^32).
 * `participants` is the full agreed participant set, including `me`.
 */
export function maskVector(
  x: Uint32Array,
  mySecret: Uint8Array,
  me: MaskPeer,
  participants: readonly MaskPeer[],
  roundContext: Uint8Array,
): Uint32Array {
  const y = new Uint32Array(x);
  let sawMe = false;
  for (const p of participants) {
    if (p.identity === me.identity) {
      if (p.roundKey !== me.roundKey) throw new Error('participant list has a different round key for me');
      sawMe = true;
      continue;
    }
    const m = pairMask(mySecret, me, p, roundContext, x.length);
    if (me.identity < p.identity) for (let i = 0; i < y.length; i++) y[i] = (y[i] + m[i]) >>> 0;
    else for (let i = 0; i < y.length; i++) y[i] = (y[i] - m[i]) >>> 0;
  }
  if (!sawMe) throw new Error('I am not in the participant list');
  return y;
}

/** Σ vectors mod 2^32. */
export function sumVectors(vectors: readonly Uint32Array[], length: number): Uint32Array {
  const s = new Uint32Array(length);
  for (const v of vectors) {
    if (v.length !== length) throw new RangeError('vector length mismatch');
    for (let i = 0; i < length; i++) s[i] = (s[i] + v[i]) >>> 0;
  }
  return s;
}

/** Ring element → signed integer in [−2^31, 2^31). Noised counts can be negative. */
export function toSigned(v: number): number {
  return v | 0;
}

/** Signed integer → ring element. */
export function fromSigned(n: number): number {
  if (!Number.isInteger(n)) throw new RangeError('not an integer');
  return n >>> 0;
}

export function encodeVector(v: Uint32Array): string {
  const bytes = new Uint8Array(v.length * 4);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < v.length; i++) view.setUint32(i * 4, v[i], true);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

export function decodeVector(b64: string, length: number): Uint32Array {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(b64)) throw new Error('vector is not base64');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  if (bytes.length !== length * 4) throw new Error(`vector must be ${length} words`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = new Uint32Array(length);
  for (let i = 0; i < length; i++) out[i] = view.getUint32(i * 4, true);
  return out;
}
