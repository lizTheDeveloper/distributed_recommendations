import assert from "node:assert/strict";
import { test } from "node:test";
import { FIELD128_MODULUS, centered, collectorSideNoise, parseCollectOutput, postprocess, publishable } from "../src/collect.ts";
import { seededRng } from "../src/core.ts";

const neg = (k: number) => (FIELD128_MODULUS - BigInt(k)).toString();

test("centered maps wrapped negatives back", () => {
  assert.equal(centered("16"), 16n);
  assert.equal(centered(neg(3)), -3n);
  // Real output observed from Janus 0.7.143 with dp_strategy PureDpDiscreteLaplace.
  assert.equal(centered("340282366920938462946865773367900766206"), -3n);
  assert.throws(() => centered(FIELD128_MODULUS));
  assert.throws(() => centered(-1n));
});

test("counts under 20 are shown as <20 and get no share", () => {
  const s = postprocess({ aggregate: ["45", "25", neg(2), "19", "0", "20", "3", "1"], reportCount: 113 });
  assert.equal(s.suppressed, false);
  assert.deepEqual(s.channels.map((c) => c.display), ["45", "25", "<20", "<20", "<20", "20", "<20", "<20"]);
  assert.deepEqual(s.channels.filter((c) => c.count === null).map((c) => c.share), [null, null, null, null, null]);
  const total = 45 + 25 + 0 + 19 + 0 + 20 + 3 + 1;
  assert.equal(s.channels[0]!.share, 45 / total);
});

test("a batch under 20 reports shows nothing", () => {
  const s = postprocess({ aggregate: ["15", "0", "0", "0", "0", "0", "0", "0"], reportCount: 15 });
  assert.equal(s.suppressed, true);
  assert.equal(s.reportCountDisplay, "<20");
  assert.ok(s.channels.every((c) => c.display === "<20" && c.share === null && c.count === null));
});

test("the threshold cannot be lowered; length must be 8", () => {
  assert.throws(() => postprocess({ aggregate: Array(8).fill("0"), reportCount: 30, threshold: 5 }));
  assert.throws(() => postprocess({ aggregate: Array(7).fill("0"), reportCount: 30 }));
});

test("publishable keeps only displayed values", () => {
  const p = publishable(postprocess({ aggregate: ["45", "25", "2", "19", "0", "20", "3", "1"], reportCount: 115 }));
  assert.equal(p.reportCount, "115");
  assert.deepEqual(p.channels[2], { channel: "match", value: "<20", share: null });
  assert.equal(JSON.stringify(p).includes("19"), false);
});

test("parse Janus collect output", () => {
  const out = `Number of reports: 31\nInterval start: 2026-08-27 00:00:00 UTC\nInterval end: ...\nInterval length: 2419200s\nAggregation result: [12, ${neg(1)}, 3, 0, 0, 9, 2, 5]\n`;
  const r = parseCollectOutput(out);
  assert.equal(r.reportCount, 31);
  assert.equal(r.aggregate.length, 8);
  assert.equal(centered(r.aggregate[1]!), -1n);
  assert.throws(() => parseCollectOutput("garbage"));
});

test("collector-side fallback noise is centred and scaled by epsilon", () => {
  const rng = seededRng(7);
  const n = 20000;
  const draws = collectorSideNoise(Array(n).fill(100), 1, rng).map((x) => x - 100);
  const mean = draws.reduce((a, b) => a + b, 0) / n;
  const meanAbs = draws.reduce((a, b) => a + Math.abs(b), 0) / n;
  assert.ok(Math.abs(mean) < 0.2, `mean ${mean}`);
  // discrete Laplace with eps/sensitivity = 0.5: E|X| ~ 2
  assert.ok(meanAbs > 1.5 && meanAbs < 2.6, `E|X| ${meanAbs}`);
  assert.throws(() => collectorSideNoise([1], 0, rng));
});
