// The effectful layer: holds a `MatchBook`, generates keys and ids, runs PSI,
// gift-wraps the state machine's outbox and publishes it, and pulls, unwraps and
// applies incoming gift wraps. All protocol decisions live in `state.ts`.

import type { HistoryEntry, PreviewPolicy, Rng, SketchConsent } from './core.ts';
import { cryptoRng, randomHex } from './core.ts';
import type { MatchKeyPair, NostrSigner, SignedEvent } from './keys.ts';
import { generateMatchKey, localSigner } from './keys.ts';
import { GIFT_WRAP_KIND } from './kinds.ts';
import type { PsiFactory, PsiSession } from './psi.ts';
import { fromBase64, padPsiSet, toBase64 } from './psi.ts';
import type { RelayLike } from './relay.ts';
import type { MatchBook, MatchEvent, OutgoingMessage, Transition } from './state.ts';
import {
  acceptMatch,
  acceptRenew,
  answerMatchPreview,
  buildMatchSketch,
  completeTargetPreview,
  createMatchBook,
  declineMatch,
  dueSketches,
  inboxKeys,
  previewBudget,
  proposeRenew,
  receiveMessage,
  requestMatch,
  requestMatchPreview,
  respondToMatchPreview,
  revokeMatch,
  setConsent,
  setPaused,
  startTargetPreviewRun,
  tick,
} from './state.ts';
import type { Unwrapped } from './wrap.ts';
import { giftWrap, unwrap } from './wrap.ts';
import type { MatchCandidateOptions } from './candidates.ts';
import { matchCandidates } from './candidates.ts';
import type { Candidate } from './core.ts';

export class MatchError extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(`match: ${reason}`);
    this.name = 'MatchError';
    this.reason = reason;
  }
}

export interface MatchClientOptions {
  identity: NostrSigner;
  relay: RelayLike;
  psi: PsiFactory;
  now?: () => Date;
  /** Randomness for sketches, PSI padding, preview noise and timestamp jitter. Default `cryptoRng()`. */
  rng?: Rng;
  previewPolicy?: PreviewPolicy;
  /** A previously saved book (restore after restart). */
  book?: MatchBook;
  newKey?: () => MatchKeyPair;
  newId?: () => string;
}

export interface SyncResult {
  events: MatchEvent[];
  rejected: { wrapId: string; reason: string }[];
}

// Rejections that may succeed later (messages delivered out of order); retried on
// the next sync. Everything else is final.
const RETRYABLE = new Set([
  'unknown-match',
  'unexpected-sender',
  'unexpected-recipient',
  'not-active',
  'not-requested',
  'no-pending-preview',
  'no-accepted-preview',
  'no-answered-preview',
  'no-renew-proposal',
]);

interface PreviewSession {
  psi: PsiSession;
  items: string[];
  realCount: number;
}

export class MatchClient {
  book: MatchBook;
  readonly events: MatchEvent[] = [];
  private readonly identity: NostrSigner;
  private readonly relay: RelayLike;
  private readonly psi: PsiFactory;
  private readonly clock: () => Date;
  private readonly rng: Rng;
  private readonly newKey: () => MatchKeyPair;
  private readonly newId: () => string;
  private readonly sessions = new Map<string, PreviewSession>();
  private readonly seen = new Set<string>();

  private constructor(book: MatchBook, opts: MatchClientOptions) {
    this.book = book;
    this.identity = opts.identity;
    this.relay = opts.relay;
    this.psi = opts.psi;
    this.clock = opts.now ?? (() => new Date());
    this.rng = opts.rng ?? cryptoRng();
    this.newKey = opts.newKey ?? generateMatchKey;
    const idRng = opts.rng ?? cryptoRng();
    this.newId = opts.newId ?? (() => randomHex(idRng, 32));
  }

  static async create(opts: MatchClientOptions): Promise<MatchClient> {
    const self = await opts.identity.getPublicKey();
    const book = opts.book ?? createMatchBook(self, opts.previewPolicy);
    if (book.self !== self) throw new Error('book belongs to a different identity');
    return new MatchClient(book, opts);
  }

  get self(): string {
    return this.book.self;
  }

  private apply(t: Transition): { outbox: OutgoingMessage[]; event?: MatchEvent } {
    if (!t.ok) throw new MatchError(t.reason);
    this.book = t.book;
    if (t.event) this.events.push(t.event);
    return { outbox: t.outbox, event: t.event };
  }

