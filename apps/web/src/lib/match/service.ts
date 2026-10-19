// The app's Match layer: one `MatchClient` (packages/match) for the viewer's
// identity, a relay (real relays over WebSockets, or the in-memory relay of the
// offline demo), PSI, and persistence of the `MatchBook` in the encrypted vault.
//
// Every client operation goes through one queue: `MatchClient` methods replace
// `client.book` after awaits, so two interleaved calls could lose an update.

import type { Candidate, HistoryEntry, SketchConsent, Video } from "../core.ts";
import { selectSketchItems } from "../core.ts";
import type { MatchBook, MatchEvent, MatchRecord, MatchSimilarity, PsiFactory, RelayLike } from "./pkg.ts";
import { DEFAULT_CONSENT, MatchClient, MatchError, matchSimilarities } from "./pkg.ts";
import type { StoredIdentity } from "./identity.ts";
import { signerFor } from "./identity.ts";
import { npubEncode, shortNpub } from "../bech32.ts";

export type PeerSource = "manual" | "creator" | "curator" | "demo";

export interface PeerName {
  name: string;
  source: PeerSource;
  /** Creator handle or taste-list name it came from. */
  ref?: string;
}

export interface MatchMeta {
  names: Record<string, PeerName>;
  /** Local activity log (newest last), shown on the Matches screen. Never sent. */
  log: { at: number; text: string }[];
  lastSyncAt?: number;
}

export const LOG_CAP = 60;

export function emptyMeta(): MatchMeta {
  return { names: {}, log: [] };
}

export function loadMeta(x: unknown): MatchMeta {
  const m = emptyMeta();
  if (typeof x !== "object" || x === null) return m;
  const o = x as Record<string, unknown>;
  if (typeof o.names === "object" && o.names) {
    for (const [k, v] of Object.entries(o.names as Record<string, unknown>)) {
      const n = v as Record<string, unknown>;
      if (/^[0-9a-f]{64}$/.test(k) && n && typeof n.name === "string" && n.name.length <= 80) {
        const source = (["manual", "creator", "curator", "demo"] as const).find((s) => s === n.source) ?? "manual";
        m.names[k] = { name: n.name, source, ref: typeof n.ref === "string" ? n.ref.slice(0, 200) : undefined };
      }
    }
  }
  if (Array.isArray(o.log)) {
    m.log = o.log
      .filter((e): e is { at: number; text: string } => !!e && typeof e.at === "number" && typeof e.text === "string")
      .slice(-LOG_CAP);
  }
  if (typeof o.lastSyncAt === "number") m.lastSyncAt = o.lastSyncAt;
  return m;
}

/** A light structural check of a stored book; the client re-validates as it goes. */
export function loadBook(x: unknown): MatchBook | null {
  if (typeof x !== "object" || x === null) return null;
  const o = x as Partial<MatchBook>;
  if (o.v !== 1 || typeof o.self !== "string" || typeof o.matches !== "object" || !o.previews || !o.previewPolicy) return null;
  return x as MatchBook;
}

/** Hook the offline demo uses to let its simulated peer act between our syncs. */
export interface PeerDriver {
  step(): Promise<boolean>;
}

export interface MatchServiceOptions {
  now: () => Date;
  psi: PsiFactory;
  /** Sketch history: endorsements (and finished watches) from the encrypted local history. */
  history: () => HistoryEntry[];
  persist: (book: MatchBook | null, meta: MatchMeta) => void;
  onChange: () => void;
  onEvent?: (e: MatchEvent, text: string) => void;
}

export type ServiceState = "no-identity" | "starting" | "ready" | "error";

export class MatchService {
  identity: StoredIdentity | null = null;
  client: MatchClient | null = null;
  relay: RelayLike | null = null;
  /** Human label for the relay ("2 relays", "in-memory demo relay"). */
  relayLabel = "no relays";
  state: ServiceState = "no-identity";
  error: string | undefined;
  meta: MatchMeta;
  driver: PeerDriver | null = null;
  busy = false;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly opts: MatchServiceOptions;

  constructor(opts: MatchServiceOptions, meta?: MatchMeta) {
    this.opts = opts;
    this.meta = meta ?? emptyMeta();
  }

  get ready(): boolean {
    return this.state === "ready" && !!this.client;
  }

  get book(): MatchBook | null {
    return this.client?.book ?? null;
  }

  get npub(): string | null {
    return this.identity ? npubEncode(this.identity.pubkey) : null;
  }

  nameOf(pubkey: string): string {
    return this.meta.names[pubkey]?.name ?? shortNpub(pubkey);
  }

  setName(pubkey: string, n: PeerName): void {
    this.meta.names[pubkey] = n;
    this.save();
  }

  log(text: string): void {
    this.meta.log = [...this.meta.log, { at: Date.now(), text }].slice(-LOG_CAP);
  }

  private save(): void {
    this.opts.persist(this.client?.book ?? null, this.meta);
    this.opts.onChange();
  }

