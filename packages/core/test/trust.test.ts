import { test } from "node:test";
import assert from "node:assert/strict";
import { TRUST_WALK_DEFAULTS, secondDegreeScores, tasteListStrength, trustWalk } from "../src/trust.ts";
import type { TrustGraph } from "../src/trust.ts";

function graph(edges: Array<[string, string, number]>): TrustGraph {
  const g = new Map<string, Map<string, number>>();
  for (const [a, b, w] of edges) {
    if (!g.has(a)) g.set(a, new Map());
    g.get(a)!.set(b, w);
  }
  return g;
}

test("trust decays per hop and records distance", () => {
  const g = graph([["me", "a", 1], ["a", "b", 1], ["b", "c", 1]]);
  const t = trustWalk(g, "me", { damping: 0.5, perNodeCap: 1, maxHops: 3 });
  assert.deepEqual(t.get("a"), { trust: 1, hops: 1 });
  assert.deepEqual(t.get("b"), { trust: 0.5, hops: 2 });
  assert.deepEqual(t.get("c"), { trust: 0.25, hops: 3 });
  assert.equal(t.has("me"), false);
  assert.equal(trustWalk(g, "me", { maxHops: 2 }).has("c"), false);
  assert.equal(trustWalk(g, "me").has("c"), false, "default is 2 hops");
});

test("legacy walk: per-node cap bounds what one peer passes on", () => {
  // A hub with huge fan-out can't hand more than cap × damping to its whole fan-out.
  const fan: Array<[string, string, number]> = Array.from({ length: 100 }, (_, i) => ["hub", `s${i}`, 1] as [string, string, number]);
  const g = graph([["me", "hub", 1], ...fan]);
  const t = trustWalk(g, "me", { damping: 0.5, perNodeCap: 0.1, maxHops: 2, normalize: false });
  let total = 0;
  for (const [k, v] of t) if (k !== "hub") total += v.trust;
  assert.ok(Math.abs(total - 0.05) < 1e-12);
});

test("legacy walk: direct matches get their edge weight; later hops split and weak ties pass on less", () => {
  const g = graph([["me", "a", 0.6], ["me", "b", 0.2], ["a", "x", 0.6], ["a", "y", 0.2], ["b", "z", 1], ["b", "w", 1]]);
  const t = trustWalk(g, "me", { damping: 0.5, perNodeCap: 1, normalize: false, maxHops: 3 });
  assert.equal(t.get("a")!.trust, 0.6);
  assert.equal(t.get("b")!.trust, 0.2);
  assert.ok(Math.abs(t.get("x")!.trust - 0.6 * 0.5 * 0.6) < 1e-12);
  assert.ok(Math.abs(t.get("y")!.trust - 0.6 * 0.5 * 0.2) < 1e-12);
  assert.ok(Math.abs(t.get("z")!.trust - (0.2 * 0.5) / 2) < 1e-12);
});

test("only opted-in relays pass trust onward", () => {
  const g = graph([["me", "a", 1], ["me", "b", 1], ["a", "x", 1], ["b", "y", 1]]);
  const t = trustWalk(g, "me", { relays: new Set(["a"]) });
  assert.ok(t.has("x"));
  assert.ok(!t.has("y"));
  assert.ok(t.has("b"));
});

test("cycles back to the seed are ignored", () => {
  const g = graph([["me", "a", 1], ["a", "me", 1], ["a", "b", 1]]);
  const t = trustWalk(g, "me", { perNodeCap: 1 });
  assert.equal(t.has("me"), false);
  assert.equal(t.get("b")!.hops, 2);
});

test("second-degree scores exclude direct matches and cap at 1", () => {
  const g = graph([["me", "a", 1], ["a", "b", 1], ["a", "c", 1]]);
  const t = trustWalk(g, "me", { perNodeCap: 1, damping: 0.9 });
  const scores = secondDegreeScores(
    t,
    new Map([
      ["a", ["v1"]],
      ["b", ["v2", "v2"]],
      ["c", ["v2", "v3"]],
    ]),
  );
  assert.equal(scores.has("v1"), false);
  assert.ok(Math.abs(scores.get("v2")! - 2 * 0.9 * 0.5) < 1e-12);
  assert.ok(scores.get("v2")! <= 1);
  assert.ok(scores.has("v3"));
});

