// CircleMember: the effectful glue. MLS group membership and transport come from
// marmot-ts (Marmot = MLS over Nostr); the round logic is the pure
// CircleRoundEngine. PROTOTYPE: one circle per CircleMember, alpha MLS library
// (marmot-ts 0.5.1 with ts-mls overridden to 2.0.0-rc.16, both unaudited). See
// docs/CIRCLES.md. marmot-ts 0.5.1 lacks 0.7.0's authorization fixes; authz.ts
// re-checks them at the app layer, and a violation halts the circle locally.
//
// Message path for a round message:
//   inner event {kind 3480-3482, content: JSON} signed by the member's identity key
//   → JSON as the content of an unsigned application rumor, padded with trailing
//     spaces so the serialized rumor is exactly one of PAD_BUCKETS (padding.ts)
//   → MLS PrivateMessage (ts-mls) → Marmot kind-445 group event (ChaCha20-Poly1305
//     under an MLS-exporter key, ephemeral Nostr key) → relays.
// The inner signature is there because marmot-ts 0.5.1 does not hand the MLS sender
// of an application message to the application; we check the signer is a current
// MLS member AND the credential identity of the MLS sender leaf (ts-mls rc.16
// returns senderLeafIndex). (Newer marmot-ts versions expose more; see docs.)

import {
  MarmotClient,
  Proposals,
  deserializeApplicationRumor,
  getGroupMembers,
  getNostrGroupIdHex,
} from '@internet-privacy/marmot-ts';
import type { MarmotGroup } from '@internet-privacy/marmot-ts';
import { getEventHash, verifyEvent } from 'nostr-tools/pure';
import type { ClientState } from 'ts-mls';
import { mlsExporter } from 'ts-mls';
import { checkCommitAuthorized, checkGroupEvent, checkKeyPackageEvent, checkSenderBinding, checkWelcomeAuthor } from './authz.ts';
import type { Candidate, CirclePolicy, HistoryEntry, Video } from './core.ts';
import { circleKindName } from './kinds.ts';
import type { InMemoryNostrNetwork, NostrEventLike } from './network.ts';
import type { PadBucket } from './padding.ts';
import { PAD_BUCKETS, bucketFor, padRumor, serializedLength, unpadContent } from './padding.ts';
import { circleFeedCandidates } from './policy.ts';
import { KDF_PREFIX, utf8ToBytes } from './prg.ts';
import type { ContributionInspector, GroupView, RoundMessage, RoundSnapshot } from './round.ts';
import { CircleRoundEngine } from './round.ts';

/** NIP-07-shaped signer (also what marmot-ts / applesauce expect). */
export interface IdentitySigner {
  getPublicKey(): Promise<string> | string;
  signEvent(e: { kind: number; created_at: number; tags: string[][]; content: string }): Promise<NostrEventLike> | NostrEventLike;
  nip44?: {
    encrypt(pubkey: string, plaintext: string): Promise<string> | string;
    decrypt(pubkey: string, ciphertext: string): Promise<string> | string;
  };
}

class MemoryStore<T> {
  private readonly m = new Map<string, T>();
  async getItem(k: string): Promise<T | null> {
    return this.m.get(k) ?? null;
  }
  async setItem(k: string, v: T): Promise<T> {
    this.m.set(k, v);
    return v;
  }
  async removeItem(k: string): Promise<void> {
    this.m.delete(k);
  }
  async clear(): Promise<void> {
    this.m.clear();
  }
  async keys(): Promise<string[]> {
    return [...this.m.keys()];
  }
}

export interface CircleMemberOptions {
  signer: IdentitySigner;
  network: InMemoryNostrNetwork;
  now: () => Date;
  /** This member's policy floor (rounds weaker than this are refused). */
  floor?: CirclePolicy;
  noiseTolerance?: (participants: number) => number;
  /**
   * ≥ 32 secret bytes that seed this member's noise shares. Persist them (encrypted
   * at rest, T9) so a restarted device keeps sticky shares. Default: random.
   */
  localSecret?: Uint8Array;
  /** TEST ONLY. */
  inspect?: ContributionInspector;
}

