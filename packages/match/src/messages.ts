// Wire schemas for the Match protocol's control messages (rumor `content`).
// Sketches use core's format unchanged (`encodeSketch` / `decodeSketch`).
//
// Rules, as for every Match Feed format (docs/PROTOCOL.md, Conventions):
// - UTF-8 JSON, `v: 1`, keys in a fixed order, unknown keys rejected.
// - Size checked before `JSON.parse`.
// - Every control message is padded to exactly CONTROL_MESSAGE_BYTES (8,192), the
//   same size as a 64-bucket sketch, so after NIP-44 + NIP-59 all control messages
//   and small sketches wrap to the same event size. A relay can't tell a match
//   request from an accept, a revoke or a sketch by size.
// - Timestamps are integer Unix seconds.

import { MATCH_KINDS } from './kinds.ts';
import { PREVIEW_PRIVACY, ValidationError, sketchTargetBytes } from './core.ts';

/** Exact encoded size of every control message: the 64-bucket sketch size. */
export const CONTROL_MESSAGE_BYTES = sketchTargetBytes(64);

export const MESSAGE_LIMITS = {
  /** Control messages older than this are rejected (also the gift-wrap expiration). */
  maxAgeSec: 14 * 86_400,
  clockSkewSec: 300,
  /** Longest match (and renewal) in days (DESIGN.md: 90 days unless renewed). */
  maxDurationDays: 90,
  /** Largest base64 PSI blob that can still fit a control message. */
  maxPsiBase64: CONTROL_MESSAGE_BYTES,
} as const;

const HEX64 = /^[0-9a-f]{64}$/;
const HEX = /^[0-9a-f]*$/;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

interface Base {
  v: 1;
  /** 32 random bytes, hex; chosen by the requester; names the match in every message. */
  matchId: string;
  issuedAt: number;
}

/** Requester → target identity key. Sealed by the requester's identity key. */
export interface MatchRequestMsg extends Base {
  /** The requester's per-match public key (x-only hex). */
  matchKey: string;
  /** Proposed match length, 1-90 days. */
  durationDays: number;
}

/** Target → requester's match key. Sealed by the target's identity key. */
export interface MatchAcceptMsg extends Base {
  /** The target's per-match public key. */
  matchKey: string;
  /** When the match ends unless renewed; at most `durationDays` after acceptance. */
  expiresAt: number;
}

/** Requester → target. Asks for a PSI-cardinality preview. */
export interface PreviewRequestMsg extends Base {
  /** 32 random bytes, hex. */
  previewId: string;
}

/**
 * Target → requester. `accept: false` covers "declined", "budget used up" and any
 * other refusal alike, so the requester can't learn the target's preview budget.
 */
export interface PreviewResponseMsg extends Base {
  previewId: string;
  accept: boolean;
  /** The target's PSI request (base64); empty when declined. */
  psiRequest: string;
}

/** Requester → target: the PSI server setup and response over the requester's (padded) set. */
export interface PreviewAnswerMsg extends Base {
  previewId: string;
  /** Number of real (unpadded) items the requester put in. Self-reported; hygiene only. */
  setSize: number;
  psiSetup: string;
  psiResponse: string;
}

/** Target → requester: only the noised, floored cardinality. Never the exact count. */
export interface PreviewResultMsg extends Base {
  previewId: string;
  /** The target's reporting floor (≥ 5). */
  floor: number;
  belowFloor: boolean;
  /** Noised cardinality when at or above the floor, else null. */
  value: number | null;
}

/** Either side proposes, the other accepts. Each side announces a fresh match key. */
export interface RenewMsg extends Base {
  /** 32 random bytes, hex; the accept echoes the proposal's id. */
  renewId: string;
  role: 'propose' | 'accept';
  /** The sender's next per-match public key. */
  matchKey: string;
  /** New match end; at most 90 days after `issuedAt`. The accept echoes the proposal's. */
  expiresAt: number;
}

/** Ends the match (or withdraws a request). Carries no reason. */
export type RevokeMsg = Base;

