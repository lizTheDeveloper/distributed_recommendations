import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DEFAULT_RECIPE, rank, seededRng } from "../src/lib/core.ts";
import type { Video } from "../src/lib/core.ts";
import { buildCandidates, disclosureIndex, listMembership } from "../src/lib/candidates.ts";
import type { NostrEvent, NostrFilter, PlaylistBundle, TasteDeps, TasteFollow, TasteResolution } from "../src/lib/creatortaste.ts";
import {
  CREATOR_TASTE_MAX_ITEMS,
  applyResolution,
  creatorTasteList,
  creatorVias,
  curationItems,
  curationSets,
  loadTasteFollows,
  playlistPicks,
  refreshDue,
  resolveCreatorTaste,
  rewriteWhy,
  tasteListUrls,
  trackKey,
  videoUrlFromEvent,
} from "../src/lib/creatortaste.ts";
import { verifyNostrEvent } from "../src/lib/tastesources.ts";
import { tasteDeps } from "../src/lib/tastesources.ts";
import { createCatalog } from "../src/lib/catalog.ts";
import type { Snapshot } from "../src/lib/snapshotFetch.ts";
import { snapshotFetch, snapshotTasteChannels } from "../src/lib/snapshotFetch.ts";
import { emptyImpressions, listStrength, recordImpression } from "../src/lib/trackrecord.ts";
import { loadVideo } from "../src/lib/videos.ts";
import { npubEncode as encodeNpub } from "../src/lib/bech32.ts";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";

const now = new Date("2026-10-19T12:00:00Z");
const ORIGIN = "https://tube.example";
const CH = "blender_channel@tube.example";
const ACCT = "blender@tube.example";

