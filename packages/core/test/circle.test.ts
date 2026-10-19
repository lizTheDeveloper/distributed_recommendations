import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CIRCLE_PICK_STRENGTH,
  CIRCLE_RECOMMENDED_SIZE,
  DEFAULT_CIRCLE_POLICY,
  circleCandidates,
  circleMembershipId,
  circlePicks,
  discreteLaplace,
  emptyCircleLedger,
  parseCirclePolicy,
  releaseCircleEpoch,
  revealThresholdFor,
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
      assert.deepEqual(Object.keys(p), ["videoId"], "picks only, never counts");
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
  assert.equal(cs[0].source.strength, CIRCLE_PICK_STRENGTH, "every pick is equally strong: no counts");
  assert.equal(circleCandidates(r, "Riso people", new Map([[v.id, v]]), 0.8)[0].source.strength, 0.8);
  assert.deepEqual(circleCandidates({ ok: false, members: 3, reason: "too-few-members" }, "x", new Map()), []);
});

test("reveal threshold: 3 for k = 8–15, 4 for k ≥ 16, derived when not given", () => {
  assert.equal(DEFAULT_CIRCLE_POLICY.revealThreshold, undefined);
  assert.equal(DEFAULT_CIRCLE_POLICY.epsilon, 1);
  assert.deepEqual({ ...CIRCLE_RECOMMENDED_SIZE }, { min: 12, max: 30 });
  for (const k of [8, 12, 15]) assert.equal(revealThresholdFor(k), 3);
  for (const k of [16, 20, 30, 50]) assert.equal(revealThresholdFor(k), 4);
  assert.deepEqual(parseCirclePolicy(DEFAULT_CIRCLE_POLICY), DEFAULT_CIRCLE_POLICY);
  assert.equal(parseCirclePolicy({ ...DEFAULT_CIRCLE_POLICY, revealThreshold: 5 }).revealThreshold, 5);
  // An item exactly 3 members endorse, with zero noise: shown at k = 12, not at k = 20.
  const zeroNoise = () => 0.5; // geometric(0.5) - geometric(0.5) = 0
  const sets = (k: number) => Array.from({ length: k }, (_, m) => (m < 3 ? ["three"] : [`own${m}`]));
  const at12 = circlePicks(sets(12), DEFAULT_CIRCLE_POLICY, zeroNoise);
  const at20 = circlePicks(sets(20), DEFAULT_CIRCLE_POLICY, zeroNoise);
  assert.ok(at12.ok && at12.picks.some((p) => p.videoId === "three"));
  assert.ok(at20.ok && !at20.picks.some((p) => p.videoId === "three"));
  // An explicit threshold overrides the derived one.
  const explicit = circlePicks(sets(20), { ...DEFAULT_CIRCLE_POLICY, revealThreshold: 3 }, zeroNoise);
  assert.ok(explicit.ok && explicit.picks.some((p) => p.videoId === "three"));
});

test("picks are sorted by id, so their order carries no count information", () => {
  const sets = Array.from({ length: 12 }, (_, m) => ["zz-everyone", ...(m < 8 ? ["aa-most"] : []), ...(m < 5 ? ["mm-some"] : [])]);
  const r = circlePicks(sets, DEFAULT_CIRCLE_POLICY, seededRng(9));
  assert.ok(r.ok);
  const ids = r.picks.map((p) => p.videoId);
  assert.deepEqual(ids, [...ids].sort());
});

