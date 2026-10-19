/** How a candidate reached the feed. */
export type SourceKind = "follow" | "taste" | "match" | "circle" | "second" | "explore";

/** All source kinds, in the order used to break ties when picking a primary kind. */
export const SOURCE_KINDS: readonly SourceKind[] = [
  "follow",
  "match",
  "circle",
  "taste",
  "second",
  "explore",
];

/** A video from any catalog (PeerTube, NIP-71). `id` is the canonical URL. */
export interface Video {
  id: string;
  title: string;
  /** Channel handle, `name@host`. */
  creator: string;
  /** Human-readable channel name, used in explanations when present. */
  creatorName?: string;
  durationSec: number;
  publishedAt: Date;
  tags: string[];
  /** BCP 47 language code, e.g. "en", "pt-BR". */
  language?: string;
  thumbnailUrl?: string;
  /** Watch page URL, if different from `id`. */
  url?: string;
}

/** Where a candidate came from. */
export interface CandidateSource {
  kind: SourceKind;
  /**
   * Display name of the relationship that produced it: the creator (follow), the
   * taste-list name (taste), the match's name (match) or the circle's name (circle).
   * Ignored for `second` and `explore`, which never name anyone.
   */
  via?: string;
  /**
   * Strength in [0, 1], default 1: overlap with a match, trust of a second-degree
   * path, a circle's normalized count, or a taste list's track record.
   */
  strength?: number;
}

/** One reason a video might be shown. A video may arrive as several candidates. */
export interface Candidate {
  video: Video;
  source: CandidateSource;
}

/** A video in the ranked feed, with the explanation shown under "Why am I seeing this?". */
export interface RankedItem {
  video: Video;
  score: number;
  /** The source kind that contributed most; drives the chip. */
  primary: SourceKind;
  why: string[];
}

/** A random number generator returning floats in [0, 1). */
export type Rng = () => number;