  /** Serialize client work; errors are recorded and rethrown to the caller. */
  private run<T>(label: string, fn: (c: MatchClient) => Promise<T>, local = false): Promise<T> {
    const next = this.queue.then(async () => {
      if (!this.client) throw new Error("Match isn't set up yet");
      if (!local && !this.relay) throw new Error("add a relay first (Matches → Relays)");
      this.busy = true;
      this.opts.onChange();
      try {
        const r = await fn(this.client);
        this.error = undefined;
        return r;
      } catch (e) {
        this.error = `${label}: ${errorText(e)}`;
        throw e;
      } finally {
        this.busy = false;
        this.client.tick();
        this.save();
      }
    });
    this.queue = next.catch(() => undefined);
    return next;
  }

  /** Start (or restart) with an identity, a relay and an optional saved book. */
  async start(identity: StoredIdentity, relay: RelayLike | null, relayLabel: string, book?: MatchBook | null): Promise<void> {
    this.identity = identity;
    this.relay = relay;
    this.relayLabel = relayLabel;
    this.state = "starting";
    this.opts.onChange();
    try {
      const saved = book && book.self === identity.pubkey ? book : undefined;
      this.client = await MatchClient.create({
        identity: signerFor(identity),
        relay: relay ?? NO_RELAY,
        psi: this.opts.psi,
        now: this.opts.now,
        book: saved,
      });
      this.client.tick();
      this.state = "ready";
      this.error = undefined;
    } catch (e) {
      this.client = null;
      this.state = "error";
      this.error = errorText(e);
    }
    this.save();
  }

  /** Swap relays, keeping the book. In-flight PSI sessions are lost. */
  async setRelay(relay: RelayLike | null, label: string): Promise<void> {
    if (!this.identity) {
      this.relay = relay;
      this.relayLabel = label;
      return;
    }
    await this.queue;
    await this.start(this.identity, relay, label, this.client?.book);
  }

  /** Forget the identity and every match (after an in-page confirm). */
  reset(): void {
    this.identity = null;
    this.client = null;
    this.state = "no-identity";
    this.meta = emptyMeta();
    this.save();
  }

  // ---- reads ----

  records(): MatchRecord[] {
    return Object.values(this.book?.matches ?? {}).sort((a, b) => b.requestedAt - a.requestedAt);
  }

  record(matchId: string): MatchRecord | undefined {
    return this.book?.matches[matchId];
  }

  /** A live (not ended) match with this peer. */
  liveWith(pubkey: string): MatchRecord | undefined {
    return this.records().find((r) => r.peer === pubkey && (r.status === "requested" || r.status === "incoming" || r.status === "active"));
  }

  previewBudget(): number {
    return this.client?.previewBudget() ?? 0;
  }

  /** Items this consent would share right now, newest first. */
  shareable(consent: SketchConsent): string[] {
    return selectSketchItems(this.opts.history(), consent, this.opts.now());
  }

  similarities(myItems: Iterable<string>): MatchSimilarity[] {
    const b = this.book;
    return b ? matchSimilarities(b, myItems, { now: this.opts.now() }) : [];
  }

  candidates(myItems: Iterable<string>, resolveVideo: (id: string) => Video | undefined): Candidate[] {
    if (!this.client) return [];
    return this.client.candidates({ myItems, resolveVideo, nameOf: (pk) => this.nameOf(pk) });
  }

  // ---- actions ----

  async requestMatch(peer: string, consent: SketchConsent, withPreview: boolean): Promise<string> {
    return this.run("Request", async (c) => {
      const id = await c.requestMatch(peer, { consent });
      this.log(`You asked ${this.nameOf(peer)} to match`);
      if (withPreview) {
        await c.requestPreview(id, this.shareable(consent));
        this.log(`You asked ${this.nameOf(peer)} for a preview`);
      }
      return id;
    }).finally(() => this.pump());
  }

  async requestPreview(matchId: string): Promise<void> {
    await this.run("Preview", async (c) => {
      const rec = c.book.matches[matchId];
      await c.requestPreview(matchId, this.shareable(rec?.consent ?? DEFAULT_CONSENT));
      if (rec) this.log(`You asked ${this.nameOf(rec.peer)} for a preview`);
    });
    await this.pump();
  }

  async respondToPreview(matchId: string, accept: boolean): Promise<MatchEvent | undefined> {
    const ev = await this.run("Preview", async (c) => {
      const rec = c.book.matches[matchId];
      const e = await c.respondToPreview(matchId, accept, accept ? this.shareable(rec?.consent ?? DEFAULT_CONSENT) : []);
      if (rec) {
        if (e?.type === "preview-declined" && e.refusal === "target-budget") this.log(`Preview for ${this.nameOf(rec.peer)} declined: your yearly preview budget is spent`);
        else this.log(accept ? `You accepted ${this.nameOf(rec.peer)}'s preview request` : `You declined ${this.nameOf(rec.peer)}'s preview request`);
      }
      return e;
    });
    await this.pump();
    return ev;
  }

  async accept(matchId: string, consent: SketchConsent): Promise<void> {
    await this.run("Accept", async (c) => {
      await c.acceptMatch(matchId, { consent });
      const rec = c.book.matches[matchId];
      if (rec) this.log(`You matched with ${this.nameOf(rec.peer)}`);
      await c.sendDueSketches(this.opts.history());
    });
    await this.pump();
  }

