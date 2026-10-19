import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { CHANNELS, CHANNEL_INDEX, CHUNK_LENGTH, WINDOW_SECONDS, channelOf, windowEnd, windowIndex, windowStart } from "../src/channels.ts";
import { SOURCE_KINDS } from "../src/core.ts";

test("every rank() source kind maps to its own channel; search and unknown map to search/other", () => {
  for (const k of SOURCE_KINDS) assert.equal(channelOf(k), k);
  assert.equal(channelOf("search"), "search");
  assert.equal(channelOf(undefined), "other");
  assert.equal(channelOf(null), "other");
  assert.equal(channelOf("nonsense" as never), "other");
});

test("channel order is the wire format: 8 channels, indexes match", () => {
  assert.deepEqual([...CHANNELS], ["follow", "taste", "match", "circle", "second", "explore", "search", "other"]);
  CHANNELS.forEach((c, i) => assert.equal(CHANNEL_INDEX[c], i));
});

test("the infra task generator uses the same channels, window and chunk length", () => {
  const src = readFileSync(new URL("../../../infra/janus/scripts/new-task.mjs", import.meta.url), "utf8");
  const m = /const CHANNELS = (\[[^\]]+\]);/.exec(src);
  assert.ok(m);
  assert.deepEqual(JSON.parse(m[1]!), [...CHANNELS]);
  assert.match(src, /const WINDOW_SECONDS = 28 \* 24 \* 3600;/);
  assert.match(src, new RegExp(`const CHUNK_LENGTH = ${CHUNK_LENGTH};`));
});

test("windows are 28 days, aligned to the epoch, and contiguous", () => {
  assert.equal(WINDOW_SECONDS, 2_419_200);
  const t = new Date("2026-10-19T12:00:00Z");
  const w = windowIndex(t);
  assert.ok(windowStart(w) * 1000 <= t.getTime() && t.getTime() < windowEnd(w) * 1000);
  assert.equal(windowEnd(w), windowStart(w + 1));
  assert.equal(windowStart(w) % WINDOW_SECONDS, 0);
  assert.throws(() => windowIndex(new Date(NaN)));
});
