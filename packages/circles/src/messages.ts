// Round message schemas (PROVISIONAL; docs/CIRCLES.md, "Wire format").
// Same rules as PROTOCOL.md: UTF-8 JSON, `v: 1`, unknown or missing keys rejected,
// size checked before JSON.parse, fixed key order on encode.

import type { CirclePolicy } from './core.ts';
import { parseCirclePolicy } from './core.ts';

/** Largest candidate list a round may carry. Exp 3 simulated 150 candidates per circle. */
export const MAX_CANDIDATES = 256;
/** Encoded round-open limit, so the MLS message stays under a 64 KiB relay event. */
export const MAX_OPEN_BYTES = 40_000;
/** Encoded round-key / round-masked limit (a 256-word vector is ~1.4 KB of base64). */
export const MAX_SMALL_BYTES = 4_096;
/** Longest round window accepted, seconds. */
export const MAX_ROUND_SECONDS = 7 * 86_400;

export interface RoundOpenMsg {
  v: 1;
  /** Random 32 bytes, hex. */
  roundId: string;
  /** Group (circle) id, hex. */
  circleId: string;
  /** The MLS epoch this round binds to. */
  epoch: number;
  /** Unix seconds. Endorsements up to this instant (and after the member's previous contribution) are pooled. */
  openedAt: number;
  /** Round keys must be sent by this time; the participant set is the keys seen by then. */
  keyDeadline: number;
  /** Masked vectors must arrive by this time, or the round is void. */
  maskDeadline: number;
  policy: CirclePolicy;
  /**
   * The round's item domain: video ids, sorted, unique. Must come from PUBLIC data
   * (e.g. new videos from the circle's channels, or links members chose to post),
   * never from anyone's private history. See docs/CIRCLES.md, "Domain".
   */
  candidates: string[];
}

export interface RoundKeyMsg {
  v: 1;
  roundId: string;
  epoch: number;
  /** X25519 public key, 64 hex. */
  roundKey: string;
}

export interface RoundMaskedMsg {
  v: 1;
  roundId: string;
  epoch: number;
  /** SHA-256 hex of the sorted participant list this vector was masked for. */
  participants: string;
  /** base64 of candidates.length little-endian uint32 words. */
  vector: string;
}

export class MessageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MessageError';
  }
}

const HEX64 = /^[0-9a-f]{64}$/;
const HEXID = /^[0-9a-f]{2,128}$/;
const B64 = /^[A-Za-z0-9+/]*={0,2}$/;

/**
 * PROTOCOL.md's video-id rule: an http(s) URL with a host, ≤ 512 chars, printable
 * ASCII, no `"`, `\`, `<`, `>`, spaces or control characters.
 */
export function isVideoId(id: unknown): id is string {
  if (typeof id !== 'string' || id.length === 0 || id.length > 512) return false;
  if (!/^[\x21-\x7e]+$/.test(id) || /["\\<>]/.test(id)) return false;
  try {
    const u = new URL(id);
    return (u.protocol === 'https:' || u.protocol === 'http:') && u.host.length > 0;
  } catch {
    return false;
  }
}

function byteLength(s: string): number {
  return new TextEncoder().encode(s).length;
}

function parseObject(text: string, max: number, what: string): Record<string, unknown> {
  if (byteLength(text) > max) throw new MessageError(`${what} is larger than ${max} bytes`);
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    throw new MessageError(`${what} is not JSON`);
  }
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new MessageError(`${what} is not an object`);
  return v as Record<string, unknown>;
}

function exactKeys(o: Record<string, unknown>, keys: readonly string[], what: string): void {
  const got = Object.keys(o);
  for (const k of got) if (!keys.includes(k)) throw new MessageError(`${what}: unknown key "${k}"`);
  for (const k of keys) if (!(k in o)) throw new MessageError(`${what}: missing key "${k}"`);
  if (o.v !== 1) throw new MessageError(`${what}: v must be 1`);
}

function int(v: unknown, what: string, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(v) || (v as number) < min || (v as number) > max) throw new MessageError(`${what} must be an integer in [${min}, ${max}]`);
  return v as number;
}

function match(v: unknown, re: RegExp, what: string): string {
  if (typeof v !== 'string' || !re.test(v)) throw new MessageError(`${what} is malformed`);
  return v;
}

