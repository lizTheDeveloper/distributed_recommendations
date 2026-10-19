import { test } from 'node:test';
import assert from 'node:assert/strict';
import { finalizeEvent, generateSecretKey, getEventHash, getPublicKey } from 'nostr-tools/pure';
import * as nip44 from 'nostr-tools/nip44';
import { buildSketch, encodeSketch, seededRng } from '../src/core.ts';
import type { SignedEvent } from '../src/keys.ts';
import { generateMatchKey, localSigner, matchKeySigner } from '../src/keys.ts';
import { MATCH_KINDS } from '../src/kinds.ts';
import { encodeControl } from '../src/messages.ts';
import { InMemoryRelay } from '../src/relay.ts';
import { MAX_EVENT_BYTES, TIMESTAMP_JITTER_SEC, UnwrapError, eventBytes, giftWrap, unwrap } from '../src/wrap.ts';
import { T0, history, range } from './helpers.ts';

const nowSec = Math.floor(T0.getTime() / 1000);
const exp = nowSec + 14 * 86_400;
const HEX = 'ab'.repeat(32);

function revoke(): string {
  return encodeControl('revoke', { v: 1, matchId: HEX, issuedAt: nowSec });
}

/** A 128-bucket sketch whose items are as long as the bucket allows (worst realistic case). */
function fullSketch(pathological = false): string {
  const long = (n: number) =>
    pathological
      ? `https://x/${'"'.repeat(50)}${n}`
      : `https://peertube.example.org/videos/watch/${String(n).padStart(8, '0')}-aaaa-4bbb-8ccc-${'d'.repeat(12)}?start=${n}&x=${'y'.repeat(20)}`;
  const hist = range(0, 200).map((n, i) => ({ videoId: long(n), at: new Date(T0.getTime() - (i + 1) * 60_000), kind: 'endorse' as const, tags: [] }));
  const consent = { windowDays: 60, includeFinished: false, excludedTags: [], excludedHours: [], paused: false };
  const { sketch } = buildSketch(hist, consent, { epoch: 0 }, { now: T0, rng: seededRng(1), transport: 'nip17' });
  assert.equal(sketch.items.length, 128);
  return encodeSketch(sketch);
}

test('gift wrap round trip: seal key, recipient, kind and content survive', async () => {
  const sender = generateMatchKey();
  const recipient = generateMatchKey();
  const wrap = await giftWrap({ kind: MATCH_KINDS.revoke, content: revoke(), sender: matchKeySigner(sender), recipient: recipient.pubkey, now: T0, expiration: exp });
  assert.equal(wrap.kind, 1059);
  assert.notEqual(wrap.pubkey, sender.pubkey, 'wrap is signed by a one-time key');
  assert.deepEqual(wrap.tags, [
    ['p', recipient.pubkey],
    ['expiration', String(exp)],
  ]);
  assert.ok(wrap.created_at <= nowSec && wrap.created_at > nowSec - TIMESTAMP_JITTER_SEC);
  const u = await unwrap(wrap, matchKeySigner(recipient), { now: T0 });
  assert.equal(u.kind, MATCH_KINDS.revoke);
  assert.equal(u.content, revoke());
  assert.equal(u.sealPubkey, sender.pubkey);
  assert.equal(u.recipientPubkey, recipient.pubkey);
  assert.equal(u.createdAt, nowSec);
});

test('a full 128-bucket sketch gift-wraps to under 64 KiB', async () => {
  const content = fullSketch();
  assert.equal(new TextEncoder().encode(content).length, 15_872);
  const r = generateMatchKey();
  const wrap = await giftWrap({ kind: MATCH_KINDS.sketch, content, sender: matchKeySigner(generateMatchKey()), recipient: r.pubkey, now: T0, expiration: exp });
  const size = eventBytes(wrap);
  assert.ok(size < MAX_EVENT_BYTES, `wrap is ${size} bytes`);
  assert.ok(size < 40_000, `expected about 33 KB per PROTOCOL.md, got ${size}`);
  const relay = new InMemoryRelay({ now: () => T0 });
  assert.equal((await relay.publish(wrap)).ok, true);
  assert.equal((await unwrap(wrap, matchKeySigner(r), { now: T0 })).content, content);
});

test('control messages and 64-bucket sketches wrap to the same size; 128 is the only other size', async () => {
  const r = generateMatchKey().pubkey;
  const s = matchKeySigner(generateMatchKey());
  const hist = history(range(0, 10), T0);
  const consent = { windowDays: 60, includeFinished: false, excludedTags: [], excludedHours: [], paused: false };
  const small = encodeSketch(buildSketch(hist, consent, { epoch: 0 }, { now: T0, rng: seededRng(2) }).sketch);
  const contents = [
    { kind: MATCH_KINDS.revoke, content: revoke() },
    { kind: MATCH_KINDS.matchRequest, content: encodeControl('matchRequest', { v: 1, matchId: HEX, issuedAt: nowSec, matchKey: HEX, durationDays: 90 }) },
    { kind: MATCH_KINDS.sketch, content: small },
  ];
  const sizes = new Set<number>();
  for (const c of contents) sizes.add(eventBytes(await giftWrap({ ...c, sender: s, recipient: r, now: T0, expiration: exp })));
  assert.equal(sizes.size, 1, `sizes ${[...sizes]}`);
  const big = eventBytes(await giftWrap({ kind: MATCH_KINDS.sketch, content: fullSketch(), sender: s, recipient: r, now: T0, expiration: exp }));
  assert.ok(big > [...sizes][0]);
});

