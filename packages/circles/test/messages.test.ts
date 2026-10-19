import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_CIRCLE_POLICY } from '../src/core.ts';
import type { RoundOpenMsg } from '../src/messages.ts';
import {
  MAX_CANDIDATES,
  decodeRoundKey,
  decodeRoundMasked,
  decodeRoundOpen,
  encodeRoundKey,
  encodeRoundMasked,
  encodeRoundOpen,
  isVideoId,
} from '../src/messages.ts';
import { hexId, video } from './helpers.ts';

const open: RoundOpenMsg = {
  v: 1,
  roundId: hexId(9),
  circleId: 'ab'.repeat(16),
  epoch: 4,
  openedAt: 1_792_411_200,
  keyDeadline: 1_792_411_200 + 3600,
  maskDeadline: 1_792_411_200 + 7200,
  policy: DEFAULT_CIRCLE_POLICY,
  candidates: [video(1), video(2), video(3)],
};

test('round messages round-trip with fixed key order', () => {
  assert.deepEqual(decodeRoundOpen(encodeRoundOpen(open)), open);
  const k = { v: 1 as const, roundId: hexId(9), epoch: 4, roundKey: hexId(3) };
  assert.deepEqual(decodeRoundKey(encodeRoundKey(k)), k);
  const m = { v: 1 as const, roundId: hexId(9), epoch: 4, participants: hexId(5), vector: 'AAAAAA==' };
  assert.deepEqual(decodeRoundMasked(encodeRoundMasked(m)), m);
});

test('receivers reject unknown and missing keys, bad versions and oversize text', () => {
  const o = JSON.parse(encodeRoundOpen(open));
  assert.throws(() => decodeRoundOpen(JSON.stringify({ ...o, extra: 1 })), /unknown key/);
  const { candidates: _c, ...missing } = o;
  assert.throws(() => decodeRoundOpen(JSON.stringify(missing)), /missing key/);
  assert.throws(() => decodeRoundOpen(JSON.stringify({ ...o, v: 2 })), /v must be 1/);
  assert.throws(() => decodeRoundKey(JSON.stringify({ v: 1, roundId: hexId(1), epoch: 1, roundKey: hexId(1), pad: 'x'.repeat(5000) })), /larger/);
});

test('round-open enforces core policy floors, sorted public candidates and sane deadlines', () => {
  const o = JSON.parse(encodeRoundOpen(open));
  assert.throws(() => decodeRoundOpen(JSON.stringify({ ...o, policy: { ...o.policy, minMembers: 5 } })), /policy/);
  assert.throws(() => decodeRoundOpen(JSON.stringify({ ...o, candidates: [video(2), video(1)] })), /sorted/);
  assert.throws(() => decodeRoundOpen(JSON.stringify({ ...o, candidates: [video(1), video(1)] })), /sorted and unique/);
  assert.throws(() => decodeRoundOpen(JSON.stringify({ ...o, candidates: ['javascript:alert(1)'] })), /video id/);
  assert.throws(() => decodeRoundOpen(JSON.stringify({ ...o, candidates: [] })), /candidates/);
  const many = Array.from({ length: MAX_CANDIDATES + 1 }, (_, i) => video(i)).sort();
  assert.throws(() => decodeRoundOpen(JSON.stringify({ ...o, candidates: many })), /candidates|larger/);
  assert.throws(() => decodeRoundOpen(JSON.stringify({ ...o, maskDeadline: o.keyDeadline })), /maskDeadline/);
  assert.equal(isVideoId('https://a.example/v/1'), true);
  assert.equal(isVideoId('https://a.example/v/"x"'), false);
});
