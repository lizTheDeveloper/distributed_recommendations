import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { getEventHash, getPublicKey } from 'nostr-tools/pure';
import { cleanText, getEventId, serializeEvent, signWith } from '../src/event.ts';
import type { Sha256, Signer } from '../src/event.ts';
import { parseSecretKey, secretKeySigner, verifySignedEvent } from '../src/nostr-signer.ts';
import type { UnsignedEvent } from '../src/types.ts';

// BIP-340 test vector 0: secret key 3 -> this x-only public key.
const SK3 = '0000000000000000000000000000000000000000000000000000000000000003';
const PK3 = 'f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9';

// Exercises every escape NIP-01 lists, non-ASCII, an astral char and U+2028.
const VECTOR: UnsignedEvent = {
  pubkey: PK3,
  created_at: 1700000000,
  kind: 34235,
  tags: [
    ['d', 'abc'],
    ['title', 'Café "quoted" \\ back'],
    ['t', '🎥'],
  ],
  content: 'line1\nline2\ttab\r\b\f end   é',
};
// Computed independently with Python:
//   json.dumps(ev, separators=(',',':'), ensure_ascii=False) -> hashlib.sha256
const VECTOR_SERIALIZED =
  '[0,"f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9",1700000000,34235,' +
  '[["d","abc"],["title","Café \\"quoted\\" \\\\ back"],["t","🎥"]],"line1\\nline2\\ttab\\r\\b\\f end   é"]';
const VECTOR_ID = '212cd17af510d2ed4c94b72c9bb2909288585d679c6dac89f9996adf8f50b62b';

const nodeSha256: Sha256 = async (data) => new Uint8Array(createHash('sha256').update(data).digest());

test('NIP-01 serialization matches the canonical form byte for byte', () => {
  assert.equal(serializeEvent(VECTOR), VECTOR_SERIALIZED);
});

test('event id matches an independently computed vector (WebCrypto)', async () => {
  assert.equal(await getEventId(VECTOR), VECTOR_ID);
});

test('event id is the same with node:crypto and with nostr-tools', async () => {
  assert.equal(await getEventId(VECTOR, nodeSha256), VECTOR_ID);
  assert.equal(getEventHash(VECTOR), VECTOR_ID);
});

test('serialization refuses strings whose escaping NIP-01 leaves ambiguous', () => {
  assert.throws(() => serializeEvent({ ...VECTOR, content: 'bell\u0007' }), /control character/);
  assert.throws(() => serializeEvent({ ...VECTOR, tags: [['title', 'x\ud800']] }), /surrogate/);
  assert.throws(() => serializeEvent({ ...VECTOR, pubkey: PK3.toUpperCase() }), /pubkey/);
  assert.throws(() => serializeEvent({ ...VECTOR, tags: [[]] }), /non-empty/);
});

test('cleanText strips ambiguous controls and lone surrogates but keeps \\n \\t \\r', () => {
  assert.equal(cleanText('a\u0000b\u0007c\u001bd\ud800e\n\t\r'), 'abcd�e\n\t\r');
});

test('secret key parsing and BIP-340 vector public key', () => {
  const sk = parseSecretKey(SK3);
  assert.equal(getPublicKey(sk), PK3);
  assert.throws(() => parseSecretKey('nope'));
});

test('signWith produces a verifiable event with our id', async () => {
  const signer = secretKeySigner(parseSecretKey(SK3));
  const { pubkey: _p, ...template } = VECTOR;
  const signed = await signWith(signer, template, { verify: verifySignedEvent });
  assert.equal(signed.id, VECTOR_ID);
  assert.equal(signed.pubkey, PK3);
  assert.match(signed.sig, /^[0-9a-f]{128}$/);
  assert.ok(verifySignedEvent(signed));
});

test('signWith rejects a signer that alters the event', async () => {
  const honest = secretKeySigner(parseSecretKey(SK3));
  const sneaky: Signer = {
    getPublicKey: () => honest.getPublicKey(),
    signEvent: (t) => honest.signEvent({ ...t, tags: [...t.tags, ['client', 'sneaky']] }),
  };
  const { pubkey: _p, ...template } = VECTOR;
  await assert.rejects(signWith(sneaky, template), /modified/);
});