/** What one member saw during sync: useful for structural tests. */
export interface SeenMessage {
  sender: string;
  kind: number;
  content: string;
}

/** Something the app-level guards (authz.ts, padding.ts) refused. */
export interface Rejection {
  what: 'group-event' | 'commit' | 'round-message' | 'welcome' | 'key-package';
  id?: string;
  reason: string;
}

/** Give up on an event that stayed unreadable for this many syncs. */
const MAX_UNREADABLE_TRIES = 8;

const ROUND_CONTEXT_LABEL = `${KDF_PREFIX}round`;

export class CircleMember {
  readonly identity: string;
  readonly marmot: MarmotClient;
  private readonly opts: CircleMemberOptions;
  group?: MarmotGroup;
  engine?: CircleRoundEngine;
  private readonly seenEvents = new Set<string>();
  /** Sync passes an event has stayed unreadable for (e.g. commits from before we joined). */
  private readonly unreadableTries = new Map<string, number>();
  /** Decrypted round messages this member received from others (structural tests). */
  readonly seen: SeenMessage[] = [];
  /** What the app-level guards refused (audit trail; tests). */
  readonly rejections: Rejection[] = [];
  removed = false;
  /**
   * Set when an applied commit fails the parent-state authorization check
   * (authz.ts). The member then stops syncing and sending for this circle (fail
   * closed): MLS state cannot be rolled back at the app layer.
   */
  halted?: string;
  /** Pad bucket per round, fixed by its round-open, so a round's messages are all one size. */
  private readonly roundBuckets = new Map<string, PadBucket>();

  private constructor(identity: string, opts: CircleMemberOptions) {
    this.identity = identity;
    this.opts = opts;
    this.marmot = new MarmotClient({
      signer: opts.signer as never,
      network: opts.network as never,
      groupStateStore: new MemoryStore(),
      keyPackageStore: new MemoryStore(),
      clientId: identity.slice(0, 16),
    });
  }

  static async create(opts: CircleMemberOptions): Promise<CircleMember> {
    return new CircleMember(await opts.signer.getPublicKey(), opts);
  }

  private get relays(): string[] {
    return this.opts.network.relays;
  }

  /** Publish an MLS key package (kind 30443) so admins can add this member. */
  async publishKeyPackage(): Promise<void> {
    await this.marmot.keyPackages.create({ relays: this.relays });
  }

  private makeEngine(circleId: string): CircleRoundEngine {
    return new CircleRoundEngine({
      circleId,
      identity: this.identity,
      floor: this.opts.floor,
      noiseTolerance: this.opts.noiseTolerance,
      localSecret: this.opts.localSecret,
      since: this.opts.now(),
      inspect: this.opts.inspect,
    });
  }

  /** Create a circle (an MLS group with this member, and optionally others, as admin). */
  async createCircle(name: string, opts: { admins?: string[] } = {}): Promise<string> {
    if (this.group) throw new Error('prototype: one circle per CircleMember');
    this.group = await this.marmot.groups.create(name, { relays: this.relays, adminPubkeys: opts.admins ?? [] });
    this.engine = this.makeEngine(this.group.idStr);
    return this.group.idStr;
  }

  private requireGroup(): MarmotGroup {
    if (!this.group || !this.engine) throw new Error('not in a circle');
    if (this.removed) throw new Error('removed from the circle');
    if (this.halted) throw new Error(`circle halted: ${this.halted}`);
    return this.group;
  }

