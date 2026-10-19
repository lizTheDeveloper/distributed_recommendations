// One member's side of Circle rounds: a transport-agnostic state machine.
//
// A round, bound to one MLS epoch e (docs/CIRCLES.md, "Round"):
//   1. open    any member sends round-open (domain = public candidate list, policy,
//              deadlines). Every member validates it against its own local floor.
//   2. key     each member that takes part sends a fresh X25519 round key.
//   3. fix     at keyDeadline each member fixes the participant set P = keys seen.
//              |P| < minMembers → the epoch is released as "too few members".
//   4. masked  each participant sends y_i = x_i + noise_i + masks (mod 2^32), where
//              x_i is 0/1 per candidate (its new endorsements), noise_i its Pólya
//              share, and the masks are pairwise over P. The message carries a
//              digest of P (bound to the MLS epoch secret), so differing views of P
//              are detected. Sending marks the epoch as contributed: never again.
//   5. release once all |P| vectors are in, sum, apply core's policy (threshold on
//              the noised count, picks only), record the epoch in the ledger.
//              Missing vectors at maskDeadline, a digest mismatch, a second
//              different vector or an implausible sum → the epoch is VOID, final.
//
// The engine never sees raw vectors of other members (only masked ones), never
// stores noised counts, and never holds anyone's noise seed but its own.

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, randomBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import type { CirclePolicy, CircleResult, HistoryEntry } from './core.ts';
import { DEFAULT_CIRCLE_POLICY, parseCirclePolicy, revealThresholdFor } from './core.ts';
import { CIRCLE_KINDS, circleKindName } from './kinds.ts';
import type { MaskPeer, RoundKeyPair } from './masking.ts';
import { decodeVector, encodeVector, fromSigned, generateRoundKey, maskVector, sumVectors, toSigned } from './masking.ts';
import type { RoundOpenMsg } from './messages.ts';
import {
  MessageError,
  decodeRoundKey,
  decodeRoundMasked,
  decodeRoundOpen,
  encodeRoundKey,
  encodeRoundMasked,
  encodeRoundOpen,
} from './messages.ts';
import { defaultNoiseTolerance, memberNoiseKey, noiseShareVector, shareShape } from './noise.ts';
import type { CirclesLedger, VoidReason } from './policy.ts';
import { emptyCirclesLedger, newestEpoch, releaseAggregatedEpoch, releasedItems, voidEpoch } from './policy.ts';
import { deriveKey } from './prg.ts';

/** A round message as handed to / taken from the transport (inside MLS). */
export interface RoundMessage {
  kind: number;
  /** JSON per messages.ts. */
  content: string;
}

/** A received round message, after the transport authenticated its sender. */
export interface ReceivedRoundMessage extends RoundMessage {
  /** Authenticated sender identity (Nostr pubkey hex). */
  sender: string;
  /** Sender's claimed send time, Unix seconds (inside the signed inner event). */
  createdAt: number;
}

/** What the transport tells the engine about the group right now. */
export interface GroupView {
  /** Current MLS epoch. */
  epoch: number;
  /** Current MLS members (identities). */
  members: readonly string[];
  /** 32 bytes bound to the current MLS epoch secret and the round id (MLS exporter). */
  roundContext(roundId: string): Promise<Uint8Array>;
}

export type RoundStatus =
  | 'collecting-keys'
  | 'masked-sent'
  | 'absent'
  | 'released'
  | 'too-few-members'
  | 'void';

export interface RoundSnapshot {
  roundId: string;
  epoch: number;
  opener: string;
  status: RoundStatus;
  participants: string[];
  voidReason?: VoidReason | 'epoch-changed';
  result?: CircleResult;
}

/** TEST-ONLY hook: lets tests check mask cancellation. Never set it in an app. */
export interface ContributionInspector {
  (info: { identity: string; epoch: number; input: Uint8Array; noise: Int32Array; masked: Uint32Array }): void;
}

