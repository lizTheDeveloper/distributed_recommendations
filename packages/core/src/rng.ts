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
