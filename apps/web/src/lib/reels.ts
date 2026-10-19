// Reels: the vertical short-video view. Pure selection, pagination and player
// planning, so the UI layer only renders what these functions decide.
//
// The ranked list comes from the same on-device `rank()` pass as the grid (the
// viewer's recipe), plus the labelled "Popular on your instances" pass after it.
// From that order, Reels prefers short or portrait videos (PeerTube `duration` and
// `aspectRatio`), and falls back to ordinary videos only when the pool runs dry.

import type { RankedItem, Video } from "./core.ts";

/** Per-video fields the core `Video` doesn't carry, captured from PeerTube responses. */
export interface VideoMeta {
  /** width / height, e.g. 0.5625 for 9:16 portrait. PeerTube ≥ 6 sends it. */
  aspectRatio?: number;
  isLive?: boolean;
}

/** "Short" for Reels: at most this long, or portrait at any length. */
export const REELS_MAX_SHORT_SEC = 180;
/** Items added to the Reels list at a time. */
export const REELS_BATCH = 8;
/** Start loading the next page when the viewer is this close to the end. */
export const REELS_LOAD_AHEAD = 3;
/** Extra catalog pages fetched per instance and list before falling back to long videos. */
export const REELS_MAX_PAGES = 6;
export const REELS_PAGE_SIZE = 50;

export function isPortrait(meta: VideoMeta | undefined): boolean {
  return !!meta && typeof meta.aspectRatio === "number" && meta.aspectRatio > 0 && meta.aspectRatio < 1;
}

export function isShortForm(v: Video, meta?: VideoMeta): boolean {
  if (meta?.isLive) return false;
  return isPortrait(meta) || (v.durationSec > 0 && v.durationSec <= REELS_MAX_SHORT_SEC);
}

export type ReelSection = "feed" | "popular";

export interface ReelItem {
  item: RankedItem;
  section: ReelSection;
  /** A longer video, used because there weren't enough short ones. */
  fallback: boolean;
}

export interface ExtendOptions {
  batch?: number;
  meta: (id: string) => VideoMeta | undefined;
  /** No more pages will come: long videos may fill in. */
  exhausted: boolean;
  /** Ids never to add (dismissed, "not interested"). */
  exclude?: ReadonlySet<string>;
}

/**
 * Append the next batch to the committed Reels list. Items already committed keep
 * their positions (re-ranking never reshuffles what the viewer scrolled past).
 * Short/portrait items come first, in rank order; long ones fill in only when the
 * catalog is exhausted, or when nothing short exists yet so the screen isn't empty.
 * `needMore` says another page should be fetched.
 */
export function extendReels(
  committed: readonly ReelItem[],
  ranked: readonly { item: RankedItem; section: ReelSection }[],
  opts: ExtendOptions,
): { items: ReelItem[]; needMore: boolean; added: number } {
  const batch = opts.batch ?? REELS_BATCH;
  const have = new Set(committed.map((r) => r.item.video.id));
  const available = ranked.filter((r) => {
    const id = r.item.video.id;
    if (have.has(id) || opts.exclude?.has(id)) return false;
    have.add(id); // a video ranked in both passes is offered once
    return !opts.meta(id)?.isLive;
  });
  const short = available.filter((r) => isShortForm(r.item.video, opts.meta(r.item.video.id)));
  const long = available.filter((r) => !isShortForm(r.item.video, opts.meta(r.item.video.id)));
  const add: ReelItem[] = short.slice(0, batch).map((r) => ({ ...r, fallback: false }));
  const mayFill = opts.exhausted || (committed.length === 0 && add.length === 0);
  if (add.length < batch && mayFill) {
    for (const r of long.slice(0, batch - add.length)) add.push({ ...r, fallback: true });
  }
  return { items: [...committed, ...add], needMore: !opts.exhausted && short.length < batch, added: add.length };
}

/** Drop one id (not interested) and return the new list. */
export function removeReel(items: readonly ReelItem[], id: string): ReelItem[] {
  return items.filter((r) => r.item.video.id !== id);
}

// ---- pagination over core's PeerTube client (start / count) ----

export type ListKind = "recent" | "trending";

export interface PagerCursor {
  start: number;
  done: boolean;
  pages: number;
}

export type Pager = Record<string, Record<ListKind, PagerCursor>>;

/** The first page (start 0) is the one the home feed already loaded. */
export function newPager(origins: readonly string[], firstPageSize = REELS_PAGE_SIZE): Pager {
  const p: Pager = {};
  for (const o of origins) p[o] = { recent: { start: firstPageSize, done: false, pages: 0 }, trending: { start: firstPageSize, done: false, pages: 0 } };
  return p;
}

export interface PageRequest {
  origin: string;
  which: ListKind;
  start: number;
  count: number;
}

/** Next pages to fetch, one per instance and list that isn't exhausted. */
export function nextPages(p: Pager, maxPages = REELS_MAX_PAGES, count = REELS_PAGE_SIZE): PageRequest[] {
  const out: PageRequest[] = [];
  for (const [origin, lists] of Object.entries(p)) {
    for (const which of ["recent", "trending"] as const) {
      const c = lists[which];
      if (!c.done && c.pages < maxPages) out.push({ origin, which, start: c.start, count });
    }
  }
  return out;
}

/** Record a fetched page. Fewer results than asked for means the list ended. */
export function applyPage(p: Pager, req: PageRequest, received: number): Pager {
  const lists = p[req.origin];
  if (!lists) return p;
  const c = lists[req.which];
  return {
    ...p,
    [req.origin]: { ...lists, [req.which]: { start: req.start + received, done: received < req.count, pages: c.pages + 1 } },
  };
}

export function pagerExhausted(p: Pager, maxPages = REELS_MAX_PAGES): boolean {
  return nextPages(p, maxPages).length === 0;
}

// ---- players: only the visible item plays ----

/** play = visible; preload = next (mounted, not playing); paused = previous; none = torn down. */
export type PlayerMode = "play" | "preload" | "paused" | "none";

export function playerPlan(active: number, count: number): PlayerMode[] {
  return Array.from({ length: count }, (_, i) =>
    i === active ? "play" : i === active + 1 ? "preload" : i === active - 1 ? "paused" : "none",
  );
}

export function shouldLoadMore(active: number, count: number, ahead = REELS_LOAD_AHEAD): boolean {
  return count === 0 || active >= count - 1 - ahead;
}

export type ReelKey = "next" | "prev" | "toggle" | "mute";

/** Desktop keyboard: ↑/↓ or j/k to move, space to pause, m to mute. */
export function reelKey(e: { key: string; altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean }): ReelKey | null {
  if (e.altKey || e.ctrlKey || e.metaKey) return null;
  switch (e.key) {
    case "ArrowDown":
    case "j":
    case "PageDown":
      return "next";
    case "ArrowUp":
    case "k":
    case "PageUp":
      return "prev";
    case " ":
    case "Spacebar":
      return "toggle";
    case "m":
    case "M":
      return "mute";
    default:
      return null;
  }
}
