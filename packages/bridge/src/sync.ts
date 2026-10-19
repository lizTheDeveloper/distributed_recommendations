// Channel sync: list a PeerTube channel, build NIP-71 events, optionally sign
// and publish them. Dry run (no relays / publish=false) never opens a socket
// and never changes the state.
//
// With a `state` (see state.ts), a publishing run records every video it
// bridged, and every run checks recorded videos that were not bridged this
// time: if PeerTube now says the video is gone, private/unlisted or blocked,
// sync builds a NIP-09 deletion request (dry run) or signs and sends it
// (publish). Entries already marked deleted are not deleted again.

import { goneReason, toDeletionRequest } from './deletion.ts';
import { signWith } from './event.ts';
import type { Sha256, Signer } from './event.ts';
import { BridgeRefusal, checkBridgeable, toVideoEvent } from './mapping.ts';
import type { ToVideoEventOptions } from './mapping.ts';
import { PeerTubeClient, PeerTubeHttpError } from './peertube.ts';
import type { PeerTubeClientOptions } from './peertube.ts';
import { publishToRelay, query } from './relay.ts';
import type { PublishResult, RelayOptions } from './relay.ts';
import { entriesFor, normalizeChannel, stateKey } from './state.ts';
import type { BridgedEntry, BridgeState } from './state.ts';
import type { EventTemplate, PtVideo, SignedEvent } from './types.ts';

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
  /** Use the event signer for NIP-42 AUTH when a relay asks (default true). */
  relayAuth?: boolean;
  /** What was bridged before. Mutated only when `publish` is true. */
  state?: BridgeState;
  /** Called after each state change, e.g. to persist it. */
  onStateChange?: (state: BridgeState) => void | Promise<void>;
  /** Check recorded videos for deletion (default true when `state` is given). */
  deletions?: boolean;
  onResult?: (r: SyncResult) => void;
}

export interface SyncResult {
  uuid: string;
  title: string;
  /**
   * built/published: a video event. refused: not bridgeable. error: failure.
   * delete-planned: a deletion request was built but not sent (dry run).
   * deleted: a deletion request was sent; `relays` says where it landed.
   */
  status: 'built' | 'refused' | 'published' | 'error' | 'delete-planned' | 'deleted';
  reason?: string;
  template?: EventTemplate;
  event?: SignedEvent;
  relays?: PublishResult[];
}

function sameEvent(a: { kind: number; tags: string[][]; content: string }, b: EventTemplate): boolean {
  return a.kind === b.kind && a.content === b.content && JSON.stringify(a.tags) === JSON.stringify(b.tags);
}

async function relaysNeedingEvent(relays: string[], event: SignedEvent, opts: SyncOptions, relayOpts: RelayOptions): Promise<{ need: string[]; existingIds: Map<string, string> }> {
  const d = event.tags.find((t) => t[0] === 'd')?.[1];
  const r = event.tags.find((t) => t[0] === 'r')?.[1];
  const filter: Record<string, unknown> = { kinds: [event.kind], authors: [event.pubkey], limit: 5 };
  if (d !== undefined) filter['#d'] = [d];
  else if (r) filter['#r'] = [r];
  const need: string[] = [];
  const existingIds = new Map<string, string>();
  for (const relay of relays) {
    try {
      const existing = (await query(relay, filter, relayOpts)).filter((e) => e.pubkey === event.pubkey && (!opts.verify || opts.verify(e)));
      // Addressable: skip only if the latest stored version is identical.
      // Regular (21/22): any existing event for this video means "already bridged"; they cannot be edited.
      const latest = existing.sort((x, y) => y.created_at - x.created_at)[0];
      const covered = d !== undefined ? latest && sameEvent(latest, event) : existing.length > 0;
      if (covered) existingIds.set(relay, latest.id);
      else need.push(relay);
    } catch {
      need.push(relay); // can't tell; publishing is idempotent enough
    }
  }
  return { need, existingIds };
}

