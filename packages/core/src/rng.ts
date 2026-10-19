import type { Rng } from "./types.ts";

/**
 * Deterministic RNG (mulberry32) for tests and simulations. Not for secrets.
 */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** RNG backed by `crypto.getRandomValues`. Use this in production. */
export function cryptoRng(): Rng {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (!c || typeof c.getRandomValues !== "function") {
    throw new Error("crypto.getRandomValues is not available");
  }
  const buf = new Uint32Array(2);
  return () => {
    c.getRandomValues(buf);
    // 53 random bits -> float in [0, 1).
    return ((buf[0] >>> 5) * 67108864 + (buf[1] >>> 6)) / 9007199254740992;
  };
}

/** Uniform integer in [0, n). */
export function randomInt(rng: Rng, n: number): number {
  return Math.min(n - 1, Math.floor(rng() * n));
}

/** `bytes` random bytes from `rng`, as lowercase hex. */
export function randomHex(rng: Rng, bytes: number): string {
  let out = "";
  for (let i = 0; i < bytes; i++) out += randomInt(rng, 256).toString(16).padStart(2, "0");
  return out;
}

/** Fisher-Yates shuffle into a new array. */
export function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(rng, i + 1);
    const t = a[i];
    a[i] = a[j];
    a[j] = t;
  }
  return a;
}

// --- Keyed, deterministic randomness (sticky noise) -------------------------------

const K256 = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** SHA-256 of `data` (synchronous, dependency-free; used only to derive sticky noise). */
export function sha256(data: Uint8Array): Uint8Array {
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const len = data.length;
  const padded = new Uint8Array(((len + 9 + 63) >> 6) << 6);
  padded.set(data);
  padded[len] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(len / 0x20000000), false);
  view.setUint32(padded.length - 4, (len << 3) >>> 0, false);
  const w = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K256[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0] + a) >>> 0;
    h[1] = (h[1] + b) >>> 0;
    h[2] = (h[2] + c) >>> 0;
    h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0;
    h[5] = (h[5] + f) >>> 0;
    h[6] = (h[6] + g) >>> 0;
    h[7] = (h[7] + hh) >>> 0;
  }
  const out = new Uint8Array(32);
  const ov = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) ov.setUint32(i * 4, h[i], false);
  return out;
}

/**
 * Deterministic RNG keyed by a secret `key` and a public `label`: SHA-256 in counter
 * mode over `key ‖ 0 ‖ label ‖ 0 ‖ counter`. The same (key, label) always yields the
 * same stream, which is what "sticky" noise needs (one noise draw per circle item per
 * epoch: key = the epoch's secret noise seed, label = the video id).
 *
 * The output is only as unpredictable as `key`. Anyone who knows the key can recompute
 * the noise and subtract it, so a circle's noise seed must stay inside the secure
 * aggregation and never reach a member. A production build should use an audited PRF
 * (HMAC-SHA-256) and sampler; this one is a dependency-free reference.
 */
export function keyedRng(key: string, label: string): Rng {
  const enc = new TextEncoder();
  const prefix = enc.encode(`${key}\u0000${label}\u0000`);
  let counter = 0;
  let block = new Uint8Array(0);
  let pos = 0;
  const next32 = (): number => {
    if (pos + 4 > block.length) {
      const msg = new Uint8Array(prefix.length + 4);
      msg.set(prefix);
      new DataView(msg.buffer).setUint32(prefix.length, counter++, false);
      block = sha256(msg);
      pos = 0;
    }
    const v = new DataView(block.buffer, block.byteOffset).getUint32(pos, false);
    pos += 4;
    return v;
  };
  // 53 random bits -> float in [0, 1).
  return () => ((next32() >>> 5) * 67108864 + (next32() >>> 6)) / 9007199254740992;
}
