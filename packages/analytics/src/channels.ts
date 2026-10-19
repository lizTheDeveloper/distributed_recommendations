// Discovery channels and time windows for Tier 2 creator analytics (docs/ANALYTICS.md).
//
// The order of CHANNELS is part of the wire format: a report is a one-hot vector over
// it (Prio3Histogram, length 8), and the creator's published task config must list
// exactly these channels in this order. Changing it needs a new task (and config `v`).

import type { SourceKind } from "./core.ts";

export const CHANNELS = ["follow", "taste", "match", "circle", "second", "explore", "search", "other"] as const;
export type Channel = (typeof CHANNELS)[number];

export const CHANNEL_INDEX: Readonly<Record<Channel, number>> = Object.freeze(
  Object.fromEntries(CHANNELS.map((c, i) => [c, i])) as Record<Channel, number>,
);

export function isChannel(x: unknown): x is Channel {
  return typeof x === "string" && (CHANNELS as readonly string[]).includes(x);
}

/**
 * Channel for a view. `primary` is the ranked item's `primary` from core `rank()`
 * (the source that contributed most). Pass "search" for a view opened from search
 * results, and nothing for anything else (a shared link, a direct URL, an embed).
 */
export function channelOf(primary: SourceKind | "search" | null | undefined): Channel {
  return isChannel(primary) ? primary : "other";
}

/** 28 days. Also the DAP task's time_precision, so a report reveals only its window. */
export const WINDOW_SECONDS = 28 * 24 * 3600;

/** Prio3Histogram chunk length: about sqrt(8), as the VDAF draft suggests. */
export const CHUNK_LENGTH = 3;

/** Any displayed count below this is shown as "<20" (ANALYTICS.md). */
export const DISPLAY_THRESHOLD = 20;

/** Windows are aligned to the Unix epoch so every batch interval is a multiple of time_precision. */
export function windowIndex(at: Date | number): number {
  const ms = typeof at === "number" ? at : at.getTime();
  if (!Number.isFinite(ms)) throw new RangeError("invalid time");
  return Math.floor(ms / 1000 / WINDOW_SECONDS);
}

/** Start of window `w`, in Unix seconds. */
export function windowStart(w: number): number {
  return w * WINDOW_SECONDS;
}

/** End (exclusive) of window `w`, in Unix seconds. */
export function windowEnd(w: number): number {
  return (w + 1) * WINDOW_SECONDS;
}