  /** Admin: add a member by its newest published key package. One MLS commit (new epoch). */
  async invite(pubkey: string): Promise<void> {
    const g = this.requireGroup();
    const kps = await this.opts.network.request(this.relays, { kinds: [30443, 443], authors: [pubkey] });
    // Newest key package that is verified, by the invitee, with credential = author.
    let kp: NostrEventLike | undefined;
    for (const e of [...kps].reverse()) {
      const ok = checkKeyPackageEvent(e, pubkey);
      if (ok.ok) {
        kp = e;
        break;
      }
      this.rejections.push({ what: 'key-package', id: e.id, reason: ok.reason });
    }
    if (!kp) throw new Error(`no valid key package for ${pubkey.slice(0, 12)}…`);
    await g.inviteByKeyPackageEvent(kp as never);
  }

  /** Admin: remove a member. One MLS commit: new epoch, the removed member loses the group key. */
  async remove(pubkey: string): Promise<void> {
    const g = this.requireGroup();
    const proposals = await Proposals.proposeRemoveUser(pubkey)({ state: g.state, ciphersuite: g.ciphersuite, groupData: g.groupData! });
    // marmot-ts 0.5.1's commit() mis-handles a builder that returns an array, so pass the proposals.
    await g.commit({ extraProposals: proposals });
  }

  /** Admin: replace the circle's admin list. One MLS commit (GroupContextExtensions). */
  async setAdmins(pubkeys: string[]): Promise<void> {
    const g = this.requireGroup();
    const proposal = await Proposals.proposeUpdateMetadata({ adminPubkeys: [...new Set(pubkeys)] })({ state: g.state, ciphersuite: g.ciphersuite, groupData: g.groupData! });
    await g.commit({ extraProposals: [proposal] });
  }

  /** Any member: advance the epoch without a membership change (MLS self-update). */
  async selfUpdate(): Promise<void> {
    await this.requireGroup().selfUpdate();
  }

  /**
   * Join from the newest acceptable Welcome gift-wrapped to this member. A Welcome
   * is acceptable only if its authenticated author (the NIP-59 seal signer; the
   * rumor pubkey must match it) is a member and an admin of the joined group
   * (authz.ts check 1, backported from marmot-ts 0.7.0). Rejected Welcomes are
   * discarded along with the group state they produced.
   */
  async acceptInvite(): Promise<string> {
    if (this.group) throw new Error('prototype: one circle per CircleMember');
    const wraps = await this.opts.network.request(this.relays, { kinds: [1059], '#p': [this.identity] });
    await this.marmot.invites.ingestEvents(wraps as never);
    const unread = await this.marmot.invites.decryptGiftWraps();
    if (unread.length === 0) throw new Error('no invite');
    let joined: MarmotGroup | undefined;
    // Newest first (rumor created_at, then id), so the order is deterministic.
    const ordered = [...unread].sort((a, b) => b.created_at - a.created_at || (a.id < b.id ? -1 : 1));
    for (const welcome of ordered) {
      let group: MarmotGroup;
      try {
        ({ group } = await this.marmot.joinGroupFromWelcome({ welcomeRumor: welcome }));
      } catch (e) {
        this.rejections.push({ what: 'welcome', id: welcome.id, reason: `join failed: ${(e as Error).message}` });
        continue;
      }
      const ok = checkWelcomeAuthor(group.state, welcome.pubkey);
      if (ok.ok) {
        joined = group;
        break;
      }
      this.rejections.push({ what: 'welcome', id: welcome.id, reason: ok.reason });
      await this.marmot.groups.destroy(group.idStr);
    }
    for (const u of unread) await this.marmot.invites.markAsRead(u.id);
    if (!joined) throw new Error('no acceptable invite');
    this.group = joined;
    this.engine = this.makeEngine(joined.idStr);
    return joined.idStr;
  }

  epoch(): number {
    return Number(this.requireGroup().state.groupContext.epoch);
  }

  members(): string[] {
    return getGroupMembers(this.requireGroup().state).sort();
  }

