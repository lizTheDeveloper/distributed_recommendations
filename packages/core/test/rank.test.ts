import { test } from "node:test";
import assert from "node:assert/strict";
import { rank } from "../src/rank.ts";
import { DEFAULT_RECIPE, FOLLOWING_CHRONOLOGICAL_RECIPE, parseRecipe, recipeToJson } from "../src/recipe.ts";
import { seededRng } from "../src/rng.ts";
import { tagProfile, tagRelevance } from "../src/similarity.ts";
import type { Recipe } from "../src/recipe.ts";
import { NOW, cand, video } from "./helpers.ts";

const opts = (extra = {}) => ({ now: NOW, limit: 20, rng: seededRng(1), ...extra });

function recipe(patch: Record<string, unknown>): Recipe {
  return parseRecipe({ ...recipeToJson(DEFAULT_RECIPE), ...patch });
}

test("merges duplicate videos and sums contributions", () => {
  const v = video(1);
  const out = rank(
    [cand(v, "match", "Ines Okafor", 0.64), cand(v, "match", "Theo Brandt", 0.51), cand(video(2), "match", "Theo Brandt", 0.51)],
    DEFAULT_RECIPE,
    opts(),
  );
  assert.equal(out.length, 2);
  assert.equal(out[0].video.id, v.id);
  assert.equal(out[0].primary, "match");
  assert.ok(Math.abs(out[0].score - out[1].score * (1.15 / 0.51)) < 1e-9);
  assert.deepEqual(out[0].why, [
    "Ines Okafor endorsed it (overlap 0.64)",
    "Theo Brandt also endorsed it (0.51)",
    "Score: 0.64 + 0.51 = 1.15",
  ]);
});

test("same source twice counts once", () => {
  const v = video(1);
  const once = rank([cand(v, "match", "Ines", 0.5)], DEFAULT_RECIPE, opts());
  const twice = rank([cand(v, "match", "Ines", 0.5), cand(v, "match", "Ines", 0.4)], DEFAULT_RECIPE, opts());
  assert.equal(once[0].score, twice[0].score);
});

test("recency decay halves the score per half-life", () => {
  const r = recipe({ recencyHalfLifeDays: 10, exploreShare: 0 });
  const [a] = rank([cand(video(1, { ageDays: 0 }), "follow")], r, opts());
  const [b] = rank([cand(video(2, { ageDays: 10 }), "follow")], r, opts());
  assert.ok(Math.abs(b.score - a.score / 2) < 1e-9);
});

test("primary kind is the largest contributor", () => {
  const v = video(1, { creatorName: "Hand & Hearth" });
  const [item] = rank([cand(v, "follow"), cand(v, "match", "Ines", 0.2)], DEFAULT_RECIPE, opts());
  assert.equal(item.primary, "follow");
  assert.equal(item.why[0], "You follow Hand & Hearth");
  assert.equal(item.why[1], "Posted yesterday");
  assert.equal(item.why[2], "Ines endorsed it (overlap 0.20)");
});

test("applies filters and seen", () => {
  const r = recipe({
    exploreShare: 0,
    filters: {
      excludeTags: ["health"],
      includeLanguages: ["en"],
      minDurationSec: 60,
      maxDurationSec: 3600,
      excludeCreators: ["creator5@tube.example"],
    },
  });
  const vs = [
    video(1),
    video(2, { tags: ["Health"] }),
    video(3, { language: "de" }),
    video(4, { durationSec: 30 }),
    video(5),
    video(6, { durationSec: 4000 }),
    video(7, { language: "en-GB" }),
    video(8),
  ];
  const out = rank(vs.map((v) => cand(v, "follow")), r, opts({ seen: new Set([vs[7].id]) }));
  assert.deepEqual(out.map((i) => i.video.id).sort(), [vs[0].id, vs[6].id].sort());
});

test("per-creator cap", () => {
  const vs = [1, 2, 3, 4].map((n) => video(n, { creator: "same@tube.example", ageDays: n }));
  const out = rank(vs.map((v) => cand(v, "follow")), DEFAULT_RECIPE, opts());
  assert.equal(out.length, DEFAULT_RECIPE.maxPerCreator);
  assert.deepEqual(out.map((i) => i.video.id), [vs[0].id, vs[1].id]);
});

test("following-only recipe is chronological and drops other sources", () => {
  const vs = [5, 1, 30, 2].map((age, i) => video(i, { ageDays: age }));
  const out = rank(
    [...vs.map((v) => cand(v, "follow")), cand(video(9), "match", "Ines", 1), cand(video(10, { ageDays: 0 }), "explore")],
    FOLLOWING_CHRONOLOGICAL_RECIPE,
    opts(),
  );
  assert.deepEqual(
    out.map((i) => i.video.id),
    [vs[1], vs[3], vs[0], vs[2]].map((v) => v.id),
  );
});

