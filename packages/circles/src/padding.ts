// Fixed-size padding for round messages (docs/CIRCLES.md §1, "Metadata the relay sees").
//
// Every round message (round-open, round-key, round-masked) travels as an MLS
// application message whose plaintext is the serialized rumor
// (marmot-ts serializeApplicationRumor = UTF-8 JSON.stringify of the rumor). We pad
// that plaintext to one of a few fixed sizes, so the MLS ciphertext, the Marmot
// kind-445 event and its JSON all have one length per bucket. The relay can no longer
// tell a round-open from a round-key from a round-masked by size.
//
// How: trailing ASCII spaces after the inner JSON in the rumor's `content`. JSON.parse
// ignores trailing whitespace, and a space serializes to exactly one byte with no
// escaping, so the serialized length is exact. Every message of a round uses the
// round-open's bucket, so all of a round's messages are the same size on the relay.
//
// What still leaks: which bucket a round uses (a coarse class of candidate-list
// size), how many messages a round has, and when they are sent. See docs/CIRCLES.md §8.

/**
 * Allowed serialized-rumor sizes in bytes, ascending. The largest must hold a
 * maximal round-open (MAX_OPEN_BYTES of content plus two layers of JSON escaping and
 * the event wrappers, about 42.3 KB worst case) and still give a kind-445 event under
 * the 64 KiB relay limit (measured: 45,056 → about 60.5 KB; test/padding.test.ts).
 */
export const PAD_BUCKETS = [8_192, 16_384, 45_056] as const;

export type PadBucket = (typeof PAD_BUCKETS)[number];

export class PaddingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PaddingError';
  }
}

export function isPadBucket(n: number): n is PadBucket {
  return (PAD_BUCKETS as readonly number[]).includes(n);
}

/** The smallest bucket that holds `size` bytes, at least `atLeast`. */
export function bucketFor(size: number, atLeast = 0): PadBucket {
  for (const b of PAD_BUCKETS) if (b >= size && b >= atLeast) return b;
  throw new PaddingError(`round message of ${size} bytes is larger than the largest pad bucket`);
}

export interface UnsignedRumor {
  kind: number;
  created_at: number;
  tags: string[][];
  content: string;
  pubkey: string;
}

const enc = new TextEncoder();

/** Byte length of marmot-ts serializeApplicationRumor(rumor) (UTF-8 of JSON.stringify). */
export function serializedLength(rumor: object): number {
  return enc.encode(JSON.stringify(rumor)).length;
}

/**
 * Pad `rumor.content` with trailing spaces so that the serialized rumor including
 * `id` (64 hex, so its length does not depend on the content) is exactly `bucket`
 * bytes. `makeId` computes the event id over the padded rumor.
 */
export function padRumor<R extends UnsignedRumor>(
  rumor: R,
  bucket: PadBucket,
  makeId: (r: R) => string,
): R & { id: string } {
  const placeholder = '0'.repeat(64);
  const base = serializedLength({ ...rumor, id: placeholder });
  if (base > bucket) throw new PaddingError(`round message of ${base} bytes does not fit bucket ${bucket}`);
  const padded = { ...rumor, content: rumor.content + ' '.repeat(bucket - base) };
  const id = makeId(padded);
  if (!/^[0-9a-f]{64}$/.test(id)) throw new PaddingError('event id must be 64 hex');
  const out = { ...padded, id };
  const got = serializedLength(out);
  if (got !== bucket) throw new PaddingError(`padding produced ${got} bytes, expected ${bucket}`);
  return out;
}

/**
 * Receiver side: the serialized rumor must be exactly one bucket long, and the
 * content must be the inner JSON followed only by ASCII spaces. Returns the content
 * with the padding removed. Checked before any JSON parsing of the content.
 */
export function unpadContent(serializedBytes: number, content: string): string {
  if (!isPadBucket(serializedBytes)) throw new PaddingError(`unpadded round message (${serializedBytes} bytes)`);
  const body = content.replace(/ +$/, '');
  if (!body.startsWith('{') || !body.endsWith('}')) throw new PaddingError('round message content is not padded JSON');
  return body;
}
