// Second-degree trust: a personalized, decaying trust walk seeded from you.
//
// This is personalized PageRank (Haveliwala, WWW 2002) truncated to a few hops, in
// the spirit of TrustWalker (Jamali & Ester, KDD 2009) and MeritRank (Nasrulin et
// al., arXiv:2207.09950): trust starts at the viewer, decays by `damping` at every
// further hop, splits across a node's outgoing edges in proportion to their weights
// (row normalization), and no node beyond the first hop may hold more than
// `perNodeCap` of the viewer's trust mass, so one well-connected (or Sybil-fronting)
// peer can't relay unbounded influence. Defaults follow docs/SIMULATION_RESULTS.md,
// Exp 5 (P1): damping 0.3, 2 hops, cap 0.05. Unlike
// EigenTrust there is no global score and no pre-trusted set; every viewer computes
// their own. See DESIGN.md, "Second degree" and THREAT_MODEL.md, T7.
//
// The walk is computed exactly (hop-by-hop mass propagation), not by Monte Carlo,
// so it is deterministic.

/** Directed, weighted graph of opted-in match edges: node → (neighbor → weight in [0, 1]). */
export type TrustGraph = ReadonlyMap<string, ReadonlyMap<string, number>>;

export interface TrustWalkOptions {
  /** Multiplier applied at every hop after the first, in (0, 1). Default 0.3. */
  damping?: number;
  /** Hops to walk. Default 2 (direct matches and their matches). */
  maxHops?: number;
  /**
   * Per-node cap. Normalized walk (default): the most trust any node beyond the first
   * hop may hold, as a share of the viewer's total trust mass. Default 0.05.
   * Legacy walk (`normalize: false`): the most trust a non-seed node may pass on per
   * hop, in absolute terms.
   */
  perNodeCap?: number;
  /**
   * Row-normalize the walk (default true): every node splits the trust it passes on
   * in proportion to its edge weights, so a peer with many matches can't multiply
   * its influence, and the cap is a share of your own trust mass. Results are
   * reported on the scale of your direct edges: a direct match's trust is its edge
   * weight, as in the legacy walk. `false` restores the pre-simulation walk (no
   * normalization of your own edges; others' totals below 1 are not scaled up).
   */
  normalize?: boolean;
  /**
   * Nodes that opted in to relaying their matches' picks. Only these can pass trust
   * onward; anyone may still receive it. Omit to let every node relay.
   */
  relays?: ReadonlySet<string>;
}

/**
 * Defaults from docs/SIMULATION_RESULTS.md, Exp 5 (policy P1): decay 0.3, two hops,
 * per-node cap 0.05 of the viewer's trust mass, row-normalized. With these, 200
 * attack edges reached 0–3 bystanders, against 779 under naive 3-hop path counting.
 */
export const TRUST_WALK_DEFAULTS = {
  damping: 0.3,
  maxHops: 2,
  perNodeCap: 0.05,
  normalize: true,
} as const;

export interface TrustScore {
  /** Accumulated trust, summed over all hops. */
  trust: number;
  /** Fewest hops from the seed. */
  hops: number;
}

function edgeWeight(w: number): number {
  return w > 0 && Number.isFinite(w) ? Math.min(1, w) : 0;
}

/** Run the decaying trust walk from `seed`. The seed itself is not in the result. */
export function trustWalk(graph: TrustGraph, seed: string, opts: TrustWalkOptions = {}): Map<string, TrustScore> {
  const damping = opts.damping ?? TRUST_WALK_DEFAULTS.damping;
  const maxHops = opts.maxHops ?? TRUST_WALK_DEFAULTS.maxHops;
  const cap = opts.perNodeCap ?? TRUST_WALK_DEFAULTS.perNodeCap;
  const normalize = opts.normalize ?? TRUST_WALK_DEFAULTS.normalize;
  if (!(damping > 0 && damping < 1)) throw new RangeError("damping must be in (0, 1)");
  if (!(cap > 0)) throw new RangeError("perNodeCap must be positive");
  return normalize ? normalizedWalk(graph, seed, damping, maxHops, cap, opts.relays) : legacyWalk(graph, seed, damping, maxHops, cap, opts.relays);
}

