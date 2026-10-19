import { test } from "node:test";
import assert from "node:assert/strict";
import type { Video } from "../src/lib/core.ts";
import { DEFAULT_RECIPE, EXPLORE_SHARE, FOLLOWING_CHRONOLOGICAL_RECIPE, rank, seededRng, tagProfile, tagRelevance } from "../src/lib/core.ts";
import {
  DEFAULT_LIST_STRENGTH,
  POPULAR_PER_INSTANCE,
  buildCandidates,
  buildPopularCandidates,
  disclosureIndex,
  listMembership,
  popularRecipe,
} from "../src/lib/candidates.ts";
import { DISCOVERY_RECIPE, describeRecipe, exploreText } from "../src/lib/recipes.ts";
import { parseTasteList } from "../src/lib/tastelist.ts";

const now = new Date("2026-10-19T12:00:00Z");
const day = 86_400_000;
let n = 0;
function vid(creator: string, ageDays: number, tags: string[] = []): Video {
  n++;
  return { id: `https://a.example/videos/watch/v${n}`, title: `Video ${n}`, creator, durationSec: 60, publishedAt: new Date(now.getTime() - ageDays * day), tags };
}

test("personal feed: follow, taste and explore candidates; trending stays out", () => {
  const followed = vid("alice@a.example", 1);
  const trending = vid("bob@a.example", 2);
  const trendingFollowed = vid("alice@a.example", 2);
  const fresh = vid("carol@b.example", 1);
  const freshFollowed = vid("alice@a.example", 0);
  const listed = vid("dave@c.example", 3);
  const list = parseTasteList({ v: 1, name: "Dave's picks", items: [{ id: listed.id, sponsored: true }] });
  const c = buildCandidates({
    instances: [{ origin: "https://a.example", trending: [trending, trendingFollowed], recent: [fresh, freshFollowed] }],
    follows: new Set(["alice@a.example"]),
    followVideos: [followed],
    tasteLists: [{ list, videos: [listed] }],
  });
  const kinds = (v: Video) => c.filter((x) => x.video.id === v.id).map((x) => x.source.kind);
  assert.deepEqual(kinds(followed), ["follow"]);
  assert.deepEqual(kinds(trending), [], "instance trending is not a personal-feed source");
  assert.deepEqual(kinds(trendingFollowed), ["follow"]);
  assert.deepEqual(kinds(fresh), ["explore"]);
  assert.deepEqual(kinds(freshFollowed), ["follow"], "a followed creator's new upload is never an explore pick");
  assert.deepEqual(kinds(listed), ["taste"]);
  assert.equal(c.find((x) => x.video.id === listed.id)!.source.strength, DEFAULT_LIST_STRENGTH);
  assert.deepEqual(disclosureIndex([{ list, videos: [listed] }]).get(listed.id)?.sponsored, ["Dave's picks"]);
  assert.deepEqual(listMembership([{ list, videos: [listed] }]).get(listed.id), ["Dave's picks"]);
});

test("default recipe: 5% explore, one slot per 20 at position 10, every item explained", () => {
  const recent = Array.from({ length: 30 }, (_, i) => vid(`new${i}@b.example`, 1));
  const followVideos = Array.from({ length: 60 }, (_, i) => vid(`f${i % 30}@a.example`, 3));
  const c = buildCandidates({
    instances: [{ origin: "https://a.example", trending: [], recent }],
    follows: new Set(followVideos.map((v) => v.creator)),
    followVideos,
    tasteLists: [],
  });
  const feed = rank(c, DEFAULT_RECIPE, { now, limit: 40, rng: seededRng(1) });
  assert.equal(DEFAULT_RECIPE.exploreShare, EXPLORE_SHARE.default);
  assert.equal(feed.length, 40);
  assert.deepEqual(
    feed.map((f, i) => (f.primary === "explore" ? i : -1)).filter((i) => i >= 0),
    [10, 30],
  );
  assert.ok(feed.every((f) => f.why.length > 0));
  assert.match(exploreText(DEFAULT_RECIPE), /^5% of slots \(1 in 20\)/);
  assert.match(describeRecipe(FOLLOWING_CHRONOLOGICAL_RECIPE), /Only channels you follow.*No new-creator slots/);
});

test("each taste list places at most maxPerTasteList items", () => {
  const vids = Array.from({ length: 10 }, (_, i) => vid(`c${i}@a.example`, 1));
  const list = parseTasteList({ v: 1, name: "Big list", items: vids.map((v) => ({ id: v.id })) });
  const c = buildCandidates({ instances: [], follows: new Set(), followVideos: [], tasteLists: [{ list, videos: vids, strength: 1 }] });
  assert.equal(rank(c, DEFAULT_RECIPE, { now, limit: 20, rng: seededRng(1) }).length, 2);
  assert.equal(rank(c, DISCOVERY_RECIPE, { now, limit: 20, rng: seededRng(1) }).length, 3);
});

test("explore is relevance-ranked by the on-device tag profile", () => {
  const recent = [vid("x@b.example", 1, ["knitting"]), vid("y@b.example", 1, ["pottery", "kiln"]), vid("z@b.example", 1, ["crypto"])];
  const c = buildCandidates({ instances: [{ origin: "https://b.example", trending: [], recent }], follows: new Set(), followVideos: [], tasteLists: [] });
  const exploreRelevance = tagRelevance(tagProfile([{ tags: ["pottery", "glaze"] }]));
  const feed = rank(c, DEFAULT_RECIPE, { now, limit: 3, rng: seededRng(7), exploreRelevance });
  assert.equal(feed[0].video.id, recent[1].id);
  assert.match(feed[0].why.join(" "), /fits what you watch/);
});

test("popular section: per-instance cap, separate pass, follows the recipe's taste weight", () => {
  const a = Array.from({ length: 10 }, (_, i) => vid(`a${i}@a.example`, 2));
  const b = Array.from({ length: 10 }, (_, i) => vid(`b${i}@b.example`, 2));
  const cands = buildPopularCandidates([
    { origin: "https://a.example", trending: a, recent: [] },
    { origin: "https://b.example", trending: b, recent: [] },
  ]);
  const pop = rank(cands, popularRecipe(DEFAULT_RECIPE), { now, limit: 2 * POPULAR_PER_INSTANCE, rng: seededRng(1) });
  assert.equal(pop.length, 2 * POPULAR_PER_INSTANCE);
  assert.ok(pop.every((p) => p.primary === "taste" && /Trending on [ab]\.example/.test(p.why[0])));
  assert.equal(popularRecipe(DEFAULT_RECIPE).exploreShare, 0);
  assert.equal(rank(cands, popularRecipe(FOLLOWING_CHRONOLOGICAL_RECIPE), { now, limit: 12, rng: seededRng(1) }).length, 0);
});