export interface EngineOptions {
  circleId: string;
  identity: string;
  /** ≥ 32 random bytes that never leave this device: seeds this member's noise shares. */
  localSecret?: Uint8Array;
  /** This member's floor: rounds with weaker policies are refused. Default core's DEFAULT_CIRCLE_POLICY. */
  floor?: CirclePolicy;
  /**
   * Collusion tolerance for this member's noise share, as a function of the
   * participant count. Default ⌈m/3⌉ − 1 (noise.ts).
   */
  noiseTolerance?: (participants: number) => number;
  /** Endorsements at or before this time are never pooled (default: creation time). */
  since?: Date;
  ledger?: CirclesLedger;
  inspect?: ContributionInspector;
}

interface Round {
  open: RoundOpenMsg;
  opener: string;
  members: string[];
  status: RoundStatus;
  myKey?: RoundKeyPair;
  keys: Map<string, string>;
  participants?: MaskPeer[];
  digest?: string;
  masked: Map<string, Uint32Array>;
  /** Masked messages that arrived before this member fixed P. */
  early: ReceivedRoundMessage[];
  voidReason?: VoidReason | 'epoch-changed';
  result?: CircleResult;
}

/** Sum entries farther than this from [0, |P|] mean someone sent garbage. */
const PLAUSIBLE_NOISE = 1_000_000;

const sec = (d: Date) => Math.floor(d.getTime() / 1000);

export class CircleRoundEngine {
  readonly circleId: string;
  readonly identity: string;
  private readonly localSecret: Uint8Array;
  private readonly floor: CirclePolicy;
  private readonly tolerance: (m: number) => number;
  private readonly inspect?: ContributionInspector;
  private ledgerState: CirclesLedger;
  /** Epochs this member has sent a masked vector for. Never contribute twice. */
  private readonly contributed = new Set<number>();
  /** Endorsements after this (Unix s) have not been pooled yet. */
  private cursor: number;
  private readonly rounds = new Map<string, Round>();
  /** epoch → roundId of the one round this member follows in that epoch. */
  private readonly roundForEpoch = new Map<number, string>();

  constructor(opts: EngineOptions) {
    this.circleId = opts.circleId;
    this.identity = opts.identity;
    this.localSecret = opts.localSecret ?? randomBytes(32);
    this.floor = parseCirclePolicy(opts.floor ?? DEFAULT_CIRCLE_POLICY);
    this.tolerance = opts.noiseTolerance ?? defaultNoiseTolerance;
    this.inspect = opts.inspect;
    this.ledgerState = opts.ledger ?? emptyCirclesLedger();
    this.cursor = sec(opts.since ?? new Date());
  }

  get ledger(): CirclesLedger {
    return this.ledgerState;
  }

  contributedEpochs(): number[] {
    return [...this.contributed].sort((a, b) => a - b);
  }

  listRounds(): RoundSnapshot[] {
    return [...this.rounds.values()].map((r) => this.snapshot(r));
  }

  round(roundId: string): RoundSnapshot | undefined {
    const r = this.rounds.get(roundId);
    return r && this.snapshot(r);
  }

  private snapshot(r: Round): RoundSnapshot {
    return {
      roundId: r.open.roundId,
      epoch: r.open.epoch,
      opener: r.opener,
      status: r.status,
      participants: (r.participants ?? []).map((p) => p.identity),
      ...(r.voidReason ? { voidReason: r.voidReason } : {}),
      ...(r.result ? { result: r.result } : {}),
    };
  }

  /** Would this member accept a round with `policy`? (its local floor) */
  acceptsPolicy(policy: CirclePolicy): boolean {
    const f = this.floor;
    if (policy.minMembers < f.minMembers) return false;
    if (policy.epsilon > f.epsilon) return false;
    if (policy.maxItemsPerMember > f.maxItemsPerMember) return false;
    if (policy.revealThreshold !== undefined && policy.revealThreshold < revealThresholdFor(policy.minMembers)) return false;
    return true;
  }

