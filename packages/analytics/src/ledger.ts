// The on-device ledger: per 28-day window, per creator, how many views arrived through
// each channel. This is all the analytics code ever keeps about viewing.
//
// - No video ids, titles, URLs or view times are stored: `recordView` copies only the
//   creator key, the channel and the window index out of its input.
// - The ledger says which creators you watched, so the app must store it with the
//   other sensitive local data (apps/web `lib/vault.ts`, encrypted at rest) and delete
//   it with the rest on wipe. It is plain JSON for that reason.
// - Views are counted only when the switches allow it at the time of the view
//   (`channelAllowed`); the switches are checked again before anything is uploaded.
// - A closed window's tallies are deleted as soon as its reports are planned
//   (`planReports`), and anything older than the upload deadline is pruned.

import { CHANNELS, type Channel, isChannel, windowIndex } from "./channels.ts";
import { channelAllowed, type ContributionSettings } from "./settings.ts";

/** Upper bounds that keep the ledger small whatever happens. */
export const LEDGER_LIMITS = Object.freeze({
  /** Creators tracked per window; views of further creators in that window are not counted. */
  maxCreatorsPerWindow: 500,
  /** A counter stops here; only the dominant channel matters (see report.ts). */
  maxCountPerChannel: 10_000,
  /** Creator keys longer than this are refused. */
  maxCreatorKeyLength: 256,
});

export type ChannelCounts = Partial<Record<Channel, number>>;

export interface Ledger {
  v: 1;
  /** window index (as a string key) -> creator key -> channel counts */
  windows: Record<string, Record<string, ChannelCounts>>;
}

export function emptyLedger(): Ledger {
  return { v: 1, windows: {} };
}

/** What a view hook passes in. Extra fields (a video id, a title) are ignored, never stored. */
export interface ViewEvent {
  /**
   * The creator the report is about, in the same form as the creator's task config
   * `creator` field: the PeerTube channel handle `name@host`, or a Nostr pubkey (hex).
   */
  creator: string;
  channel: Channel;
  at: Date;
}

/** A creator key: a channel handle `name@host` or a 64-char lowercase hex pubkey. */
export function isCreatorKey(x: unknown): x is string {
  if (typeof x !== "string" || x.length === 0 || x.length > LEDGER_LIMITS.maxCreatorKeyLength) return false;
  return /^[a-f0-9]{64}$/.test(x) || /^[A-Za-z0-9_.-]+@[A-Za-z0-9.-]+(:\d{1,5})?$/.test(x);
}

/**
 * Count a view. Returns the same ledger object when nothing is counted (private
 * watching, contribution off, channel switched off, malformed input, limits hit),
 * otherwise a new ledger.
 */
export function recordView(ledger: Ledger, view: ViewEvent, settings: ContributionSettings): Ledger {
  if (!view || !isChannel(view.channel) || !isCreatorKey(view.creator)) return ledger;
  if (!(view.at instanceof Date) || !Number.isFinite(view.at.getTime())) return ledger;
  if (!channelAllowed(view.channel, settings)) return ledger;
  const w = String(windowIndex(view.at));
  const win = ledger.windows[w] ?? {};
  const counts = win[view.creator];
  if (!counts && Object.keys(win).length >= LEDGER_LIMITS.maxCreatorsPerWindow) return ledger;
  const prev = counts?.[view.channel] ?? 0;
  if (prev >= LEDGER_LIMITS.maxCountPerChannel) return ledger;
  return {
    v: 1,
    windows: { ...ledger.windows, [w]: { ...win, [view.creator]: { ...counts, [view.channel]: prev + 1 } } },
  };
}

/** Parse a stored ledger, dropping anything malformed. Never throws. */
export function loadLedger(x: unknown): Ledger {
  const out = emptyLedger();
  if (typeof x !== "object" || x === null) return out;
  const windows = (x as { windows?: unknown }).windows;
  if (typeof windows !== "object" || windows === null) return out;
  for (const [w, creators] of Object.entries(windows)) {
    if (!/^\d{1,9}$/.test(w) || typeof creators !== "object" || creators === null) continue;
    const win: Record<string, ChannelCounts> = {};
    for (const [creator, counts] of Object.entries(creators).slice(0, LEDGER_LIMITS.maxCreatorsPerWindow)) {
      if (!isCreatorKey(creator) || typeof counts !== "object" || counts === null) continue;
      const c: ChannelCounts = {};
      for (const ch of CHANNELS) {
        const v = (counts as Record<string, unknown>)[ch];
        if (typeof v === "number" && Number.isInteger(v) && v > 0) c[ch] = Math.min(v, LEDGER_LIMITS.maxCountPerChannel);
      }
      if (Object.keys(c).length > 0) win[creator] = c;
    }
    if (Object.keys(win).length > 0) out.windows[w] = win;
  }
  return out;
}

/** Creators with views in closed windows that still need a task config lookup. */
export function creatorsInWindow(ledger: Ledger, w: number): string[] {
  return Object.keys(ledger.windows[String(w)] ?? {}).sort();
}

/** Remove one window's tallies. */
export function dropWindow(ledger: Ledger, w: number): Ledger {
  if (!(String(w) in ledger.windows)) return ledger;
  const windows = { ...ledger.windows };
  delete windows[String(w)];
  return { v: 1, windows };
}

/** Delete everything (the app's wipe, or the viewer turning contribution off). */
export function clearLedger(): Ledger {
  return emptyLedger();
}
