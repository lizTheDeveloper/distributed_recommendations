// Offline demo for the artifact build, where no network exists: a SIMULATED peer
// ("Demo peer (simulated)") running the real protocol in this page, over the match
// package's InMemoryRelay. It has its own random key and a made-up history of
// endorsements drawn from the snapshot's videos. It accepts previews and matches
// automatically and sends sketches on the real schedule (the first one at once).
// Nothing about it is a real person; the UI labels it everywhere.

import type { HistoryEntry } from "../core.ts";
import type { MatchBook, PsiFactory, RelayLike } from "./pkg.ts";
import { DEFAULT_CONSENT, MatchClient, generateMatchKey, localSigner } from "./pkg.ts";
import type { PeerDriver } from "./service.ts";

export const DEMO_NAME = "Demo peer (simulated)";
/** Endorsements in the simulated peer's history. Previews need at least 20 on each side. */
export const DEMO_HISTORY_SIZE = 30;

export interface DemoSaved {
  secret: string;
  book?: MatchBook;
  items: string[];
}

export function loadDemoSaved(x: unknown): DemoSaved | null {
  if (typeof x !== "object" || x === null) return null;
  const o = x as Record<string, unknown>;
  if (typeof o.secret !== "string" || !/^[0-9a-f]{64}$/.test(o.secret) || !Array.isArray(o.items)) return null;
  return { secret: o.secret, book: (o.book as MatchBook) ?? undefined, items: o.items.filter((i): i is string => typeof i === "string") };
}

/**
 * Pick the simulated peer's endorsements: a deterministic spread over the snapshot
 * (every other video, by id), so a viewer who endorses some of the same videos gets
 * a real overlap to preview.
 */
export function pickDemoItems(ids: readonly string[], n = DEMO_HISTORY_SIZE): string[] {
  const sorted = [...new Set(ids)].sort();
  return sorted.filter((_, i) => i % 2 === 0).slice(0, n);
}

export class DemoPeer implements PeerDriver {
  readonly client: MatchClient;
  readonly secret: string;
  readonly items: string[];
  private readonly now: () => Date;

  private constructor(client: MatchClient, secret: string, items: string[], now: () => Date) {
    this.client = client;
    this.secret = secret;
    this.items = items;
    this.now = now;
  }

  static async create(opts: { relay: RelayLike; psi: PsiFactory; now: () => Date; items: string[]; saved?: DemoSaved | null }): Promise<DemoPeer> {
    const secret = opts.saved?.secret ?? generateMatchKey().secret;
    const items = opts.saved?.items.length ? opts.saved.items : opts.items;
    const signer = localSigner(secret);
    const self = await signer.getPublicKey();
    const book = opts.saved?.book && opts.saved.book.self === self ? opts.saved.book : undefined;
    const client = await MatchClient.create({ identity: signer, relay: opts.relay, psi: opts.psi, now: opts.now, book });
    return new DemoPeer(client, secret, items, opts.now);
  }

  get pubkey(): string {
    return this.client.self;
  }

  save(): DemoSaved {
    return { secret: this.secret, book: this.client.book, items: this.items };
  }

  /** The simulated history: one endorsement per item, an hour apart, newest first. */
  history(): HistoryEntry[] {
    const t = this.now().getTime();
    return this.items.map((videoId, i) => ({ videoId, at: new Date(t - (i + 1) * 3_600_000), kind: "endorse" as const }));
  }

  /** One round: read messages, answer what's waiting, send due sketches. */
  async step(): Promise<boolean> {
    const r = await this.client.sync();
    let acted = r.events.length > 0;
    for (const rec of Object.values(this.client.book.matches)) {
      if (rec.status === "incoming") {
        const stage = rec.preview?.stage;
        if (stage === "requested" && rec.preview?.role === "target") {
          await this.client.respondToPreview(rec.matchId, true, this.items);
          acted = true;
        } else if (!stage || stage === "done" || stage === "declined" || stage === "failed") {
          await this.client.acceptMatch(rec.matchId, { consent: DEFAULT_CONSENT });
          acted = true;
        }
      } else if (rec.status === "active" && rec.renew?.proposedBy === "peer") {
        await this.client.acceptRenew(rec.matchId);
        acted = true;
      }
    }
    const sent = await this.client.sendDueSketches(this.history());
    this.client.tick();
    return acted || sent.length > 0;
  }

  /** The simulated peer asks the viewer to match, with a preview request. */
  async requestViewer(viewer: string, withPreview: boolean): Promise<string> {
    const id = await this.client.requestMatch(viewer, { consent: DEFAULT_CONSENT });
    if (withPreview) await this.client.requestPreview(id, this.items);
    return id;
  }
}