let n = 0;
/** A PeerTube video object as list/playlist endpoints return it. */
function ptVideo(channel: string, account: string, opts: { ageDays?: number; privacy?: number } = {}) {
  n++;
  const [cn, ch] = channel.split("@");
  const [an, ah] = account.split("@");
  return {
    uuid: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    url: `https://${ch}/videos/watch/00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    name: `Video ${n} by ${cn}`,
    duration: 120,
    publishedAt: new Date(now.getTime() - (opts.ageDays ?? 2) * 86_400_000).toISOString(),
    isLocal: false,
    privacy: { id: opts.privacy ?? 1 },
    channel: { name: cn, host: ch, displayName: cn },
    account: { name: an, host: ah },
  };
}
function playlist(name: string, els: unknown[], opts: { privacy?: number; type?: number; updatedAt?: string } = {}): PlaylistBundle {
  return {
    origin: ORIGIN,
    playlist: { uuid: name, url: `${ORIGIN}/w/p/${name}`, displayName: name, privacy: { id: opts.privacy ?? 1 }, type: { id: opts.type ?? 1 }, videosLength: els.length, updatedAt: opts.updatedAt ?? "2026-10-01T00:00:00Z" },
    elements: els.map((video, i) => ({ position: i + 1, type: 0, video })),
  };
}

test("playlist picks: public playlists only, the creator's own uploads (channel or account) excluded", () => {
  const own = ptVideo(CH, ACCT);
  const ownOtherChannel = ptVideo("blender_studio@tube.example", ACCT);
  const a = ptVideo("alice@a.example", "alice@a.example");
  const b = ptVideo("bob@b.example", "bob@b.example");
  const c = ptVideo("carol@c.example", "carol@c.example");
  const privateVideo = ptVideo("dan@d.example", "dan@d.example", { privacy: 2 });
  const deleted = { position: 9, type: 1, video: null };
  const newer = playlist("Favorites", [own, a, b], { updatedAt: "2026-10-10T00:00:00Z" });
  newer.elements.push(deleted);
  const older = playlist("Old picks", [ownOtherChannel, c, a, privateVideo], { updatedAt: "2026-01-01T00:00:00Z" });
  const priv = playlist("Private", [ptVideo("eve@e.example", "eve@e.example")], { privacy: 3 });
  const watchLater = playlist("Watch later", [ptVideo("fay@f.example", "fay@f.example")], { type: 2 });

  const r = playlistPicks(CH, ACCT, [older, priv, newer, watchLater]);
  // Newest playlist first, last-added element first; duplicates once.
  assert.deepEqual(r.items.map((i) => i.id), [b.url, a.url, c.url]);
  assert.deepEqual(r.playlists.map((p) => p.name), ["Favorites", "Old picks"]);
  assert.ok(r.items.every((i) => !i.sponsored && !i.affiliated));
  assert.equal(r.videos[0].creator, "bob@b.example");
  // Without the owner account, only the channel's own uploads are excluded.
  assert.ok(playlistPicks(CH, undefined, [older]).items.some((i) => i.id === ownOtherChannel.url));
  // Only own uploads: nothing.
  assert.equal(playlistPicks(CH, ACCT, [playlist("BCON", [own, ownOtherChannel])]).items.length, 0);
});

// ---- Nostr fixtures: real keys and signatures ----
const creatorSk = generateSecretKey();
const creatorPk = getPublicKey(creatorSk);
const bridgeSk = generateSecretKey();
const bridgePk = getPublicKey(bridgeSk);
const sign = (sk: Uint8Array, kind: number, tags: string[][], created_at = 1_790_000_000, content = "") =>
  finalizeEvent({ kind, tags, content, created_at }, sk) as unknown as NostrEvent;

function videoEvent(kind: number, url: string, d?: string, tagsMode: "both" | "r" | "none" = "both") {
  const uuid = url.split("/").pop()!;
  const tags: string[][] = [["title", "A video"]];
  if (d) tags.unshift(["d", d]);
  if (tagsMode === "both") tags.push(["r", url], ["origin", "peertube", uuid, url]);
  if (tagsMode === "r") tags.push(["r", url]);
  return sign(bridgeSk, kind, tags);
}

test("NIP-51: a signed kind-30005 set maps back to PeerTube URLs via origin / r tags", async () => {
  const u1 = "https://a.example/videos/watch/11111111-1111-4111-8111-111111111111";
  const u2 = "https://b.example/videos/watch/22222222-2222-4222-8222-222222222222";
  const u3 = "https://c.example/w/3333333333333333333333";
  const e1 = videoEvent(21, u1);
  const e2 = videoEvent(34235, u2, "22222222-2222-4222-8222-222222222222");
  const e3 = videoEvent(22, u3, undefined, "r");
  const noLink = videoEvent(21, "https://x.example/videos/watch/44444444-4444-4444-8444-444444444444", undefined, "none");
  assert.equal(videoUrlFromEvent(e1), u1);
  assert.equal(videoUrlFromEvent(e3), u3, "falls back to the r tag");
  assert.equal(videoUrlFromEvent(noLink), null);

  const oldSet = sign(creatorSk, 30005, [["d", "picks"], ["title", "Old"], ["e", e1.id]], 1_780_000_000);
  const set = sign(creatorSk, 30005, [["d", "picks"], ["title", "My picks"], ["e", e1.id], ["a", `34235:${bridgePk}:22222222-2222-4222-8222-222222222222`], ["e", e3.id], ["e", noLink.id]], 1_790_000_000);
  const forged = { ...sign(creatorSk, 30005, [["d", "evil"], ["e", e1.id]]), sig: "00".repeat(64) };
  const someoneElse = sign(generateSecretKey(), 30005, [["d", "x"], ["e", e1.id]]);

  const cs = await curationSets([oldSet, set, forged, someoneElse], creatorPk, verifyNostrEvent);
  assert.equal(cs.sets.length, 1, "forged and foreign sets are ignored; the newest version of each d wins");
  assert.equal(cs.sets[0].title, "My picks");
  const items = await curationItems(cs, [e1, e2, e3, noLink], verifyNostrEvent);
  // NIP-51 appends new items, so the last tag is the newest pick.
  assert.deepEqual(items.map((i) => i.id), [u3, u2, u1]);
  // A tampered video event is dropped.
  const tampered = { ...e3, tags: [...e3.tags, ["r", "https://evil.example/videos/watch/55555555-5555-4555-8555-555555555555"]] };
  assert.deepEqual((await curationItems(cs, [e1, e2, tampered], verifyNostrEvent)).map((i) => i.id), [u2, u1]);
});

/** Deps for resolution-order tests. */
function deps(o: { npub?: boolean; relays?: boolean; url?: string | null; listJson?: string; playlists?: PlaylistBundle[]; nostrEvents?: NostrEvent[]; profileFails?: boolean }): TasteDeps & { calls: string[] } {
  const calls: string[] = [];
  const text = [o.npub ? `Find me on Nostr: ${encodeNpub(creatorPk)}` : "", o.url ? `My taste list: ${o.url}` : "", "https://example.org/about"].join("\n");
  return {
    calls,
    now: () => now.getTime(),
    profile: async () => {
      calls.push("profile");
      if (o.profileFails) throw new Error("down");
      return { text, displayName: "Blender", ownerAccount: ACCT };
    },
    relays: o.relays ? ["wss://relay.example"] : [],
    nostrQuery: o.relays
      ? async (f: NostrFilter) => {
          calls.push("nostr");
          return (o.nostrEvents ?? []).filter((e) => (!f.kinds || f.kinds.includes(e.kind)) && (!f.authors || f.authors.includes(e.pubkey)) && (!f.ids || f.ids.includes(e.id)));
        }
      : undefined,
    verify: verifyNostrEvent,
    fetchText: async (url: string) => {
      calls.push("url:" + url);
      if (!o.listJson) throw new Error("returned 404");
      return o.listJson;
    },
    playlists: async (owner) => {
      calls.push("playlists:" + owner);
      return o.playlists ?? [];
    },
  };
}

test("resolution order: Nostr list, then linked taste list, then public playlists; the first with picks wins", async () => {
  const u1 = "https://a.example/videos/watch/11111111-1111-4111-8111-111111111111";
  const e1 = videoEvent(21, u1);
  const set = sign(creatorSk, 30005, [["d", "picks"], ["title", "Nostr picks"], ["e", e1.id]]);
  const pick = ptVideo("alice@a.example", "alice@a.example");
  const pls = [playlist("Favorites", [pick])];
  const listUrl = "https://lists.example/blender.json";
  const listJson = JSON.stringify({ v: 1, name: "Blender's list", items: [{ id: "https://z.example/videos/watch/zzzzzzzz-zzzz", sponsored: true }] });

  // 1. All three available: the signed Nostr list wins.
  let r = await resolveCreatorTaste(CH, "blender", deps({ npub: true, relays: true, nostrEvents: [set, e1], url: listUrl, listJson, playlists: pls }));
  assert.equal(r.taste?.source, "nostr");
  assert.equal(r.taste?.pubkey, creatorPk);
  assert.deepEqual(r.taste?.items.map((i) => i.id), [u1]);
  assert.deepEqual(r.attempts.map((a) => [a.source, a.outcome]), [["nostr", "found"]]);

  // 2. No relays configured: Nostr is skipped (never contacted), the linked list is used.
  const d2 = deps({ npub: true, relays: false, url: listUrl, listJson, playlists: pls });
  r = await resolveCreatorTaste(CH, "blender", d2);
  assert.equal(r.taste?.source, "url");
  assert.equal(r.taste?.items[0].sponsored, true, "sponsored flags from the list are kept");
  assert.deepEqual(r.attempts.map((a) => [a.source, a.outcome]), [["nostr", "skipped"], ["url", "found"]]);
  assert.match(r.attempts[0].note, /no relays configured/);
  assert.ok(!d2.calls.includes("nostr"));
  assert.ok(!d2.calls.some((c) => c.startsWith("playlists")), "later sources aren't fetched once one is found");

  // 3. No npub, no list link: public playlists.
  r = await resolveCreatorTaste(CH, "blender", deps({ playlists: pls }));
  assert.equal(r.taste?.source, "playlists");
  assert.equal(r.name, "Blender");
  assert.deepEqual(r.attempts.map((a) => a.outcome), ["skipped", "skipped", "found"]);
  assert.equal(r.taste?.videos.length, 1, "playlists carry video data: no lookup per item");

  // 3b. An npub with relays but no set, and a broken link: falls through to playlists.
  r = await resolveCreatorTaste(CH, "blender", deps({ npub: true, relays: true, nostrEvents: [], url: listUrl, playlists: pls }));
  assert.equal(r.taste?.source, "playlists");
  assert.deepEqual(r.attempts.map((a) => [a.source, a.outcome]), [["nostr", "none"], ["url", "error"], ["playlists", "found"]]);

  // 4. Nothing anywhere.
  r = await resolveCreatorTaste(CH, "blender", deps({ playlists: [playlist("BCON", [ptVideo(CH, ACCT)])] }));
  assert.equal(r.taste, null);
  assert.equal(r.attempts[2].outcome, "none");
  assert.match(r.attempts[2].note, /only the creator's own uploads/);

  // 5. Profile unavailable: playlists are still tried (without the owner account).
  const d5 = deps({ profileFails: true, playlists: pls });
  r = await resolveCreatorTaste(CH, "blender", d5);
  assert.equal(r.taste?.source, "playlists");
  assert.ok(d5.calls.includes("playlists:undefined"));
});

test("taste-list links in channel text", () => {
  assert.deepEqual(tasteListUrls("Picks: https://x.example/a.json.\nMy taste list → https://y.example/list\nhttps://shop.example/merch"), ["https://x.example/a.json", "https://y.example/list"]);
  assert.deepEqual(tasteListUrls("http://insecure.example/a.json"), []);
});

function follow(handle: string, name: string, picks: Video[], extra: Partial<TasteFollow> = {}): TasteFollow {
  return {
    handle,
    name,
    enabled: true,
    addedAt: 1,
    checkedAt: now.getTime(),
    taste: { handle, name, source: "playlists", detail: "Favorites", refs: [`${ORIGIN}/w/p/x`], items: picks.map((v) => ({ id: v.id, sponsored: false, affiliated: false })), videos: [], fetchedAt: now.getTime() },
    ...extra,
  };
}
const vid = (creator: string, ageDays = 1): Video => {
  n++;
  return { id: `https://${creator.split("@")[1]}/videos/watch/v${n}-xxxxxx`, title: `Pick ${n}`, creator, durationSec: 90, publishedAt: new Date(now.getTime() - ageDays * 86_400_000), tags: [] };
};

test("rank integration: kind taste, via = creator name, why-line names the source, capped per list", () => {
  const picks = Array.from({ length: 10 }, (_, i) => vid(`c${i}@p.example`, 1 + i * 0.1));
  const f = follow(CH, "Blender", picks);
  const byId = new Map(picks.map((v) => [v.id, v]));
  const vias = creatorVias([f], []);
  const list = creatorTasteList(f, vias.get(CH)!, (id) => byId.get(id))!;
  assert.equal(list.via, "Blender");
  assert.equal(list.trackKey, trackKey(CH));
  const cands = buildCandidates({ instances: [], follows: new Set(), followVideos: [], tasteLists: [list] });
  assert.ok(cands.every((c) => c.source.kind === "taste" && c.source.via === "Blender" && c.source.strength === 0.5), "a new list starts at core's 0.5");

  const ranked = rewriteWhy(rank(cands, DEFAULT_RECIPE, { now, limit: 20, rng: seededRng(1) }), [list]);
  assert.equal(ranked.length, 2, "maxPerTasteList (default 2) caps a creator's taste like any list");
  assert.ok(ranked.every((i) => i.primary === "taste"));
  assert.ok(ranked.every((i) => i.why.includes("In Blender's picks (public PeerTube playlist)")), JSON.stringify(ranked.map((i) => i.why)));
  const three = rank(cands, { ...DEFAULT_RECIPE, maxPerTasteList: 3 }, { now, limit: 20, rng: seededRng(1) });
  assert.equal(three.length, 3);

  // Disabled or empty: not a source.
  assert.equal(creatorTasteList({ ...f, enabled: false }, "Blender", (id) => byId.get(id)), null);
  assert.equal(creatorTasteList({ ...f, taste: null }, "Blender", (id) => byId.get(id)), null);
  // Same name as a subscribed list: the via is made unique (core caps per via).
  assert.equal(creatorVias([f], ["Blender"]).get(CH), `Blender (${CH})`);
});

test("track record: impressions and endorsements per creator taste set its strength", () => {
  const picks = Array.from({ length: 30 }, (_, i) => vid(`d${i}@q.example`));
  const f = follow(CH, "Blender", picks);
  const list = creatorTasteList(f, "Blender", (id) => picks.find((v) => v.id === id))!;
  const imp = emptyImpressions();
  const member = listMembership([list]);
  for (const v of picks) recordImpression(imp, v.id, member.get(v.id) ?? []);
  for (let i = 0; i < 60; i++) recordImpression(imp, `https://other.example/videos/watch/o${i}-xxxxxx`, []);
  assert.equal(imp.byList[trackKey(CH)].length, 30);
  const others = imp.all.filter((id) => id.includes("other.example")).slice(0, 10);
  const endorsed = new Set([...picks.slice(0, 15).map((v) => v.id), ...others]);
  const s = listStrength(imp, trackKey(CH), endorsed);
  assert.ok(s > 0.5, `a list the viewer endorses from gets stronger (${s})`);
  const weak = listStrength(imp, trackKey(CH), new Set(others));
  assert.ok(weak < 0.5, `and one they never endorse from gets weaker (${weak})`);
  const withStrength = creatorTasteList(f, "Blender", (id) => picks.find((v) => v.id === id), s)!;
  assert.ok(buildCandidates({ instances: [], follows: new Set(), followVideos: [], tasteLists: [withStrength] }).every((c) => c.source.strength === s));
});

test("sponsored / affiliated labels from a creator's linked list reach the card", () => {
  const v = vid("x@s.example");
  const f = follow(CH, "Blender", [v]);
  f.taste!.source = "url";
  f.taste!.items[0].sponsored = true;
  const list = creatorTasteList(f, "Blender", () => v)!;
  assert.deepEqual(disclosureIndex([list]).get(v.id)?.sponsored, ["Blender"]);
  assert.equal(list.why, "In Blender's picks (public taste list)");
});

test("stored follows are validated; a failed refresh keeps the previous picks; daily refresh", () => {
  const v = vid("x@s.example");
  const f = follow(CH, "Blender", [v]);
  const loaded = loadTasteFollows(JSON.parse(JSON.stringify([f, { handle: "nope" }, { ...f }, { handle: "b@c.example", taste: { source: "bogus" } }])));
  assert.equal(loaded.length, 2);
  assert.deepEqual(loaded[0].taste?.items, f.taste?.items);
  assert.equal(loaded[1].taste, null);
  const failed: TasteResolution = { handle: CH, name: "Blender", taste: null, attempts: [{ source: "playlists", outcome: "error", note: "couldn't reach it" }], checkedAt: now.getTime() + 5 };
  const kept = applyResolution(f, failed);
  assert.equal(kept.taste, f.taste);
  assert.match(kept.error!, /couldn't reach/);
  const gone: TasteResolution = { ...failed, attempts: [{ source: "playlists", outcome: "none", note: "no public playlists" }] };
  assert.equal(applyResolution(f, gone).taste, null, "the creator removed their picks: respect that");
  assert.equal(refreshDue(f, now.getTime() + 23 * 3600_000), false);
  assert.equal(refreshDue(f, now.getTime() + 25 * 3600_000), true);
  assert.equal(refreshDue({ ...f, enabled: false }, now.getTime() + 25 * 3600_000), false);
  assert.ok(CREATOR_TASTE_MAX_ITEMS <= 256);
});

test("offline snapshot: a curator's public playlist resolves through the same catalog code", async () => {
  const snap = JSON.parse(readFileSync(new URL("../src/snapshot/snapshot.json", import.meta.url), "utf8")) as Snapshot;
  const channels = snapshotTasteChannels(snap);
  assert.ok(channels.length >= 1, "the snapshot has at least one channel with public picks");
  const handle = channels[0];
  const [name, host] = handle.split("@");
  const catalog = createCatalog(snapshotFetch(snap));
  const ref = { name, host };
  const r = await resolveCreatorTaste(handle, name, tasteDeps({ catalog, ref, profile: () => catalog.channelProfile(ref, []), relays: ["wss://never.example"], live: false, now: () => now.getTime() }));
  assert.equal(r.taste?.source, "playlists");
  assert.equal(r.attempts[0].note.includes("no relays") || r.attempts[0].note.includes("npub"), true, "offline never queries relays");
  assert.ok(r.taste!.items.length >= 1);
  const own = r.taste!.videos.map(loadVideo).filter((v) => v && v.creator === handle);
  assert.equal(own.length, 0);
  // A snapshot channel without picks reads as none (the "No public picks yet" state).
  const none = Object.keys(snap.channels ?? {}).find((c) => !channels.includes(c));
  if (none) {
    const [n2, h2] = none.split("@");
    const r2 = await resolveCreatorTaste(none, n2, tasteDeps({ catalog, ref: { name: n2, host: h2 }, profile: () => catalog.channelProfile({ name: n2, host: h2 }, []), relays: [], live: false, now: () => now.getTime() }));
    assert.equal(r2.taste, null);
  }
});