test('a sketch that would exceed 64 KiB after escaping is refused before publishing; relays reject oversize events', async () => {
  const content = fullSketch(true); // URLs full of `"`, which JSON-escaping doubles
  await assert.rejects(
    giftWrap({ kind: MATCH_KINDS.sketch, content, sender: matchKeySigner(generateMatchKey()), recipient: generateMatchKey().pubkey, now: T0, expiration: exp }),
    RangeError,
  );
  const sk = generateSecretKey();
  const huge = finalizeEvent({ kind: 1059, created_at: nowSec, tags: [], content: 'x'.repeat(70_000) }, sk) as SignedEvent;
  const relay = new InMemoryRelay({ now: () => T0 });
  const res = await relay.publish(huge);
  assert.equal(res.ok, false);
  assert.match(res.message, /too large/);
});

test('unwrap rejects: wrong recipient, expired, tampered wrap, unknown kind, mismatched rumor', async () => {
  const sender = generateMatchKey();
  const recipient = generateMatchKey();
  const wrap = await giftWrap({ kind: MATCH_KINDS.revoke, content: revoke(), sender: matchKeySigner(sender), recipient: recipient.pubkey, now: T0, expiration: exp });
  const me = matchKeySigner(recipient);

  await assert.rejects(unwrap(wrap, matchKeySigner(generateMatchKey()), { now: T0 }), /not addressed/);
  await assert.rejects(unwrap(wrap, me, { now: new Date((exp + 1) * 1000) }), /expired/);
  await assert.rejects(unwrap({ ...wrap, content: wrap.content.slice(0, -4) + 'AAAA' }, me, { now: T0 }), /signature/);

  // Hand-built wraps around bad seals/rumors, to check the inner checks.
  const wrapSeal = (seal: object) => {
    const k = generateSecretKey();
    return finalizeEvent(
      {
        kind: 1059,
        created_at: nowSec,
        tags: [
          ['p', recipient.pubkey],
          ['expiration', String(exp)],
        ],
        content: nip44.v2.encrypt(JSON.stringify(seal), nip44.v2.utils.getConversationKey(k, recipient.pubkey)),
      },
      k,
    ) as SignedEvent;
  };
  const sealOf = (rumor: object, sealer: Uint8Array) =>
    finalizeEvent({ kind: 13, created_at: nowSec, tags: [], content: nip44.v2.encrypt(JSON.stringify(rumor), nip44.v2.utils.getConversationKey(sealer, recipient.pubkey)) }, sealer);
  const sk = generateSecretKey();
  const other = generateSecretKey();
  const base = { kind: MATCH_KINDS.revoke, created_at: nowSec, tags: [], content: revoke(), pubkey: getPublicKey(sk) };

  // Impersonation: rumor claims `sk` but the seal is signed by `other`.
  await assert.rejects(unwrap(wrapSeal(sealOf({ ...base, id: getEventHash(base) }, other)), me, { now: T0 }), /does not match seal/);
  // Rumor id doesn't match its content.
  await assert.rejects(unwrap(wrapSeal(sealOf({ ...base, id: '00'.repeat(32) }, sk)), me, { now: T0 }), /rumor id/);
  // A kind we don't speak (a NIP-17 DM).
  const dm = { ...base, kind: 14 };
  await assert.rejects(unwrap(wrapSeal(sealOf({ ...dm, id: getEventHash(dm) }, sk)), me, { now: T0 }), /unknown rumor kind/);
  // A well-formed one passes.
  const good = await unwrap(wrapSeal(sealOf({ ...base, id: getEventHash(base) }, sk)), me, { now: T0 });
  assert.equal(good.sealPubkey, getPublicKey(sk));
  assert.ok(new UnwrapError('x') instanceof Error);
});

test('identity-sealed and match-sealed messages are distinguishable only inside the encryption', async () => {
  const idSecret = generateSecretKey();
  const identity = localSigner(idSecret);
  const recipient = generateMatchKey();
  const wrap = await giftWrap({ kind: MATCH_KINDS.revoke, content: revoke(), sender: identity, recipient: recipient.pubkey, now: T0, expiration: exp });
  assert.ok(!JSON.stringify(wrap).includes(getPublicKey(idSecret)));
  assert.equal((await unwrap(wrap, matchKeySigner(recipient), { now: T0 })).sealPubkey, getPublicKey(idSecret));
});
