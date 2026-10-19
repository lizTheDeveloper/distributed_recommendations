// Channel sync: list a PeerTube channel, build NIP-71 events, optionally sign
// and publish them. Dry run (no relays / publish=false) never opens a socket.

import { signWith } from './event.ts';
import type { Sha256, Signer } from './event.ts';
import { BridgeRefusal, checkBridgeable, toVideoEvent } from './mapping.ts';
import type { ToVideoEventOptions } from './mapping.ts';
import { PeerTubeClient } from './peertube.ts';
import type { PeerTubeClientOptions } from './peertube.ts';
import { publishToRelay, query } from './relay.ts';
import type { PublishResult, RelayOptions } from './relay.ts';
import type { EventTemplate, SignedEvent } from './types.ts';

export interface SyncOptions extends ToVideoEventOptions {
  /** Actually send to relays. Default false (dry run). */
  publish?: boolean;
  /** Max videos to process (newest first). */
  limit?: number;
  /** Fetch captions and chapters (2 extra requests per video). Default true. */
  fetchExtras?: boolean;
  /** Skip relays that already hold an identical event (default true when publishing). */
  skipUnchanged?: boolean;
  /** Signature verifier for events read back from relays and for our own output. */
  verify?: (e: SignedEvent) => boolean;
  sha256?: Sha256;
  client?: PeerTubeClientOptions;
  relay?: RelayOptions;
  onResult?: (r: SyncResult) => void;
}

export interface SyncResult {
  uuid: string;
  title: string;
  status: 'built' | 'refused' | 'published' | 'error';
  reason?: string;
  template?: EventTemplate;
  event?: SignedEvent;
  relays?: PublishResult[];
}

function sameEvent(a: { kind: number; tags: string[][]; content: string }, b: EventTemplate): boolean {
  return a.kind === b.kind && a.content === b.content && JSON.stringify(a.tags) === JSON.stringify(b.tags);
}

async function relaysNeedingEvent(relays: string[], event: SignedEvent, opts: SyncOptions): Promise<string[]> {
  const d = event.tags.find((t) => t[0] === 'd')?.[1];
  const r = event.tags.find((t) => t[0] === 'r')?.[1];
  const filter: Record<string, unknown> = { kinds: [event.kind], authors: [event.pubkey], limit: 5 };
  if (d !== undefined) filter['#d'] = [d];
  else if (r) filter['#r'] = [r];
  const need: string[] = [];
  for (const relay of relays) {
    try {
      const existing = (await query(relay, filter, opts.relay)).filter((e) => e.pubkey === event.pubkey && (!opts.verify || opts.verify(e)));
      // Addressable: skip only if the latest stored version is identical.
      // Regular (21/22): any existing event for this video means "already bridged"; they cannot be edited.
      const latest = existing.sort((x, y) => y.created_at - x.created_at)[0];
      const covered = d !== undefined ? latest && sameEvent(latest, event) : existing.length > 0;
      if (!covered) need.push(relay);
    } catch {
      need.push(relay); // can't tell; publishing is idempotent enough
    }
  }
  return need;
}

/**
 * Sync one channel. `signer` may be null for a dry run that only prints
 * unsigned templates. `relays` are only contacted when `opts.publish` is true.
 */
export async function sync(
  instance: string,
  channelHandle: string,
  signer: Signer | null,
  relays: string[],
  opts: SyncOptions = {},
): Promise<SyncResult[]> {
  if (opts.publish && !signer) throw new Error('publishing requires a signer');
  if (opts.publish && relays.length === 0) throw new Error('publishing requires at least one relay');
  const client = new PeerTubeClient(instance, opts.client);
  const results: SyncResult[] = [];
  const emit = (r: SyncResult) => {
    results.push(r);
    opts.onResult?.(r);
  };

  for await (const summary of client.channelVideos(channelHandle, { limit: opts.limit })) {
    const base = { uuid: summary.uuid, title: summary.name };
    try {
      // Cheap pre-check on the summary (privacy/live/nsfw) before fetching detail.
      if (summary.privacy?.id !== undefined && summary.privacy.id !== 1) {
        emit({ ...base, status: 'refused', reason: `not public (privacy: ${summary.privacy.label})` });
        continue;
      }
      const video = await client.video(summary.uuid);
      const check = checkBridgeable(video, opts);
      if (!check.ok) {
        emit({ ...base, status: 'refused', reason: check.reason });
        continue;
      }
      const extras = opts.fetchExtras ?? true;
      const captions = opts.captions ?? (extras ? await client.captions(video.uuid) : []);
      const chapters = opts.chapters ?? (extras ? await client.chapters(video.uuid) : []);
      const template = toVideoEvent(video, { ...opts, captions, chapters, instanceUrl: opts.instanceUrl ?? client.base });

      if (!signer) {
        emit({ ...base, status: 'built', template });
        continue;
      }
      const event = await signWith(signer, template, { sha256: opts.sha256, verify: opts.verify });
      if (!opts.publish) {
        emit({ ...base, status: 'built', template, event });
        continue;
      }
      const targets = (opts.skipUnchanged ?? true) ? await relaysNeedingEvent(relays, event, opts) : relays;
      const relayResults: PublishResult[] = relays
        .filter((r) => !targets.includes(r))
        .map((relay) => ({ relay, ok: true, message: 'unchanged; not re-sent' }));
      for (const relay of targets) relayResults.push(await publishToRelay(relay, event, opts.relay));
      emit({ ...base, status: 'published', template, event, relays: relayResults });
    } catch (err) {
      if (err instanceof BridgeRefusal) emit({ ...base, status: 'refused', reason: err.message });
      else emit({ ...base, status: 'error', reason: (err as Error).message });
    }
  }
  return results;
}
