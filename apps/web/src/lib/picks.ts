// Creator studio, "Publish my picks": the draft and the pure helpers around
// packages/taste (publishPicks, validatePicksSet). The draft is stored in the vault
// (`picks`): it is built from the viewer's endorsements.

import type { Pick, PicksSet } from "./taste/pkg.ts";
import { validatePicksSet } from "./taste/pkg.ts";
import type { Video } from "./core.ts";
import type { WatchEvent } from "./history.ts";

export interface PicksDraft {
  set: PicksSet;
  /** Default true: build and preview (and optionally sign) but send nothing. */
  dryRun: boolean;
}

export const MAX_PICKS = 256;

export function emptyPicksDraft(): PicksDraft {
  return { set: { d: "picks", title: "My picks", items: [] }, dryRun: true };
}

/** Validate what the vault returned (packages/taste's strict check); anything bad starts over. */
export function loadPicksDraft(x: unknown): PicksDraft {
  const o = x as Partial<PicksDraft> | null;
  const d = emptyPicksDraft();
  if (!o || typeof o !== "object") return d;
  try {
    d.set = validatePicksSet(o.set);
  } catch {
    return d;
  }
  d.dryRun = o.dryRun !== false;
  return d;
}

/**
 * What the viewer can pick from: their endorsed videos (newest endorsement first),
 * with video data where the app knows it. Only http(s) watch URLs qualify.
 */
export function endorsedChoices(history: readonly WatchEvent[], known: (id: string) => Video | undefined): { id: string; at: number; video?: Video }[] {
  const out = new Map<string, { id: string; at: number; video?: Video }>();
  for (const e of [...history].sort((a, b) => b.at - a.at)) {
    if (e.kind !== "endorse" || out.has(e.videoId) || !/^https:\/\//.test(e.videoId)) continue;
    out.set(e.videoId, { id: e.videoId, at: e.at, video: known(e.videoId) });
  }
  return [...out.values()];
}

/** Add or remove a pick. A new pick is stamped with `addedAt` = now (Unix seconds). */
export function togglePick(set: PicksSet, url: string, nowMs: number): PicksSet {
  if (set.items.some((p) => p.url === url)) return { ...set, items: set.items.filter((p) => p.url !== url) };
  if (set.items.length >= MAX_PICKS) throw new RangeError(`At most ${MAX_PICKS} picks`);
  const pick: Pick = { url, addedAt: Math.floor(nowMs / 1000), sponsored: false, affiliated: false };
  return validatePicksSet({ ...set, items: [...set.items, pick] });
}

export function editPick(set: PicksSet, url: string, patch: Partial<Pick>): PicksSet {
  return validatePicksSet({ ...set, items: set.items.map((p) => (p.url === url ? { ...p, ...patch } : p)) });
}

/** What to put in the channel description so Follow taste finds the picks. */
export function descriptionHint(npub: string | null, jsonUrl: string | null): string {
  const lines: string[] = [];
  if (npub) lines.push(`Nostr: nostr:${npub}`);
  lines.push(`My taste list: ${jsonUrl || "https://<where you host it>/taste.json"}`);
  return lines.join("\n");
}
