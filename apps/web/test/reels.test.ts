import { test } from "node:test";
import assert from "node:assert/strict";
import type { RankedItem, Video } from "../src/lib/core.ts";
import type { ReelItem, VideoMeta } from "../src/lib/reels.ts";
import {
  REELS_MAX_SHORT_SEC,
  applyPage,
  extendReels,
  isShortForm,
  newPager,
  nextPages,
  pagerExhausted,
  playerPlan,
  reelKey,
  removeReel,
  shouldLoadMore,
} from "../src/lib/reels.ts";
import { createCatalog } from "../src/lib/catalog.ts";
import { snapshotFetch } from "../src/lib/snapshotFetch.ts";
import type { Snapshot } from "../src/lib/snapshotFetch.ts";

let n = 0;
function item(durationSec: number, id = `https://a.example/videos/watch/r${++n}`): { item: RankedItem; section: "feed" } {
  const video: Video = { id, title: id, creator: "c@a.example", durationSec, publishedAt: new Date(), tags: [] };
  return { item: { video, score: 1, primary: "explore", why: [] }, section: "feed" };
}
const noMeta = () => undefined;

test("short or portrait counts as short-form; live never does", () => {
  const v = item(REELS_MAX_SHORT_SEC).item.video;
  assert.equal(isShortForm(v), true);
  assert.equal(isShortForm({ ...v, durationSec: REELS_MAX_SHORT_SEC + 1 }), false);
  assert.equal(isShortForm({ ...v, durationSec: 1200 }, { aspectRatio: 0.5625 }), true, "portrait at any length");
  assert.equal(isShortForm({ ...v, durationSec: 1200 }, { aspectRatio: 1.7778 }), false);
  assert.equal(isShortForm({ ...v, durationSec: 0 }), false, "unknown duration isn't short");
  assert.equal(isShortForm(v, { isLive: true }), false);
});

test("extendReels: shorts first in rank order, long ones only as a fallback", () => {
  const ranked = [item(600), item(30), item(1200), item(90), item(45), item(3000)];
  const first = extendReels([], ranked, { batch: 2, meta: noMeta, exhausted: false });
  assert.deepEqual(first.items.map((r) => r.item.video.durationSec), [30, 90]);
  assert.equal(first.needMore, false, "enough shorts for this batch");
  const second = extendReels(first.items, ranked, { batch: 2, meta: noMeta, exhausted: false });
  assert.deepEqual(second.items.map((r) => r.item.video.durationSec), [30, 90, 45]);
  assert.equal(second.needMore, true, "shorts ran out: fetch another page before falling back");
  const third = extendReels(second.items, ranked, { batch: 2, meta: noMeta, exhausted: true });
  assert.deepEqual(third.items.map((r) => [r.item.video.durationSec, r.fallback]), [
    [30, false],
    [90, false],
    [45, false],
    [600, true],
    [1200, true],
  ]);
});

test("extendReels: committed items never move when the ranking changes", () => {
  const a = item(30);
  const b = item(40);
  const c = item(50);
  const first = extendReels([], [a, b], { batch: 5, meta: noMeta, exhausted: false });
  const reranked = [c, b, a];
  const next = extendReels(first.items, reranked, { batch: 5, meta: noMeta, exhausted: false });
  assert.deepEqual(next.items.map((r) => r.item.video.id), [a.item.video.id, b.item.video.id, c.item.video.id]);
});

test("extendReels: no empty screen, exclusions, duplicates across passes, portrait meta", () => {
  const long = [item(900), item(1500)];
  const r = extendReels([], long, { batch: 3, meta: noMeta, exhausted: false });
  assert.equal(r.items.length, 2, "nothing short yet: show long ones rather than nothing");
  assert.ok(r.items.every((x) => x.fallback));

  const dup = item(20);
  const popularDup = { ...dup, section: "popular" as const };
  const hidden = item(25);
  const portrait = item(1000);
  const meta = (id: string): VideoMeta | undefined => (id === portrait.item.video.id ? { aspectRatio: 0.5625 } : undefined);
  const out = extendReels([], [dup, popularDup, hidden, portrait], { batch: 5, meta, exhausted: false, exclude: new Set([hidden.item.video.id]) });
  assert.deepEqual(out.items.map((x) => x.item.video.id), [dup.item.video.id, portrait.item.video.id]);
  assert.equal(removeReel(out.items, dup.item.video.id).length, 1);
});