test("sticky noise: the same seed gives the same draw per item, whatever else changes", () => {
  const base = Array.from({ length: 12 }, (_, m) => [`v${m % 4}`, "shared"]);
  const a = circlePicks(base, DEFAULT_CIRCLE_POLICY, seededRng(1), { noiseSeed: "epoch-secret" });
  // Different rng, and an extra unrelated item: per-item noise is unchanged.
  const b = circlePicks(base.map((s) => [...s, "extra"]), DEFAULT_CIRCLE_POLICY, seededRng(99), { noiseSeed: "epoch-secret" });
  assert.ok(a.ok && b.ok);
  assert.deepEqual(a.picks, b.picks.filter((p) => p.videoId !== "extra"));
  // Averaging repeated releases learns nothing: 50 releases are all identical.
  const singleton = Array.from({ length: 12 }, (_, m) => (m === 0 ? ["target-item"] : []));
  const outcomes = new Set<boolean>();
  for (let i = 0; i < 50; i++) {
    const r = circlePicks(singleton, DEFAULT_CIRCLE_POLICY, seededRng(i), { noiseSeed: "s" });
    assert.ok(r.ok);
    outcomes.add(r.picks.length > 0);
  }
  assert.equal(outcomes.size, 1);
  // A different seed (another epoch) draws fresh noise.
  let differs = false;
  for (let e = 0; e < 40 && !differs; e++) {
    const x = circlePicks(singleton, DEFAULT_CIRCLE_POLICY, seededRng(0), { noiseSeed: `e${e}` });
    differs = x.ok && (x.picks.length > 0) !== outcomes.has(true);
  }
  assert.ok(differs);
});

test("epoch freeze: an epoch is released once and never recomputed with a different membership", () => {
  const members = Array.from({ length: 12 }, (_, i) => `m${i}`);
  const contributions = new Map(members.map((m, i) => [m, ["popular", ...(i < 6 ? ["half"] : []), `own-${m}`]]));
  let ledger = emptyCircleLedger();
  const first = releaseCircleEpoch(ledger, { epoch: 4, members, noiseSeed: "secret", contributions });
  assert.ok(first.ok && !first.frozen);
  ledger = first.ledger;
  assert.equal(ledger.epochs.length, 1);
  assert.equal(ledger.epochs[0].membership, circleMembershipId(members));
  assert.ok(first.result.ok && first.result.picks.some((p) => p.videoId === "popular"));

  // m0 leaves; someone asks for epoch 4 again with the new membership: frozen output.
  const left = members.slice(1);
  const again = releaseCircleEpoch(ledger, { epoch: 4, members: left, noiseSeed: "secret", contributions });
  assert.ok(again.ok && again.frozen);
  assert.deepEqual(again.result, first.result);
  assert.equal(again.ledger, ledger, "ledger unchanged");

  // The next epoch evaluates only new endorsements and never re-releases old picks.
  const next = releaseCircleEpoch(ledger, {
    epoch: 5,
    members: left,
    noiseSeed: "secret",
    contributions: new Map(left.map((m) => [m, ["popular", "fresh"]])),
  });
  assert.ok(next.ok && !next.frozen && next.result.ok);
  assert.ok(!next.result.picks.some((p) => p.videoId === "popular"));
  assert.ok(next.result.picks.some((p) => p.videoId === "fresh"));
  ledger = next.ledger;

  // Going back to an epoch older than the newest released one is refused.
  assert.deepEqual(releaseCircleEpoch(ledger, { epoch: 3, members, noiseSeed: "secret", contributions }), {
    ok: false,
    reason: "stale-epoch",
  });
  // Non-members' contributions are ignored; too few members means no output.
  const few = releaseCircleEpoch(ledger, {
    epoch: 6,
    members: members.slice(0, 7),
    noiseSeed: "secret",
    contributions: new Map([...contributions, ["outsider", ["x"]]]),
  });
  assert.ok(few.ok && !few.result.ok && few.result.members === 7);
  assert.throws(() => releaseCircleEpoch(ledger, { epoch: -1, members, noiseSeed: "s", contributions }), RangeError);
});

test("epoch release is deterministic in the seed and does not use an rng", () => {
  const members = Array.from({ length: 10 }, (_, i) => `m${i}`);
  const contributions = new Map(members.map((m, i) => [m, [`v${i % 3}`, `w${i % 5}`]]));
  const a = releaseCircleEpoch(emptyCircleLedger(), { epoch: 1, members, noiseSeed: "k", contributions });
  const b = releaseCircleEpoch(emptyCircleLedger(), { epoch: 1, members: [...members].reverse(), noiseSeed: "k", contributions });
  assert.ok(a.ok && b.ok);
  assert.deepEqual(a.result, b.result);
});
