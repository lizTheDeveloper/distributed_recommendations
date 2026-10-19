// Small helpers for the app's integration points (docs/ANALYTICS_IMPLEMENTATION.md,
// "Hooks apps/web must add"). They exist so the app never has to touch a video id
// on the analytics path.

import { channelOf } from "./channels.ts";
import type { RankedItem } from "./core.ts";
import type { ViewEvent } from "./ledger.ts";

/**
 * The view event for a feed item the viewer watched. Takes only the creator handle
 * and the item's `primary` source from core `rank()`; the video id is not read.
 */
export function viewFromRankedItem(item: Pick<RankedItem, "primary"> & { video: { creator: string } }, at: Date): ViewEvent {
  return { creator: item.video.creator, channel: channelOf(item.primary), at };
}

/** A view opened from search results. */
export function viewFromSearch(creator: string, at: Date): ViewEvent {
  return { creator, channel: "search", at };
}

/** A view with no feed or search context (shared link, direct URL, embed). */
export function viewFromElsewhere(creator: string, at: Date): ViewEvent {
  return { creator, channel: "other", at };
}

/**
 * Delay before the next `runUploads` call: 10 to 30 minutes, uniformly at random,
 * so upload times carry no pattern. Use with `setTimeout`, and also run once a few
 * minutes after the app starts (not at start, to avoid a burst on launch).
 */
export function nextRunDelayMs(rng: () => number): number {
  return Math.floor((10 + rng() * 20) * 60_000);
}
