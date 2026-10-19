import { test } from "node:test";
import assert from "node:assert/strict";
import { countView, emptyTally, loadTally } from "../src/lib/analytics.ts";
import { isEndorsed, loadHistory, record, seenSet, toSketchHistory, unendorse } from "../src/lib/history.ts";
import { defaultSettings, loadSettings } from "../src/lib/settings.ts";
import { memoryKV, readJson, writeJson, browserKV } from "../src/lib/storage.ts";
import { editRecipe, BUILTIN_RECIPES, DISCOVERY_RECIPE } from "../src/lib/recipes.ts";
import { parseChannelInput, parseInstance } from "../src/lib/handles.ts";
import { embedUrl, formatDuration, watchId } from "../src/lib/videos.ts";

test("decided defaults: P2P off, analytics on per signal, private watching off", () => {
  const s = defaultSettings();
  assert.equal(s.p2p, false);
  assert.equal(s.privateWatching, false);
  assert.equal(s.analytics.contribute, true);
  assert.ok(Object.values(s.analytics.perKind).every(Boolean));
  assert.deepEqual(loadSettings({ p2p: "yes", instances: ["javascript:x", "https://ok.example"] }).instances, ["https://ok.example"]);
  assert.equal(loadSettings({ trendingAsTaste: false }).showPopular, false, "old setting name migrates");
});

test("private watching records nothing; endorsements feed the sketch format", () => {
  const ev = { videoId: "https://a.example/videos/watch/1", at: 1, kind: "endorse" as const, tags: ["x"] };
  assert.deepEqual(record([], ev, { privateWatching: true }), []);
  const h = record(record([], ev, { privateWatching: false }), { ...ev, kind: "watch", videoId: "w" }, { privateWatching: false });
  assert.ok(isEndorsed(h, ev.videoId));
  assert.deepEqual([...seenSet(h)], ["w"]);
  assert.deepEqual(toSketchHistory(h).map((e) => e.kind), ["endorse"]);
  assert.equal(unendorse(h, ev.videoId).length, 1);
  assert.deepEqual(loadHistory([{ junk: 1 }, ev]), [ev]);
});

test("discovery tally honors the main switch, per-signal switches and private watching", () => {
  const s = defaultSettings();
  assert.equal(countView(emptyTally(), "match", s).match, 1);
  s.analytics.perKind.match = false;
  assert.equal(countView(emptyTally(), "match", s).match, 0);
  assert.equal(countView(emptyTally(), "follow", { ...s, privateWatching: true }).follow, 0);
  assert.equal(countView(emptyTally(), "follow", { ...s, analytics: { ...s.analytics, contribute: false } }).follow, 0);
  assert.equal(loadTally({ follow: -3, taste: 2 }).taste, 2);
});

test("storage survives a throwing localStorage", () => {
  const kv = memoryKV();
  writeJson(kv, "x", { a: 1 });
  assert.deepEqual(readJson(kv, "x", null), { a: 1 });
  kv.set("mf.v1.bad", "{");
  assert.equal(readJson(kv, "bad", 7), 7);
  const g = globalThis as { localStorage?: unknown };
  const prev = g.localStorage;
  Object.defineProperty(globalThis, "localStorage", { configurable: true, get() { throw new Error("SecurityError"); } });
  try {
    const b = browserKV();
    assert.equal(b.persistent, false);
    b.set("k", "v");
    assert.equal(b.get("k"), "v");
  } finally {
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: prev, writable: true });
  }
});

test("recipe edits are re-validated by core parseRecipe", () => {
  const base = BUILTIN_RECIPES[0].recipe;
  assert.equal(editRecipe(base, { weights: { explore: 2 } }).weights.explore, 2);
  assert.equal(editRecipe(base, { weights: { explore: 2 } }).weights.follow, base.weights.follow);
  assert.throws(() => editRecipe(base, { exploreShare: 0.9 }), /recipe\.exploreShare/);
  assert.equal(editRecipe(base, { maxPerTasteList: 4 }).maxPerTasteList, 4);
  assert.throws(() => editRecipe(base, { maxPerTasteList: 0 }), /recipe\.maxPerTasteList/);
  assert.ok(DISCOVERY_RECIPE.exploreShare <= 0.1, "built-ins stay within the recommended explore range");
});

test("handles, instances and embed URLs", () => {
  assert.deepEqual(parseChannelInput("@blender@video.blender.org"), { name: "blender", host: "video.blender.org" });
  assert.deepEqual(parseChannelInput("https://tilvids.com/c/foo_channel/videos"), { name: "foo_channel", host: "tilvids.com" });
  assert.deepEqual(parseChannelInput("https://a.example/video-channels/x@b.example"), { name: "x", host: "b.example" });
  assert.equal(parseChannelInput("not a handle"), null);
  assert.equal(parseInstance("framatube.org/foo"), "https://framatube.org");
  assert.equal(parseInstance("http://insecure.example"), null);
  assert.deepEqual(watchId("https://t.example/w/abcDEF123"), { origin: "https://t.example", id: "abcDEF123" });
  const v = { id: "https://t.example/videos/watch/0a1b2c3d-1111", title: "t", creator: "a@t.example", durationSec: 0, publishedAt: new Date(), tags: [] };
  assert.match(embedUrl(v, { p2p: false })!, /^https:\/\/t\.example\/videos\/embed\/0a1b2c3d-1111\?p2p=0&/);
  assert.match(embedUrl(v, { p2p: true })!, /p2p=1/);
  assert.equal(formatDuration(3725), "1:02:05");
});
