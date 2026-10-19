import { test } from "node:test";
import assert from "node:assert/strict";
import { cosine, cosineSets, jaccard, overlap, sketchSimilarity } from "../src/similarity.ts";
import { buildSketch } from "../src/sketch.ts";
import { seededRng } from "../src/rng.ts";
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
