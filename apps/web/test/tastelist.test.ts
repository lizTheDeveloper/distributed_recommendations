import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TASTE_LIST_LIMITS, errorText, parseTasteList, parseTasteListJson } from "../src/lib/tastelist.ts";

const ok = { v: 1, name: "Picks", items: [{ id: "https://tube.example/videos/watch/abc", sponsored: true }] };

test("parses a minimal list and defaults flags", () => {
  const l = parseTasteList(ok);
  assert.equal(l.name, "Picks");
  assert.deepEqual(l.items[0], { id: "https://tube.example/videos/watch/abc", sponsored: true, affiliated: false });
});

test("rejects unknown keys, bad versions, duplicates and non-URL ids", () => {
  assert.throws(() => parseTasteList({ ...ok, extra: 1 }), /list\.extra: unknown key/);
  assert.throws(() => parseTasteList({ ...ok, v: 2 }), /list\.v: must be 1/);
  assert.throws(() => parseTasteList({ ...ok, items: [ok.items[0], ok.items[0]] }), /duplicate/);
  assert.throws(() => parseTasteList({ ...ok, items: [{ id: "javascript:alert(1)" }] }), /invalid format/);
  assert.throws(() => parseTasteList({ ...ok, items: [{ id: "https://x.example/v", tracking: 1 }] }), /unknown key/);
});

test("rejects control and bidi characters in display strings", () => {
  assert.throws(() => parseTasteList({ ...ok, name: "evil‮eman" }), /control characters/);
});

test("enforces the size limit before parsing", () => {
  const big = " ".repeat(TASTE_LIST_LIMITS.maxJsonBytes + 1);
  assert.throws(() => parseTasteListJson(big), /at most 65536 bytes/);
  assert.match(errorText((() => { try { parseTasteListJson("{"); } catch (e) { return e; } })()), /not valid JSON/);
});

test("the shipped example lists are valid and labelled as examples", () => {
  for (const f of ["tilvids-picks.json", "framatube-picks.json"]) {
    const l = parseTasteListJson(readFileSync(new URL(`../public/examples/${f}`, import.meta.url), "utf8"));
    assert.ok(l.items.length >= 5);
    assert.match(l.name, /^Example/);
    assert.match(l.author ?? "", /example/i);
  }
});
