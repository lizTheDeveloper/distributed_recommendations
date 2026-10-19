// Second-degree trust: a personalized, decaying trust walk seeded from you.
//
// This is personalized PageRank (Haveliwala, WWW 2002) truncated to a few hops, in
// the spirit of TrustWalker (Jamali & Ester, KDD 2009) and MeritRank (Nasrulin et
// al., arXiv:2207.09950): trust starts at the viewer (a direct match gets its edge
// weight), decays by `damping` at every further hop, splits across a node's outgoing
// edges in proportion to their weights, and
// each intermediate node may pass on at most `perNodeCap` of trust, so one
// well-connected (or Sybil-fronting) peer can't relay unbounded influence. Unlike
// EigenTrust there is no global score and no pre-trusted set; every viewer computes
// their own. See DESIGN.md, "Second degree" and THREAT_MODEL.md, T7.
//
// The walk is computed exactly (hop-by-hop mass propagation), not by Monte Carlo,
// so it is deterministic.

/** Directed, weighted graph of opted-in match edges: node → (neighbor → weight in [0, 1]). */
export type TrustGraph = ReadonlyMap<string, ReadonlyMap<string, number>>;

export interface TrustWalkOptions {
  /** Multiplier applied at every hop after the first, in (0, 1). Default 0.5. */
  damping?: number;
  /** Hops to walk. Default 3. */
  maxHops?: number;
  /** Most trust any node other than the seed may pass on, per hop. Default 0.5. */
  perNodeCap?: number;
  /**
   * Nodes that opted in to relaying their matches' picks. Only these can pass trust
   * onward; anyone may still receive it. Omit to let every node relay.
   */
  relays?: ReadonlySet<string>;
}

export interface TrustScore {
  /** Accumulated trust, summed over all hops. */
  trust: number;
  /** Fewest hops from the seed. */
  hops: number;
}

/** Run the decaying trust walk from `seed`. The seed itself is not in the result. */
export function trustWalk(graph: TrustGraph, seed: string, opts: TrustWalkOptions = {}): Map<string, TrustScore> {
  const damping = opts.damping ?? 0.5;
  const maxHops = opts.maxHops ?? 3;
  const cap = opts.perNodeCap ?? 0.5;
  if (!(damping > 0 && damping < 1)) throw new RangeError("damping must be in (0, 1)");
  if (!(cap > 0)) throw new RangeError("perNodeCap must be positive");

  const out = new Map<string, TrustScore>();
  let frontier = new Map<string, number>([[seed, 1]]);
  for (let hop = 1; hop <= maxHops && frontier.size > 0; hop++) {
    const next = new Map<string, number>();
    for (const [node, mass] of frontier) {
      if (node !== seed && opts.relays && !opts.relays.has(node)) continue;
      const edges = graph.get(node);
      if (!edges) continue;
      let total = 0;
      for (const w of edges.values()) if (w > 0 && Number.isFinite(w)) total += Math.min(1, w);
      if (total === 0) continue;
      // Hop 1: a direct match's trust is its own edge weight (its similarity to you).
      // Later hops: decay, cap, and split; weights below 1 in total are not scaled
      // up, so weak ties pass on less.
      const isSeed = node === seed;
      const outMass = isSeed ? 1 : Math.min(mass, cap) * damping;
      const norm = isSeed ? 1 : Math.max(1, total);
      for (const [to, w] of edges) {
        if (to === seed || !(w > 0) || !Number.isFinite(w)) continue;
        next.set(to, (next.get(to) ?? 0) + (outMass * Math.min(1, w)) / norm);
      }
    }
    for (const [node, mass] of next) {
      const prev = out.get(node);
      out.set(node, prev ? { trust: prev.trust + mass, hops: prev.hops } : { trust: mass, hops: hop });
    }
    frontier = next;
  }
  return out;
}

/**
 * Score videos endorsed by people two or more hops out. Each video's score is the
 * sum of its endorsers' trust, capped at 1. Direct matches (1 hop) are excluded:
 * they arrive as `match` candidates instead.
 */
export function secondDegreeScores(
  walk: ReadonlyMap<string, TrustScore>,
  endorsements: ReadonlyMap<string, Iterable<string>>,
  minHops = 2,
): Map<string, number> {
  const scores = new Map<string, number>();
  for (const [node, ids] of endorsements) {
    const t = walk.get(node);
    if (!t || t.hops < minHops) continue;
    for (const id of new Set(ids)) scores.set(id, Math.min(1, (scores.get(id) ?? 0) + t.trust));
  }
  return scores;
}
