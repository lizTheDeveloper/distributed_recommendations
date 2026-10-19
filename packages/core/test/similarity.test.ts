import { test } from "node:test";
import assert from "node:assert/strict";
import { cosine, cosineSets, jaccard, overlap, sketchSimilarity, tagProfile, tagRelevance } from "../src/similarity.ts";
import { buildSketch } from "../src/sketch.ts";
import { keyedRng, seededRng, sha256 } from "../src/rng.ts";
import { NOW } from "./helpers.ts";

test("jaccard and set cosine", () => {
  const a = ["x", "y", "z", "w"];
  const b = new Set(["y", "z", "q"]);
  assert.equal(overlap(a, b), 2);
  assert.equal(jaccard(a, b), 2 / 5);
  assert.equal(cosineSets(a, b), 2 / Math.sqrt(12));
  assert.equal(jaccard([], []), 0);
  assert.equal(cosineSets([], ["a"]), 0);
  assert.equal(jaccard(a, a), 1);
});

test("weighted cosine", () => {
  const a = new Map([["x", 1], ["y", 2]]);
  const b = new Map([["x", 2], ["y", 4]]);
  assert.ok(Math.abs(cosine(a, b) - 1) < 1e-12);
  assert.equal(cosine(a, new Map([["z", 1]])), 0);
  assert.equal(cosine(new Map(), b), 0);
  assert.ok(Math.abs(cosine(a, new Map([["x", -1], ["y", -2]])) + 1) < 1e-12);
});

test("sketch similarity ignores padding", () => {
  const ids = Array.from({ length: 10 }, (_, i) => `https://tube.example/videos/watch/${i}`);
  const { sketch } = buildSketch(
    ids.map((videoId) => ({ videoId, at: new Date(NOW.getTime() - 3600_000), kind: "endorse" as const })),
    { windowDays: 60, includeFinished: false, excludedTags: [], excludedHours: [], paused: false },
    { epoch: 0 },
    { now: NOW, rng: seededRng(3) },
  );
  assert.equal(sketch.items.length, 64);
  const mine = ids.slice(0, 5);
  assert.equal(sketchSimilarity(mine, sketch), 5 / 10);
  assert.equal(sketchSimilarity(mine, sketch, "cosine"), 5 / Math.sqrt(50));
});

test("tag profile and on-device tag relevance", () => {
  const profile = tagProfile([{ tags: ["Riso", "zine"] }, { tags: ["riso", "riso"] }, { tags: [] }]);
  assert.deepEqual([...profile], [["riso", 2], ["zine", 1]]);
  const rel = tagRelevance(profile);
  assert.ok(rel({ tags: ["riso", "zine"] }) > rel({ tags: ["zine"] }));
  assert.equal(rel({ tags: ["gaming"] }), 0);
  assert.equal(rel({ tags: [] }), 0);
  assert.ok(rel({ tags: ["RISO"] }) <= 1);
  const weighted = tagProfile([{ tags: ["a"] }, { tags: ["b"] }], (v) => (v.tags[0] === "a" ? 3 : 0));
  assert.deepEqual([...weighted], [["a", 3]]);
});

test("sha256 and keyed rng", () => {
  const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  assert.equal(hex(sha256(new TextEncoder().encode("abc"))), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.equal(hex(sha256(new Uint8Array())), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  const a = keyedRng("k", "x");
  const b = keyedRng("k", "x");
  const xs = Array.from({ length: 20 }, () => a());
  assert.deepEqual(xs, Array.from({ length: 20 }, () => b()));
  assert.ok(xs.every((x) => x >= 0 && x < 1));
  assert.notEqual(keyedRng("k", "y")(), xs[0]);
  assert.notEqual(keyedRng("k2", "x")(), xs[0]);
});
