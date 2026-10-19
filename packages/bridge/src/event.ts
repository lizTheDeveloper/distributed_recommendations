// NIP-01 event serialization, id computation and signing glue.
//
// NIP-01: "To obtain the event.id, we sha256 the serialized event. The
// serialization is done over the UTF-8 JSON-serialized string of
// [0, <pubkey>, <created_at>, <kind>, <tags>, <content>]" with no extra
// whitespace and only \n \" \\ \r \t \b \f escaped.
//
// JSON.stringify produces exactly that for every string that contains no other
// C0 control characters and no lone UTF-16 surrogates. `cleanText` removes
// those from untrusted input (PeerTube titles/descriptions) so the id is
// unambiguous across implementations; `serializeEvent` refuses anything that
// would still be ambiguous.

import type { EventTemplate, SignedEvent, UnsignedEvent } from './types.ts';

/** SHA-256 abstraction so callers can swap WebCrypto, node:crypto or noble. */
export type Sha256 = (data: Uint8Array) => Promise<Uint8Array>;

/** Default: WebCrypto, available as a global in Node >= 19, browsers and Deno. */
export const webCryptoSha256: Sha256 = async (data) =>
  new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', data as Uint8Array<ArrayBuffer>));

const HEX64 = /^[0-9a-f]{64}$/;
const HEX128 = /^[0-9a-f]{128}$/;
// C0 controls that NIP-01 does not list as escaped (it lists \b \t \n \f \r).
// eslint-disable-next-line no-control-regex
const AMBIGUOUS_CONTROL = /[\u0000-\u0007\u000b\u000e-\u001f]/;
// eslint-disable-next-line no-control-regex
const AMBIGUOUS_CONTROL_G = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

/** Normalize untrusted text for use in an event: drop ambiguous control chars and lone surrogates. */
export function cleanText(s: string): string {
  return s.toWellFormed().replace(AMBIGUOUS_CONTROL_G, '');
}

export function bytesToHex(b: Uint8Array): string {
  let out = '';
  for (const x of b) out += x.toString(16).padStart(2, '0');
  return out;
}

function checkString(s: unknown, where: string): void {
  if (typeof s !== 'string') throw new TypeError(`${where} must be a string`);
  if (!s.isWellFormed()) throw new TypeError(`${where} contains a lone surrogate`);
  if (AMBIGUOUS_CONTROL.test(s)) throw new TypeError(`${where} contains an unescapable control character`);
}

/** Structural NIP-01 checks on an unsigned event. Throws on the first problem. */
export function assertValidUnsigned(e: UnsignedEvent): void {
  if (!HEX64.test(e.pubkey)) throw new TypeError('pubkey must be 32-byte lowercase hex');
  if (!Number.isInteger(e.created_at) || e.created_at < 0) throw new TypeError('created_at must be a non-negative integer');
  if (!Number.isInteger(e.kind) || e.kind < 0 || e.kind > 65535) throw new TypeError('kind must be an integer in 0..65535');
  if (!Array.isArray(e.tags)) throw new TypeError('tags must be an array');
  e.tags.forEach((t, i) => {
    if (!Array.isArray(t) || t.length === 0) throw new TypeError(`tags[${i}] must be a non-empty array`);
    t.forEach((v, j) => checkString(v, `tags[${i}][${j}]`));
  });
  checkString(e.content, 'content');
}

/** NIP-01 canonical serialization. */
export function serializeEvent(e: UnsignedEvent): string {
  assertValidUnsigned(e);
  return JSON.stringify([0, e.pubkey, e.created_at, e.kind, e.tags, e.content]);
}

/** NIP-01 event id: lowercase hex sha256 of the canonical serialization. */
export async function getEventId(e: UnsignedEvent, sha256: Sha256 = webCryptoSha256): Promise<string> {
  return bytesToHex(await sha256(new TextEncoder().encode(serializeEvent(e))));
}

/**
 * Anything that can sign Nostr events. The shape matches NIP-07's
 * `window.nostr` (getPublicKey / signEvent), so a browser extension, a NIP-46
 * remote signer (e.g. nostr-tools BunkerSigner, NDK signers) or a local key can
 * be passed in unchanged.
 */
export interface Signer {
  getPublicKey(): Promise<string>;
  signEvent(event: EventTemplate): Promise<SignedEvent>;
}

/**
 * Sign through `signer`, then check the signer returned the event we asked
 * for: same pubkey, same content, and an id that matches our own NIP-01
 * computation. Signature verification is left to `verify` because it needs a
 * secp256k1 implementation (see nostr-signer.ts).
 */
export async function signWith(
  signer: Signer,
  template: EventTemplate,
  opts: { sha256?: Sha256; verify?: (e: SignedEvent) => boolean } = {},
): Promise<SignedEvent> {
  const pubkey = await signer.getPublicKey();
  const expectedId = await getEventId({ ...template, pubkey }, opts.sha256);
  const signed = await signer.signEvent({
    kind: template.kind,
    created_at: template.created_at,
    tags: template.tags.map((t) => [...t]),
    content: template.content,
  });
  if (signed.pubkey !== pubkey) throw new Error('signer returned an event for a different pubkey');
  const actualId = await getEventId(signed, opts.sha256);
  if (actualId !== expectedId || signed.id !== expectedId) {
    throw new Error('signer modified the event or returned a wrong id');
  }
  if (!HEX128.test(signed.sig)) throw new Error('signer returned a malformed signature');
  if (opts.verify && !opts.verify(signed)) throw new Error('signature does not verify');
  return signed;
}
