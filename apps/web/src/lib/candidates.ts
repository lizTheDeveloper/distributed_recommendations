// Turn catalog data and the viewer's relationships into ranker candidates.
// Pure: no network, no storage.

import type { Candidate, Recipe, Video } from "./core.ts";
import { editRecipe } from "./recipes.ts";
import type { TasteList } from "./tastelist.ts";

export interface InstanceFeed {
  origin: string;
  trending: Video[];
  recent: Video[];
}

export interface ResolvedTasteList {
  list: TasteList;
  /** Videos resolved from the list's ids (unresolvable ids are skipped). */
  videos: Video[];
  /** Track-record strength in [0, 1] (`tasteListStrength`); default 0.5, core's start value. */
  strength?: number;
  /** Ranker `via` (one per list: core caps per via). Default: the list's name. */
  via?: string;
  /** Key for the list's track record (impressions). Default: the list's name. */
  trackKey?: string;
  /** Why-line replacing core's generic one (followed creator tastes). */
  why?: string;
}

export interface CandidateInput {
  instances: InstanceFeed[];
  /** Lowercased `name@host` handles. */
  follows: ReadonlySet<string>;
  /** Videos fetched from followed channels. */
  followVideos: Video[];
  tasteLists: ResolvedTasteList[];
}

export const DEFAULT_LIST_STRENGTH = 0.5;

/**
 * The personal feed: follows, subscribed taste lists, and explore. Instance trending
 * is NOT a source here (see `buildPopularCandidates`); a followed creator's trending
 * video still counts as a follow.
 */
export function buildCandidates(input: CandidateInput): Candidate[] {
  const out: Candidate[] = [];
  const followSrc = (v: Video): Candidate => ({ video: v, source: { kind: "follow", via: v.creatorName ?? v.creator } });
  const followed = (v: Video) => input.follows.has(v.creator.toLowerCase());

  for (const v of input.followVideos) if (followed(v)) out.push(followSrc(v));

  for (const t of input.tasteLists) {
    const strength = t.strength ?? DEFAULT_LIST_STRENGTH;
    const via = t.via ?? t.list.name;
    for (const v of t.videos) out.push({ video: v, source: { kind: "taste", via, strength } });
  }

  for (const inst of input.instances) {
    for (const v of inst.trending) if (followed(v)) out.push(followSrc(v));
    // Newest uploads from the wider network are the explore pool: the ranker keeps
    // only those with no other tie, from creators you don't follow, under 14 days old.
    for (const v of inst.recent) out.push(followed(v) ? followSrc(v) : { video: v, source: { kind: "explore" } });
  }
  return out;
}

/**
 * "Popular on your instances": each instance's trending list as a public taste
 * source, ranked in its own pass and shown as a separate, labelled section after the
 * personal feed. Kept out of the personal feed so core's per-list cap (2) keeps
 * protecting it, while a new viewer with no follows or lists still sees something.
 */
export function buildPopularCandidates(instances: readonly InstanceFeed[]): Candidate[] {
  const out: Candidate[] = [];
  for (const inst of instances) {
    const host = new URL(inst.origin).host;
    for (const v of inst.trending) out.push({ video: v, source: { kind: "taste", via: `Trending on ${host}` } });
  }
  return out;
}

/** Popular items per instance in the popular section. */
export const POPULAR_PER_INSTANCE = 6;

/**
 * The recipe for the popular pass: the viewer's own recipe (filters, per-creator cap,
 * decay, taste weight), with explore off and a per-list cap of POPULAR_PER_INSTANCE.
 * A recipe with taste weight 0 (e.g. following only) gets no popular section.
 */
export function popularRecipe(r: Recipe): Recipe {
  return editRecipe(r, { exploreShare: 0, maxPerTasteList: POPULAR_PER_INSTANCE });
}

/** Map of video id -> taste-list item flags, for sponsored/affiliated labels. */
export function disclosureIndex(lists: readonly ResolvedTasteList[]): Map<string, { sponsored: string[]; affiliated: string[] }> {
  const m = new Map<string, { sponsored: string[]; affiliated: string[] }>();
  for (const { list, via } of lists) {
    const name = via ?? list.name;
    for (const it of list.items) {
      if (!it.sponsored && !it.affiliated) continue;
      const e = m.get(it.id) ?? { sponsored: [], affiliated: [] };
      if (it.sponsored) e.sponsored.push(name);
      if (it.affiliated) e.affiliated.push(name);
      m.set(it.id, e);
    }
  }
  return m;
}

/** Map of video id -> track-record keys of subscribed lists (and followed tastes) containing it. */
export function listMembership(lists: readonly ResolvedTasteList[]): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const { list, trackKey } of lists) for (const it of list.items) m.set(it.id, [...(m.get(it.id) ?? []), trackKey ?? list.name]);
  return m;
}