// Exp 5's P1: T = W[seed] + min(cap, damping · W[seed] · W_relay), with W the
// row-normalized edge matrix, extended hop by hop. Computed on the normalized scale
// (the seed's total mass is 1), then reported × the seed's total edge weight so a
// direct match's trust equals its edge weight.
function normalizedWalk(
  graph: TrustGraph,
  seed: string,
  damping: number,
  maxHops: number,
  cap: number,
  relays: ReadonlySet<string> | undefined,
): Map<string, TrustScore> {
  const out = new Map<string, TrustScore>();
  let seedTotal = 0;
  for (const [to, w] of graph.get(seed) ?? []) if (to !== seed) seedTotal += edgeWeight(w);
  if (seedTotal === 0) return out;
  const mass = new Map<string, { trust: number; hops: number }>();
  let frontier = new Map<string, number>([[seed, 1]]);
  for (let hop = 1; hop <= maxHops && frontier.size > 0; hop++) {
    const next = new Map<string, number>();
    for (const [node, m] of frontier) {
      if (node !== seed && relays && !relays.has(node)) continue;
      const edges = graph.get(node);
      if (!edges) continue;
      let total = 0;
      for (const [to, w] of edges) if (to !== seed) total += edgeWeight(w);
      if (total === 0) continue;
      const outMass = node === seed ? 1 : m * damping;
      for (const [to, w] of edges) {
        const ew = edgeWeight(w);
        if (to === seed || ew === 0) continue;
        next.set(to, (next.get(to) ?? 0) + (outMass * ew) / total);
      }
    }
    const frontierNext = new Map<string, number>();
    for (const [node, m] of next) {
      const prev = mass.get(node);
      // Direct matches count once (their first-hop trust); they don't collect more.
      if (prev && prev.hops === 1) continue;
      let add = m;
      if (hop >= 2) add = Math.min(add, cap - (prev?.trust ?? 0));
      if (add <= 0) continue;
      mass.set(node, prev ? { trust: prev.trust + add, hops: prev.hops } : { trust: add, hops: hop });
      frontierNext.set(node, add);
    }
    frontier = frontierNext;
  }
  for (const [node, { trust, hops }] of mass) out.set(node, { trust: trust * seedTotal, hops });
  return out;
}

// The walk as it was before the simulation results (kept for `normalize: false`).
function legacyWalk(
  graph: TrustGraph,
  seed: string,
  damping: number,
  maxHops: number,
  cap: number,
  relays: ReadonlySet<string> | undefined,
): Map<string, TrustScore> {
  const out = new Map<string, TrustScore>();
  let frontier = new Map<string, number>([[seed, 1]]);
  for (let hop = 1; hop <= maxHops && frontier.size > 0; hop++) {
    const next = new Map<string, number>();
    for (const [node, mass] of frontier) {
      if (node !== seed && relays && !relays.has(node)) continue;
      const edges = graph.get(node);
      if (!edges) continue;
      let total = 0;
      for (const w of edges.values()) total += edgeWeight(w);
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

/** What a viewer's device has observed about one subscribed taste list. */
export interface TrackRecord {
  /** Items from this list the viewer was shown. */
  shown: number;
  /** Of those, how many the viewer endorsed. */
  endorsed: number;
}

export interface TrackRecordOptions {
  /** The viewer's endorse rate across all shown feed items: the bar a list must meet. */
  baseline: TrackRecord;
  /** Pseudo-observations pulling a young list toward `start`. Default 10. */
  priorShown?: number;
  /** Strength of a list with no record yet, in [0, 1]. Default 0.5. */
  start?: number;
}

/**
 * Taste-list strength from its track record with this viewer, in [0, 1]: the list's
 * smoothed endorse rate relative to the viewer's baseline, clamped. Use it as the
 * `strength` of the list's `taste` candidates. docs/SIMULATION_RESULTS.md, Exp 5
 * (P2): weighting lists by track record rather than subscriber count stops Sybils
 * from inflating a list with fake subscribers.
 */
export function tasteListStrength(record: TrackRecord, opts: TrackRecordOptions): number {
  const priorShown = Math.max(0, opts.priorShown ?? 10);
  const start = Math.min(1, Math.max(0, opts.start ?? 0.5));
  const nonNeg = (x: number) => (Number.isFinite(x) && x > 0 ? x : 0);
  const bShown = nonNeg(opts.baseline.shown);
  const bRate = bShown > 0 ? Math.min(bShown, nonNeg(opts.baseline.endorsed)) / bShown : 0;
  if (!(bRate > 0)) return start;
  const shown = nonNeg(record.shown);
  const endorsed = Math.min(shown, nonNeg(record.endorsed));
  if (shown + priorShown <= 0) return start;
  const rate = (endorsed + priorShown * start * bRate) / (shown + priorShown);
  return Math.min(1, Math.max(0, rate / bRate));
}