  /**
   * Start a round in the current epoch. Returns the messages to send (round-open,
   * then this member's round-key), already applied locally.
   */
  async open(
    view: GroupView,
    args: { candidates: readonly string[]; now: Date; keyWindowSec?: number; maskWindowSec?: number; policy?: CirclePolicy },
  ): Promise<RoundMessage[]> {
    const openedAt = sec(args.now);
    const msg: RoundOpenMsg = {
      v: 1,
      roundId: bytesToHex(randomBytes(32)),
      circleId: this.circleId,
      epoch: view.epoch,
      openedAt,
      keyDeadline: openedAt + (args.keyWindowSec ?? 3600),
      maskDeadline: openedAt + (args.keyWindowSec ?? 3600) + (args.maskWindowSec ?? 3600),
      policy: parseCirclePolicy(args.policy ?? this.floor),
      candidates: [...new Set(args.candidates)].sort(),
    };
    const out: RoundMessage = { kind: CIRCLE_KINDS.roundOpen, content: encodeRoundOpen(msg) };
    const followUps = await this.receive(view, { ...out, sender: this.identity, createdAt: openedAt }, args.now);
    if (!this.rounds.has(msg.roundId)) throw new Error('refused to open the round (see acceptsPolicy / epoch rules)');
    return [out, ...followUps];
  }

  /**
   * Handle one authenticated round message. Returns messages to send in reply
   * (already applied locally). Invalid or out-of-place messages are ignored.
   */
  async receive(view: GroupView, m: ReceivedRoundMessage, now: Date): Promise<RoundMessage[]> {
    const name = circleKindName(m.kind);
    if (!name || !view.members.includes(m.sender)) return [];
    try {
      if (name === 'roundOpen') return await this.onOpen(view, m, now);
      if (name === 'roundKey') {
        this.onKey(m);
        return [];
      }
      return await this.onMasked(view, m);
    } catch (e) {
      if (e instanceof MessageError) return [];
      throw e;
    }
  }

  private async onOpen(view: GroupView, m: ReceivedRoundMessage, now: Date): Promise<RoundMessage[]> {
    const open = decodeRoundOpen(m.content);
    const t = sec(now);
    if (open.circleId !== this.circleId) return [];
    if (open.epoch !== view.epoch) return []; // a round binds to the current MLS epoch
    if (this.roundForEpoch.has(open.epoch)) return []; // one round per epoch; first seen wins
    if (this.contributed.has(open.epoch) || open.epoch <= newestEpoch(this.ledgerState)) return []; // freeze
    if (!this.acceptsPolicy(open.policy)) return [];
    if (view.members.length < open.policy.minMembers) return [];
    if (open.openedAt > t + 300 || open.keyDeadline <= t) return [];
    const round: Round = {
      open,
      opener: m.sender,
      members: [...view.members].sort(),
      status: 'collecting-keys',
      keys: new Map(),
      masked: new Map(),
      early: [],
    };
    this.rounds.set(open.roundId, round);
    this.roundForEpoch.set(open.epoch, open.roundId);
    round.myKey = generateRoundKey();
    const key: RoundMessage = {
      kind: CIRCLE_KINDS.roundKey,
      content: encodeRoundKey({ v: 1, roundId: open.roundId, epoch: open.epoch, roundKey: round.myKey.publicKey }),
    };
    round.keys.set(this.identity, round.myKey.publicKey);
    return [key];
  }

  private onKey(m: ReceivedRoundMessage): void {
    const k = decodeRoundKey(m.content);
    const r = this.rounds.get(k.roundId);
    if (!r || r.open.epoch !== k.epoch || r.status !== 'collecting-keys') return;
    if (!r.members.includes(m.sender)) return; // must have been a member when the round opened
    if (m.createdAt > r.open.keyDeadline) return;
    const prev = r.keys.get(m.sender);
    if (prev !== undefined && prev !== k.roundKey) {
      // Equivocation: two keys from one sender. Drop the sender from our view; the
      // digest check then voids the round if others saw a different key.
      r.keys.delete(m.sender);
      return;
    }
    r.keys.set(m.sender, k.roundKey);
  }

