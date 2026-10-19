import assert from "node:assert/strict";
import { test } from "node:test";
import { windowIndex } from "../src/channels.ts";
import { LEDGER_LIMITS, emptyLedger, isCreatorKey, loadLedger, recordView } from "../src/ledger.ts";
import { DEFAULT_CONTRIBUTION, channelAllowed, fromWebSettings, type ContributionSettings } from "../src/settings.ts";
import { viewFromRankedItem } from "../src/hooks.ts";

const at = new Date("2026-10-19T12:00:00Z");
const on: ContributionSettings = { ...DEFAULT_CONTRIBUTION, perChannel: {} };

test("contribution is on by default, per Q1", () => {
  assert.equal(channelAllowed("match", DEFAULT_CONTRIBUTION), true);
  assert.equal(channelAllowed("other", DEFAULT_CONTRIBUTION), true);
});

test("a view is counted under its window and creator", () => {
  const l = recordView(emptyLedger(), { creator: "alice@videos.example", channel: "taste", at }, on);
  assert.deepEqual(l.windows[String(windowIndex(at))], { "alice@videos.example": { taste: 1 } });
  const l2 = recordView(l, { creator: "alice@videos.example", channel: "taste", at }, on);
  assert.equal(l2.windows[String(windowIndex(at))]!["alice@videos.example"]!.taste, 2);
});

test("private watching records nothing", () => {
  const l0 = emptyLedger();
  assert.equal(recordView(l0, { creator: "alice@videos.example", channel: "follow", at }, { ...on, privateWatching: true }), l0);
});

test("the master off switch records nothing", () => {
  const l0 = emptyLedger();
  assert.equal(recordView(l0, { creator: "alice@videos.example", channel: "follow", at }, { ...on, contribute: false }), l0);
});

test("a per-channel off switch drops only that channel", () => {
  const s = { ...on, perChannel: { match: false, circle: false } };
  let l = emptyLedger();
  l = recordView(l, { creator: "alice@videos.example", channel: "match", at }, s);
  l = recordView(l, { creator: "alice@videos.example", channel: "circle", at }, s);
  assert.deepEqual(l.windows, {});
  l = recordView(l, { creator: "alice@videos.example", channel: "follow", at }, s);
  assert.deepEqual(Object.values(l.windows)[0], { "alice@videos.example": { follow: 1 } });
});

test("no video id, title or view time is ever stored, even if the caller passes them", () => {
  const view = {
    creator: "alice@videos.example",
    channel: "explore",
    at,
    videoId: "https://videos.example/w/SECRETVIDEOID",
    title: "SECRET TITLE",
  } as never;
  const json = JSON.stringify(recordView(emptyLedger(), view, on));
  assert.ok(!json.includes("SECRET"));
  assert.ok(!json.includes("2026-10-19"));
  // The rank() hook reads only creator + primary.
  const item = { primary: "match" as const, video: { id: "https://videos.example/w/SECRETVIDEOID", creator: "alice@videos.example", title: "SECRET" } };
  const ev = viewFromRankedItem(item, at);
  assert.deepEqual(Object.keys(ev).sort(), ["at", "channel", "creator"]);
  assert.ok(!JSON.stringify(recordView(emptyLedger(), ev, on)).includes("SECRET"));
});

test("malformed input is ignored", () => {
  const l0 = emptyLedger();
  for (const v of [
    { creator: "", channel: "follow", at },
    { creator: "alice@videos.example", channel: "tv", at },
    { creator: "alice@videos.example", channel: "follow", at: new Date(NaN) },
    { creator: "<script>@x", channel: "follow", at },
  ]) assert.equal(recordView(l0, v as never, on), l0);
  assert.ok(isCreatorKey("a".repeat(64)));
  assert.ok(isCreatorKey("chan_1@peertube.example:8443"));
});

test("limits: creators per window and count per channel are capped", () => {
  let l = emptyLedger();
  for (let i = 0; i < LEDGER_LIMITS.maxCreatorsPerWindow + 5; i++) l = recordView(l, { creator: `c${i}@x.example`, channel: "follow", at }, on);
  assert.equal(Object.keys(Object.values(l.windows)[0]!).length, LEDGER_LIMITS.maxCreatorsPerWindow);
  const loaded = loadLedger({ windows: { "1": { "a@x.example": { follow: 10 ** 9 } } } });
  assert.equal(loaded.windows["1"]!["a@x.example"]!.follow, LEDGER_LIMITS.maxCountPerChannel);
});

test("loadLedger drops junk and round-trips valid data", () => {
  let l = emptyLedger();
  l = recordView(l, { creator: "alice@videos.example", channel: "taste", at }, on);
  assert.deepEqual(loadLedger(JSON.parse(JSON.stringify(l))), l);
  assert.deepEqual(loadLedger(null), emptyLedger());
  assert.deepEqual(loadLedger({ windows: { x: {}, "5": { "bad key": { follow: 1 } }, "6": { "a@b.example": { follow: -1, nope: 3 } } } }), emptyLedger());
});

test("fromWebSettings maps apps/web settings", () => {
  const s = fromWebSettings({ analytics: { contribute: true, perKind: { match: false, follow: true } }, privateWatching: false });
  assert.equal(channelAllowed("match", s), false);
  assert.equal(channelAllowed("follow", s), true);
  assert.equal(channelAllowed("search", s), true);
  assert.equal(channelAllowed("follow", fromWebSettings({ analytics: { contribute: false, perKind: {} }, privateWatching: false })), false);
  assert.equal(channelAllowed("follow", fromWebSettings({ analytics: { contribute: true, perKind: {} }, privateWatching: true })), false);
});