  async decline(matchId: string): Promise<void> {
    await this.run("Decline", async (c) => {
      const rec = c.book.matches[matchId];
      await c.declineMatch(matchId);
      if (rec) this.log(`You declined ${this.nameOf(rec.peer)}`);
    });
  }

  async setConsent(matchId: string, consent: SketchConsent): Promise<void> {
    await this.run("Sharing", async (c) => c.setConsent(matchId, consent), true);
  }

  async setPaused(matchId: string, paused: boolean): Promise<void> {
    await this.run("Pause", async (c) => {
      c.setPaused(matchId, paused);
      const rec = c.book.matches[matchId];
      if (rec) this.log(paused ? `Paused sharing with ${this.nameOf(rec.peer)} (quietly)` : `Resumed sharing with ${this.nameOf(rec.peer)}`);
    }, true);
  }

  async renew(matchId: string): Promise<void> {
    await this.run("Renew", async (c) => {
      const rec = c.book.matches[matchId];
      if (rec?.renew?.proposedBy === "peer") await c.acceptRenew(matchId);
      else await c.proposeRenew(matchId);
      if (rec) this.log(rec.renew?.proposedBy === "peer" ? `You renewed with ${this.nameOf(rec.peer)}` : `You proposed renewing with ${this.nameOf(rec.peer)}`);
    });
    await this.pump();
  }

  async revoke(matchId: string): Promise<void> {
    await this.run("Revoke", async (c) => {
      const rec = c.book.matches[matchId];
      await c.revoke(matchId);
      if (rec) this.log(`You ended the match with ${this.nameOf(rec.peer)}`);
    });
    await this.pump();
  }

  /** Dev builds: send this match a sketch now, off schedule. */
  async sendSketchNow(matchId: string): Promise<void> {
    await this.run("Sketch", async (c) => {
      await c.sendSketch(matchId, this.opts.history());
      const rec = c.book.matches[matchId];
      if (rec) this.log(`Sent a sketch to ${this.nameOf(rec.peer)} (on demand)`);
    });
    await this.pump();
  }

  /**
   * Pull and apply messages, run PSI steps, then send whatever sketches are due on
   * the weekly schedule. Safe to call often: nothing is sent unless due.
   */
  async sync(): Promise<MatchEvent[]> {
    if (!this.client || !this.relay) return [];
    return this.run("Sync", async (c) => {
      const r = await c.sync();
      for (const e of r.events) this.announce(e);
      await c.sendDueSketches(this.opts.history());
      this.meta.lastSyncAt = Date.now();
      return r.events;
    });
  }

  /** Demo: let the simulated peer act, then sync, until things settle. */
  async pump(): Promise<void> {
    if (!this.driver) return;
    for (let i = 0; i < 8; i++) {
      const acted = await this.driver.step().catch(() => false);
      const events = await this.sync().catch(() => []);
      if (!acted && events.length === 0) break;
    }
  }

  private announce(e: MatchEvent): void {
    const rec = "matchId" in e ? this.client?.book.matches[e.matchId] : undefined;
    const who = rec ? this.nameOf(rec.peer) : "A match";
    const text = eventText(e, who);
    if (!text) return;
    this.log(text);
    this.opts.onEvent?.(e, text);
  }
}

export function eventText(e: MatchEvent, who: string): string | null {
  switch (e.type) {
    case "match-requested":
      return `${who} asked to match with you`;
    case "match-active":
      return `You and ${who} are matched`;
    case "preview-requested":
      return `${who} asked for a preview`;
    case "preview-result":
      return `Preview with ${who}: ${e.result.label}`;
    case "preview-declined":
      return `${who} declined the preview`;
    case "preview-failed":
      return `Preview with ${who} didn't run (${failText(e.reason)})`;
    case "sketch":
      return `New sketch from ${who}`;
    case "renew-requested":
      return `${who} wants to renew`;
    case "renewed":
      return `Renewed with ${who} for another 90 days`;
    case "revoked":
      return e.by === "peer" ? `${who} ended the match` : null;
    case "declined":
      return `${who} declined to match`;
    case "expired":
      return `The match with ${who} expired`;
    default:
      return null;
  }
}

export function failText(reason: string): string {
  if (reason.includes("set-too-small")) return "one side has fewer than 20 shareable videos";
  if (reason.includes("expired")) return "the request expired";
  return reason;
}

export function errorText(e: unknown): string {
  if (e instanceof MatchError) {
    const r = e.reason;
    if (r === "already-matched") return "you already have a match or request with them";
    if (r === "self-request") return "that's your own key";
    if (r.startsWith("preview-pair-limit")) return "one preview per person per week";
    if (r.startsWith("preview-requester-limit")) return "you've asked for 5 previews this week";
    if (r.startsWith("relay rejected")) return r;
    return r;
  }
  if (e instanceof Error) return e.message;
  return String(e);
}

const NO_RELAY: RelayLike = {
  async publish() {
    return { ok: false, message: "no relays configured: add one in Matches → Relays" };
  },
  async query() {
    return [];
  },
};