  view(): GroupView {
    const g = this.requireGroup();
    return {
      epoch: Number(g.state.groupContext.epoch),
      members: getGroupMembers(g.state),
      roundContext: async (roundId: string) =>
        mlsExporter(g.state.keySchedule.exporterSecret, ROUND_CONTEXT_LABEL, utf8ToBytes(roundId), 32, g.ciphersuite),
    };
  }

  private async send(messages: RoundMessage[]): Promise<void> {
    const g = this.requireGroup();
    for (const m of messages) {
      const created_at = Math.floor(this.opts.now().getTime() / 1000);
      const inner = await this.opts.signer.signEvent({ kind: m.kind, created_at, tags: [], content: m.content });
      const unsigned = { kind: m.kind, created_at, tags: [] as string[][], content: JSON.stringify(inner), pubkey: this.identity };
      // Every message of a round is padded to the round-open's bucket (padding.ts).
      const roundId = (JSON.parse(m.content) as { roundId: string }).roundId;
      const size = serializedLength({ ...unsigned, id: '0'.repeat(64) });
      const bucket = bucketFor(size, this.roundBuckets.get(roundId) ?? 0);
      if (!this.roundBuckets.has(roundId)) this.roundBuckets.set(roundId, bucket);
      const rumor = padRumor(unsigned, bucket, (r) => getEventHash(r));
      await g.sendApplicationRumor(rumor as never);
    }
  }

  /** Open a round in the current epoch over a public candidate list. */
  async openRound(candidates: readonly string[], opts: { keyWindowSec?: number; maskWindowSec?: number; policy?: CirclePolicy } = {}): Promise<string> {
    this.requireGroup();
    const out = await this.engine!.open(this.view(), { candidates, now: this.opts.now(), ...opts });
    await this.send(out);
    return JSON.parse(out[0].content).roundId as string;
  }

  /**
   * Fetch new group events, apply MLS commits and round messages, advance round
   * deadlines and send whatever the round needs from this member. `history` is the
   * local endorsement history; it only ever leaves the device masked.
   */
  async sync(history: readonly HistoryEntry[] = []): Promise<void> {
    if (!this.group || this.removed || this.halted) return;
    const g = this.group;
    const h = getNostrGroupIdHex(g.state);
    const events: NostrEventLike[] = [];
    for (const e of await this.opts.network.request(this.relays, { kinds: [445], '#h': [h] })) {
      if (this.seenEvents.has(e.id)) continue;
      // marmot-ts 0.7.0 drops kind-445 events with extra tags; 0.5.1 does not.
      const shape = checkGroupEvent(e, h);
      if (!shape.ok) {
        this.seenEvents.add(e.id);
        this.rejections.push({ what: 'group-event', id: e.id, reason: shape.reason });
        continue;
      }
      events.push(e);
    }
    const incoming: { sender: string; kind: number; content: string; createdAt: number }[] = [];
    // `parent` is the state each yielded result was applied to: ingest() sets
    // g.state before every yield, and nothing else changes it in between.
    let parent: ClientState = g.state;
    // Events from epochs we have not reached yet come back "unreadable"; they are
    // not marked seen, so the next sync retries them (bounded by relay retention).
    for await (const r of g.ingest(events as never, { maxRetries: 64 })) {
      const before = parent;
      parent = g.state;
      if (r.kind === 'unreadable') {
        const tries = (this.unreadableTries.get(r.event.id) ?? 0) + 1;
        this.unreadableTries.set(r.event.id, tries);
        if (tries >= MAX_UNREADABLE_TRIES) this.seenEvents.add(r.event.id);
        continue;
      }
      this.seenEvents.add(r.event.id);
      if (r.kind !== 'processed') continue;
      if (r.result.kind === 'newState') {
        if (r.result.newState.groupContext.epoch === before.groupContext.epoch) continue; // a proposal
        // Re-authorize the commit against the state it was applied to (authz.ts check 2).
        const ok = checkCommitAuthorized(before, r.result.newState, r.result.senderLeafIndex);
        if (!ok.ok) {
          this.rejections.push({ what: 'commit', id: r.event.id, reason: ok.reason });
          this.halted = ok.reason;
          return;
        }
        continue;
      }
      if (r.result.kind !== 'applicationMessage') continue;
      const parsed = this.parseRoundRumor(r.result.message, r.event.id);
      if (!parsed) continue;
      const pm = (r.message as { privateMessage?: { epoch: bigint | number } }).privateMessage;
      const epoch = pm ? BigInt(pm.epoch) : before.groupContext.epoch;
      const bound = checkSenderBinding(before, epoch, r.result.senderLeafIndex, parsed.sender);
      if (!bound.ok) {
        this.rejections.push({ what: 'round-message', id: r.event.id, reason: bound.reason });
        continue;
      }
      incoming.push(parsed);
    }
    if (!getGroupMembers(g.state).includes(this.identity)) {
      this.removed = true;
      return;
    }
    const now = this.opts.now();
    // Causal order within a batch: opens, then keys, then masked vectors (kinds ascend).
    incoming.sort((a, b) => a.kind - b.kind || a.createdAt - b.createdAt);
    for (const m of incoming) {
      if (!getGroupMembers(g.state).includes(m.sender)) continue;
      this.seen.push({ sender: m.sender, kind: m.kind, content: m.content });
      await this.send(await this.engine!.receive(this.view(), m, now));
    }
    await this.send(await this.engine!.tick(this.view(), now, history));
  }