  private async onMasked(view: GroupView, m: ReceivedRoundMessage): Promise<RoundMessage[]> {
    const msg = decodeRoundMasked(m.content);
    const r = this.rounds.get(msg.roundId);
    if (!r || r.open.epoch !== msg.epoch) return [];
    if (r.status === 'collecting-keys') {
      // We have not fixed P yet: keep it and replay it once we have.
      if (r.early.length < r.members.length * 2) r.early.push(m);
      return [];
    }
    if (r.status !== 'masked-sent') return [];
    if (!r.participants!.some((p) => p.identity === m.sender)) return [];
    if (msg.participants !== r.digest) return this.voidRound(r, 'participant-mismatch');
    let v: Uint32Array;
    try {
      v = decodeVector(msg.vector, r.open.candidates.length);
    } catch {
      return this.voidRound(r, 'bad-vector');
    }
    const prev = r.masked.get(m.sender);
    if (prev) {
      if (!prev.every((x, i) => x === v[i])) return this.voidRound(r, 'duplicate-vector');
      return [];
    }
    r.masked.set(m.sender, v);
    this.tryRelease(r);
    return [];
  }

  /**
   * Advance deadlines. Call after each sync and on a timer. `history` is this
   * member's local endorsement history (never leaves the device except masked).
   */
  async tick(view: GroupView, now: Date, history: readonly HistoryEntry[]): Promise<RoundMessage[]> {
    const out: RoundMessage[] = [];
    const t = sec(now);
    for (const r of this.rounds.values()) {
      if (r.status === 'collecting-keys' && t >= r.open.keyDeadline) out.push(...(await this.fixAndMask(view, r, history)));
      if (r.status === 'masked-sent' && t >= r.open.maskDeadline && r.masked.size < r.participants!.length) {
        this.voidRound(r, 'dropout');
      }
    }
    return out;
  }

