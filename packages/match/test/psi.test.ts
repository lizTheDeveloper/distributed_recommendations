import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { isPaddingItem, seededRng } from '../src/core.ts';
import { encodeControl } from '../src/messages.ts';
import { INSECURE_plaintextPsiForTests, PSI_SET_SIZE, fromBase64, openMinedPsi, padPsiSet, toBase64 } from '../src/psi.ts';
import { T0, range, video } from './helpers.ts';

const A = range(0, 60).map(video);
const B = range(30, 100).map(video);
const now = Math.floor(T0.getTime() / 1000);
const H = 'a'.repeat(64);

test('padPsiSet: exactly 128 items, real ones kept (newest first), nonces never collide with ids', () => {
  const p = padPsiSet(A, seededRng(1));
  assert.equal(p.items.length, PSI_SET_SIZE);
  assert.equal(p.realCount, 60);
  assert.equal(p.items.filter(isPaddingItem).length, 68);
  const many = padPsiSet(range(0, 300).map(video), seededRng(1));
  assert.equal(many.realCount, 128);
  assert.ok(many.items.includes(video(0)) && !many.items.includes(video(200)));
});

test('OpenMined PSI: the target learns the exact overlap of the padded sets; messages fit a control message', async () => {
  const factory = await openMinedPsi();
  const target = factory();
  const requester = factory();
  const tSet = padPsiSet(B, seededRng(2)).items;
  const rSet = padPsiSet(A, seededRng(3)).items;
  const request = await target.createRequest(tSet);
  const { setup, response } = await requester.answerRequest(request, rSet);
  assert.equal(await target.intersectionSize(setup, response), 30);
  // Both PSI messages fit one 8,192-byte control message.
  encodeControl('previewResponse', { v: 1, matchId: H, issuedAt: now, previewId: H, accept: true, psiRequest: toBase64(request) });
  encodeControl('previewAnswer', { v: 1, matchId: H, issuedAt: now, previewId: H, setSize: 60, psiSetup: toBase64(setup), psiResponse: toBase64(response) });
  assert.deepEqual(fromBase64(toBase64(request)), request);
  // One run per session: the client key is gone after intersectionSize.
  await assert.rejects(target.intersectionSize(setup, response), /createRequest/);
  target.dispose();
  requester.dispose();
});

test('OpenMined PSI: requester refuses reveal-intersection requests and oversize sets', async () => {
  const factory = await openMinedPsi();
  const require = createRequire(import.meta.url);
  const lib = await (require('@openmined/psi.js') as () => Promise<{ client: { createWithNewKey(r: boolean): { createRequest(x: string[]): { serializeBinary(): Uint8Array }; delete(): void } } }>)();
  const revealing = lib.client.createWithNewKey(true);
  const req = revealing.createRequest(padPsiSet(B, seededRng(4)).items).serializeBinary();
  revealing.delete();
  await assert.rejects(factory().answerRequest(req, padPsiSet(A, seededRng(5)).items), /reveal the intersection/);
  await assert.rejects(factory().createRequest(range(0, 129).map(video)), RangeError);
});

test('INSECURE test double: same flow, plaintext inside (never ship it)', async () => {
  const f = INSECURE_plaintextPsiForTests();
  const t = f();
  const req = await t.createRequest(B);
  assert.match(new TextDecoder().decode(req), /INSECURE-TEST-PSI/);
  const { setup, response } = await f().answerRequest(req, A);
  assert.equal(await t.intersectionSize(setup, response), 30);
});
