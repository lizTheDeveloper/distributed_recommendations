import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { MaskPeer } from '../src/masking.ts';
import { decodeVector, encodeVector, fromSigned, generateRoundKey, maskVector, pairMask, sumVectors, toSigned } from '../src/masking.ts';
import { hexId } from './helpers.ts';

const CTX = new Uint8Array(32).fill(7);
const N = 64;

function setup(n: number) {
  const keys = Array.from({ length: n }, () => generateRoundKey());
  const peers: MaskPeer[] = keys.map((k, i) => ({ identity: hexId(i + 1), roundKey: k.publicKey }));
  const inputs = Array.from({ length: n }, (_, i) => {
    const x = new Uint32Array(N);
    for (let j = 0; j < N; j++) x[j] = fromSigned(((i * 7 + j * 3) % 5 === 0 ? 1 : 0) + ((j % 3) - 1));
    return x;
  });
  const masked = inputs.map((x, i) => maskVector(x, keys[i].secretKey, peers[i], peers, CTX));
  return { keys, peers, inputs, masked };
}

test('pairwise masks are symmetric: m_ij = m_ji', () => {
  const a = generateRoundKey();
  const b = generateRoundKey();
  const pa = { identity: hexId(1), roundKey: a.publicKey };
  const pb = { identity: hexId(2), roundKey: b.publicKey };
  assert.deepEqual(pairMask(a.secretKey, pa, pb, CTX, N), pairMask(b.secretKey, pb, pa, CTX, N));
  // Bound to the round context: another round gives an unrelated mask.
  assert.notDeepEqual(pairMask(a.secretKey, pa, pb, CTX, N), pairMask(a.secretKey, pa, pb, new Uint8Array(32), N));
});

test('masks cancel: the sum of 12 masked vectors equals the sum of the inputs (mod 2^32)', () => {
  const { inputs, masked } = setup(12);
  assert.deepEqual(sumVectors(masked, N), sumVectors(inputs, N));
  // Signed decoding of the sum gives back small integers.
  const s = sumVectors(inputs, N);
  for (let j = 0; j < N; j++) assert.ok(Math.abs(toSigned(s[j])) <= 24);
});

test('a masked vector hides its input from any coalition that misses one pairwise key', () => {
  const n = 12;
  const { keys, peers, inputs, masked } = setup(n);
  const target = 3;
  const outsider = 7; // the one member not in the coalition (besides the target)
  // The coalition (everyone but target and outsider) strips every mask it can compute.
  const residual = new Uint32Array(masked[target]);
  for (let c = 0; c < n; c++) {
    if (c === target || c === outsider) continue;
    const m = pairMask(keys[c].secretKey, peers[c], peers[target], CTX, N);
    const sign = peers[target].identity < peers[c].identity ? -1 : 1; // undo the target's +/−
    for (let j = 0; j < N; j++) residual[j] = (residual[j] + sign * m[j]) >>> 0;
  }
  // What's left is x + (±) m_{target,outsider}: a one-time pad. If the coalition
  // could unmask, residuals would be small integers; check they are not.
  let small = 0;
  for (let j = 0; j < N; j++) if (Math.abs(toSigned((residual[j] - inputs[target][j]) >>> 0)) < 1_000) small++;
  assert.equal(small, 0);
});

test('documented limit: all n−1 other members together recover x (same as subtracting from the output)', () => {
  const n = 12;
  const { keys, peers, inputs, masked } = setup(n);
  const target = 3;
  const residual = new Uint32Array(masked[target]);
  for (let c = 0; c < n; c++) {
    if (c === target) continue;
    const m = pairMask(keys[c].secretKey, peers[c], peers[target], CTX, N);
    const sign = peers[target].identity < peers[c].identity ? -1 : 1;
    for (let j = 0; j < N; j++) residual[j] = (residual[j] + sign * m[j]) >>> 0;
  }
  assert.deepEqual(residual, inputs[target]);
});

test('masking refuses a low-order (all-zero) peer key and a participant list without me', () => {
  const a = generateRoundKey();
  const me = { identity: hexId(1), roundKey: a.publicKey };
  assert.throws(() => pairMask(a.secretKey, me, { identity: hexId(2), roundKey: '00'.repeat(32) }, CTX, 4));
  assert.throws(() => maskVector(new Uint32Array(4), a.secretKey, me, [{ identity: hexId(2), roundKey: generateRoundKey().publicKey }], CTX));
});

test('vector encoding round-trips and checks length', () => {
  const v = Uint32Array.from([0, 1, 0xffffffff, 12345678]);
  assert.deepEqual(decodeVector(encodeVector(v), 4), v);
  assert.throws(() => decodeVector(encodeVector(v), 5));
  assert.throws(() => decodeVector('not base64!', 4));
  assert.equal(toSigned(fromSigned(-3)), -3);
});
