// Fetch a snapshot of real PeerTube API data for the offline artifact build, and
// (with --examples) regenerate the example taste lists in public/examples/.
//
//   npm run snapshot              # refresh src/snapshot/snapshot.json
//   npm run snapshot -- --examples  # also rewrite the example taste lists
//
// Only public, unauthenticated endpoints are used. Raw objects are trimmed to the
// fields the app reads, and thumbnails are dropped (the artifact sandbox can't load
// external images anyway).

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const INSTANCES = ["https://framatube.org", "https://tilvids.com"];
const PER_LIST = 30;

async function get(url) {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json();
}

function trim(v) {
  const out = {
    uuid: v.uuid,
    shortUUID: v.shortUUID,
    url: v.url,
    name: v.name,
    duration: v.duration,
    publishedAt: v.publishedAt,
    isLocal: v.isLocal,
    views: v.views,
    likes: v.likes,
    channel: v.channel && { name: v.channel.name, host: v.channel.host, displayName: v.channel.displayName },
  };
  if (v.language && v.language.id) out.language = { id: v.language.id };
  if (Array.isArray(v.tags)) out.tags = v.tags;
  return out;
}

const listUrl = (origin, sort, count) => `${origin}/api/v1/videos?count=${count}&sort=${sort}&nsfw=false`;

const snapshot = { fetchedAt: new Date().toISOString(), instances: {}, extra: [] };
for (const origin of INSTANCES) {
  const trending = await get(listUrl(origin, "-trending", PER_LIST));
  const recent = await get(listUrl(origin, "-publishedAt", PER_LIST));
  snapshot.instances[origin] = { trending: trending.data.map(trim), recent: recent.data.map(trim) };
  console.log(origin, trending.data.length, recent.data.length);
}

// Example taste lists: the most-viewed of an instance's last 100 local uploads, one
// pick per creator. Recent picks, so they still count under a 14-day half-life.
async function exampleList(origin, file, name, description) {
  const body = await get(listUrl(origin, "-publishedAt", 100) + "&isLocal=true");
  body.data.sort((a, b) => (b.views ?? 0) - (a.views ?? 0));
  const seen = new Set();
  const items = [];
  for (const v of body.data) {
    const creator = `${v.channel?.name}@${v.channel?.host}`;
    if (seen.has(creator) || !v.url) continue;
    seen.add(creator);
    items.push(v);
    if (items.length === 12) break;
  }
  const list = {
    v: 1,
    name,
    author: "Match Feed example data (not a real curator)",
    description,
    updatedAt: Math.floor(Date.now() / 1000),
    items: items.map((v) => ({ id: v.url })),
  };
  writeFileSync(join(root, "public/examples", file), JSON.stringify(list, null, 2) + "\n");
  console.log("wrote example", file, items.length);
}

if (process.argv.includes("--examples") || !existsSync(join(root, "public/examples/tilvids-picks.json"))) {
  mkdirSync(join(root, "public/examples"), { recursive: true });
  await exampleList(
    "https://tilvids.com",
    "tilvids-picks.json",
    "Example: TILvids recent standouts",
    "Example data, generated automatically: the most-viewed of tilvids.com's 100 newest local videos, one per channel. Not curated by a person.",
  );
  await exampleList(
    "https://framatube.org",
    "framatube-picks.json",
    "Example: Framatube recent standouts",
    "Example data, generated automatically: the most-viewed of framatube.org's 100 newest local videos, one per channel. Not curated by a person.",
  );
}

// Make sure every example-list video is in the snapshot, so lists resolve offline.
const known = new Set(Object.values(snapshot.instances).flatMap((i) => [...i.trending, ...i.recent]).map((v) => v.url));
for (const file of ["tilvids-picks.json", "framatube-picks.json"]) {
  const list = JSON.parse(readFileSync(join(root, "public/examples", file), "utf8"));
  for (const item of list.items) {
    if (known.has(item.id)) continue;
    const u = new URL(item.id);
    const id = u.pathname.split("/").pop();
    try {
      snapshot.extra.push(trim(await get(`${u.origin}/api/v1/videos/${id}`)));
      known.add(item.id);
    } catch (e) {
      console.warn("skip", item.id, e.message);
    }
  }
}

mkdirSync(join(root, "src/snapshot"), { recursive: true });
writeFileSync(join(root, "src/snapshot/snapshot.json"), JSON.stringify(snapshot));
console.log("snapshot videos:", known.size);