test("defaults follow the simulation: decay 0.3, 2 hops, cap 0.05, normalized", () => {
  assert.deepEqual({ ...TRUST_WALK_DEFAULTS }, { damping: 0.3, maxHops: 2, perNodeCap: 0.05, normalize: true });
});

test("normalized walk: direct matches keep their edge weight; later hops are row-normalized", () => {
  const g = graph([["me", "a", 0.6], ["me", "b", 0.2], ["a", "x", 0.6], ["a", "y", 0.2], ["b", "z", 1], ["b", "w", 1]]);
  const t = trustWalk(g, "me", { perNodeCap: 1 });
  assert.ok(Math.abs(t.get("a")!.trust - 0.6) < 1e-12);
  assert.ok(Math.abs(t.get("b")!.trust - 0.2) < 1e-12);
  // a's row (0.6, 0.2) normalizes to (0.75, 0.25); decay 0.3.
  assert.ok(Math.abs(t.get("x")!.trust - 0.6 * 0.3 * 0.75) < 1e-12);
  assert.ok(Math.abs(t.get("y")!.trust - 0.6 * 0.3 * 0.25) < 1e-12);
  assert.ok(Math.abs(t.get("z")!.trust - 0.2 * 0.3 * 0.5) < 1e-12);
});

test("normalized walk: no node beyond the first hop holds more than 0.05 of the viewer's trust", () => {
  // One strong match fronting 1,000 Sybils, plus a dedicated path to a single node.
  const sybils: Array<[string, string, number]> = Array.from({ length: 1000 }, (_, i) => ["front", `sybil${i}`, 1] as [string, string, number]);
  const g = graph([["me", "front", 1], ["me", "friend", 1], ["friend", "solo", 1], ...sybils]);
  const t = trustWalk(g, "me");
  const seedTotal = 2;
  for (const [k, v] of t) if (v.hops >= 2) assert.ok(v.trust <= 0.05 * seedTotal + 1e-12, k);
  // Without the cap, solo would get 1 · 0.3 = 0.3 (normalized 0.15); the cap holds it at 0.05 of the mass.
  assert.ok(Math.abs(t.get("solo")!.trust - 0.05 * seedTotal) < 1e-12);
  // The fan-out splits: the whole Sybil set together gets no more than the front's decayed trust.
  let sybilTotal = 0;
  for (const [k, v] of t) if (k.startsWith("sybil")) sybilTotal += v.trust;
  assert.ok(sybilTotal > 0 && sybilTotal <= 1 * 0.3 + 1e-9);
});

test("normalized walk: a direct match reached again at hop 2 counts once", () => {
  const g = graph([["me", "a", 0.5], ["me", "b", 0.5], ["a", "b", 1]]);
  const t = trustWalk(g, "me");
  assert.deepEqual(t.get("b"), { trust: 0.5, hops: 1 });
  assert.equal(trustWalk(new Map(), "me").size, 0);
});

test("taste-list strength comes from track record, not subscribers", () => {
  const baseline = { shown: 400, endorsed: 40 };
  assert.equal(tasteListStrength({ shown: 0, endorsed: 0 }, { baseline }), 0.5, "a new list starts at 0.5");
  const good = tasteListStrength({ shown: 50, endorsed: 6 }, { baseline });
  const junk = tasteListStrength({ shown: 50, endorsed: 0 }, { baseline });
  assert.equal(good, 1);
  assert.ok(junk < 0.1, `junk ${junk}`);
  assert.ok(tasteListStrength({ shown: 10, endorsed: 1 }, { baseline }) > 0.5);
  assert.equal(tasteListStrength({ shown: 5, endorsed: 1 }, { baseline: { shown: 0, endorsed: 0 } }), 0.5);
  assert.equal(tasteListStrength({ shown: 5, endorsed: 1 }, { baseline, priorShown: 0, start: 0.2 }), 1);
  assert.equal(tasteListStrength({ shown: 0, endorsed: 0 }, { baseline, priorShown: 0, start: 0.2 }), 0.2);
});

test("rejects bad options", () => {
  assert.throws(() => trustWalk(new Map(), "me", { damping: 1 }), RangeError);
  assert.throws(() => trustWalk(new Map(), "me", { perNodeCap: 0 }), RangeError);
});
