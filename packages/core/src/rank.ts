import type { Candidate, CandidateSource, RankedItem, Rng, SourceKind, Video } from "./types.ts";
import { SOURCE_KINDS } from "./types.ts";
import type { Recipe } from "./recipe.ts";
import { RECIPE_DEFAULTS } from "./recipe.ts";
import type { Contribution } from "./explain.ts";
import { explain } from "./explain.ts";
import { shuffle } from "./rng.ts";

/** Options for `rank`. */
export interface RankOptions {
  now: Date;
  /** Maximum number of items to return. */
  limit: number;
  /** Used only to pick explore items; pass `seededRng` in tests. */
  rng: Rng;
  /** Video ids already watched or dismissed; never shown. */
  seen?: ReadonlySet<string>;
  /** Explore candidates older than this are ignored. Default 14. */
  exploreMaxAgeDays?: number;
  /**
   * On-device relevance of an explore candidate to this viewer, higher is better
   * (e.g. `tagRelevance(tagProfile(myHistory))`). Computed locally; nothing leaves the
   * device. When given, it takes precedence over explore sources' `strength`.
   *
   * Explore picks are relevance-ranked whenever a relevance signal exists (this
   * function, or an explicit `strength` on any explore source); ties break by a
   * seeded random draw. With no signal at all they fall back to a seeded random pick
   * among the newest. docs/SIMULATION_RESULTS.md, Exp 2: random explore cost about
   * 0.7% P@20 per point of share; relevance-ranked explore cost about nothing.
   */
  exploreRelevance?: (video: Video) => number;
}

const DAY_MS = 86_400_000;

interface Group {
  video: Video;
  sources: Map<string, Required<Pick<CandidateSource, "kind" | "strength">> & { via?: string; explicit: boolean }>;
}

function decay(publishedAt: Date, now: Date, halfLifeDays: number): number {
  if (halfLifeDays <= 0) return 1;
  const ageDays = Math.max(0, (now.getTime() - publishedAt.getTime()) / DAY_MS);
  return Math.pow(0.5, ageDays / halfLifeDays);
}

function usable(c: Candidate): boolean {
  const v = c?.video;
  return (
    !!v &&
    typeof v.id === "string" &&
    v.id.length > 0 &&
    typeof v.creator === "string" &&
    v.publishedAt instanceof Date &&
    Number.isFinite(v.publishedAt.getTime()) &&
    SOURCE_KINDS.includes(c.source?.kind)
  );
}

function passesFilters(v: Video, recipe: Recipe): boolean {
  const f = recipe.filters;
  if (f.excludeCreators.includes(v.creator.toLowerCase())) return false;
  if (f.excludeTags.length && v.tags.some((t) => f.excludeTags.includes(t.toLowerCase()))) return false;
  if (f.includeLanguages.length && v.language) {
    const lang = v.language.toLowerCase();
    if (!f.includeLanguages.some((l) => lang === l || lang.startsWith(l + "-"))) return false;
  }
  if (v.durationSec < f.minDurationSec) return false;
  if (f.maxDurationSec !== null && v.durationSec > f.maxDurationSec) return false;
  return true;
}

function byScore(a: RankedItem, b: RankedItem): number {
  return (
    b.score - a.score ||
    b.video.publishedAt.getTime() - a.video.publishedAt.getTime() ||
    (a.video.id < b.video.id ? -1 : a.video.id > b.video.id ? 1 : 0)
  );
}

/**
 * Rank candidates with a recipe, on device.
 *
 * - Candidates for the same video merge; each distinct source adds
 *   `weight[kind] × strength × 0.5^(age / halfLife)`.
 * - Recipe filters, `seen` and the per-creator cap apply to every slot.
 * - Each taste list contributes to at most `recipe.maxPerTasteList` (default 2) items.
 * - Explore slots sit at a fixed cadence (every `round(1 / exploreShare)` slots).
 *   Explore candidates are videos whose only source is `explore` and whose creator
 *   you don't follow. They compete only with each other: ranked by on-device
 *   relevance (`opts.exploreRelevance`, or explore `strength`) with seeded
 *   tie-breaking, or, with no relevance signal, a seeded random pick among the
 *   newest. Explore is off when `exploreShare` or `weights.explore` is 0.
 *
 * Deterministic for a given `rng` state.
 */
