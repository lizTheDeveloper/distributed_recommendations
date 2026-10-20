// Analysis/editorial agent output (§10): apply AI-proposed editorial records from a JSON file.
// A proposal moves a record to `reviewed` with proposed_by set and reviewer left null; only
// approve.mjs, run with a named human reviewer, can move it on to `approved` (§10: AI does not get
// publication authority). A proposal may instead reject (`reject: "reason"`), which a human can
// reverse by re-running verify/approve.
//   node curation/scripts/propose.mjs proposals.json --by "claude-opus-5-5 (AI proposal)"
import { readFileSync } from "node:fs";
import { now, readRecords, transition, writeRecord } from "./lib.mjs";

export const WEIGHTS = { usefulness: 25, rigor: 25, mission: 20, distinctiveness: 10, accessibility: 10, currency: 10 };

/** §6: sum(weight * rating / 5), each rating 0–5, giving 0–100. */
export function editorialScore(ratings) {
  let total = 0;
  for (const [k, w] of Object.entries(WEIGHTS)) {
    const r = ratings?.[k];
    if (!Number.isInteger(r) || r < 0 || r > 5) throw new Error(`rating ${k} must be an integer 0–5`);
    total += (w * r) / 5;
  }
  return Math.round(total);
}

/** §6 thresholds. */
export function band(score) {
  return score >= 80 ? "feature-candidate" : score >= 65 ? "collection-candidate" : score >= 50 ? "editorial-review" : "reject";
}

const FIELDS = ["primary_collection", "secondary_collections", "shelves", "difficulty", "format", "learning_intents", "evidence_class", "tags", "why_selected", "learning_outcomes", "try_next", "context_note"];

if (import.meta.url === `file://${process.argv[1]}`) {
  const [file] = process.argv.slice(2);
  const by = process.argv.includes("--by") ? process.argv[process.argv.indexOf("--by") + 1] : null;
  if (!file || !by) throw new Error("usage: propose.mjs proposals.json --by <who>");
  const proposals = JSON.parse(readFileSync(file, "utf8"));
  const records = readRecords();
  let applied = 0;
  for (const p of proposals) {
    const hits = records.filter(({ rec }) => rec.id.startsWith(p.id));
    if (hits.length !== 1) throw new Error(`${p.id}: matches ${hits.length} records`);
    const { file: f, rec } = hits[0];
    if (!["verified", "reviewed", "rejected"].includes(rec.editorial.status)) throw new Error(`${rec.id}: status ${rec.editorial.status} can't take a proposal`);
    if (p.reject) {
      rec.editorial.rejection_reason = p.reject;
      rec.editorial.proposed_by = by;
      if (rec.editorial.status !== "rejected") transition(rec, "rejected", by, p.reject);
    } else {
      for (const k of FIELDS) if (k in p) rec.editorial[k] = p[k];
      if (rec.editorial.why_selected && rec.editorial.why_selected.length > 280) throw new Error(`${rec.id}: why_selected over 280 chars (it becomes the taste-list note)`);
      rec.editorial.ratings = p.ratings;
      rec.editorial.score = editorialScore(p.ratings);
      rec.editorial.band = band(rec.editorial.score);
      rec.editorial.judgment_basis = p.judgment_basis ?? "metadata only (title, description, channel, caption list); not watched — substantive judgments unverified";
      rec.editorial.proposed_by = by;
      if (p.identity) Object.assign(rec.verification, p.identity);
      if (rec.editorial.status !== "reviewed") transition(rec, "reviewed", by, `proposed score ${rec.editorial.score}`);
    }
    rec.editorial.proposed_at = now();
    writeRecord(f, rec);
    applied++;
  }
  console.log(`applied ${applied} proposals`);
}
