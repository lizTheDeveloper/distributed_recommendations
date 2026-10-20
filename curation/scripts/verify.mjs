// Verification (§9.1 layer 2) and refresh (§10): fetch each record's video from its origin
// instance, never from a mirror or the search index, and record what the origin says: that the
// video exists at that URL, its channel actor URI, licence, language and captions.
//
// "origin_confirmed" means the video is really published by that channel on that instance. It is
// NOT creator identity verification (§5.3 step 3: matching the channel to an organization's
// official site). That is recorded by hand in sources.json, and this script copies it onto
// matching records; anything not in the registry stays "unverified".
//   node curation/scripts/verify.mjs [--status discovered] [--all]
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, canonical, clean, getJson, now, readRecords, sleep, transition, writeRecord } from "./lib.mjs";

const { sources } = JSON.parse(readFileSync(join(ROOT, "sources.json"), "utf8"));
/** The registry entry for a record's host and channel, if any (sources.json). */
const sourceFor = (host, channel) => sources.find((s) => s.host === host && (!s.channels || s.channels.includes(channel)));

const args = process.argv.slice(2);
const all = args.includes("--all");
const status = args.includes("--status") ? args[args.indexOf("--status") + 1] : "discovered";

let ok = 0, gone = 0, failed = 0;
for (const { file, rec } of readRecords()) {
  if (!all && rec.editorial.status !== status) continue;
  const { instance_host: host, video_uuid: uuid } = rec.source;
  const t = now();
  try {
    const v = await getJson(`https://${host}/api/v1/videos/${uuid}`);
    // The origin must say the video is its own; a remote copy would point elsewhere.
    if (!v.isLocal || v.uuid !== uuid || v.channel?.host !== host) throw new Error("origin does not report this video as local");
    const caps = await getJson(`https://${host}/api/v1/videos/${uuid}/captions`).catch(() => ({ data: [] }));
    const langs = [...new Set((caps.data ?? []).map((c) => c.language?.id).filter(Boolean))];
    Object.assign(rec.source, {
      video_url: canonical(host, uuid).url,
      channel_actor_uri: v.channel?.url ?? null,
      title: clean(v.name, 200),
      creator_display_name: clean(v.channel?.displayName, 120),
      license: v.licence?.label && v.licence.id ? clean(v.licence.label, 80) : null,
      language: v.language?.id ?? null,
      duration_s: v.duration,
      original_published_at: v.originallyPublishedAt ?? v.publishedAt ?? null,
      description: clean(v.description, 1500),
      tags: (v.tags ?? []).map((x) => clean(x, 40)).filter(Boolean).slice(0, 10),
      category: clean(v.category?.label, 40),
      views: v.views ?? null,
    });
    Object.assign(rec.verification, {
      origin_confirmed: true,
      verified_at: rec.verification.verified_at ?? t,
      verification_method: "origin instance REST API (/api/v1/videos/{uuid}, isLocal and channel host match)",
      captions_verified: langs.length > 0,
      caption_languages: langs,
      last_checked_at: t,
    });
    const src = sourceFor(host, rec.source.channel_handle?.split("@")[0]);
    Object.assign(rec.verification, src
      ? { identity_status: src.identity_status, identity_evidence: src.evidence, publisher: src.publisher }
      : { identity_status: "unverified", identity_evidence: null, publisher: null });
    if (rec.editorial.status === "discovered") transition(rec, "verified", "verify.mjs", "origin confirmed");
    if (rec.editorial.status === "needs-recheck") transition(rec, rec.audit.findLast((a) => a.to !== "needs-recheck")?.to ?? "verified", "verify.mjs", "available again");
    ok++;
  } catch (e) {
    rec.verification.last_checked_at = t;
    if (e.status === 404 || e.status === 410) {
      if (rec.editorial.status !== "needs-recheck") transition(rec, "needs-recheck", "verify.mjs", `origin returned ${e.status}`);
      gone++;
    } else {
      console.error(`${rec.id}: ${e.message}`);
      failed++;
    }
  }
  writeRecord(file, rec);
  await sleep(200);
}
console.log(`origin-confirmed ${ok}, gone ${gone}, errors ${failed}`);
