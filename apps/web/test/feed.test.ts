import { test } from "node:test";
import assert from "node:assert/strict";
import type { Video } from "../src/lib/core.ts";
import { DEFAULT_RECIPE, rank, seededRng } from "../src/lib/core.ts";
import { TRENDING_STRENGTH, buildCandidates, disclosureIndex } from "../src/lib/candidates.ts";
import { parseTasteList } from "../src/lib/tastelist.ts";

const now = new Date("2026-10-19T12:00:00Z");
const day = 86_400_000;
let n = 0;
function vid(creator: string, ageDays: number): Video {
  n++;
  return { id: `https://a.example/videos/watch/v${n}`, title: `Video ${n}`, creator, durationSec: 60, publishedAt: new Date(now.getTime() - ageDays * day), tags: [] };
}

test("builds follow, taste, trending and explore candidates", () => {
  const followed = vid("alice@a.example", 1);
  const trending = vid("bob@a.example", 2);
  const fresh = vid("carol@b.example", 1);
  const freshFollowed = vid("alice@a.example", 0);
  const listed = vid("dave@c.example", 3);
  const list = parseTasteList({ v: 1, name: "Dave's picks", items: [{ id: listed.id, sponsored: true }] });
  const c = buildCandidates({
    instances: [{ origin: "https://a.example", trending: [trending], recent: [fresh, freshFollowed] }],
    follows: new Set(["alice@a.example"]),
    followVideos: [followed],
    tasteLists: [{ list, videos: [listed] }],
    trendingAsTaste: true,
  });
  const kinds = (v: Video) => c.filter((x) => x.video.id === v.id).map((x) => x.source.kind);
  assert.deepEqual(kinds(followed), ["follow"]);
  assert.deepEqual(kinds(trending), ["taste"]);
  assert.equal(c.find((x) => x.video.id === trending.id)!.source.strength, TRENDING_STRENGTH);
  assert.deepEqual(kinds(fresh), ["explore"]);
  assert.deepEqual(kinds(freshFollowed), ["follow"], "a followed creator's new upload is never an explore pick");
  assert.deepEqual(kinds(listed), ["taste"]);
  assert.deepEqual(disclosureIndex([{ list, videos: [listed] }]).get(listed.id)?.sponsored, ["Dave's picks"]);

  const off = buildCandidates({ instances: [{ origin: "https://a.example", trending: [trending], recent: [] }], follows: new Set(), followVideos: [], tasteLists: [], trendingAsTaste: false });
  assert.equal(off.length, 0);
});

test("core rank gives explore slots to new creators and explains every item", () => {
  const recent = Array.from({ length: 30 }, (_, i) => vid(`new${i}@b.example`, 1));
  const trending = Array.from({ length: 40 }, (_, i) => vid(`t${i % 20}@a.example`, 3));
  const c = buildCandidates({ instances: [{ origin: "https://a.example", trending, recent }], follows: new Set(), followVideos: [], tasteLists: [], trendingAsTaste: true });
  const feed = rank(c, DEFAULT_RECIPE, { now, limit: 30, rng: seededRng(1) });
  assert.equal(feed.length, 30);
  assert.equal(feed.filter((f) => f.primary === "explore").length, 3, "10% explore share");
  assert.equal(feed[5].primary, "explore");
  assert.ok(feed.every((f) => f.why.length > 0));
  assert.match(feed[0].why[0], /Trending on a\.example/);
});
