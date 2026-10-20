import { test } from "node:test";
import assert from "node:assert/strict";
import { DURATION_CHOICES, closedSheet, durationChoice, sheetLayout, sheetReduce, splitList, trapFocus } from "../src/lib/sheet.ts";
import { MAX_RELAYS, SUGGESTED_RELAYS, defaultSettings, loadSettings, parseRelayUrl } from "../src/lib/settings.ts";
import { DISCOVERY_RECIPE, editRecipe, filtersText, recipePillText } from "../src/lib/recipes.ts";
import { DEFAULT_RECIPE } from "../src/lib/core.ts";

test("sheet: bottom sheet on phones, side drawer on wider screens", () => {
  assert.equal(sheetLayout(390), "bottom");
  assert.equal(sheetLayout(859), "bottom");
  assert.equal(sheetLayout(860), "drawer");
  assert.equal(sheetLayout(1440), "drawer");
});

test("sheet: open from the gear or the recipe pill, close with the button or Escape, focus returns", () => {
  let s = sheetReduce(closedSheet, { type: "open", from: "gear-btn" });
  assert.deepEqual(s, { open: true, section: "recipe", returnFocus: "gear-btn" });
  s = sheetReduce(s, { type: "key", key: "Enter" });
  assert.equal(s.open, true, "other keys do nothing");
  s = sheetReduce(s, { type: "key", key: "Escape" });
  assert.equal(s.open, false);
  assert.equal(s.returnFocus, "gear-btn", "remembered so focus can go back");
  s = sheetReduce(s, { type: "open", section: "view", from: "pill" });
  assert.equal(s.section, "view");
  s = sheetReduce(s, { type: "close" });
  assert.equal(s.open, false);
  assert.equal(sheetReduce(s, { type: "close" }), s, "closing a closed sheet is a no-op");
  s = sheetReduce(s, { type: "toggle", from: "tab-settings" });
  assert.equal(s.open, true);
  s = sheetReduce(s, { type: "toggle" });
  assert.equal(s.open, false);
});

test("sheet: focus trap wraps both ways", () => {
  assert.equal(trapFocus(4, 5, false), 0);
  assert.equal(trapFocus(0, 5, true), 4);
  assert.equal(trapFocus(-1, 5, false), 0);
  assert.equal(trapFocus(-1, 5, true), 4);
  assert.equal(trapFocus(0, 0, false), -1);
});

test("filters: text inputs, duration choices, and every edit re-validated by core", () => {
  assert.deepEqual(splitList(" #Politics, news,\nNEWS ,, "), ["politics", "news"]);
  assert.equal(durationChoice(0, null), "any");
  assert.equal(durationChoice(0, 180), "short");
  assert.equal(durationChoice(60, 61), "custom");
  const short = DURATION_CHOICES.find((c) => c.id === "short")!;
  let r = editRecipe(DEFAULT_RECIPE, { filters: { excludeTags: ["politics"], minDurationSec: short.min, maxDurationSec: short.max } });
  assert.deepEqual(r.filters.excludeTags, ["politics"]);
  assert.equal(r.filters.maxDurationSec, 180);
  assert.equal(filtersText(r), "hiding #politics; at most 3 min");
  r = editRecipe(r, { filters: { excludeTags: [], maxDurationSec: null } });
  assert.equal(filtersText(r), null, "filters can be cleared again");
  assert.throws(() => editRecipe(DEFAULT_RECIPE, { filters: { includeLanguages: ["not a language!"] } }), /includeLanguages/);
  assert.throws(() => editRecipe(DEFAULT_RECIPE, { filters: { minDurationSec: 600, maxDurationSec: 60 } }), /maxDurationSec/);
  assert.throws(() => editRecipe(DEFAULT_RECIPE, { filters: { excludeCreators: ["no-at-sign"] } }), /excludeCreators/);
});

test("settings: Reels by default, view choice and relays persist; relays validated", () => {
  const d = defaultSettings();
  assert.equal(d.defaultView, "reels");
  assert.deepEqual(d.relays, [], "no relays by default: nothing is sent anywhere until you add one");
  const s = loadSettings({ defaultView: "grid", relays: ["wss://relay.example", "wss://relay.example/", "ws://evil.example", "ws://127.0.0.1:7777", 5] });
  assert.equal(s.defaultView, "grid");
  assert.deepEqual(s.relays, ["wss://relay.example", "ws://127.0.0.1:7777"]);
  assert.equal(loadSettings({ defaultView: "tiktok" }).defaultView, "reels");
  assert.equal(parseRelayUrl("wss://relay.example/inbox"), "wss://relay.example/inbox");
  assert.equal(parseRelayUrl("ws://localhost:7777"), "ws://localhost:7777");
  assert.equal(parseRelayUrl("https://relay.example"), null);
  assert.equal(parseRelayUrl("wss://user:pw@relay.example"), null);
  assert.equal(parseRelayUrl("not a url"), null);
});

test("recipe pill: short name and explore share", () => {
  assert.equal(recipePillText(DEFAULT_RECIPE), `${DEFAULT_RECIPE.name} · 5% new`);
  assert.match(recipePillText(DISCOVERY_RECIPE), /^Discovery: taste lists \+ ne… · 10% new$/);
});

test("suggested relays are valid wss:// URLs, unique, and within the relay cap", () => {
  assert.ok(SUGGESTED_RELAYS.length <= MAX_RELAYS);
  assert.equal(new Set(SUGGESTED_RELAYS.map((r) => r.url)).size, SUGGESTED_RELAYS.length);
  for (const r of SUGGESTED_RELAYS) assert.equal(parseRelayUrl(r.url), r.url, r.url);
});
