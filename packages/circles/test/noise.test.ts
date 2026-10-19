import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defaultNoiseTolerance, memberNoiseKey, noiseShare, noiseShareVector, samplePolya, shareShape } from '../src/noise.ts';
import { KeyedStream } from '../src/prg.ts';

const KEY = new Uint8Array(32).fill(42);
const EPS = 1;
const ALPHA = Math.exp(-EPS);

function stats(xs: number[]) {
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const variance = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length;
  const p0 = xs.filter((x) => x === 0).length / xs.length;
  return { mean, variance, p0 };
}

test('Pólya(r, α) has mean rα/(1−α), including small shapes', () => {
  const u = new KeyedStream(KEY).rng();
  for (const r of [1, 0.1]) {
    const xs = Array.from({ length: 20_000 }, () => samplePolya(r, ALPHA, u));
    const { mean } = stats(xs);
    const expected = (r * ALPHA) / (1 - ALPHA);
    assert.ok(Math.abs(mean - expected) < 0.05 * Math.max(1, expected * 4), `r=${r}: mean ${mean} vs ${expected}`);
  }
});

test('12 shares with r = 1/12 sum to discrete Laplace(ε = 1): P(0) ≈ 0.462, variance ≈ 1.84', () => {
  const u = new KeyedStream(KEY).rng();
  const m = 12;
  const xs = Array.from({ length: 20_000 }, () => {
    let s = 0;
    for (let i = 0; i < m; i++) s += noiseShare(EPS, 1 / m, u);
    return s;
  });
  const { mean, variance, p0 } = stats(xs);
  assert.ok(Math.abs(mean) < 0.05, `mean ${mean}`);
  assert.ok(Math.abs(p0 - (1 - ALPHA) / (1 + ALPHA)) < 0.015, `P(0) ${p0}`);
  assert.ok(Math.abs(variance - (2 * ALPHA) / (1 - ALPHA) ** 2) < 0.15, `variance ${variance}`);
});

test('collusion tolerance: any m − c honest shares already sum to ≥ discrete Laplace', () => {
  assert.equal(defaultNoiseTolerance(12), 3);
  assert.equal(defaultNoiseTolerance(8), 2);
  assert.equal(defaultNoiseTolerance(30), 9);
  const m = 12;
  const c = defaultNoiseTolerance(m);
  const r = shareShape(m, c);
  assert.equal(r, 1 / 9);
  // The 9 honest shares of 12 sum to Pólya(1) − Pólya(1): exactly discrete Laplace.
  const u = new KeyedStream(KEY).rng();
  const honest = Array.from({ length: 20_000 }, () => {
    let s = 0;
    for (let i = 0; i < m - c; i++) s += noiseShare(EPS, r, u);
    return s;
  });
  assert.ok(Math.abs(stats(honest).p0 - (1 - ALPHA) / (1 + ALPHA)) < 0.015);
  assert.throws(() => shareShape(12, 12));
});

test('noise shares are sticky per (member secret, circle, epoch) and differ otherwise', () => {
  const secret = new Uint8Array(32).fill(1);
  const a = noiseShareVector(memberNoiseKey(secret, 'abcd', 7), 150, EPS, 1 / 9);
  const b = noiseShareVector(memberNoiseKey(secret, 'abcd', 7), 150, EPS, 1 / 9);
  const c = noiseShareVector(memberNoiseKey(secret, 'abcd', 8), 150, EPS, 1 / 9);
  const d = noiseShareVector(memberNoiseKey(new Uint8Array(32).fill(2), 'abcd', 7), 150, EPS, 1 / 9);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
  assert.notDeepEqual(a, d);
  assert.throws(() => memberNoiseKey(new Uint8Array(16), 'abcd', 1));
});