export function rank(candidates: readonly Candidate[], recipe: Recipe, opts: RankOptions): RankedItem[] {
  const { now, rng } = opts;
  const limit = Math.max(0, Math.floor(opts.limit));
  const seen = opts.seen ?? new Set<string>();
  const exploreMaxAgeDays = opts.exploreMaxAgeDays ?? 14;

  // 1. Merge duplicates. The same (kind, via) counted twice keeps its max strength.
  const groups = new Map<string, Group>();
  for (const c of candidates) {
    if (!usable(c)) continue;
    const strength = Math.min(1, Math.max(0, c.source.strength ?? 1));
    if (Number.isNaN(strength)) continue;
    const kind = c.source.kind;
    const named = kind !== "second" && kind !== "explore";
    const via = named && typeof c.source.via === "string" ? c.source.via : undefined;
    const key = named ? `${kind}\u0000${via ?? ""}` : kind;
    let g = groups.get(c.video.id);
    if (!g) {
      g = { video: c.video, sources: new Map() };
      groups.set(c.video.id, g);
    }
    const explicit = c.source.strength !== undefined;
    const prev = g.sources.get(key);
    if (!prev || strength > prev.strength || (explicit && !prev.explicit && strength === prev.strength)) {
      g.sources.set(key, { kind, strength, via, explicit: explicit || (prev?.explicit ?? false) });
    }
  }

  // 2. Filter, then split into the regular and the explore pools.
  const followed = new Set<string>();
  for (const g of groups.values()) {
    for (const s of g.sources.values()) if (s.kind === "follow") followed.add(g.video.creator.toLowerCase());
  }
  const exploreOn = recipe.exploreShare > 0 && recipe.weights.explore > 0;
  const scorer = opts.exploreRelevance;
  interface Scored {
    video: Video;
    decay: number;
    contributions: Contribution[];
  }
  const scored: Scored[] = [];
  const explorers: Array<{ video: Video; decay: number; relevance: number | undefined }> = [];
  for (const g of groups.values()) {
    const v = g.video;
    if (seen.has(v.id) || !passesFilters(v, recipe)) continue;
    const d = decay(v.publishedAt, now, recipe.recencyHalfLifeDays);
    const sources = [...g.sources.values()];
    const tied = sources.filter((s) => s.kind !== "explore");
    if (tied.length === 0) {
      const ageDays = (now.getTime() - v.publishedAt.getTime()) / DAY_MS;
      if (exploreOn && ageDays <= exploreMaxAgeDays && !followed.has(v.creator.toLowerCase())) {
        let relevance: number | undefined;
        if (scorer) {
          const r = scorer(v);
          relevance = typeof r === "number" && Number.isFinite(r) ? r : 0;
        } else {
          const src = g.sources.get("explore");
          relevance = src?.explicit ? src.strength : undefined;
        }
        explorers.push({ video: v, decay: d, relevance });
      }
      continue;
    }
    // A tie (follow, match, ...) outranks an explore source on the same video.
    const contributions: Contribution[] = tied
      .filter((s) => recipe.weights[s.kind] > 0)
      .map((s) => ({ kind: s.kind, via: s.via, strength: s.strength, value: recipe.weights[s.kind] * s.strength * d }));
    if (contributions.length === 0) continue;
    scored.push({ video: v, decay: d, contributions });
  }

  // 2b. Taste-list cap: each list (one `via`) contributes to at most
  // `maxPerTasteList` videos, the ones that score best overall (so a list's items
  // that the viewer's own peers also like go first). The rest lose that list's
  // contribution and keep any other sources. docs/SIMULATION_RESULTS.md, Exp 5 (P2).
  const listCap = recipe.maxPerTasteList ?? RECIPE_DEFAULTS.maxPerTasteList;
  const total = (x: Scored) => x.contributions.reduce((sum, c) => sum + c.value, 0);
  const byList = new Map<string, Scored[]>();
  for (const x of scored) {
    for (const c of x.contributions) {
      if (c.kind !== "taste") continue;
      const key = c.via ?? "";
      const list = byList.get(key) ?? [];
      list.push(x);
      byList.set(key, list);
    }
  }
  const totals = new Map(scored.map((x) => [x, total(x)]));
  for (const [key, items] of byList) {
    if (items.length <= listCap) continue;
    items.sort(
      (a, b) =>
        totals.get(b)! - totals.get(a)! ||
        b.video.publishedAt.getTime() - a.video.publishedAt.getTime() ||
        (a.video.id < b.video.id ? -1 : a.video.id > b.video.id ? 1 : 0),
    );
    for (const x of items.slice(listCap)) {
      x.contributions = x.contributions.filter((c) => !(c.kind === "taste" && (c.via ?? "") === key));
    }
  }

  const regular: RankedItem[] = [];
  for (const { video: v, contributions } of scored) {
    if (contributions.length === 0) continue;
    const perKind = new Map<SourceKind, number>();
    for (const c of contributions) perKind.set(c.kind, (perKind.get(c.kind) ?? 0) + c.value);
    let primary: SourceKind | undefined;
    for (const k of SOURCE_KINDS) {
      const value = perKind.get(k);
      if (value !== undefined && (primary === undefined || value > perKind.get(primary)!)) primary = k;
    }
    const score = contributions.reduce((s, c) => s + c.value, 0);
    regular.push({ video: v, score, primary: primary!, why: explain(v, contributions, primary!, now, SOURCE_KINDS) });
  }
  regular.sort(byScore);

  // 3. Explore. Relevance-ranked when any relevance signal exists, with seeded
  // random tie-breaking; otherwise a seeded shuffle of the newest few.
  const period = exploreOn ? Math.max(2, Math.round(1 / recipe.exploreShare)) : Infinity;
  const offset = Math.floor(period / 2);
  const slots = exploreOn ? Math.ceil(limit / period) : 0;
  const ranked = scorer !== undefined || explorers.some((x) => x.relevance !== undefined);
  const toItem = (x: (typeof explorers)[number]): RankedItem => {
    const rel = ranked ? Math.min(1, Math.max(0, x.relevance ?? 0)) : 1;
    const c: Contribution = { kind: "explore", strength: rel, value: recipe.weights.explore * rel * x.decay, personalized: ranked && rel > 0 };
    return { video: x.video, score: c.value, primary: "explore", why: explain(x.video, [c], "explore", now, SOURCE_KINDS) };
  };
  let exploreQueue: RankedItem[];
  if (ranked) {
    // Draw tie-break keys in id order so they depend only on the rng state.
    const ids = explorers.map((x) => x.video.id).sort();
    const keys = new Map(ids.map((id) => [id, rng()]));
    exploreQueue = explorers
      .slice()
      .sort(
        (a, b) =>
          (b.relevance ?? 0) - (a.relevance ?? 0) ||
          keys.get(a.video.id)! - keys.get(b.video.id)! ||
          (a.video.id < b.video.id ? -1 : 1),
      )
      .map(toItem);
  } else {
    const pool = explorers.map(toItem);
    pool.sort((a, b) => b.video.publishedAt.getTime() - a.video.publishedAt.getTime() || byScore(a, b));
    exploreQueue = shuffle(pool.slice(0, Math.max(8, slots * 4)), rng);
  }

  // 4. Fill slots, respecting the per-creator cap.
  const perCreator = new Map<string, number>();
  const take = (queue: RankedItem[], state: { i: number }): RankedItem | undefined => {
    while (state.i < queue.length) {
      const item = queue[state.i++];
      const creator = item.video.creator.toLowerCase();
      const n = perCreator.get(creator) ?? 0;
      if (n >= recipe.maxPerCreator) continue;
      perCreator.set(creator, n + 1);
      return item;
    }
    return undefined;
  };
  const r = { i: 0 };
  const e = { i: 0 };
  const out: RankedItem[] = [];
  while (out.length < limit) {
    const wantExplore = exploreOn && out.length % period === offset;
    const item = wantExplore
      ? (take(exploreQueue, e) ?? take(regular, r))
      : (take(regular, r) ?? (exploreOn ? take(exploreQueue, e) : undefined));
    if (!item) break;
    out.push(item);
  }
  return out;
}
