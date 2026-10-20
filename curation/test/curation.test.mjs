// node --test curation/test/
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { editorialScore, band } from "../scripts/propose.mjs";
import { assertHumanReviewer } from "../scripts/approve.mjs";
import { buildCollections } from "../scripts/publish.mjs";
import { clean, canonical, assertPublicHost, readRecords, ROOT } from "../scripts/lib.mjs";

const STATUSES = ["candidate", "discovered", "verified", "reviewed", "approved", "published", "rejected", "needs-recheck", "removed"];
const { collections } = JSON.parse(readFileSync(join(ROOT, "collections.json"), "utf8"));
const SLUGS = collections.map((c) => c.slug);

test("score: §6 weights, 0–100", () => {
  assert.equal(editorialScore({ usefulness: 5, rigor: 5, mission: 5, distinctiveness: 5, accessibility: 5, currency: 5 }), 100);
  assert.equal(editorialScore({ usefulness: 0, rigor: 0, mission: 0, distinctiveness: 0, accessibility: 0, currency: 0 }), 0);
  assert.equal(editorialScore({ usefulness: 5, rigor: 4, mission: 5, distinctiveness: 3, accessibility: 5, currency: 4 }), 89);
  assert.throws(() => editorialScore({ usefulness: 6, rigor: 0, mission: 0, distinctiveness: 0, accessibility: 0, currency: 0 }));
  assert.throws(() => editorialScore({ usefulness: 5 }));
  assert.deepEqual([80, 79, 65, 64, 50, 49].map(band), ["feature-candidate", "collection-candidate", "collection-candidate", "editorial-review", "editorial-review", "reject"]);
});

test("reviewers are people, not agents", () => {
  assert.equal(assertHumanReviewer(" Liz "), "Liz");
  for (const bad of ["", "x", "claude-opus-5-5 (AI proposal)", "Qwen Engineer", "publish.mjs", "review bot"]) assert.throws(() => assertHumanReviewer(bad));
});

test("remote text is cleaned and capped", () => {
  assert.equal(clean("a‮b\u0000c   d"), "abc d");
  assert.equal(clean("x".repeat(10), 5), "xxxx…");
  assert.equal(clean(42), null);
});

test("canonical ids refuse anything but a uuid", () => {
  assert.equal(canonical("framatube.org", "4294a72f-0000-4000-8000-000000000000").url, "https://framatube.org/videos/watch/4294a72f-0000-4000-8000-000000000000");
  assert.throws(() => canonical("framatube.org", "../../etc"));
});

test("host check refuses local and IP-literal targets without a lookup", async () => {
  for (const h of ["localhost", "127.0.0.1", "printer.local", "db.internal", "10.0.0.5"]) await assert.rejects(() => assertPublicHost(h));
});

const rec = (id, over = {}) => ({
  id,
  source: { video_url: `https://ex.org/videos/watch/${id}`, ...over.source },
  editorial: { status: "approved", reviewer: "Liz", reviewed_at: "2026-10-19T00:00:00Z", score: 80, primary_collection: "hack-the-planet", secondary_collections: [], shelves: [], why_selected: "why", ...over.editorial },
  verification: { captions_verified: false, ...over.verification },
});

test("publish: only human-approved records, best first, start-here capped at 10", () => {
  const recs = [
    rec("a", { editorial: { score: 70 } }),
    rec("b", { editorial: { score: 90 } }),
    rec("c", { editorial: { status: "reviewed", reviewer: null } }),
    rec("d", { editorial: { reviewer: null } }),
    rec("e", { editorial: { status: "removed" } }),
    ...Array.from({ length: 12 }, (_, i) => rec("s" + i, { editorial: { shelves: ["start-here"], primary_collection: "strange-machines" } })),
  ];
  const out = buildCollections(recs, collections);
  const hack = out.find((c) => c.slug === "hack-the-planet").list;
  assert.deepEqual(hack.items.map((i) => i.id.split("/").pop()), ["b", "a"]);
  assert.equal(out.find((c) => c.slug === "start-here").list.items.length, 10);
  assert.equal(hack.author, "Multiverse Video editors");
});

test("publish: classroom-ready needs verified captions; notes fit the taste-list limit", () => {
  const long = "x".repeat(400);
  const out = buildCollections([rec("a", { editorial: { shelves: ["classroom-ready"], why_selected: long } }), rec("b", { editorial: { shelves: ["classroom-ready"] }, verification: { captions_verified: true } })], collections);
  assert.deepEqual(out.find((c) => c.slug === "classroom-ready").list.items.map((i) => i.id.split("/").pop()), ["b"]);
  assert.ok(out.find((c) => c.slug === "hack-the-planet").list.items.every((i) => !i.note || i.note.length <= 280));
});

test("every record is well formed (§8 schema)", () => {
  for (const { rec: r } of readRecords()) {
    assert.ok(STATUSES.includes(r.editorial.status), `${r.id}: status ${r.editorial.status}`);
    assert.equal(r.id, `${r.source.instance_host}__${r.source.video_uuid}`);
    assert.equal(r.source.video_url, canonical(r.source.instance_host, r.source.video_uuid).url);
    assert.equal(r.distribution.mode, "link-only", `${r.id}: only link-only distribution exists so far`);
    assert.equal(r.distribution.mirroring_authorized, false);
    assert.ok(Array.isArray(r.audit) && r.audit.length && r.audit.at(-1).to === r.editorial.status, `${r.id}: audit log ends at the current status`);
    if (r.editorial.primary_collection) assert.ok(SLUGS.includes(r.editorial.primary_collection), `${r.id}: unknown collection`);
    if (["approved", "published"].includes(r.editorial.status)) {
      assertHumanReviewer(r.editorial.reviewer);
      assert.ok(r.verification.origin_confirmed, `${r.id}: approved without origin confirmation`);
    }
    if (r.editorial.status === "rejected") assert.ok(r.editorial.rejection_reason, `${r.id}: rejected without a reason`);
  }
});
