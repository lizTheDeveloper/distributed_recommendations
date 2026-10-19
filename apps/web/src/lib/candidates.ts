// Turn catalog data and the viewer's relationships into ranker candidates.
// Pure: no network, no storage.

import type { Candidate, Video } from "./core.ts";
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
}

export interface CandidateInput {
  instances: InstanceFeed[];
  /** Lowercased `name@host` handles. */
  follows: ReadonlySet<string>;
  /** Videos fetched from followed channels. */
  followVideos: Video[];
  tasteLists: ResolvedTasteList[];
  trendingAsTaste: boolean;
}

/** Strength of an instance's trending list, relative to a list a person chose (1). */
export const TRENDING_STRENGTH = 0.5;

export function buildCandidates(input: CandidateInput): Candidate[] {
  const out: Candidate[] = [];
  const followSrc = (v: Video): Candidate => ({ video: v, source: { kind: "follow", via: v.creatorName ?? v.creator } });
  const followed = (v: Video) => input.follows.has(v.creator.toLowerCase());

  for (const v of input.followVideos) if (followed(v)) out.push(followSrc(v));

  for (const t of input.tasteLists) {
    for (const v of t.videos) out.push({ video: v, source: { kind: "taste", via: t.list.name, strength: 1 } });
  }

  for (const inst of input.instances) {
    const host = new URL(inst.origin).host;
    for (const v of inst.trending) {
      if (followed(v)) out.push(followSrc(v));
      if (input.trendingAsTaste) {
        out.push({ video: v, source: { kind: "taste", via: `Trending on ${host}`, strength: TRENDING_STRENGTH } });
      }
    }
    // Newest uploads from the wider network are the explore pool: the ranker keeps
    // only those with no other tie, from creators you don't follow, under 14 days old.
    for (const v of inst.recent) out.push(followed(v) ? followSrc(v) : { video: v, source: { kind: "explore" } });
  }
  return out;
}

/** Map of video id -> taste-list item flags, for sponsored/affiliated labels. */
export function disclosureIndex(lists: readonly ResolvedTasteList[]): Map<string, { sponsored: string[]; affiliated: string[] }> {
  const m = new Map<string, { sponsored: string[]; affiliated: string[] }>();
  for (const { list } of lists) {
    for (const it of list.items) {
      if (!it.sponsored && !it.affiliated) continue;
      const e = m.get(it.id) ?? { sponsored: [], affiliated: [] };
      if (it.sponsored) e.sponsored.push(list.name);
      if (it.affiliated) e.affiliated.push(list.name);
      m.set(it.id, e);
    }
  }
  return m;
}
