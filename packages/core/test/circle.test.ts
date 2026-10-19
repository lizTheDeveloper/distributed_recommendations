import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_CIRCLE_POLICY,
  circleCandidates,
  circlePicks,
  discreteLaplace,
  parseCirclePolicy,
} from "../src/circle.ts";
import { seededRng } from "../src/rng.ts";
import { ValidationError } from "../src/validate.ts";
import { video } from "./helpers.ts";

test("discrete Laplace noise is symmetric with the right spread", () => {
  const rng = seededRng(42);
  const eps = 1;
  const n = 50_000;
  let sum = 0;
  let zeros = 0;
  for (let i = 0; i < n; i++) {
    const x = discreteLaplace(eps, rng);
    assert.ok(Number.isInteger(x));
    sum += x;
    if (x === 0) zeros++;
  }
  // P(0) = (1 - a) / (1 + a) with a = e^-eps.
  const a = Math.exp(-eps);
  assert.ok(Math.abs(zeros / n - (1 - a) / (1 + a)) < 0.01);
  assert.ok(Math.abs(sum / n) < 0.05);
  assert.throws(() => discreteLaplace(0, rng), RangeError);
});

test("refuses rounds with fewer than 8 present members", () => {
  const sets = Array.from({ length: 9 }, () => ["v"]);
  sets[0] = null as any;
  sets[1] = null as any;
  const r = circlePicks(sets, DEFAULT_CIRCLE_POLICY, seededRng(1));
  assert.deepEqual(r, { ok: false, members: 7, reason: "too-few-members" });
});

test("policy floor of k >= 8 can't be lowered", () => {
  assert.throws(() => parseCirclePolicy({ ...DEFAULT_CIRCLE_POLICY, minMembers: 5 }), ValidationError);
  assert.throws(() => circlePicks([], { ...DEFAULT_CIRCLE_POLICY, minMembers: 3 }, seededRng(1)), ValidationError);
  assert.throws(() => parseCirclePolicy({ ...DEFAULT_CIRCLE_POLICY, revealThreshold: 1 }), ValidationError);
  assert.throws(() => parseCirclePolicy({ ...DEFAULT_CIRCLE_POLICY, extra: true }), ValidationError);
});

test("popular items pass the threshold, singletons rarely do", () => {
  const members = 12;
  const sets = Array.from({ length: members }, (_, m) => {
    const s = ["popular", `own-${m}`];
    if (m < 6) s.push("half");
    return s;
  });
  let popular = 0;
  let half = 0;
  let singles = 0;
  const rounds = 300;
  for (let seed = 0; seed < rounds; seed++) {
    const r = circlePicks(sets, DEFAULT_CIRCLE_POLICY, seededRng(seed));
    assert.ok(r.ok);
    for (const p of r.picks) {
      assert.ok(p.noisedCount >= DEFAULT_CIRCLE_POLICY.revealThreshold);
      assert.ok(p.noisedCount <= members);
      if (p.videoId === "popular") popular++;
      else if (p.videoId === "half") half++;
      else singles++;
    }
  }
  assert.equal(popular, rounds);
  assert.ok(half > rounds * 0.9);
  // 12 singletons per round; P(1 + noise >= 3) ≈ 0.1 at epsilon 1.
  assert.ok(singles / (rounds * members) < 0.15);
});

test("deterministic for a seed; members contribute at most maxItemsPerMember", () => {
  const sets = Array.from({ length: 10 }, () => Array.from({ length: 100 }, (_, i) => `v${String(i).padStart(3, "0")}`));
  const policy = { ...DEFAULT_CIRCLE_POLICY, maxItemsPerMember: 5 };
  const a = circlePicks(sets, policy, seededRng(5));
  const b = circlePicks(sets, policy, seededRng(5));
  assert.deepEqual(a, b);
  assert.ok(a.ok);
  for (const p of a.picks) assert.ok(["v000", "v001", "v002", "v003", "v004"].includes(p.videoId));
});

test("circle candidates name the circle, not members", () => {
  const v = video(1);
  const sets = Array.from({ length: 10 }, () => [v.id]);
  const r = circlePicks(sets, DEFAULT_CIRCLE_POLICY, seededRng(1));
  const cs = circleCandidates(r, "Riso people", new Map([[v.id, v]]));
  assert.equal(cs.length, 1);
  assert.equal(cs[0].source.kind, "circle");
  assert.equal(cs[0].source.via, "Riso people (10 members)");
  assert.ok(cs[0].source.strength! > 0 && cs[0].source.strength! <= 1);
  assert.deepEqual(circleCandidates({ ok: false, members: 3, reason: "too-few-members" }, "x", new Map()), []);
});
