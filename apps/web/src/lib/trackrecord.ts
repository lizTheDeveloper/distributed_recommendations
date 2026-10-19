// Per-list track record (PROTOCOL.md: list strength = track record, never subscriber
// count). The device notes which feed items the viewer actually saw, and which of
// those they endorsed; core's `tasteListStrength` turns that into a strength.
// Local only, never sent. Not recorded during private watching; wiped with history.

import { tasteListStrength } from "./core.ts";

export interface Impressions {
  /** Unique video ids shown in the feed (newest last). */
  all: string[];
  /** List name -> unique ids from that list that were shown. */
  byList: Record<string, string[]>;
}

export const IMPRESSION_CAP = 2000;
export const PER_LIST_CAP = 500;

export function emptyImpressions(): Impressions {
  return { all: [], byList: {} };
}

export function loadImpressions(x: unknown): Impressions {
  const out = emptyImpressions();
  if (typeof x !== "object" || x === null) return out;
  const o = x as Record<string, unknown>;
  const ids = (v: unknown) => (Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : []);
  out.all = ids(o.all).slice(-IMPRESSION_CAP);
  if (typeof o.byList === "object" && o.byList !== null) {
    for (const [k, v] of Object.entries(o.byList)) out.byList[k] = ids(v).slice(-PER_LIST_CAP);
  }
  return out;
}

/** Record that `videoId` was seen; `lists` are the subscribed lists that contain it. Mutates. Returns true if anything changed. */
export function recordImpression(imp: Impressions, videoId: string, lists: readonly string[]): boolean {
  let changed = false;
  if (!imp.all.includes(videoId)) {
    imp.all.push(videoId);
    if (imp.all.length > IMPRESSION_CAP) imp.all.splice(0, imp.all.length - IMPRESSION_CAP);
    changed = true;
  }
  for (const l of lists) {
    const arr = (imp.byList[l] ??= []);
    if (!arr.includes(videoId)) {
      arr.push(videoId);
      if (arr.length > PER_LIST_CAP) arr.splice(0, arr.length - PER_LIST_CAP);
      changed = true;
    }
  }
  return changed;
}

/** Strength in [0, 1] for one list, from what was shown and endorsed on this device. */
export function listStrength(imp: Impressions, list: string, endorsed: ReadonlySet<string>): number {
  const shown = imp.byList[list] ?? [];
  const count = (ids: readonly string[]) => ids.reduce((n, id) => n + (endorsed.has(id) ? 1 : 0), 0);
  return tasteListStrength(
    { shown: shown.length, endorsed: count(shown) },
    { baseline: { shown: imp.all.length, endorsed: count(imp.all) } },
  );
}