test("pager: next pages per instance and list, ends on a short page or the page cap", () => {
  let p = newPager(["https://a.example", "https://b.example"], 50);
  let reqs = nextPages(p, 2, 30);
  assert.equal(reqs.length, 4);
  assert.deepEqual(reqs[0], { origin: "https://a.example", which: "recent", start: 50, count: 30 });
  p = applyPage(p, reqs[0], 30);
  p = applyPage(p, reqs[1], 7); // a.trending ended
  p = applyPage(p, reqs[2], 0); // b.recent ended
  p = applyPage(p, reqs[3], 30);
  reqs = nextPages(p, 2, 30);
  assert.deepEqual(
    reqs.map((r) => [r.origin, r.which, r.start]),
    [
      ["https://a.example", "recent", 80],
      ["https://b.example", "trending", 80],
    ],
  );
  p = applyPage(p, reqs[0], 30);
  p = applyPage(p, reqs[1], 30);
  assert.equal(pagerExhausted(p, 2), true, "page cap reached");
  assert.equal(pagerExhausted(p, 3), false);
});

test("pagination goes through core's PeerTube client (start/count), offline snapshot included", async () => {
  const raw = (i: number) => ({ uuid: `u${i}`, url: `https://a.example/videos/watch/u${i}`, name: `V${i}`, duration: 30 + i, publishedAt: new Date(2026, 9, 1, 0, i).toISOString(), isLocal: true, aspectRatio: i % 2 ? 0.5625 : 1.7778, channel: { name: "c", host: "a.example" } });
  const snap: Snapshot = { fetchedAt: "2026-10-19T00:00:00Z", instances: { "https://a.example": { trending: [], recent: Array.from({ length: 7 }, (_, i) => raw(i)) } }, extra: [] };
  const catalog = createCatalog(snapshotFetch(snap));
  const page1 = await catalog.instancePage("https://a.example", "recent", 0, 5);
  const page2 = await catalog.instancePage("https://a.example", "recent", 5, 5);
  assert.deepEqual(page1.map((v) => v.title), ["V0", "V1", "V2", "V3", "V4"]);
  assert.deepEqual(page2.map((v) => v.title), ["V5", "V6"]);
  assert.deepEqual(catalog.meta(page1[1].id), { aspectRatio: 0.5625 });
  assert.equal(isShortForm(page1[1], catalog.meta(page1[1].id)), true);
});

test("player plan: only the visible item plays; next preloads; far ones are torn down", () => {
  assert.deepEqual(playerPlan(2, 6), ["none", "paused", "play", "preload", "none", "none"]);
  assert.deepEqual(playerPlan(0, 2), ["play", "preload"]);
  assert.equal(shouldLoadMore(4, 8), true);
  assert.equal(shouldLoadMore(1, 8), false);
  assert.equal(shouldLoadMore(0, 0), true);
});

test("keyboard: arrows / j / k move, space pauses, m mutes, modifiers ignored", () => {
  assert.equal(reelKey({ key: "ArrowDown" }), "next");
  assert.equal(reelKey({ key: "j" }), "next");
  assert.equal(reelKey({ key: "k" }), "prev");
  assert.equal(reelKey({ key: "ArrowUp" }), "prev");
  assert.equal(reelKey({ key: " " }), "toggle");
  assert.equal(reelKey({ key: "m" }), "mute");
  assert.equal(reelKey({ key: "j", ctrlKey: true }), null);
  assert.equal(reelKey({ key: "x" }), null);
  const kept: ReelItem[] = [];
  assert.equal(kept.length, 0);
});
