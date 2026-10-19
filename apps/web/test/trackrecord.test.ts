import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyImpressions, listStrength, loadImpressions, recordImpression } from "../src/lib/trackrecord.ts";

test("a new list starts at core's 0.5; a list the viewer endorses from rises, one they ignore falls", () => {
  const imp = emptyImpressions();
  assert.equal(listStrength(imp, "L", new Set()), 0.5);
  const endorsed = new Set<string>();
  for (let i = 0; i < 40; i++) {
    recordImpression(imp, `good${i}`, ["Good"]);
    recordImpression(imp, `meh${i}`, ["Meh"]);
    recordImpression(imp, `other${i}`, []);
    if (i % 2 === 0) endorsed.add(`good${i}`);
    if (i % 8 === 0) endorsed.add(`other${i}`);
  }
  const good = listStrength(imp, "Good", endorsed);
  const meh = listStrength(imp, "Meh", endorsed);
  assert.ok(good > 0.5 && good <= 1, `good ${good}`);
  assert.ok(meh < 0.5, `meh ${meh}`);
});

test("impressions are unique, capped and robust to junk", () => {
  const imp = emptyImpressions();
  assert.equal(recordImpression(imp, "a", ["L"]), true);
  assert.equal(recordImpression(imp, "a", ["L"]), false);
  assert.deepEqual(loadImpressions({ all: ["a", 3], byList: { L: ["a"], M: "x" } }), { all: ["a"], byList: { L: ["a"], M: [] } });
});
