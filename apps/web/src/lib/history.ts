// Local watch history. It never leaves the device in v1. Private watching means
// nothing is recorded at all.

import type { HistoryEntry, SourceKind } from "./core.ts";
import type { Settings } from "./settings.ts";

export interface WatchEvent {
  videoId: string;
  /** Unix ms. */
  at: number;
  /** `watch` = opened the player; `endorse` = explicit like/save. */
  kind: "watch" | "endorse";
  tags: string[];
  /** The chip the video carried when acted on (local only). */
  via?: SourceKind;
}

export const HISTORY_CAP = 2000;

export function loadHistory(x: unknown): WatchEvent[] {
  if (!Array.isArray(x)) return [];
  return x
    .filter(
      (e): e is WatchEvent =>
        typeof e === "object" &&
        e !== null &&
        typeof e.videoId === "string" &&
        typeof e.at === "number" &&
        (e.kind === "watch" || e.kind === "endorse"),
    )
    .map((e) => ({ ...e, tags: Array.isArray(e.tags) ? e.tags.filter((t: unknown) => typeof t === "string") : [] }))
    .slice(-HISTORY_CAP);
}

/** Returns the new history, or the same array when private watching is on. */
export function record(history: WatchEvent[], ev: WatchEvent, settings: Pick<Settings, "privateWatching">): WatchEvent[] {
  if (settings.privateWatching) return history;
  return [...history, ev].slice(-HISTORY_CAP);
}

export const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Drop events older than the sharing window (`days`). Returns the same array when
 * nothing is removed, so callers can skip a write.
 */
export function pruneHistory(history: WatchEvent[], days: number, nowMs: number): WatchEvent[] {
  const cutoff = nowMs - days * DAY_MS;
  return history.some((e) => e.at < cutoff) ? history.filter((e) => e.at >= cutoff) : history;
}

/** Remove an endorsement (un-endorse). */
export function unendorse(history: WatchEvent[], videoId: string): WatchEvent[] {
  return history.filter((e) => !(e.kind === "endorse" && e.videoId === videoId));
}

export function isEndorsed(history: readonly WatchEvent[], videoId: string): boolean {
  return history.some((e) => e.kind === "endorse" && e.videoId === videoId);
}

/** Ids to hide from the feed: anything watched. */
export function seenSet(history: readonly WatchEvent[]): Set<string> {
  return new Set(history.filter((e) => e.kind === "watch").map((e) => e.videoId));
}

/**
 * Entries in core's sketch format, for when Match ships. Endorsements only:
 * opening the player is not a finished watch, so `watch` events never qualify.
 */
export function toSketchHistory(history: readonly WatchEvent[]): HistoryEntry[] {
  return history
    .filter((e) => e.kind === "endorse")
    .map((e) => ({ videoId: e.videoId, at: new Date(e.at), kind: "endorse" as const, tags: e.tags }));
}
