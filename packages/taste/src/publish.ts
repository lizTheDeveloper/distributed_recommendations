// The "Publish my picks" flow: resolve picked PeerTube URLs to bridged NIP-71
// events, build the kind-30005 set and the taste-list v1 JSON from the same picks,
// and (only when asked) sign and send the set. Dry run by default.

import type { Signer } from '../../bridge/src/event.ts';
import type { EventTemplate, SignedEvent } from '../../bridge/src/types.ts';
import type { PublishResult } from '../../bridge/src/relay.ts';
import { buildCurationSet, curationSetAddress, signCurationSet } from './nip51.ts';
import { findBridgedVideo } from './peertube.ts';
import type { FindBridgedOptions, FindBridgedResult } from './peertube.ts';
import { npubEncode } from './npub.ts';
import { serializeTasteList, toTasteList, validatePicksSet } from './picks.ts';
import type { TasteList } from './tastelist.ts';
import type { PicksSet } from './types.ts';
import type { PublishFn } from './relays.ts';

export type PickStatus = 'bridged' | 'not-bridged' | 'ambiguous' | 'error' | 'kept';

export interface PickReport {
  url: string;
  status: PickStatus;
  /** Every verified bridged event found (for "choose which bridge" UI when ambiguous). */
  candidates?: FindBridgedResult['candidates'];
  error?: string;
}

/**
 * Attach a bridged video ref to every pick that has none (picks that already have
 * one are `kept`, unless `refresh`). Four lookups at a time. Picks that aren't
 * bridged stay in the set: they go into the JSON list, not the Nostr event.
 */
export async function resolvePicks(
  input: PicksSet,
  opts: Omit<FindBridgedOptions, 'query'> & { query: FindBridgedOptions['query']; refresh?: boolean; concurrency?: number },
): Promise<{ set: PicksSet; report: PickReport[] }> {
  const set = validatePicksSet(input);
  const report: PickReport[] = new Array(set.items.length);
  let next = 0;
  const worker = async () => {
    while (next < set.items.length) {
      const i = next++;
      const p = set.items[i];
      if (p.video && !opts.refresh) {
        report[i] = { url: p.url, status: 'kept' };
        continue;
      }
      try {
        const r = await findBridgedVideo(p.url, opts);
        if (r.ref) {
          p.video = r.ref;
          report[i] = { url: p.url, status: 'bridged', candidates: r.candidates };
        } else {
          delete p.video;
          report[i] = { url: p.url, status: r.ambiguous ? 'ambiguous' : 'not-bridged', candidates: r.candidates };
        }
      } catch (e) {
        report[i] = { url: p.url, status: 'error', error: e instanceof Error ? e.message : String(e) };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(opts.concurrency ?? 4, 8)) }, worker));
  return { set, report };
}

export interface PublishPicksOptions {
  /** The creator's signer (NIP-07, bunker, key). Needed to publish; optional for a dry run. */
  signer?: Signer;
  /** Relays to send to. Needed to publish. Only these are contacted. */
  relays?: readonly string[];
  /** Default true: build (and with `signInDryRun`, sign) but send nothing. */
  dryRun?: boolean;
  /** Sign during a dry run too (shows the complete event; a bunker or extension may prompt). */
  signInDryRun?: boolean;
  /** Event `created_at` and JSON `updatedAt`, Unix seconds (default now). */
  createdAt?: number;
  /** Schnorr check of the signed event (e.g. `verifySignedEvent`); recommended. */
  verify?: (e: SignedEvent) => boolean;
  /** How to send (`relayPublisher()`, or a MemoryRelay in tests). Needed to publish. */
  publish?: PublishFn;
  /** Pretty-print the JSON list (default 2). */
  jsonSpace?: number;
}

export interface PublishPicksResult {
  dryRun: boolean;
  /** Signer's pubkey, when a signer was given. */
  pubkey?: string;
  /** `30005:<pubkey>:<d>`, when the pubkey is known. */
  address?: string;
  template: EventTemplate;
  /** The signed event (published, or signed in a dry run with `signInDryRun`). */
  event?: SignedEvent;
  /** Taste-list v1, for hosting at a URL linked from the channel description. */
  tasteList: TasteList;
  json: string;
  /** Picks not in the Nostr event (not bridged). They are in the JSON list. */
  skipped: { url: string; reason: string }[];
  results?: PublishResult[];
  warnings: string[];
}

/**
 * Build both formats from one picks set and, unless `dryRun` (the default), sign the
 * kind-30005 set and send it to `relays`. The JSON list's `author` defaults to the
 * signer's npub, which lets viewers send a match request from a list card.
 */
export async function publishPicks(input: PicksSet, opts: PublishPicksOptions = {}): Promise<PublishPicksResult> {
  const dryRun = opts.dryRun ?? true;
  const set = validatePicksSet(input);
  const createdAt = opts.createdAt ?? Math.floor(Date.now() / 1000);
  if (!dryRun) {
    if (!opts.signer) throw new Error('publishing needs a signer');
    if (!opts.relays?.length) throw new Error('publishing needs at least one relay');
    if (!opts.publish) throw new Error('publishing needs a publish function (relayPublisher())');
  }
  const { template, skipped, included } = buildCurationSet(set, { createdAt });
  const pubkey = opts.signer ? await opts.signer.getPublicKey() : undefined;
  const author = pubkey ? npubEncode(pubkey) : undefined;
  const tasteList = toTasteList(set, { author, updatedAt: createdAt });
  const json = serializeTasteList(set, { author, updatedAt: createdAt }, opts.jsonSpace ?? 2);

  const warnings: string[] = [];
  if (!set.items.length) warnings.push('the set has no picks; publishing it clears your public picks');
  else if (!included.length) warnings.push('none of the picks is bridged to Nostr; the signed set would be empty (the JSON list still has them)');
  if (skipped.length && included.length) warnings.push(`${skipped.length} pick(s) are not bridged and appear only in the JSON list`);
  const paid = set.items.filter((p) => p.sponsored).length;
  if (paid) warnings.push(`${paid} pick(s) are marked sponsored; viewers see a "Sponsored" label on them`);

  const out: PublishPicksResult = { dryRun, template, tasteList, json, skipped, warnings };
  if (pubkey) {
    out.pubkey = pubkey;
    out.address = curationSetAddress(pubkey, set.d);
  }
  if (opts.signer && (!dryRun || opts.signInDryRun)) {
    out.event = await signCurationSet(opts.signer, template, { verify: opts.verify });
  }
  if (!dryRun) out.results = await opts.publish!([...opts.relays!], out.event!);
  return out;
}