export interface ControlMessages {
  matchRequest: MatchRequestMsg;
  matchAccept: MatchAcceptMsg;
  previewRequest: PreviewRequestMsg;
  previewResponse: PreviewResponseMsg;
  previewAnswer: PreviewAnswerMsg;
  previewResult: PreviewResultMsg;
  renew: RenewMsg;
  revoke: RevokeMsg;
}

export type ControlKindName = keyof ControlMessages;

/** Field order per message (also the allowed key set; `padding` is always last). */
export const MESSAGE_FIELDS: { readonly [K in ControlKindName]: readonly string[] } = {
  matchRequest: ['v', 'matchId', 'issuedAt', 'matchKey', 'durationDays'],
  matchAccept: ['v', 'matchId', 'issuedAt', 'matchKey', 'expiresAt'],
  previewRequest: ['v', 'matchId', 'issuedAt', 'previewId'],
  previewResponse: ['v', 'matchId', 'issuedAt', 'previewId', 'accept', 'psiRequest'],
  previewAnswer: ['v', 'matchId', 'issuedAt', 'previewId', 'setSize', 'psiSetup', 'psiResponse'],
  previewResult: ['v', 'matchId', 'issuedAt', 'previewId', 'floor', 'belowFloor', 'value'],
  renew: ['v', 'matchId', 'issuedAt', 'renewId', 'role', 'matchKey', 'expiresAt'],
  revoke: ['v', 'matchId', 'issuedAt'],
};

export function controlKind(name: ControlKindName): number {
  return MATCH_KINDS[name];
}

function utf8Length(s: string): number {
  return new TextEncoder().encode(s).length;
}

function fail(path: string, message: string): never {
  throw new ValidationError(path, message);
}

/**
 * Canonical encoding: keys in `MESSAGE_FIELDS` order, then `padding` ("0"s) so the
 * UTF-8 encoding is exactly `CONTROL_MESSAGE_BYTES`. Validates the message first.
 */
export function encodeControl<K extends ControlKindName>(name: K, msg: ControlMessages[K]): string {
  checkFields(name, msg as unknown as Record<string, unknown>);
  const ordered: Record<string, unknown> = {};
  for (const key of MESSAGE_FIELDS[name]) ordered[key] = (msg as unknown as Record<string, unknown>)[key];
  ordered.padding = '';
  const bare = JSON.stringify(ordered);
  const room = CONTROL_MESSAGE_BYTES - utf8Length(bare);
  if (room < 0) throw new RangeError(`${name} message is ${-room} bytes over ${CONTROL_MESSAGE_BYTES}`);
  ordered.padding = '0'.repeat(room);
  return JSON.stringify(ordered);
}

export interface DecodeOptions {
  now: Date;
}

/**
 * Parse and validate an untrusted control message: exact size before parsing,
 * exact keys, field formats, and freshness (`issuedAt` within the last 14 days and
 * at most 300 s in the future). Throws `ValidationError`.
 */