type Detail = { video?: PtVideo; status?: number; error?: string };

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
  const channel = normalizeChannel(channelHandle);
  const pubkey = signer ? await signer.getPublicKey() : undefined;
  const relayOpts: RelayOptions = { ...opts.relay };
  if (signer && (opts.relayAuth ?? true) && !relayOpts.authSigner) relayOpts.authSigner = signer;
  const state = opts.state;
  const writeState = Boolean(state && opts.publish);
  const results: SyncResult[] = [];
  const emit = (r: SyncResult) => {
    results.push(r);
    opts.onResult?.(r);
  };
  const changed = async () => {
    if (state && opts.onStateChange) await opts.onStateChange(state);
  };

  const bridged = new Set<string>(); // uuids bridged (built or published) this run
  const details = new Map<string, Detail>();
  const fetchDetail = async (uuid: string): Promise<Detail> => {
    let d = details.get(uuid);
    if (d) return d;
    try {
      d = { video: await client.video(uuid) };
    } catch (err) {
      d = err instanceof PeerTubeHttpError && err.fromPeerTube ? { status: err.status, error: err.message } : { error: (err as Error).message };
    }
    details.set(uuid, d);
    return d;
  };

  for await (const summary of client.channelVideos(channel, { limit: opts.limit })) {
    const base = { uuid: summary.uuid, title: summary.name };
    try {
      // Cheap pre-check on the summary (privacy/live/nsfw) before fetching detail.
      if (summary.privacy?.id !== undefined && summary.privacy.id !== 1) {
        details.set(summary.uuid, { video: summary });
        emit({ ...base, status: 'refused', reason: `not public (privacy: ${summary.privacy.label})` });
        continue;
      }
      const d = await fetchDetail(summary.uuid);
      if (!d.video) throw new Error(d.error ?? 'video detail unavailable');
      const video = d.video;
      const check = checkBridgeable(video, opts);
      if (!check.ok) {
        emit({ ...base, status: 'refused', reason: check.reason });
        continue;
      }
      const extras = opts.fetchExtras ?? true;
      const captions = opts.captions ?? (extras ? await client.captions(video.uuid) : []);
      const chapters = opts.chapters ?? (extras ? await client.chapters(video.uuid) : []);
      // After a deletion request with an `a` tag, relays drop versions up to its
      // created_at, so a re-published version must be strictly newer.
      const prior = pubkey && state ? state.entries[stateKey(pubkey, video.uuid)] : undefined;
      let createdAt = opts.createdAt;
      if (prior?.deletion) createdAt = Math.max(createdAt ?? Math.floor(Date.now() / 1000), prior.deletion.createdAt + 1);
      const template = toVideoEvent(video, { ...opts, createdAt, captions, chapters, instanceUrl: opts.instanceUrl ?? client.base });
      bridged.add(video.uuid);

      if (!signer) {
        emit({ ...base, status: 'built', template });
        continue;
      }
      const event = await signWith(signer, template, { sha256: opts.sha256, verify: opts.verify });
      if (!opts.publish) {
        emit({ ...base, status: 'built', template, event });
        continue;
      }
      const { need, existingIds } = (opts.skipUnchanged ?? true) ? await relaysNeedingEvent(relays, event, opts, relayOpts) : { need: relays, existingIds: new Map<string, string>() };
      const relayResults: PublishResult[] = relays
        .filter((r) => !need.includes(r))
        .map((relay) => ({ relay, ok: true, message: 'unchanged; not re-sent' }));
      for (const relay of need) relayResults.push(await publishToRelay(relay, event, relayOpts));
      emit({ ...base, status: 'published', template, event, relays: relayResults });

      if (writeState && state) {
        const okRelays = relayResults.filter((r) => r.ok).map((r) => r.relay);
        if (okRelays.length > 0) {
          const sent = relayResults.some((r) => r.ok && need.includes(r.relay));
          const d = event.tags.find((t) => t[0] === 'd')?.[1];
          const key = stateKey(event.pubkey, video.uuid);
          const old = state.entries[key];
          const entry: BridgedEntry = {
            uuid: video.uuid,
            instance: client.base,
            channel,
            pubkey: event.pubkey,
            kind: event.kind,
            eventId: sent ? event.id : (existingIds.values().next().value ?? event.id),
            createdAt: event.created_at,
            url: video.url,
            title: template.tags.find((t) => t[0] === 'title')?.[1] ?? video.name,
            relays: [...new Set([...(old?.status === 'live' ? old.relays : []), ...okRelays])].sort(),
            status: 'live',
            updatedAt: Math.floor(Date.now() / 1000),
          };
          if (d !== undefined) entry.address = `${event.kind}:${event.pubkey}:${d}`;
          if (!old || JSON.stringify({ ...old, updatedAt: 0 }) !== JSON.stringify({ ...entry, updatedAt: 0 })) {
            state.entries[key] = entry;
            await changed();
          }
        }
      }
    } catch (err) {
      if (err instanceof BridgeRefusal) emit({ ...base, status: 'refused', reason: err.message });
      else emit({ ...base, status: 'error', reason: (err as Error).message });
    }
  }

  if (state && (opts.deletions ?? true)) {
    for (const entry of entriesFor(state, client.base, channel, pubkey)) {
      if (entry.status !== 'live' || bridged.has(entry.uuid)) continue;
      const base = { uuid: entry.uuid, title: entry.title };
      try {
        const d = await fetchDetail(entry.uuid);
        if (!d.video && d.status === undefined) {
          // Network error, 5xx, 429, or a non-PeerTube error page: never delete on doubt.
          emit({ ...base, status: 'error', reason: `could not check for deletion: ${d.error}` });
          continue;
        }
        const gone = goneReason(d.video, d.status);
        if (!gone) continue; // still public (outside --limit, or transiently refused): keep
        const template = toDeletionRequest(entry, gone.text);
        if (!signer) {
          emit({ ...base, status: 'delete-planned', reason: gone.reason, template });
          continue;
        }
        if (entry.pubkey !== pubkey) continue; // filtered above; defensive
        const event = await signWith(signer, template, { sha256: opts.sha256, verify: opts.verify });
        if (!opts.publish) {
          emit({ ...base, status: 'delete-planned', reason: gone.reason, template, event });
          continue;
        }
        // NIP-09: deletion requests should reach every relay that may hold the
        // event, so send to the relays given now and those recorded earlier.
        const targets = [...new Set([...relays, ...entry.relays])];
        const relayResults: PublishResult[] = [];
        for (const relay of targets) relayResults.push(await publishToRelay(relay, event, relayOpts));
        const okRelays = relayResults.filter((r) => r.ok).map((r) => r.relay);
        emit({ ...base, status: okRelays.length ? 'deleted' : 'error', reason: okRelays.length ? gone.reason : 'no relay accepted the deletion request', template, event, relays: relayResults });
        if (writeState && okRelays.length > 0) {
          entry.status = 'deleted';
          entry.deletion = { id: event.id, createdAt: event.created_at, reason: gone.reason, relays: okRelays.sort() };
          entry.updatedAt = Math.floor(Date.now() / 1000);
          await changed();
        }
      } catch (err) {
        emit({ ...base, status: 'error', reason: (err as Error).message });
      }
    }
  }
  return results;
}
