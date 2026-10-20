// Human reviewer step (§10): approve, reject or remove records. This is the only way a record
// reaches `approved`, and it needs a named human reviewer. Removal (§8) takes a record out of
// every collection on the next publish; bringing it back needs a fresh review.
//   node curation/scripts/approve.mjs --reviewer "Liz" approve <id-prefix>...
//   node curation/scripts/approve.mjs --reviewer "Liz" reject <id-prefix> --reason "…"
//   node curation/scripts/approve.mjs --reviewer "Liz" remove <id-prefix> --reason "…"
//   node curation/scripts/approve.mjs --reviewer "Liz" approve --min-score 80   (every reviewed record at or above)
// --note "…" adds context to the audit entry, e.g. that the reviewer delegated the decision.
import { now, readRecords, transition, writeRecord } from "./lib.mjs";

/** Reviewers are people. Anything that looks like an agent or a script is refused. */
export function assertHumanReviewer(name) {
  if (typeof name !== "string" || name.trim().length < 2) throw new Error("--reviewer <name> is required");
  if (/\b(ai|bot|claude|gpt|gemini|llama|qwen|agent|proposal|script|\.mjs)\b/i.test(name)) throw new Error(`"${name}" doesn't look like a human reviewer`);
  return name.trim();
}

const ALLOWED = { approve: ["reviewed"], reject: ["discovered", "verified", "reviewed", "approved"], remove: ["approved", "published"] };

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const take = (flag) => {
    const i = args.indexOf(flag);
    if (i < 0) return null;
    const [, v] = args.splice(i, 2);
    return v;
  };
  const reviewer = assertHumanReviewer(take("--reviewer"));
  const reason = take("--reason");
  const minScore = take("--min-score");
  const note = take("--note");
  const [action, ...prefixes] = args;
  if (!ALLOWED[action]) throw new Error("action must be approve, reject or remove");
  if (action !== "approve" && !reason) throw new Error(`${action} needs --reason`);

  const records = readRecords();
  const targets =
    minScore != null
      ? records.filter(({ rec }) => rec.editorial.status === "reviewed" && rec.editorial.score >= Number(minScore))
      : prefixes.map((p) => {
          const hits = records.filter(({ rec }) => rec.id.startsWith(p));
          if (hits.length !== 1) throw new Error(`${p}: matches ${hits.length} records`);
          return hits[0];
        });

  for (const { file, rec } of targets) {
    if (!ALLOWED[action].includes(rec.editorial.status)) throw new Error(`${rec.id}: can't ${action} from ${rec.editorial.status}`);
    const t = now();
    if (action === "approve") {
      if (!rec.verification.origin_confirmed) throw new Error(`${rec.id}: origin not confirmed; run verify.mjs first`);
      rec.editorial.reviewer = reviewer;
      rec.editorial.reviewed_at = t;
      transition(rec, "approved", reviewer, note ?? undefined);
    } else if (action === "reject") {
      rec.editorial.rejection_reason = reason;
      rec.editorial.reviewer = reviewer;
      rec.editorial.reviewed_at = t;
      transition(rec, "rejected", reviewer, reason);
    } else {
      rec.editorial.removal_reason = reason;
      rec.distribution.featured = false;
      transition(rec, "removed", reviewer, reason);
    }
    writeRecord(file, rec);
  }
  console.log(`${action}: ${targets.length} record(s) by ${reviewer}`);
}