export function decodeControl<K extends ControlKindName>(name: K, text: string, opts: DecodeOptions): ControlMessages[K] {
  if (typeof text !== 'string' || utf8Length(text) !== CONTROL_MESSAGE_BYTES) {
    fail(name, `must be exactly ${CONTROL_MESSAGE_BYTES} bytes`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    fail(name, 'is not valid JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw) || Object.getPrototypeOf(raw) !== Object.prototype) {
    fail(name, 'must be a plain object');
  }
  const o = raw as Record<string, unknown>;
  const allowed = [...MESSAGE_FIELDS[name], 'padding'];
  for (const key of Object.keys(o)) if (!allowed.includes(key)) fail(`${name}.${key}`, 'unknown key');
  for (const key of allowed) if (!Object.prototype.hasOwnProperty.call(o, key)) fail(`${name}.${key}`, 'is required');
  if (typeof o.padding !== 'string' || !HEX.test(o.padding)) fail(`${name}.padding`, 'must be hex');
  const { padding: _padding, ...rest } = o;
  checkFields(name, rest);
  const nowSec = Math.floor(opts.now.getTime() / 1000);
  const issuedAt = rest.issuedAt as number;
  if (issuedAt > nowSec + MESSAGE_LIMITS.clockSkewSec) fail(`${name}.issuedAt`, 'is in the future');
  if (issuedAt < nowSec - MESSAGE_LIMITS.maxAgeSec) fail(`${name}.issuedAt`, 'is too old');
  return rest as unknown as ControlMessages[K];
}

function int(o: Record<string, unknown>, path: string, key: string, min: number, max: number): number {
  const v = o[key];
  if (typeof v !== 'number' || !Number.isInteger(v)) fail(`${path}.${key}`, 'must be an integer');
  if (v < min || v > max) fail(`${path}.${key}`, `must be between ${min} and ${max}`);
  return v;
}

function hex64(o: Record<string, unknown>, path: string, key: string): void {
  if (typeof o[key] !== 'string' || !HEX64.test(o[key] as string)) fail(`${path}.${key}`, 'must be 64 lowercase hex characters');
}

function b64(o: Record<string, unknown>, path: string, key: string, allowEmpty: boolean): void {
  const v = o[key];
  if (typeof v !== 'string' || v.length > MESSAGE_LIMITS.maxPsiBase64 || !BASE64.test(v)) fail(`${path}.${key}`, 'must be base64');
  if (!allowEmpty && v.length === 0) fail(`${path}.${key}`, 'must not be empty');
}

function checkFields(name: ControlKindName, o: Record<string, unknown>): void {
  for (const key of Object.keys(o)) if (!MESSAGE_FIELDS[name].includes(key)) fail(`${name}.${key}`, 'unknown key');
  for (const key of MESSAGE_FIELDS[name]) if (!Object.prototype.hasOwnProperty.call(o, key)) fail(`${name}.${key}`, 'is required');
  if (o.v !== 1) fail(`${name}.v`, 'must be 1');
  hex64(o, name, 'matchId');
  const issuedAt = int(o, name, 'issuedAt', 1, 1e11);
  switch (name) {
    case 'matchRequest':
      hex64(o, name, 'matchKey');
      int(o, name, 'durationDays', 1, MESSAGE_LIMITS.maxDurationDays);
      break;
    case 'matchAccept': {
      hex64(o, name, 'matchKey');
      const exp = int(o, name, 'expiresAt', 1, 1e11);
      if (exp <= issuedAt) fail(`${name}.expiresAt`, 'must be after issuedAt');
      if (exp > issuedAt + MESSAGE_LIMITS.maxDurationDays * 86_400) fail(`${name}.expiresAt`, 'is more than 90 days out');
      break;
    }
    case 'previewRequest':
      hex64(o, name, 'previewId');
      break;
    case 'previewResponse':
      hex64(o, name, 'previewId');
      if (typeof o.accept !== 'boolean') fail(`${name}.accept`, 'must be a boolean');
      b64(o, name, 'psiRequest', !o.accept);
      if (!o.accept && o.psiRequest !== '') fail(`${name}.psiRequest`, 'must be empty when declining');
      break;
    case 'previewAnswer':
      hex64(o, name, 'previewId');
      int(o, name, 'setSize', 0, 100_000);
      b64(o, name, 'psiSetup', false);
      b64(o, name, 'psiResponse', false);
      break;
    case 'previewResult': {
      hex64(o, name, 'previewId');
      const floor = int(o, name, 'floor', PREVIEW_PRIVACY.minFloor, 100);
      if (typeof o.belowFloor !== 'boolean') fail(`${name}.belowFloor`, 'must be a boolean');
      if (o.belowFloor) {
        if (o.value !== null) fail(`${name}.value`, 'must be null below the floor');
      } else {
        int(o, name, 'value', floor, 1_000_000);
      }
      break;
    }
    case 'renew': {
      hex64(o, name, 'renewId');
      if (o.role !== 'propose' && o.role !== 'accept') fail(`${name}.role`, 'must be propose or accept');
      hex64(o, name, 'matchKey');
      const exp = int(o, name, 'expiresAt', 1, 1e11);
      // An accept may arrive days after the proposal; the receiver checks it echoes the proposal.
      if (o.role === 'propose' && exp > issuedAt + MESSAGE_LIMITS.maxDurationDays * 86_400) {
        fail(`${name}.expiresAt`, 'is more than 90 days out');
      }
      break;
    }
    case 'revoke':
      break;
  }
}