  private async send(outbox: OutgoingMessage[]): Promise<SignedEvent[]> {
    const sent: SignedEvent[] = [];
    for (const m of outbox) {
      const sender = m.from.type === 'identity' ? this.identity : localSigner(m.from.key.secret);
      const wrap = await giftWrap({ kind: m.kind, content: m.content, sender, recipient: m.to, now: this.clock(), expiration: m.expiration, rng: this.rng });
      const r = await this.relay.publish(wrap);
      if (!r.ok) throw new MatchError(`relay rejected: ${r.message}`);
      sent.push(wrap);
    }
    return sent;
  }

  private async run(t: Transition): Promise<MatchEvent | undefined> {
    const { outbox, event } = this.apply(t);
    await this.send(outbox);
    return event;
  }

  // --- User actions --------------------------------------------------------------

  async requestMatch(peer: string, opts: { consent?: SketchConsent; durationDays?: number } = {}): Promise<string> {
    const matchId = this.newId();
    await this.run(requestMatch(this.book, { matchId, peer, myKey: this.newKey(), now: this.clock(), ...opts }));
    return matchId;
  }

  /**
   * Ask the target for a preview. `items` are what I'd share with this match
   * (e.g. `selectSketchItems(history, consent, now)`), newest first; kept in memory
   * for the PSI answer.
   */
  async requestPreview(matchId: string, items: readonly string[]): Promise<string> {
    const previewId = this.newId();
    await this.run(requestMatchPreview(this.book, matchId, { previewId, now: this.clock() }));
    const { items: padded, realCount } = padPsiSet(items, this.rng);
    this.sessions.set(previewId, { psi: this.psi(), items: padded, realCount });
    return previewId;
  }

  /** Accepted previews I can still grant this rolling year (max 8). */
  previewBudget(): number {
    return previewBudget(this.book, this.clock());
  }

  /**
   * Target: accept or decline a preview request. Accepting creates the PSI request
   * over my padded items. If the yearly budget is spent this goes out as a decline,
   * and the returned event says `refusal: 'target-budget'` (for my UI only).
   */
  async respondToPreview(matchId: string, accept: boolean, items: readonly string[] = []): Promise<MatchEvent | undefined> {
    const rec = this.book.matches[matchId];
    const previewId = rec?.preview?.id;
    let psiRequest: string | undefined;
    if (accept && previewId && this.previewBudget() > 0) {
      const { items: padded, realCount } = padPsiSet(items, this.rng);
      const psi = this.psi();
      psiRequest = toBase64(await psi.createRequest(padded));
      this.sessions.set(previewId, { psi, items: padded, realCount });
    }
    const t = respondToMatchPreview(this.book, matchId, { accept, psiRequest, now: this.clock() });
    if (t.ok && previewId && (!accept || t.event?.type === 'preview-declined')) this.dropSession(previewId);
    return this.run(t);
  }

  async acceptMatch(matchId: string, opts: { consent?: SketchConsent; durationDays?: number } = {}): Promise<MatchEvent | undefined> {
    return this.run(acceptMatch(this.book, matchId, { myKey: this.newKey(), now: this.clock(), ...opts }));
  }

  async declineMatch(matchId: string): Promise<void> {
    await this.run(declineMatch(this.book, matchId, { now: this.clock() }));
  }

  setConsent(matchId: string, consent: SketchConsent): void {
    this.apply(setConsent(this.book, matchId, consent));
  }

  /** Quiet pause (D2): local only, nothing is sent. */
  setPaused(matchId: string, paused: boolean): void {
    this.apply(setPaused(this.book, matchId, paused));
  }

  async sendSketch(matchId: string, history: readonly HistoryEntry[]): Promise<SignedEvent> {
    const { outbox } = this.apply(buildMatchSketch(this.book, matchId, { history, rng: this.rng, now: this.clock() }));
    const [wrap] = await this.send(outbox);
    return wrap;
  }

  /** Send every sketch due on the fixed weekly schedule (paused matches included). */
  async sendDueSketches(history: readonly HistoryEntry[]): Promise<string[]> {
    const due = dueSketches(this.book, this.clock());
    for (const id of due) await this.sendSketch(id, history);
    return due;
  }

  async proposeRenew(matchId: string, durationDays?: number): Promise<void> {
    await this.run(proposeRenew(this.book, matchId, { renewId: this.newId(), myNewKey: this.newKey(), durationDays, now: this.clock() }));
  }