test("explore slots at a fixed cadence, competing only with each other", () => {
  const regular = Array.from({ length: 30 }, (_, i) => cand(video(`r${i}`, { ageDays: 0.1 * i }), "follow"));
  const explore = Array.from({ length: 10 }, (_, i) => cand(video(`e${i}`, { ageDays: i }), "explore"));
  const out = rank([...regular, ...explore], recipe({ exploreShare: 0.1 }), opts({ limit: 30 }));
  assert.equal(out.length, 30);
  const positions = out.flatMap((item, i) => (item.primary === "explore" ? [i] : []));
  assert.deepEqual(positions, [5, 15, 25]);
  // The default 5% share: one slot per 20, at position 10.
  const def = rank([...regular, ...explore], DEFAULT_RECIPE, opts({ limit: 30 }));
  assert.deepEqual(def.flatMap((item, i) => (item.primary === "explore" ? [i] : [])), [10]);
  for (const p of positions) {
    assert.match(out[p].why[0], /^New-creator slot: uploaded (this week|\d+ days ago) by a creator you have no tie to$/);
    assert.equal(out[p].why[1], "Not personalized");
  }
  // Regular items keep their own order around the explore slots.
  const reg = out.filter((i) => i.primary !== "explore").map((i) => i.video.id);
  assert.deepEqual(reg, regular.slice(0, 27).map((c) => c.video.id));
});

test("explore is deterministic given the rng, and varies with the seed", () => {
  const regular = Array.from({ length: 20 }, (_, i) => cand(video(`r${i}`), "follow"));
  const explore = Array.from({ length: 12 }, (_, i) => cand(video(`e${i}`, { ageDays: i / 2 }), "explore"));
  const pick = (seed: number) =>
    rank([...regular, ...explore], DEFAULT_RECIPE, opts({ rng: seededRng(seed) }))
      .filter((i) => i.primary === "explore")
      .map((i) => i.video.id);
  assert.deepEqual(pick(7), pick(7));
  const seen = new Set<string>();
  for (let s = 0; s < 20; s++) for (const id of pick(s)) seen.add(id);
  assert.ok(seen.size > 2, "different seeds pick different explore items");
});

test("explore excludes followed creators, stale uploads and videos with ties", () => {
  const followed = video(1, { creator: "known@tube.example" });
  const sameCreator = video(2, { creator: "known@tube.example" });
  const stale = video(3, { ageDays: 40 });
  const tied = video(4);
  const fresh = video(5);
  const out = rank(
    [cand(followed, "follow"), cand(sameCreator, "explore"), cand(stale, "explore"), cand(tied, "explore"), cand(tied, "match", "Ines", 0.5), cand(fresh, "explore")],
    DEFAULT_RECIPE,
    opts(),
  );
  const explore = out.filter((i) => i.primary === "explore").map((i) => i.video.id);
  assert.deepEqual(explore, [fresh.id]);
  assert.equal(out.find((i) => i.video.id === tied.id)?.primary, "match");
});

test("explore off when share or weight is 0", () => {
  const cs = [cand(video(1), "follow"), cand(video(2), "explore")];
  assert.equal(rank(cs, recipe({ exploreShare: 0 }), opts()).length, 1);
  assert.equal(rank(cs, recipe({ weights: { ...DEFAULT_RECIPE.weights, explore: 0 } }), opts()).length, 1);
  assert.equal(rank(cs, DEFAULT_RECIPE, opts()).length, 2);
});

test("second-degree and circle explanations never name a person", () => {
  const v1 = video(1);
  const v2 = video(2);
  const out = rank(
    [cand(v1, "second", "Mallory Secret", 0.3), cand(v2, "circle", "Riso people (12 members)", 0.5)],
    DEFAULT_RECIPE,
    opts(),
  );
  const second = out.find((i) => i.primary === "second")!;
  assert.ok(second.why.every((w) => !w.includes("Mallory")));
  assert.deepEqual(second.why, ["Endorsed two or more steps out in your trust network", "Weight ×0.30, decaying with each step; source not named"]);
  const circle = out.find((i) => i.primary === "circle")!;
  assert.equal(circle.why[0], "Picked by several people in Riso people (12 members)");
});

test("ignores malformed candidates and clamps strength", () => {
  const good = video(1);
  const out = rank(
    [
      cand(good, "match", "Ines", 5),
      { video: { ...video(2), publishedAt: new Date("nope") }, source: { kind: "follow" } },
      { video: video(3), source: { kind: "bogus" as any } },
      cand(video(4), "match", "X", NaN),
    ],
    DEFAULT_RECIPE,
    opts(),
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].score, DEFAULT_RECIPE.weights.match * Math.pow(0.5, 1 / 14));
});

