// Discovery (§9.1 layer 1): run each collection's query pack against Sepia Search and record new
// candidates as `discovered`. Never invents URLs: every candidate is a video Sepia returned, keyed
// by its origin host and uuid. Existing records are left alone (idempotent).
//   node curation/scripts/discover.mjs [--per-query 8] [--pack hack-the-planet]
//   node curation/scripts/discover.mjs --channel name@host --collection slug [--count 30]
// The --channel form lists a known publisher's own uploads from its origin instance (§5.2 leads).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, RECORDS, SEPIA, canonical, clean, getJson, now, sleep, writeRecord } from "./lib.mjs";

const args = process.argv.slice(2);
const opt = (name, dflt) => (args.includes(name) ? args[args.indexOf(name) + 1] : dflt);
const perQuery = Number(opt("--per-query", 8));
const onlyPack = opt("--pack", null);
const channel = opt("--channel", null);
const { packs } = JSON.parse(readFileSync(join(ROOT, "search-queries.json"), "utf8"));

let added = 0, seen = 0, skipped = 0;
function record(v, query, collection) {
  const viaChannel = query.startsWith("channel ");
  const host = v.channel?.host;
  if (!host || !v.uuid || v.nsfw || v.isLive || v.privacy?.id !== 1) { skipped++; return; }
  if (v.duration < 60) { skipped++; return; } // trailers and teasers rarely teach anything
  let c;
  try { c = canonical(host, v.uuid); } catch { skipped++; return; }
  const file = join(RECORDS, `${c.id}.json`);
  if (existsSync(file)) { seen++; return; }
  const t = now();
  writeRecord(file, {
    id: c.id,
    source: {
      video_url: c.url,
      video_uuid: v.uuid,
      channel_actor_uri: null,
      instance_host: host,
      title: clean(v.name, 200),
      creator_display_name: clean(v.channel?.displayName, 120),
      channel_handle: `${clean(v.channel?.name, 100)}@${host}`,
      license: null,
      language: v.language?.id ?? null,
      duration_s: v.duration,
      original_published_at: v.originallyPublishedAt ?? v.publishedAt ?? null,
    },
    discovery: { query, collection_hint: collection, service: viaChannel ? "origin channel listing" : "search.joinpeertube.org", at: t },
    editorial: {
      status: "discovered",
      primary_collection: null,
      secondary_collections: [],
      difficulty: null,
      format: null,
      learning_intents: [],
      evidence_class: null,
      tags: [],
      why_selected: null,
      learning_outcomes: [],
      try_next: null,
      context_note: null,
      ratings: null,
      score: null,
      judgment_basis: null,
      proposed_by: null,
      reviewer: null,
      reviewed_at: null,
      rejection_reason: null,
    },
    verification: {
      origin_confirmed: false,
      identity_status: "unverified",
      verified_at: null,
      verification_method: null,
      rights_status: "unknown",
      captions_verified: false,
      caption_languages: [],
      last_checked_at: null,
    },
    distribution: { mode: "link-only", featured: false, mirroring_authorized: false },
    audit: [{ at: t, from: null, to: "discovered", by: "discover.mjs", note: viaChannel ? query : `Sepia query "${query}"` }],
  });
  added++;
}

if (channel) {
  const [name, host] = channel.split("@");
  const collection = opt("--collection", null);
  const count = Number(opt("--count", 30));
  const data = (await getJson(`https://${host}/api/v1/video-channels/${encodeURIComponent(name)}/videos?count=${count}&sort=-publishedAt`)).data ?? [];
  for (const v of data) record(v, `channel ${channel}`, collection);
} else {
  for (const [collection, queries] of Object.entries(packs)) {
    if (onlyPack && collection !== onlyPack) continue;
    for (const query of queries) {
      const q = new URLSearchParams({ search: query, count: String(perQuery), sort: "-match", nsfw: "false", isLive: "false" });
      let data;
      try {
        data = (await getJson(`${SEPIA}/api/v1/search/videos?${q}`)).data ?? [];
      } catch (e) {
        console.error(`search failed for "${query}": ${e.message}`);
        continue;
      }
      for (const v of data) record(v, query, collection);
      await sleep(300); // be gentle with the shared search index
    }
  }
}
console.log(`discovered ${added} new, ${seen} already recorded, ${skipped} skipped`);