  async acceptRenew(matchId: string): Promise<MatchEvent | undefined> {
    return this.run(acceptRenew(this.book, matchId, { myNewKey: this.newKey(), now: this.clock() }));
  }

  async revoke(matchId: string): Promise<void> {
    const preview = this.book.matches[matchId]?.preview?.id;
    await this.run(revokeMatch(this.book, matchId, { now: this.clock() }));
    if (preview) this.dropSession(preview);
  }

  /** Expiry and housekeeping; call periodically. */
  tick(): MatchEvent[] {
    const r = tick(this.book, { now: this.clock() });
    this.book = r.book;
    this.events.push(...r.events);
    return r.events;
  }

  candidates(opts: Omit<MatchCandidateOptions, 'now'>): Candidate[] {
    return matchCandidates(this.book, { ...opts, now: this.clock() });
  }

  // --- Receiving -----------------------------------------------------------------

  private dropSession(previewId: string): void {
    this.sessions.get(previewId)?.psi.dispose();
    this.sessions.delete(previewId);
  }

  /** Pull gift wraps for all my keys from the relay, unwrap, apply, and run PSI steps. */
  async sync(): Promise<SyncResult> {
    const result: SyncResult = { events: [], rejected: [] };
    // A renewal adds keys, so loop until a pass finds nothing new.
    for (let pass = 0; pass < 4; pass++) {
      const now = this.clock();
      const { identity, matchKeys } = inboxKeys(this.book, now);
      const signers = new Map<string, NostrSigner>([[identity, this.identity]]);
      for (const k of matchKeys) signers.set(k.pubkey, localSigner(k.secret));
      const wraps = (await this.relay.query({ kinds: [GIFT_WRAP_KIND], '#p': [...signers.keys()] })).filter((w) => !this.seen.has(w.id));
      if (wraps.length === 0) break;
      const opened: Unwrapped[] = [];
      for (const w of wraps) {
        const p = w.tags.find((t) => t[0] === 'p')?.[1];
        const signer = p ? signers.get(p) : undefined;
        if (!signer) continue;
        try {
          opened.push(await unwrap(w, signer, { now }));
        } catch (e) {
          this.seen.add(w.id);
          result.rejected.push({ wrapId: w.id, reason: (e as Error).message });
        }
      }
      // Rumor timestamps are real (wrap/seal ones are jittered): apply in send order.
      opened.sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));
      let progressed = false;
      for (const m of opened) {
        const t = receiveMessage(this.book, m, { now });
        if (!t.ok) {
          if (!RETRYABLE.has(t.reason)) this.seen.add(m.wrapId);
          result.rejected.push({ wrapId: m.wrapId, reason: t.reason });
          continue;
        }
        this.seen.add(m.wrapId);
        progressed = true;
        const { outbox, event } = this.apply(t);
        await this.send(outbox);
        if (event) {
          result.events.push(event);
          await this.followUp(event, result);
        }
      }
      if (!progressed) break;
    }
    return result;
  }

  private async followUp(event: MatchEvent, result: SyncResult): Promise<void> {
    if (event.type === 'preview-accepted') {
      // Requester (PSI server): answer over my padded set.
      const s = this.sessions.get(event.previewId);
      if (!s) return;
      try {
        const { setup, response } = await s.psi.answerRequest(fromBase64(event.psiRequest), s.items);
        await this.run(
          answerMatchPreview(this.book, event.matchId, { setSize: s.realCount, psiSetup: toBase64(setup), psiResponse: toBase64(response), now: this.clock() }),
        );
      } finally {
        this.dropSession(event.previewId);
      }
    } else if (event.type === 'preview-answer') {
      // Target (PSI client): check limits, compute |A ∩ B|, noise it here, send only that.
      const s = this.sessions.get(event.previewId);
      if (!s) return;
      try {
        const start = startTargetPreviewRun(this.book, event.matchId, { targetSetSize: s.realCount, now: this.clock() });
        const { event: started } = this.apply(start);
        if (started?.type === 'preview-failed') {
          result.events.push(started);
          return;
        }
        const trueCount = await s.psi.intersectionSize(fromBase64(event.psiSetup), fromBase64(event.psiResponse));
        await this.run(completeTargetPreview(this.book, event.matchId, { trueCount, rng: this.rng, now: this.clock() }));
      } finally {
        this.dropSession(event.previewId);
      }
    } else if (event.type === 'preview-declined' || event.type === 'preview-result' || event.type === 'revoked') {
      if ('previewId' in event) this.dropSession(event.previewId);
    }
  }
}