  private parseRoundRumor(bytes: Uint8Array, eventId: string): { sender: string; kind: number; content: string; createdAt: number } | undefined {
    // Size before parse: a round message must be exactly one pad bucket long.
    if (!(PAD_BUCKETS as readonly number[]).includes(bytes.length)) {
      this.rejections.push({ what: 'round-message', id: eventId, reason: `unpadded round message (${bytes.length} bytes)` });
      return undefined;
    }
    let rumor: { kind: number; content: string };
    try {
      rumor = deserializeApplicationRumor(bytes) as never;
    } catch {
      return undefined;
    }
    if (!circleKindName(rumor.kind) || typeof rumor.content !== 'string') return undefined;
    let inner: NostrEventLike;
    try {
      const o = JSON.parse(unpadContent(bytes.length, rumor.content)) as NostrEventLike;
      // Verify a fresh object (nostr-tools caches verdicts on the object, T25).
      inner = {
        id: o.id,
        pubkey: o.pubkey,
        created_at: o.created_at,
        kind: o.kind,
        tags: Array.isArray(o.tags) ? o.tags.map((t) => [...t]) : [],
        content: o.content,
        sig: o.sig,
      };
    } catch {
      return undefined;
    }
    if (inner.kind !== rumor.kind || inner.tags.length !== 0 || typeof inner.content !== 'string') return undefined;
    if (!verifyEvent(inner)) return undefined;
    this.noteBucket(inner, bytes.length as PadBucket);
    return { sender: inner.pubkey, kind: inner.kind, content: inner.content, createdAt: inner.created_at };
  }

  /** Remember the bucket a round-open used, so this member pads its replies the same. */
  private noteBucket(inner: NostrEventLike, bucket: PadBucket): void {
    if (circleKindName(inner.kind) !== 'roundOpen') return;
    try {
      const roundId = (JSON.parse(inner.content) as { roundId?: unknown }).roundId;
      if (typeof roundId === 'string' && !this.roundBuckets.has(roundId)) this.roundBuckets.set(roundId, bucket);
    } catch {
      // the engine rejects malformed content
    }
  }

  rounds(): RoundSnapshot[] {
    return this.engine?.listRounds() ?? [];
  }

  /** Circle picks from every released epoch, as core `circle` candidates for rank(). */
  candidates(circleName: string, videos: ReadonlyMap<string, Video>): Candidate[] {
    return this.engine ? circleFeedCandidates(this.engine.ledger, circleName, videos) : [];
  }
}
