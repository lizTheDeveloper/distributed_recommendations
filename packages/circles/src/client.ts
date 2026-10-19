// CircleMember: the effectful glue. MLS group membership and transport come from
// marmot-ts (Marmot = MLS over Nostr); the round logic is the pure
// CircleRoundEngine. PROTOTYPE: one circle per CircleMember, alpha MLS library
// (marmot-ts 0.5.1 + ts-mls 2.0.0-rc.10, both unaudited). See docs/CIRCLES.md.
//
// Message path for a round message:
//   inner event {kind 3480-3482, content: JSON} signed by the member's identity key
//   → JSON as the content of an unsigned application rumor
//   → MLS PrivateMessage (ts-mls) → Marmot kind-445 group event (ChaCha20-Poly1305
//     under an MLS-exporter key, ephemeral Nostr key) → relays.
// The inner signature is there because marmot-ts 0.5.1 does not hand the MLS sender
// of an application message to the application; we check the signer is a current
// MLS member instead. (Newer marmot-ts versions expose more; see docs.)

import {
  MarmotClient,
  Proposals,
  deserializeApplicationRumor,
  getGroupMembers,
  getNostrGroupIdHex,
} from '@internet-privacy/marmot-ts';
import type { MarmotGroup } from '@internet-privacy/marmot-ts';
import { getEventHash, verifyEvent } from 'nostr-tools/pure';
import { mlsExporter } from 'ts-mls';
import type { Candidate, CirclePolicy, HistoryEntry, Video } from './core.ts';
import { circleKindName } from './kinds.ts';
import type { InMemoryNostrNetwork, NostrEventLike } from './network.ts';
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
  /** TEST ONLY. */
  inspect?: ContributionInspector;
}

/** What one member saw during sync: useful for structural tests. */
export interface SeenMessage {
  sender: string;
  kind: number;
  content: string;
}

const ROUND_CONTEXT_LABEL = `${KDF_PREFIX}round`;

export class CircleMember {
  readonly identity: string;
  readonly marmot: MarmotClient;
  private readonly opts: CircleMemberOptions;
  group?: MarmotGroup;
  engine?: CircleRoundEngine;
  private readonly seenEvents = new Set<string>();
  /** Decrypted round messages this member received from others (structural tests). */
  readonly seen: SeenMessage[] = [];
  removed = false;

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
      since: this.opts.now(),
      inspect: this.opts.inspect,
    });
  }

  /** Create a circle (an MLS group with this member as admin). */
  async createCircle(name: string): Promise<string> {
    if (this.group) throw new Error('prototype: one circle per CircleMember');
    this.group = await this.marmot.groups.create(name, { relays: this.relays });
    this.engine = this.makeEngine(this.group.idStr);
    return this.group.idStr;
  }

  private requireGroup(): MarmotGroup {
    if (!this.group || !this.engine) throw new Error('not in a circle');
    if (this.removed) throw new Error('removed from the circle');
    return this.group;
  }

  /** Admin: add a member by its newest published key package. One MLS commit (new epoch). */
  async invite(pubkey: string): Promise<void> {
    const g = this.requireGroup();
    const kps = await this.opts.network.request(this.relays, { kinds: [30443, 443], authors: [pubkey] });
    const kp = kps.at(-1);
    if (!kp) throw new Error(`no key package for ${pubkey.slice(0, 12)}…`);
    await g.inviteByKeyPackageEvent(kp as never);
  }

  /** Admin: remove a member. One MLS commit: new epoch, the removed member loses the group key. */
  async remove(pubkey: string): Promise<void> {
    const g = this.requireGroup();
    const proposals = await Proposals.proposeRemoveUser(pubkey)({ state: g.state, ciphersuite: g.ciphersuite, groupData: g.groupData! });
    // marmot-ts 0.5.1's commit() mis-handles a builder that returns an array, so pass the proposals.
    await g.commit({ extraProposals: proposals });
  }

  /** Any member: advance the epoch without a membership change (MLS self-update). */
  async selfUpdate(): Promise<void> {
    await this.requireGroup().selfUpdate();
  }

  /** Join from the newest Welcome gift-wrapped to this member. */
  async acceptInvite(): Promise<string> {
    if (this.group) throw new Error('prototype: one circle per CircleMember');
    const wraps = await this.opts.network.request(this.relays, { kinds: [1059], '#p': [this.identity] });
    await this.marmot.invites.ingestEvents(wraps as never);
    const unread = await this.marmot.invites.decryptGiftWraps();
    const welcome = unread.at(-1);
    if (!welcome) throw new Error('no invite');
    const { group } = await this.marmot.joinGroupFromWelcome({ welcomeRumor: welcome });
    for (const u of unread) await this.marmot.invites.markAsRead(u.id);
    this.group = group;
    this.engine = this.makeEngine(group.idStr);
    return group.idStr;
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
      await g.sendApplicationRumor({ ...unsigned, id: getEventHash(unsigned) } as never);
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
    if (!this.group || this.removed) return;
    const g = this.group;
    const h = getNostrGroupIdHex(g.state);
    const events = (await this.opts.network.request(this.relays, { kinds: [445], '#h': [h] })).filter((e) => !this.seenEvents.has(e.id));
    for (const e of events) this.seenEvents.add(e.id);
    const incoming: { sender: string; kind: number; content: string; createdAt: number }[] = [];
    for await (const r of g.ingest(events as never)) {
      if (r.kind !== 'processed' || r.result.kind !== 'applicationMessage') continue;
      const parsed = this.parseRoundRumor(r.result.message);
      if (parsed) incoming.push(parsed);
    }
    if (!getGroupMembers(g.state).includes(this.identity)) {
      this.removed = true;
      return;
    }
    const now = this.opts.now();
    for (const m of incoming) {
      if (!getGroupMembers(g.state).includes(m.sender)) continue;
      this.seen.push({ sender: m.sender, kind: m.kind, content: m.content });
      await this.send(await this.engine!.receive(this.view(), m, now));
    }
    await this.send(await this.engine!.tick(this.view(), now, history));
  }

  private parseRoundRumor(bytes: Uint8Array): { sender: string; kind: number; content: string; createdAt: number } | undefined {
    let rumor: { kind: number; content: string };
    try {
      rumor = deserializeApplicationRumor(bytes) as never;
    } catch {
      return undefined;
    }
    if (!circleKindName(rumor.kind)) return undefined;
    let inner: NostrEventLike;
    try {
      const o = JSON.parse(rumor.content) as NostrEventLike;
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
    return { sender: inner.pubkey, kind: inner.kind, content: inner.content, createdAt: inner.created_at };
  }

  rounds(): RoundSnapshot[] {
    return this.engine?.listRounds() ?? [];
  }

  /** Circle picks from every released epoch, as core `circle` candidates for rank(). */
  candidates(circleName: string, videos: ReadonlyMap<string, Video>): Candidate[] {
    return this.engine ? circleFeedCandidates(this.engine.ledger, circleName, videos) : [];
  }
}
