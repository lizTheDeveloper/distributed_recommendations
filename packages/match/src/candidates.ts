// Turn received sketches into feed candidates (DESIGN.md, Match protocol step 4):
// similarity = Jaccard (or set cosine) between my items and the peer's sketch, and
// each of the peer's items becomes a `match` candidate with that similarity as its
// strength, so core `rank` scores Σ over matches of weight × sim × decay.

import type { MatchBook } from './state.ts';
import type { Candidate, Video } from './core.ts';
import { sketchItems, sketchSimilarity } from './core.ts';

export interface MatchSimilarity {
  matchId: string;
  peer: string;
  similarity: number;
  /** The peer's real items (padding removed). */
  items: Set<string>;
}

function sec(d: Date): number {
  return Math.floor(d.getTime() / 1000);
}

/** Similarity to every active match with a current (unexpired) sketch. */
export function matchSimilarities(
  book: MatchBook,
  myItems: Iterable<string>,
  opts: { now: Date; method?: 'jaccard' | 'cosine' },
): MatchSimilarity[] {
  const now = sec(opts.now);
  const mine = new Set(myItems);
  const out: MatchSimilarity[] = [];
  for (const rec of Object.values(book.matches)) {
    if (rec.status !== 'active' || !rec.peerSketch) continue;
    if (rec.expiresAt !== undefined && rec.expiresAt <= now) continue;
    if (rec.peerSketch.expiresAt <= now) continue;
    out.push({
      matchId: rec.matchId,
      peer: rec.peer,
      similarity: sketchSimilarity(mine, rec.peerSketch, opts.method ?? 'jaccard'),
      items: sketchItems(rec.peerSketch),
    });
  }
  return out.sort((a, b) => b.similarity - a.similarity || (a.matchId < b.matchId ? -1 : 1));
}

export interface MatchCandidateOptions {
  myItems: Iterable<string>;
  now: Date;
  /** Look up catalog metadata for a canonical video URL (PeerTube, NIP-71). Unknown ids are skipped. */
  resolveVideo: (id: string) => Video | undefined;
  /** Display name for a match (the explanation names the match). Default "a match". */
  nameOf?: (peer: string, matchId: string) => string;
  method?: 'jaccard' | 'cosine';
  /** Skip matches below this similarity. Default 0 (keep all with any overlap). */
  minSimilarity?: number;
}

/** `match` candidates for core `rank`, one per (match, video). Items I already have are skipped. */
export function matchCandidates(book: MatchBook, opts: MatchCandidateOptions): Candidate[] {
  const mine = new Set(opts.myItems);
  const out: Candidate[] = [];
  for (const m of matchSimilarities(book, mine, opts)) {
    if (!(m.similarity > (opts.minSimilarity ?? 0))) continue;
    const via = opts.nameOf?.(m.peer, m.matchId) ?? 'a match';
    for (const id of m.items) {
      if (mine.has(id)) continue;
      const video = opts.resolveVideo(id);
      if (!video) continue;
      out.push({ video, source: { kind: 'match', via, strength: Math.min(1, Math.max(0, m.similarity)) } });
    }
  }
  return out;
}
