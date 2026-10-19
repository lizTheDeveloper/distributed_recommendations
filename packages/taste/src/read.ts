// Reading a creator's published picks back (what apps/web's Follow-taste "nostr"
// source does), using this package's strict parser. apps/web can switch to this.

import type { SignedEvent } from '../../bridge/src/types.ts';
import { KIND_VIDEO_CURATION_SET, parseCurationSet, resolveCurationSet, videoFilters } from './nip51.ts';
import type { ParsedCurationSet } from './nip51.ts';
import type { QueryFn } from './peertube.ts';
import type { TasteList } from './tastelist.ts';

export interface ReadPicksOptions {
  query: QueryFn;
  verify: (e: SignedEvent) => boolean | Promise<boolean>;
  /** Only this set (`d`); default every set of the author. */
  d?: string;
  /** Use pick-tag URLs for videos not found on the relays (default true). */
  usePickUrl?: boolean;
}

export interface CreatorPicks {
  set: ParsedCurationSet;
  list: TasteList;
}

/**
 * The author's video curation sets, newest version per `d` (signature-checked),
 * newest set first, each resolved to a taste-list v1 object. Sets that fail
 * validation are reported in `rejected` and skipped.
 */
export async function readCreatorPicks(pubkey: string, opts: ReadPicksOptions): Promise<{ sets: CreatorPicks[]; rejected: { id: string; reason: string }[] }> {
  const filter: Record<string, unknown> = { kinds: [KIND_VIDEO_CURATION_SET], authors: [pubkey], limit: 20 };
  if (opts.d !== undefined) filter['#d'] = [opts.d];
  const latest = new Map<string, ParsedCurationSet>();
  const rejected: { id: string; reason: string }[] = [];
  for (const e of await opts.query(filter)) {
    let parsed: ParsedCurationSet;
    try {
      parsed = parseCurationSet(e, { pubkey });
    } catch (err) {
      rejected.push({ id: String((e as { id?: unknown })?.id ?? ''), reason: err instanceof Error ? err.message : String(err) });
      continue;
    }
    const prev = latest.get(parsed.d);
    if (prev && (prev.createdAt > parsed.createdAt || (prev.createdAt === parsed.createdAt && prev.id <= parsed.id))) continue;
    if (!(await opts.verify(e))) {
      rejected.push({ id: parsed.id, reason: 'bad signature' });
      continue;
    }
    latest.set(parsed.d, parsed);
  }
  const sets: CreatorPicks[] = [];
  for (const set of [...latest.values()].sort((a, b) => b.createdAt - a.createdAt)) {
    const events: SignedEvent[] = [];
    for (const f of videoFilters(set)) events.push(...(await opts.query(f)));
    sets.push({ set, list: await resolveCurationSet(set, events, { verify: opts.verify, usePickUrl: opts.usePickUrl }) });
  }
  return { sets, rejected };
}