test("limit is respected", () => {
  const cs = Array.from({ length: 50 }, (_, i) => cand(video(i), "follow"));
  assert.equal(rank(cs, DEFAULT_RECIPE, opts({ limit: 7 })).length, 7);
  assert.equal(rank(cs, DEFAULT_RECIPE, opts({ limit: 0 })).length, 0);
});

test("explore is relevance-ranked when a scorer is given, with seeded tie-breaking", () => {
  const r = recipe({ exploreShare: 0.1 });
  const regular = Array.from({ length: 30 }, (_, i) => cand(video(`r${i}`), "follow"));
  // 20 explore candidates; only e3, e7 and e11 match the viewer's tags.
  const explore = Array.from({ length: 20 }, (_, i) =>
    cand(video(`e${i}`, { ageDays: i / 4, tags: [3, 7, 11].includes(i) ? ["riso", "zine"] : ["gaming"] }), "explore"),
  );
  const profile = tagProfile([{ tags: ["Riso", "zine"] }, { tags: ["riso", "printing"] }]);
  const pick = (seed: number) =>
    rank([...regular, ...explore], r, opts({ limit: 30, rng: seededRng(seed), exploreRelevance: tagRelevance(profile) }))
      .filter((i) => i.primary === "explore");
  for (let seed = 0; seed < 10; seed++) {
    const got = pick(seed);
    assert.deepEqual(got.map((i) => i.video.id).sort(), [3, 7, 11].map((n) => video(`e${n}`).id).sort());
    assert.equal(got[0].why[1], "Picked on this device for how well it fits what you watch; nothing was sent");
  }
  // Tie-breaking among equally relevant items follows the seed, deterministically.
  assert.deepEqual(pick(4).map((i) => i.video.id), pick(4).map((i) => i.video.id));
  const firsts = new Set<string>();
  for (let seed = 0; seed < 20; seed++) firsts.add(pick(seed)[0].video.id);
  assert.ok(firsts.size > 1, "ties broken by the seeded rng");
});

test("explore source strength works as relevance; no signal falls back to the seeded newest pick", () => {
  const r = recipe({ exploreShare: 0.5 });
  const best = video("best", { ageDays: 10 });
  const cs = [
    cand(video("r1"), "follow"),
    cand(video("r2"), "follow"),
    cand(video("e-low", { ageDays: 0 }), "explore", undefined, 0.1),
    cand(best, "explore", undefined, 0.9),
  ];
  const out = rank(cs, r, opts({ limit: 2 }));
  assert.equal(out[1].video.id, best.id);
  assert.ok(Math.abs(out[1].score - r.weights.explore * 0.9 * Math.pow(0.5, 10 / r.recencyHalfLifeDays)) < 1e-12);
  // Without any strength or scorer the explanation still says "Not personalized".
  const plain = rank([cand(video("r1"), "follow"), cand(video("e"), "explore")], r, opts());
  assert.equal(plain.find((i) => i.primary === "explore")!.why[1], "Not personalized");
});

test("each taste list contributes at most 2 items by default", () => {
  const r = recipe({ exploreShare: 0 });
  const lure = Array.from({ length: 10 }, (_, i) => cand(video(`l${i}`, { ageDays: i }), "taste", "Big list", 1));
  const other = Array.from({ length: 3 }, (_, i) => cand(video(`o${i}`, { ageDays: i }), "taste", "Small list", 1));
  // l5 is also endorsed by a match, so it is one of the list's best items.
  const boosted = cand(video("l5", { ageDays: 5 }), "match", "Ines", 0.5);
  const out = rank([...lure, ...other, boosted], r, opts());
  const fromBig = out.filter((i) => i.why.includes('In the taste list "Big list"')).map((i) => i.video.id);
  assert.equal(fromBig.length, 2);
  assert.ok(fromBig.includes(video("l5").id));
  assert.equal(out.filter((i) => i.why.includes('In the taste list "Small list"')).length, 2);
  // Items past the cap with no other source drop out; l5 keeps its match line too.
  assert.equal(out.length, 4);
  // The cap is configurable per recipe.
  const loose = rank([...lure, ...other], recipe({ exploreShare: 0, maxPerTasteList: 5 }), opts());
  assert.equal(loose.filter((i) => i.primary === "taste").length, 8);
});

test("a capped list item keeps its other sources", () => {
  const r = recipe({ exploreShare: 0, maxPerTasteList: 1 });
  const a = video("a", { ageDays: 0 });
  const b = video("b", { ageDays: 1 });
  const out = rank([cand(a, "taste", "L", 1), cand(b, "taste", "L", 1), cand(b, "follow")], r, opts());
  // b scores higher (follow + list), so the list's single slot goes to b; a drops.
  assert.deepEqual(out.map((i) => i.video.id), [b.id]);
  assert.equal(out[0].primary, "follow");
});
