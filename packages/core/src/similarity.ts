import type { TasteSketch } from "./sketch.ts";
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
