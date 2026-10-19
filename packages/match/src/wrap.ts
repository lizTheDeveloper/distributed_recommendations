// NIP-17-style transport: rumor (unsigned) → seal (kind 13, NIP-44 to the
// recipient, signed by the sender) → gift wrap (kind 1059, NIP-44 from a one-time
// random key, `p` = recipient, NIP-40 `expiration`), per NIP-59.
//
// Composed from nostr-tools primitives (`getEventHash`, `finalizeEvent`,
// `verifyEvent`, `generateSecretKey`, `nip44.v2`) rather than `nip59.wrapEvent`,
// for two reasons:
// - `nip59.createSeal`/`wrapEvent` need the sender's raw secret key; an identity
//   key may sit in a NIP-07/NIP-46 signer, so the seal goes through `NostrSigner`.
// - `nip59.createWrap` can't add tags, and PROTOCOL.md requires an `expiration` tag
//   on the gift wrap.
// The unwrap side performs the same checks as `nip59.unwrapEvent` (seal kind,
// seal signature, rumor pubkey = seal pubkey) plus the rumor id and our sizes.

import { finalizeEvent, generateSecretKey, getEventHash, verifyEvent } from 'nostr-tools/pure';
import * as nip44 from 'nostr-tools/nip44';
import type { NostrSigner, SignedEvent } from './keys.ts';
import { NIP44_MAX_PLAINTEXT } from './keys.ts';
import { GIFT_WRAP_KIND, SEAL_KIND, matchKindName } from './kinds.ts';
import type { Rng } from './core.ts';
import { cryptoRng } from './core.ts';

/** Many relays default to a 64 KiB event limit; a gift wrap must stay under it. */
export const MAX_EVENT_BYTES = 65_536;

/** NIP-59: seal and wrap timestamps are randomized up to two days into the past. */
export const TIMESTAMP_JITTER_SEC = 2 * 86_400;

export interface Rumor {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
}

export interface WrapOptions {
  kind: number;
  content: string;
  /** Seals the rumor: the sender's identity or match key. */
  sender: NostrSigner;
  /** Recipient public key (the `p` tag): the peer's match key, or identity for first contact. */
  recipient: string;
  now: Date;
  /** NIP-40 expiration, Unix seconds. */
  expiration: number;
  /** Randomness for timestamp jitter; default `cryptoRng()`. */
  rng?: Rng;
}

function utf8Length(s: string): number {
  return new TextEncoder().encode(s).length;
}

function jittered(nowSec: number, rng: Rng): number {
  return nowSec - Math.floor(rng() * TIMESTAMP_JITTER_SEC);
}

/** Size in bytes of an event as relays receive it (its JSON). */
export function eventBytes(event: object): number {
  return utf8Length(JSON.stringify(event));
}

/** Rumor → seal → gift wrap. Throws if the result would exceed `MAX_EVENT_BYTES`. */
export async function giftWrap(opts: WrapOptions): Promise<SignedEvent> {
  const rng = opts.rng ?? cryptoRng();
  const nowSec = Math.floor(opts.now.getTime() / 1000);
  const pubkey = await opts.sender.getPublicKey();
  const unsigned = { kind: opts.kind, created_at: nowSec, tags: [] as string[][], content: opts.content, pubkey };
  const rumor: Rumor = { ...unsigned, id: getEventHash(unsigned) };

  const seal = await opts.sender.signEvent({
    kind: SEAL_KIND,
    created_at: jittered(nowSec, rng),
    tags: [],
    content: await opts.sender.nip44.encrypt(opts.recipient, JSON.stringify(rumor)),
  });
  if (seal.pubkey !== pubkey || seal.kind !== SEAL_KIND || !verifyEvent(seal)) {
    throw new Error('signer returned an invalid seal');
  }

  const sealJson = JSON.stringify(seal);
  if (utf8Length(sealJson) > NIP44_MAX_PLAINTEXT) throw new RangeError('seal exceeds the NIP-44 plaintext limit');
  const wrapKey = generateSecretKey();
  const wrap = finalizeEvent(
    {
      kind: GIFT_WRAP_KIND,
      created_at: jittered(nowSec, rng),
      tags: [
        ['p', opts.recipient],
        ['expiration', String(opts.expiration)],
      ],
      content: nip44.v2.encrypt(sealJson, nip44.v2.utils.getConversationKey(wrapKey, opts.recipient)),
    },
    wrapKey,
  ) as SignedEvent;
  const size = eventBytes(wrap);
  if (size > MAX_EVENT_BYTES) throw new RangeError(`gift wrap is ${size} bytes, over ${MAX_EVENT_BYTES}`);
  return wrap;
}

