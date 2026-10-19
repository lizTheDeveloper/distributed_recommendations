import type { TasteSketch } from "./sketch.ts";
import type { Video } from "./types.ts";
import { sketchItems } from "./sketch.ts";

function asSet(xs: Iterable<string>): ReadonlySet<string> {
  return xs instanceof Set ? xs : new Set(xs);
}

/** Number of ids in both sets. */
export function overlap(a: Iterable<string>, b: Iterable<string>): number {
  const A = asSet(a);
  const B = asSet(b);
  const [small, large] = A.size <= B.size ? [A, B] : [B, A];
  let n = 0;
  for (const x of small) if (large.has(x)) n++;
  return n;
}

/** Jaccard similarity |A∩B| / |A∪B|; 0 when both are empty. */
export function jaccard(a: Iterable<string>, b: Iterable<string>): number {
  const A = asSet(a);
  const B = asSet(b);
  const inter = overlap(A, B);
  const union = A.size + B.size - inter;
  return union === 0 ? 0 : inter / union;
}

/** Cosine similarity of two sets (binary vectors): |A∩B| / sqrt(|A||B|). */
export function cosineSets(a: Iterable<string>, b: Iterable<string>): number {
  const A = asSet(a);
  const B = asSet(b);
  if (A.size === 0 || B.size === 0) return 0;
  return overlap(A, B) / Math.sqrt(A.size * B.size);
}

/** Cosine similarity of two weighted maps (id → weight). Negative weights are allowed. */
export function cosine(a: ReadonlyMap<string, number>, b: ReadonlyMap<string, number>): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const [k, x] of a) {
    na += x * x;
    const y = b.get(k);
    if (y !== undefined) dot += x * y;
  }
  for (const y of b.values()) nb += y * y;
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb);
}

/** Similarity between my local item set and a peer's sketch; padding entries are ignored. */
export function sketchSimilarity(
  mine: Iterable<string>,
  theirs: TasteSketch,
  method: "jaccard" | "cosine" = "jaccard",
): number {
  const items = sketchItems(theirs);
  return method === "jaccard" ? jaccard(mine, items) : cosineSets(mine, items);
}

/**
 * A viewer's tag profile: lowercased tag → weight, summed over videos they endorsed
 * or finished (pass a `weight` per video to favour endorsements or recent ones).
 * Stays on the device.
 */
export function tagProfile(
  videos: Iterable<Pick<Video, "tags">>,
  weight: (video: Pick<Video, "tags">) => number = () => 1,
): Map<string, number> {
  const profile = new Map<string, number>();
  for (const v of videos) {
    const w = weight(v);
    if (!(w > 0) || !Number.isFinite(w)) continue;
    for (const t of new Set((v.tags ?? []).map((x) => x.toLowerCase()))) profile.set(t, (profile.get(t) ?? 0) + w);
  }
  return profile;
}

/**
 * An explore relevance scorer for `rank` (`RankOptions.exploreRelevance`): cosine
 * between the viewer's tag profile and a video's tags, in [0, 1]. This is the
 * on-device relevance the simulator used to rank explore candidates
 * (docs/SIMULATION_RESULTS.md, Exp 2).
 */
export function tagRelevance(profile: ReadonlyMap<string, number>): (video: Pick<Video, "tags">) => number {
  return (video) => {
    const tags = new Map<string, number>();
    for (const t of video.tags ?? []) tags.set(t.toLowerCase(), 1);
    return Math.max(0, cosine(profile, tags));
  };
}
