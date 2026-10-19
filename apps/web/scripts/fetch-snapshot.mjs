// Fetch a snapshot of real PeerTube API data for the offline artifact build, and
// (with --examples) regenerate the example taste lists in public/examples/.
//
//   npm run snapshot              # refresh src/snapshot/snapshot.json
//   npm run snapshot -- --examples  # also rewrite the example taste lists
//
// For "Follow taste" offline, it also captures the public profile and public
// playlists (with their elements) of a few channels: some curators known to keep
// public playlists of other creators' videos, and the snapshot channels that have
// public playlists at all. Everything is public, unauthenticated data.
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
// Channels known (2026-10-19) to keep public playlists of other creators' videos.
const TASTE_CURATORS = ["wex_channel@tilvids.com", "puppuccino_channel@tilvids.com", "the_tech_beast_channel@tilvids.com"];
// Snapshot channels checked for public playlists (most-represented first).
const TASTE_SCAN = 24;
const TASTE_PLAYLISTS = 4;
const TASTE_ELEMENTS = 30;

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
    aspectRatio: v.aspectRatio,
    isLive: v.isLive,
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
  // List endpoints omit tags; fetch them for recent videos so the offline build can
  // rank explore by tag relevance, as the live app does after an endorsement.
  for (const v of recent.data) {
    if (Array.isArray(v.tags)) continue;
    try {
      v.tags = (await get(`${origin}/api/v1/videos/${v.uuid}`)).tags ?? [];
    } catch {
      v.tags = [];
    }
  }
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

// ---- Follow taste: public profiles and playlists for a few channels ----
snapshot.channels = {};
snapshot.playlistVideos = {};
const str = (x) => (typeof x === "string" ? x : undefined);
const trimPlaylist = (p) => ({
  uuid: p.uuid,
  url: p.url,
  displayName: p.displayName,
  privacy: p.privacy && { id: p.privacy.id },
  type: p.type && { id: p.type.id },
  videosLength: p.videosLength,
  updatedAt: p.updatedAt,
  videoChannel: p.videoChannel && { name: p.videoChannel.name, host: p.videoChannel.host },
});
const trimElement = (e) => ({
  position: e.position,
  type: e.type,
  video: e.video && { ...trim(e.video), account: e.video.account && { name: e.video.account.name, host: e.video.account.host }, privacy: e.video.privacy && { id: e.video.privacy.id } },
});
async function captureTaste(handle, mustHave) {
  const [name, host] = handle.split("@");
  const origin = `https://${host}`;
  let info;
  try {
    info = await get(`${origin}/api/v1/video-channels/${encodeURIComponent(name)}`);
  } catch (e) {
    console.warn("taste: skip", handle, e.message);
    return;
  }
  const owner = info.ownerAccount ?? {};
  const isPub = (p) => p.privacy?.id === 1 && p.type?.id === 1 && p.videosLength > 0;
  const chan = (await get(`${origin}/api/v1/video-channels/${encodeURIComponent(name)}/video-playlists?count=50&sort=-updatedAt`)).data ?? [];
  let acct = [];
  if (owner.name && owner.host === host) {
    try {
      acct = (await get(`${origin}/api/v1/accounts/${encodeURIComponent(owner.name)}/video-playlists?count=50&sort=-updatedAt`)).data ?? [];
    } catch {
      acct = [];
    }
  }
  const pub = [...chan, ...acct].filter(isPub);
  if (!pub.length && !mustHave) return;
  const keep = [...new Map(pub.map((p) => [p.uuid, p])).values()].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0, TASTE_PLAYLISTS);
  for (const p of keep) {
    try {
      const els = (await get(`${origin}/api/v1/video-playlists/${p.uuid}/videos?count=${TASTE_ELEMENTS}`)).data ?? [];
      snapshot.playlistVideos[p.uuid] = els.map(trimElement);
    } catch (e) {
      console.warn("taste: playlist", p.uuid, e.message);
    }
  }
  // Channels whose playlists hold only their own uploads: keep two elements each,
  // enough for the app to say "No public picks yet", to keep the artifact small.
  const own = (e) => !e.video || `${e.video.account?.name}@${e.video.account?.host}` === `${owner.name}@${owner.host}`;
  if (!mustHave && keep.every((p) => (snapshot.playlistVideos[p.uuid] ?? []).every(own))) {
    keep.splice(2);
    for (const p of keep) snapshot.playlistVideos[p.uuid] = (snapshot.playlistVideos[p.uuid] ?? []).slice(0, 2);
    for (const k of Object.keys(snapshot.playlistVideos)) if (!keep.some((p) => p.uuid === k) && (chan.concat(acct)).some((p) => p.uuid === k)) delete snapshot.playlistVideos[k];
  }
  const kept = new Set(keep.map((p) => p.uuid));
  snapshot.channels[handle] = {
    info: {
      displayName: str(info.displayName),
      description: str(info.description)?.slice(0, 600),
      support: str(info.support)?.slice(0, 600),
      ownerAccount: { name: owner.name, host: owner.host, description: str(owner.description)?.slice(0, 600) },
    },
    playlists: chan.filter((p) => kept.has(p.uuid)).map(trimPlaylist),
    accountPlaylists: acct.filter((p) => kept.has(p.uuid)).map(trimPlaylist),
  };
  const others = keep.flatMap((p) => snapshot.playlistVideos[p.uuid] ?? []).filter((e) => e.video && `${e.video.account?.name}@${e.video.account?.host}` !== `${owner.name}@${owner.host}`).length;
  console.log("taste:", handle, keep.length, "public playlists,", others, "items by others");
}
const counts = new Map();
for (const v of Object.values(snapshot.instances).flatMap((i) => [...i.trending, ...i.recent])) {
  const k = `${v.channel?.name}@${v.channel?.host}`;
  counts.set(k, (counts.get(k) ?? 0) + 1);
}
for (const handle of TASTE_CURATORS) await captureTaste(handle, true);
for (const [handle] of [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, TASTE_SCAN)) {
  if (!snapshot.channels[handle]) await captureTaste(handle, false);
}

mkdirSync(join(root, "src/snapshot"), { recursive: true });
writeFileSync(join(root, "src/snapshot/snapshot.json"), JSON.stringify(snapshot));
console.log("snapshot videos:", known.size);