/** What a recipient learns from a gift wrap. */
export interface Unwrapped {
  /** Rumor id (not published anywhere; useful to de-duplicate). */
  id: string;
  kind: number;
  content: string;
  /** Rumor `created_at` (the sender's real clock). */
  createdAt: number;
  /** Who sealed it: an identity or a match key. Verified by the seal's signature. */
  sealPubkey: string;
  /** The key it was addressed to (the wrap's `p` tag), one of the recipient's. */
  recipientPubkey: string;
  wrapId: string;
}

export class UnwrapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnwrapError';
  }
}

// nostr-tools' verifyEvent caches its verdict in a symbol property on the object,
// and object spread copies it; always verify a fresh copy of untrusted input.
function fresh(e: Record<string, unknown>): SignedEvent {
  return {
    id: e.id as string,
    pubkey: e.pubkey as string,
    created_at: e.created_at as number,
    kind: e.kind as number,
    tags: (e.tags as string[][]).map((t) => [...t]),
    content: e.content as string,
    sig: e.sig as string,
  };
}

function tagValue(e: { tags: string[][] }, name: string): string | undefined {
  return e.tags.find((t) => Array.isArray(t) && t[0] === name)?.[1];
}

function parseJson(text: string, what: string): Record<string, unknown> {
  if (utf8Length(text) > NIP44_MAX_PLAINTEXT) throw new UnwrapError(`${what} is too large`);
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    throw new UnwrapError(`${what} is not JSON`);
  }
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new UnwrapError(`${what} is not an object`);
  return v as Record<string, unknown>;
}

function isEventShape(o: Record<string, unknown>): boolean {
  return (
    typeof o.id === 'string' &&
    typeof o.pubkey === 'string' &&
    Number.isInteger(o.created_at) &&
    Number.isInteger(o.kind) &&
    Array.isArray(o.tags) &&
    (o.tags as unknown[]).every((t) => Array.isArray(t) && t.every((x) => typeof x === 'string')) &&
    typeof o.content === 'string'
  );
}

/**
 * Gift wrap → seal → rumor, for a recipient key. Rejects: oversized or malformed
 * events, a bad wrap or seal signature, a `p` tag that isn't the recipient, a
 * missing or past `expiration`, a seal with tags, a rumor whose pubkey differs from
 * the seal's or whose id doesn't match, and rumors of kinds we don't speak.
 */
export async function unwrap(wrap: SignedEvent, recipient: NostrSigner, opts: { now: Date }): Promise<Unwrapped> {
  if (eventBytes(wrap) > MAX_EVENT_BYTES) throw new UnwrapError('gift wrap is too large');
  if (wrap.kind !== GIFT_WRAP_KIND) throw new UnwrapError('not a gift wrap');
  if (!Array.isArray(wrap.tags) || !verifyEvent(fresh(wrap as unknown as Record<string, unknown>))) throw new UnwrapError('gift wrap signature is invalid');
  const me = await recipient.getPublicKey();
  if (tagValue(wrap, 'p') !== me) throw new UnwrapError('gift wrap is not addressed to this key');
  const expiration = Number(tagValue(wrap, 'expiration'));
  if (!Number.isInteger(expiration) || expiration <= Math.floor(opts.now.getTime() / 1000)) {
    throw new UnwrapError('gift wrap has no expiration or has expired');
  }

  let sealText: string;
  try {
    sealText = await recipient.nip44.decrypt(wrap.pubkey, wrap.content);
  } catch {
    throw new UnwrapError('cannot decrypt gift wrap');
  }
  const seal = parseJson(sealText, 'seal');
  if (!isEventShape(seal) || seal.kind !== SEAL_KIND) throw new UnwrapError('not a seal');
  if ((seal.tags as unknown[]).length !== 0) throw new UnwrapError('seal must have no tags');
  if (!verifyEvent(fresh(seal))) throw new UnwrapError('seal signature is invalid');

  let rumorText: string;
  try {
    rumorText = await recipient.nip44.decrypt(seal.pubkey as string, seal.content as string);
  } catch {
    throw new UnwrapError('cannot decrypt seal');
  }
  const rumor = parseJson(rumorText, 'rumor');
  if (!isEventShape(rumor)) throw new UnwrapError('malformed rumor');
  if (rumor.pubkey !== seal.pubkey) throw new UnwrapError('rumor pubkey does not match seal pubkey');
  const { id, ...unsigned } = rumor;
  if (getEventHash(unsigned as unknown as Rumor) !== id) throw new UnwrapError('rumor id does not match');
  if (matchKindName(rumor.kind as number) === undefined) throw new UnwrapError(`unknown rumor kind ${rumor.kind}`);
  return {
    id: id as string,
    kind: rumor.kind as number,
    content: rumor.content as string,
    createdAt: rumor.created_at as number,
    sealPubkey: seal.pubkey as string,
    recipientPubkey: me,
    wrapId: wrap.id,
  };
}