  private async fixAndMask(view: GroupView, r: Round, history: readonly HistoryEntry[]): Promise<RoundMessage[]> {
    const participants = [...r.keys.entries()]
      .map(([identity, roundKey]) => ({ identity, roundKey }))
      .sort((a, b) => (a.identity < b.identity ? -1 : a.identity > b.identity ? 1 : 0));
    r.participants = participants;
    if (!r.keys.has(this.identity)) {
      r.status = 'absent';
      return [];
    }
    if (participants.length < r.open.policy.minMembers) {
      // Below the floor nothing is computed or sent; the epoch is released empty.
      const rel = releaseAggregatedEpoch(
        this.ledgerState,
        { epoch: r.open.epoch, participants: participants.map((p) => p.identity), noisedCounts: new Map() },
        r.open.policy,
      );
      if (rel.ok) {
        this.ledgerState = rel.ledger;
        r.result = rel.result;
      }
      r.status = 'too-few-members';
      return [];
    }
    if (view.epoch !== r.open.epoch) {
      // A commit happened mid-round: our MLS context no longer matches the round's.
      r.status = 'void';
      r.voidReason = 'epoch-changed';
      return [];
    }
    if (this.contributed.has(r.open.epoch)) throw new Error('internal: second contribution for an epoch');

    const context = await view.roundContext(r.open.roundId);
    r.digest = participantsDigest(context, participants);

    // x_i: 0/1 per candidate, from endorsements made since the last contribution.
    const n = r.open.candidates.length;
    const index = new Map(r.open.candidates.map((id, i) => [id, i]));
    const released = releasedItems(this.ledgerState);
    const fresh = history
      .filter((h) => h.kind === 'endorse')
      .filter((h) => sec(h.at) > this.cursor && sec(h.at) <= r.open.openedAt)
      .filter((h) => index.has(h.videoId) && !released.has(h.videoId))
      .sort((a, b) => b.at.getTime() - a.at.getTime());
    const input = new Uint8Array(n);
    let count = 0;
    for (const h of fresh) {
      const i = index.get(h.videoId)!;
      if (input[i]) continue;
      if (count >= r.open.policy.maxItemsPerMember) break;
      input[i] = 1;
      count++;
    }
    // Released items get 0 from everyone (and are dropped again in the policy layer).
    // noise_i: this member's Pólya share, sticky per (circle, epoch).
    const m = participants.length;
    const shape = shareShape(m, Math.min(this.tolerance(m), m - 1));
    const noise = noiseShareVector(memberNoiseKey(this.localSecret, this.circleId, r.open.epoch), n, r.open.policy.epsilon, shape);
    const x = new Uint32Array(n);
    for (let i = 0; i < n; i++) x[i] = fromSigned(input[i] + noise[i]);
    const me = participants.find((p) => p.identity === this.identity)!;
    const masked = maskVector(x, r.myKey!.secretKey, me, participants, context);
    this.inspect?.({ identity: this.identity, epoch: r.open.epoch, input, noise, masked });

    // Point of no return: from here on these endorsements count as pooled.
    this.contributed.add(r.open.epoch);
    this.cursor = Math.max(this.cursor, r.open.openedAt);
    r.myKey!.secretKey.fill(0);
    r.status = 'masked-sent';
    r.masked.set(this.identity, masked);
    const msg: RoundMessage = {
      kind: CIRCLE_KINDS.roundMasked,
      content: encodeRoundMasked({ v: 1, roundId: r.open.roundId, epoch: r.open.epoch, participants: r.digest, vector: encodeVector(masked) }),
    };
    for (const early of r.early.splice(0)) await this.onMasked(view, early);
    this.tryRelease(r);
    return [msg];
  }

  private tryRelease(r: Round): void {
    if (r.status !== 'masked-sent' || r.masked.size !== r.participants!.length) return;
    const n = r.open.candidates.length;
    const sum = sumVectors([...r.masked.values()], n);
    const counts = new Map<string, number>();
    const m = r.participants!.length;
    for (let i = 0; i < n; i++) {
      const c = toSigned(sum[i]);
      if (c < -PLAUSIBLE_NOISE || c > m + PLAUSIBLE_NOISE) {
        this.voidRound(r, 'bad-vector');
        return;
      }
      counts.set(r.open.candidates[i], c);
    }
    const rel = releaseAggregatedEpoch(
      this.ledgerState,
      { epoch: r.open.epoch, participants: r.participants!.map((p) => p.identity), noisedCounts: counts },
      r.open.policy,
    );
    counts.clear(); // noised counts are never kept
    sum.fill(0);
    if (!rel.ok) {
      this.voidRound(r, 'participant-mismatch');
      return;
    }
    this.ledgerState = rel.ledger;
    r.result = rel.result;
    r.status = 'released';
    r.masked.clear();
  }

  private voidRound(r: Round, reason: VoidReason): RoundMessage[] {
    if (r.status === 'released' || r.status === 'void') return [];
    r.status = 'void';
    r.voidReason = reason;
    r.masked.clear();
    this.ledgerState = voidEpoch(this.ledgerState, r.open.epoch, (r.participants ?? []).map((p) => p.identity), reason);
    return [];
  }
}

/**
 * Digest of the participant set, keyed by a value derived from the MLS round
 * context: members on different epochs, or with different views of P, get
 * different digests.
 */
export function participantsDigest(roundContext: Uint8Array, participants: readonly MaskPeer[]): string {
  const tag = deriveKey(roundContext, new Uint8Array(0), 'participants');
  const lines = participants.map((p) => `${p.identity}:${p.roundKey}`).join('\n');
  return bytesToHex(sha256(new Uint8Array([...tag, ...utf8ToBytes(lines)])));
}