const OPEN_KEYS = ['v', 'roundId', 'circleId', 'epoch', 'openedAt', 'keyDeadline', 'maskDeadline', 'policy', 'candidates'] as const;
const KEY_KEYS = ['v', 'roundId', 'epoch', 'roundKey'] as const;
const MASKED_KEYS = ['v', 'roundId', 'epoch', 'participants', 'vector'] as const;

export function encodeRoundOpen(m: RoundOpenMsg): string {
  const policy: Record<string, unknown> = { v: 1, minMembers: m.policy.minMembers };
  if (m.policy.revealThreshold !== undefined) policy.revealThreshold = m.policy.revealThreshold;
  policy.epsilon = m.policy.epsilon;
  policy.maxItemsPerMember = m.policy.maxItemsPerMember;
  const text = JSON.stringify({
    v: 1,
    roundId: m.roundId,
    circleId: m.circleId,
    epoch: m.epoch,
    openedAt: m.openedAt,
    keyDeadline: m.keyDeadline,
    maskDeadline: m.maskDeadline,
    policy,
    candidates: m.candidates,
  });
  decodeRoundOpen(text); // never send what we would not accept
  return text;
}

export function decodeRoundOpen(text: string): RoundOpenMsg {
  const o = parseObject(text, MAX_OPEN_BYTES, 'round-open');
  exactKeys(o, OPEN_KEYS, 'round-open');
  const openedAt = int(o.openedAt, 'round-open.openedAt', 1);
  const keyDeadline = int(o.keyDeadline, 'round-open.keyDeadline', openedAt + 1, openedAt + MAX_ROUND_SECONDS);
  const maskDeadline = int(o.maskDeadline, 'round-open.maskDeadline', keyDeadline + 1, openedAt + MAX_ROUND_SECONDS);
  let policy: CirclePolicy;
  try {
    policy = parseCirclePolicy(o.policy);
  } catch (e) {
    throw new MessageError(`round-open.policy: ${(e as Error).message}`);
  }
  if (!Array.isArray(o.candidates) || o.candidates.length === 0 || o.candidates.length > MAX_CANDIDATES) {
    throw new MessageError(`round-open.candidates must hold 1-${MAX_CANDIDATES} ids`);
  }
  const candidates = o.candidates as unknown[];
  for (let i = 0; i < candidates.length; i++) {
    if (!isVideoId(candidates[i])) throw new MessageError(`round-open.candidates[${i}] is not a video id`);
    if (i > 0 && !((candidates[i - 1] as string) < (candidates[i] as string))) {
      throw new MessageError('round-open.candidates must be sorted and unique');
    }
  }
  return {
    v: 1,
    roundId: match(o.roundId, HEX64, 'round-open.roundId'),
    circleId: match(o.circleId, HEXID, 'round-open.circleId'),
    epoch: int(o.epoch, 'round-open.epoch'),
    openedAt,
    keyDeadline,
    maskDeadline,
    policy,
    candidates: candidates as string[],
  };
}

export function encodeRoundKey(m: RoundKeyMsg): string {
  const text = JSON.stringify({ v: 1, roundId: m.roundId, epoch: m.epoch, roundKey: m.roundKey });
  decodeRoundKey(text);
  return text;
}

export function decodeRoundKey(text: string): RoundKeyMsg {
  const o = parseObject(text, MAX_SMALL_BYTES, 'round-key');
  exactKeys(o, KEY_KEYS, 'round-key');
  return {
    v: 1,
    roundId: match(o.roundId, HEX64, 'round-key.roundId'),
    epoch: int(o.epoch, 'round-key.epoch'),
    roundKey: match(o.roundKey, HEX64, 'round-key.roundKey'),
  };
}

export function encodeRoundMasked(m: RoundMaskedMsg): string {
  const text = JSON.stringify({ v: 1, roundId: m.roundId, epoch: m.epoch, participants: m.participants, vector: m.vector });
  decodeRoundMasked(text);
  return text;
}

export function decodeRoundMasked(text: string): RoundMaskedMsg {
  const o = parseObject(text, MAX_SMALL_BYTES, 'round-masked');
  exactKeys(o, MASKED_KEYS, 'round-masked');
  return {
    v: 1,
    roundId: match(o.roundId, HEX64, 'round-masked.roundId'),
    epoch: int(o.epoch, 'round-masked.epoch'),
    participants: match(o.participants, HEX64, 'round-masked.participants'),
    vector: match(o.vector, B64, 'round-masked.vector'),
  };
}
