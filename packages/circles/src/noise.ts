// Distributed discrete-Laplace noise from per-member Pólya shares (THREAT_MODEL T19).
//
// Core's circle policy wants, per item per epoch, two-sided geometric ("discrete
// Laplace") noise Z with P(Z = k) ∝ α^|k|, α = e^−ε. Z is the difference of two
// independent Geometric(1−α) variables, and a geometric variable is a negative
// binomial (Pólya) variable with shape r = 1, which is infinitely divisible:
//     Pólya(r1, α) + Pólya(r2, α) = Pólya(r1 + r2, α).
// So if each of m members adds X_i − Y_i with X_i, Y_i ~ Pólya(1/m, α), the sum is
// exactly discrete Laplace(ε). This is Theorem 5.1 of Goryczka & Xiong, "A
// Comprehensive Comparison of Multiparty Secure Additions with Differential
// Privacy", IEEE TDSC 14(5), 2017 (DOI 10.1109/TDSC.2015.2484326).
//
// Nobody ever holds the total noise or a seed for it: each member's share comes
// from its own local secret, and the shares are summed inside the masked sum.
//
// Collusion. Members know their own shares, so a coalition of c members can
// subtract theirs; the noise protecting everyone else is then only the honest
// members' shares. To keep the full ε guarantee against up to c colluders, each
// member draws with shape r = 1/(m − c): any m − c honest shares then already sum
// to Pólya(≥ 1), i.e. at least discrete Laplace(ε) plus extra independent noise,
// which only helps (post-processing). Each member picks c locally; no agreement is
// needed, and the guarantee holds for at most the smallest c any honest member used.
//
// Sampling: Pólya(r, α) = Poisson(λ), λ ~ Gamma(shape r, scale α/(1−α)). The
// samplers below are textbook (Marsaglia–Tsang gamma, Knuth Poisson) over a
// ChaCha20 stream. They use floating point, so the realised distribution is only
// approximately Pólya: PROTOTYPE ONLY. A production build needs an exact
// integer sampler (cf. Canonne, Kamath & Steinke, NeurIPS 2020) and review against
// floating-point attacks (Mironov, CCS 2012). See docs/CIRCLES.md.

import { KeyedStream, deriveKey, utf8ToBytes } from './prg.ts';

/** Default collusion tolerance for m participants: ⌈m/3⌉ − 1 (as in Bonawitz et al.'s bound). */
export function defaultNoiseTolerance(m: number): number {
  if (!Number.isInteger(m) || m < 1) throw new RangeError('participants must be a positive integer');
  return Math.ceil(m / 3) - 1;
}

/** Pólya shape for one member's share: 1/(m − c). */
export function shareShape(m: number, tolerance: number): number {
  if (!Number.isInteger(tolerance) || tolerance < 0 || tolerance >= m) throw new RangeError('tolerance must be in [0, m)');
  return 1 / (m - tolerance);
}

function uniformOpen(u: () => number): number {
  // (0, 1): never 0, so log() is finite.
  let x = u();
  while (x === 0) x = u();
  return x;
}

function standardNormal(u: () => number): number {
  // Box–Muller.
  return Math.sqrt(-2 * Math.log(uniformOpen(u))) * Math.cos(2 * Math.PI * u());
}

/** Gamma(shape, 1) by Marsaglia & Tsang (2000), with the U^(1/shape) boost for shape < 1. */
export function sampleGamma(shape: number, u: () => number): number {
  if (!(shape > 0)) throw new RangeError('gamma shape must be positive');
  if (shape < 1) return sampleGamma(shape + 1, u) * Math.pow(uniformOpen(u), 1 / shape);
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number;
    let v: number;
    do {
      x = standardNormal(u);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const w = uniformOpen(u);
    if (w < 1 - 0.0331 * x * x * x * x) return d * v;
    if (Math.log(w) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

/** Poisson(λ) by Knuth's method, split into chunks of ≤ 30 so exp(−λ) never underflows. */
export function samplePoisson(lambda: number, u: () => number): number {
  if (!(lambda >= 0) || !Number.isFinite(lambda)) throw new RangeError('lambda must be finite and ≥ 0');
  let total = 0;
  let rest = lambda;
  while (rest > 0) {
    const l = Math.min(rest, 30);
    rest -= l;
    const limit = Math.exp(-l);
    let k = 0;
    let p = u();
    while (p > limit) {
      k++;
      p *= u();
    }
    total += k;
  }
  return total;
}

/** Pólya(r, α): negative binomial with P(k) ∝ Γ(k+r)/k! · α^k. Mean rα/(1−α). */
export function samplePolya(r: number, alpha: number, u: () => number): number {
  if (!(alpha > 0 && alpha < 1)) throw new RangeError('alpha must be in (0, 1)');
  return samplePoisson(sampleGamma(r, u) * (alpha / (1 - alpha)), u);
}

/** One member's noise share for one item: X − Y, X, Y ~ Pólya(r, e^−ε). */
export function noiseShare(epsilon: number, r: number, u: () => number): number {
  const alpha = Math.exp(-epsilon);
  return samplePolya(r, alpha, u) - samplePolya(r, alpha, u);
}

/**
 * The member-local key for its noise shares in one epoch of one circle. Derived
 * from a secret that never leaves the member's device, so the share is sticky
 * (the same epoch always gives the same draws) and nobody else can recompute it.
 */
export function memberNoiseKey(localSecret: Uint8Array, circleId: string, epoch: number): Uint8Array {
  if (localSecret.length < 32) throw new RangeError('local secret must be ≥ 32 bytes');
  if (!Number.isSafeInteger(epoch) || epoch < 0) throw new RangeError('epoch must be a non-negative integer');
  return deriveKey(localSecret, utf8ToBytes(circleId), 'noise-share', utf8ToBytes(String(epoch)));
}

/**
 * This member's noise shares for a whole domain, in index order. Deterministic in
 * (key, length, ε, r).
 */
export function noiseShareVector(key: Uint8Array, length: number, epsilon: number, r: number): Int32Array {
  if (!(epsilon > 0)) throw new RangeError('epsilon must be positive');
  const stream = new KeyedStream(key);
  const u = stream.rng();
  const out = new Int32Array(length);
  for (let i = 0; i < length; i++) out[i] = noiseShare(epsilon, r, u);
  return out;
}
