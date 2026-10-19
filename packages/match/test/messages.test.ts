import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ValidationError } from '../src/core.ts';
import { MATCH_KINDS, matchKindName } from '../src/kinds.ts';
import type { ControlKindName, ControlMessages } from '../src/messages.ts';
import { CONTROL_MESSAGE_BYTES, MESSAGE_FIELDS, decodeControl, encodeControl } from '../src/messages.ts';
import { T0 } from './helpers.ts';

const now = Math.floor(T0.getTime() / 1000);
const H = (c: string) => c.repeat(64);
const opts = { now: T0 };

const samples: { [K in ControlKindName]: ControlMessages[K] } = {
  matchRequest: { v: 1, matchId: H('a'), issuedAt: now, matchKey: H('b'), durationDays: 90 },
  matchAccept: { v: 1, matchId: H('a'), issuedAt: now, matchKey: H('c'), expiresAt: now + 90 * 86_400 },
  previewRequest: { v: 1, matchId: H('a'), issuedAt: now, previewId: H('d') },
  previewResponse: { v: 1, matchId: H('a'), issuedAt: now, previewId: H('d'), accept: true, psiRequest: 'AAEC' },
  previewAnswer: { v: 1, matchId: H('a'), issuedAt: now, previewId: H('d'), setSize: 40, psiSetup: 'AAEC', psiResponse: 'AwQF' },
  previewResult: { v: 1, matchId: H('a'), issuedAt: now, previewId: H('d'), floor: 5, belowFloor: false, value: 12 },
  renew: { v: 1, matchId: H('a'), issuedAt: now, renewId: H('e'), role: 'propose', matchKey: H('f'), expiresAt: now + 90 * 86_400 },
  revoke: { v: 1, matchId: H('a'), issuedAt: now },
};

function mutate(name: ControlKindName, patch: Record<string, unknown>): string {
  // Re-pad by hand so only the field under test is wrong.
  const o: Record<string, unknown> = { ...(samples[name] as unknown as Record<string, unknown>), ...patch, padding: '' };
  for (const k of Object.keys(patch)) if (patch[k] === undefined) delete o[k];
  const bare = JSON.stringify(o);
  o.padding = '0'.repeat(CONTROL_MESSAGE_BYTES - new TextEncoder().encode(bare).length);
  return JSON.stringify(o);
}

test('kinds are provisional, distinct, in 3470-3478', () => {
  const kinds = Object.values(MATCH_KINDS);
  assert.equal(new Set(kinds).size, kinds.length);
  assert.ok(kinds.every((k) => k >= 3470 && k <= 3478));
  assert.equal(matchKindName(3476), 'sketch');
  assert.equal(matchKindName(14), undefined);
});

test('every control message encodes to exactly 8,192 bytes and round-trips', () => {
  for (const name of Object.keys(samples) as ControlKindName[]) {
    const text = encodeControl(name, samples[name]);
    assert.equal(new TextEncoder().encode(text).length, CONTROL_MESSAGE_BYTES, name);
    assert.deepEqual(Object.keys(JSON.parse(text)), [...MESSAGE_FIELDS[name], 'padding'], `${name} key order`);
    assert.deepEqual(decodeControl(name, text, opts), samples[name], name);
  }
});

test('receivers reject unknown keys, missing keys, wrong size and bad versions', () => {
  assert.throws(() => decodeControl('revoke', mutate('revoke', { reason: 'x' }), opts), /unknown key/);
  assert.throws(() => decodeControl('matchRequest', mutate('matchRequest', { durationDays: undefined }), opts), /required/);
  assert.throws(() => decodeControl('revoke', mutate('revoke', { v: 2 }), opts), /must be 1/);
  assert.throws(() => decodeControl('revoke', encodeControl('revoke', samples.revoke) + ' ', opts), /exactly 8192/);
  assert.throws(() => decodeControl('revoke', '{}', opts), ValidationError);
  assert.throws(() => decodeControl('revoke', 'x'.repeat(CONTROL_MESSAGE_BYTES), opts), /JSON/);
  assert.throws(() => encodeControl('revoke', { ...samples.revoke, extra: 1 } as never), /unknown key/);
});

test('freshness: too old or in the future is rejected', () => {
  assert.throws(() => decodeControl('revoke', encodeControl('revoke', { ...samples.revoke, issuedAt: now - 15 * 86_400 }), opts), /too old/);
  assert.throws(() => decodeControl('revoke', encodeControl('revoke', { ...samples.revoke, issuedAt: now + 600 }), opts), /future/);
  assert.ok(decodeControl('revoke', encodeControl('revoke', { ...samples.revoke, issuedAt: now + 200 }), opts));
});

test('field rules', () => {
  const bad: [ControlKindName, Record<string, unknown>, RegExp][] = [
    ['matchRequest', { durationDays: 91 }, /between 1 and 90/],
    ['matchRequest', { matchKey: 'B'.repeat(64) }, /hex/],
    ['matchAccept', { expiresAt: now + 91 * 86_400 }, /90 days/],
    ['matchAccept', { expiresAt: now }, /after issuedAt/],
    ['previewResponse', { accept: false }, /empty when declining/],
    ['previewResponse', { psiRequest: '' }, /not be empty/],
    ['previewResponse', { psiRequest: 'not base64!' }, /base64/],
    ['previewResult', { floor: 4 }, /between 5 and 100/],
    ['previewResult', { value: 4 }, /between 5/],
    ['previewResult', { belowFloor: true }, /null below the floor/],
    ['renew', { role: 'maybe' }, /propose or accept/],
    ['renew', { expiresAt: now + 91 * 86_400 }, /90 days/],
  ];
  for (const [name, patch, re] of bad) {
    assert.throws(() => decodeControl(name, mutate(name, patch), opts), re, `${name} ${JSON.stringify(patch)}`);
  }
  assert.ok(decodeControl('previewResult', mutate('previewResult', { belowFloor: true, value: null }), opts));
  assert.ok(decodeControl('previewResponse', mutate('previewResponse', { accept: false, psiRequest: '' }), opts));
});
