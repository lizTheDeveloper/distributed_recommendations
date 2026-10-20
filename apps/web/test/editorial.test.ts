import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { parseTasteList } from "../src/lib/tastelist.ts";

// The bundled editors' collections (src/editorial.json) are generated from curation/records by
// curation/scripts/publish.mjs. Every pick must trace back to a record a person approved.
const bundle = JSON.parse(readFileSync(new URL("../src/editorial.json", import.meta.url), "utf8"));
const recordsDir = new URL("../../../curation/records/", import.meta.url);

test("editorial: every bundled collection is a valid taste list", () => {
  for (const c of bundle.collections) {
    assert.match(c.slug, /^[a-z0-9-]+$/);
    const list = parseTasteList(c.list);
    assert.equal(list.author, "Multiverse Video editors");
    assert.ok(list.items.length > 0, `${c.slug} is empty`);
  }
});

test("editorial: every pick is a published record with a human reviewer", () => {
  const byUrl = new Map<string, { editorial: { status: string; reviewer: string | null } }>();
  for (const f of readdirSync(recordsDir)) {
    if (!f.endsWith(".json")) continue;
    const r = JSON.parse(readFileSync(new URL(f, recordsDir), "utf8"));
    byUrl.set(r.source.video_url, r);
  }
  for (const c of bundle.collections) {
    for (const item of c.list.items) {
      const r = byUrl.get(item.id);
      assert.ok(r, `${c.slug}: ${item.id} has no curation record`);
      assert.ok(["approved", "published"].includes(r.editorial.status), `${item.id} is ${r.editorial.status}`);
      assert.ok(r.editorial.reviewer && !/claude|ai proposal|bot/i.test(r.editorial.reviewer), `${item.id} has no human reviewer`);
    }
  }
});

test("editorial: the public copies match the bundle", () => {
  for (const c of bundle.collections) {
    const pub = JSON.parse(readFileSync(new URL(`../public/collections/${c.slug}.json`, import.meta.url), "utf8"));
    assert.deepEqual(pub, c.list);
  }
});
