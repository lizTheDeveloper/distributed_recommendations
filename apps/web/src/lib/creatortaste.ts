// "Follow taste": add a creator's public picks (not their uploads) to the on-device
// ranking. Pure logic: source resolution, NIP-51 and PeerTube playlist mapping, the
// stored form of followed tastes, and how they enter rank(). Network access is
// injected (`TasteDeps`); see tastesources.ts for the live and offline adapters.
//
// Sources, tried in this order (docs/WEB_APP.md, "Follow taste"):
//   1. nostr      a NIP-51 video curation set (kind 30005) signed by the npub the
//                 creator publishes in their channel description or support text,
//                 read only from relays the viewer configured;
//   2. url        a taste list (format v1) linked in the channel description;
//   3. playlists  the creator's public PeerTube playlists (channel and account),
//                 minus the creator's own uploads.

import type { RankedItem, Video } from "./core.ts";
import { peertubeVideoToVideo } from "./core.ts";
import { findNpub } from "./bech32.ts";
import type { ResolvedTasteList } from "./candidates.ts";
import type { TasteItem, TasteList } from "./tastelist.ts";
import { parseTasteList, parseTasteListJson } from "./tastelist.ts";
import type { StoredVideo } from "./videos.ts";
import { loadVideo, storeVideo, watchId } from "./videos.ts";

export type TasteSourceKind = "nostr" | "url" | "playlists";
export const SOURCE_ORDER: readonly TasteSourceKind[] = ["nostr", "url", "playlists"];

/** Long labels (sheet, management). */
export const SOURCE_LABEL: Record<TasteSourceKind, string> = {
  nostr: "Signed Nostr list (NIP-51 video curation set)",
  url: "Taste list linked in the channel description",
  playlists: "Public PeerTube playlists",
};

/** Short labels for why-lines: `In Blender's picks (public PeerTube playlist)`. */
export function sourceShort(t: Pick<CreatorTaste, "source" | "refs">): string {
  if (t.source === "nostr") return "signed Nostr list";
  if (t.source === "url") return "public taste list";
  return t.refs.length > 1 ? "public PeerTube playlists" : "public PeerTube playlist";
}

/** NIP-51 "Curation sets" for videos. */
export const KIND_VIDEO_CURATION = 30005;
/** NIP-71 video kinds: regular 21/22, addressable 34235/34236 (what our bridge emits). */
export const VIDEO_KINDS: readonly number[] = [21, 22, 34235, 34236];
const ADDRESSABLE_VIDEO_KINDS = [34235, 34236];

/** Newest picks kept per creator (core's per-list cap shows at most 2 per page anyway). */
export const CREATOR_TASTE_MAX_ITEMS = 100;
/** Playlists read per creator (each is one request). */
export const MAX_PLAYLISTS = 8;
/** How long a followed taste is used before it's fetched again. */
export const TASTE_REFRESH_MS = 24 * 60 * 60 * 1000;

const HEX64 = /^[0-9a-f]{64}$/;

export interface CreatorTaste {
  /** Channel handle, lowercased `name@host`. */
  handle: string;
  /** Creator display name. */
  name: string;
  source: TasteSourceKind;
  /** What was found: playlist names, the list's name, or the set titles. */
  detail: string;
  /** Where: playlist pages, the list URL, or `30005:<pubkey>:<d>` addresses. */
  refs: string[];
  /** The creator's pubkey (hex), for the nostr source. */
  pubkey?: string;
  /** Picks, newest first. Ids are canonical watch URLs. */
  items: TasteItem[];
  /** Video data the source already carried (playlists do), so no lookup per item. */
  videos: StoredVideo[];
  /** When it was fetched (ms). */
  fetchedAt: number;
}

export type AttemptOutcome = "found" | "none" | "skipped" | "error";
export interface SourceAttempt {
  source: TasteSourceKind;
  outcome: AttemptOutcome;
  note: string;
}
export interface TasteResolution {
  handle: string;
  name: string;
  taste: CreatorTaste | null;
  /** One entry per source, in the order tried (shown in the sheet). */
  attempts: SourceAttempt[];
  checkedAt: number;
}

// ---------------------------------------------------------------- Nostr (NIP-51)

export interface NostrEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

/** NIP-01 filter fields this feature needs. */
export interface NostrFilter {
  kinds?: number[];
  authors?: string[];
  ids?: string[];
  "#d"?: string[];
  limit?: number;
}

export type CurationRef = { type: "e"; id: string } | { type: "a"; kind: number; pubkey: string; d: string };

export interface CurationSets {
  /** The latest version of each set (by `d`), newest first. */
  sets: { d: string; title: string; createdAt: number; refs: CurationRef[] }[];
}

/**
 * The creator's public video curation sets. Only kind 30005 events signed by
 * `pubkey` count (signature checked by `verify`); for each `d` the newest wins
 * (addressable events). Only public items (tags) are read: private items are
 * NIP-44-encrypted to the author and aren't ours to read. NIP-51 lists `e` refs to
 * kind-21 videos; `a` refs to addressable video events (34235/34236, which our bridge
 * emits) are accepted too.
 */
export async function curationSets(events: readonly NostrEvent[], pubkey: string, verify: (e: NostrEvent) => Promise<boolean>): Promise<CurationSets> {
  const latest = new Map<string, NostrEvent>();
  for (const e of events) {
    if (e.kind !== KIND_VIDEO_CURATION || e.pubkey !== pubkey) continue;
    const d = e.tags.find((t) => t[0] === "d")?.[1] ?? "";
    const prev = latest.get(d);
    if (prev && (prev.created_at > e.created_at || (prev.created_at === e.created_at && prev.id <= e.id))) continue;
    if (!(await verify(e))) continue;
    latest.set(d, e);
  }
  const sets = [...latest.entries()]
    .sort((a, b) => b[1].created_at - a[1].created_at)
    .map(([d, e]) => {
      const refs: CurationRef[] = [];
      for (const t of e.tags) {
        if (t[0] === "e" && HEX64.test(t[1] ?? "")) refs.push({ type: "e", id: t[1] });
        else if (t[0] === "a") {
          const m = /^(\d+):([0-9a-f]{64}):(.{1,200})$/.exec(t[1] ?? "");
          if (m && VIDEO_KINDS.includes(Number(m[1]))) refs.push({ type: "a", kind: Number(m[1]), pubkey: m[2], d: m[3] });
        }
      }
      // NIP-51: new items are appended, so the last tag is the newest pick.
      refs.reverse();
      const title = e.tags.find((t) => t[0] === "title")?.[1] || d || "Video picks";
      return { d, title: title.slice(0, 80), createdAt: e.created_at, refs };
    });
  return { sets };
}

/**
 * A NIP-71 video event back to its PeerTube watch URL: the `origin` tag
 * (`["origin", "peertube", <uuid>, <url>]`) first, then any `r` tag that is a
 * PeerTube watch URL. Our bridge emits both.
 */
export function videoUrlFromEvent(e: NostrEvent): string | null {
  if (!VIDEO_KINDS.includes(e.kind)) return null;
  for (const t of e.tags) if (t[0] === "origin" && t[1] === "peertube" && t[3] && watchId(t[3])) return t[3];
  for (const t of e.tags) if (t[0] === "r" && t[1] && watchId(t[1])) return t[1];
  return null;
}

/** Filters for the video events a set references (ids, and addressable coordinates). */
export function refFilters(refs: readonly CurationRef[]): NostrFilter[] {
  const ids = [...new Set(refs.filter((r) => r.type === "e").map((r) => (r as { id: string }).id))].slice(0, 256);
  const addrs = refs.filter((r): r is Extract<CurationRef, { type: "a" }> => r.type === "a");
  const out: NostrFilter[] = [];
  if (ids.length) out.push({ ids });
  if (addrs.length) {
    out.push({
      kinds: [...new Set(addrs.map((a) => a.kind))],
      authors: [...new Set(addrs.map((a) => a.pubkey))].slice(0, 64),
      "#d": [...new Set(addrs.map((a) => a.d))].slice(0, 256),
    });
  }
  return out;
}

/** Map set refs to picks through the fetched (and signature-checked) video events. */
export async function curationItems(cs: CurationSets, events: readonly NostrEvent[], verify: (e: NostrEvent) => Promise<boolean>): Promise<TasteItem[]> {
  const byId = new Map<string, NostrEvent>();
  const byAddr = new Map<string, NostrEvent>();
  for (const e of events) {
    if (!VIDEO_KINDS.includes(e.kind)) continue;
    byId.set(e.id, e);
    if (ADDRESSABLE_VIDEO_KINDS.includes(e.kind)) {
      const key = `${e.kind}:${e.pubkey}:${e.tags.find((t) => t[0] === "d")?.[1] ?? ""}`;
      const prev = byAddr.get(key);
      if (!prev || prev.created_at < e.created_at) byAddr.set(key, e);
    }
  }
  const items: TasteItem[] = [];
  const seen = new Set<string>();
  for (const set of cs.sets) {
    for (const r of set.refs) {
      const e = r.type === "e" ? byId.get(r.id) : byAddr.get(`${r.kind}:${r.pubkey}:${r.d}`);
      if (!e || (r.type === "a" && e.pubkey !== r.pubkey)) continue;
      const url = videoUrlFromEvent(e);
      if (!url || seen.has(url) || !(await verify(e))) continue;
      seen.add(url);
      items.push({ id: url, sponsored: false, affiliated: false, addedAt: set.createdAt });
      if (items.length >= CREATOR_TASTE_MAX_ITEMS) return items;
    }
  }
  return items;
}

// ---------------------------------------------------------------- taste-list URL

/**
 * Taste-list links in a channel's description or support text: https URLs ending in
 * `.json`, or with "taste" in the URL or on the same line. At most 3.
 */
export function tasteListUrls(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    for (const m of line.matchAll(/https:\/\/[^\s<>"'`)\]]+/g)) {
      const url = m[0].replace(/[.,;:!?]+$/, "");
      let u: URL;
      try {
        u = new URL(url);
      } catch {
        continue;
      }
      if (/\.json$/i.test(u.pathname) || /taste/i.test(url) || /taste/i.test(line)) {
        if (!out.includes(u.toString())) out.push(u.toString());
      }
    }
  }
  return out.slice(0, 3);
}

// ---------------------------------------------------------------- PeerTube playlists

/** One playlist (`/api/v1/video-playlists` object) and its elements (`…/videos`). */
export interface PlaylistBundle {
  origin: string;
  playlist: unknown;
  elements: unknown[];
}

const obj = (x: unknown): Record<string, unknown> | null => (typeof x === "object" && x !== null && !Array.isArray(x) ? (x as Record<string, unknown>) : null);
const handleOfActor = (x: unknown): string | null => {
  const o = obj(x);
  return o && typeof o.name === "string" && typeof o.host === "string" ? `${o.name}@${o.host}`.toLowerCase() : null;
};
const idOf = (x: unknown): number | undefined => {
  const o = obj(x);
  return o && typeof o.id === "number" ? o.id : undefined;
};

/** PeerTube: privacy 1 = Public; playlist type 1 = Regular (2 = Watch later). */
export function isPublicPlaylist(p: unknown): boolean {
  const o = obj(p);
  return !!o && idOf(o.privacy) === 1 && (o.type === undefined || idOf(o.type) === 1);
}

/**
 * The creator's picks from their public playlists: every video in a Public, Regular
 * playlist that the creator didn't upload (neither this channel nor any channel of
 * its owner account). Playlists most recently updated come first; within one, the
 * last-added element first. Deleted, private and unavailable elements are skipped.
 */
export function playlistPicks(
  channel: string,
  ownerAccount: string | undefined,
  bundles: readonly PlaylistBundle[],
): { items: TasteItem[]; videos: Video[]; playlists: { name: string; url: string }[] } {
  const ch = channel.toLowerCase();
  const acct = ownerAccount?.toLowerCase();
  const sorted = bundles
    .filter((b) => isPublicPlaylist(b.playlist))
    .map((b) => ({ b, updated: Date.parse(String(obj(b.playlist)!.updatedAt ?? "")) || 0 }))
    .sort((x, y) => y.updated - x.updated);
  const items: TasteItem[] = [];
  const videos: Video[] = [];
  const used: { name: string; url: string }[] = [];
  const seen = new Set<string>();
  for (const { b, updated } of sorted) {
    const p = obj(b.playlist)!;
    let took = 0;
    const els = [...b.elements]
      .map((e) => obj(e))
      .filter((e): e is Record<string, unknown> => !!e)
      .sort((x, y) => (Number(y.position) || 0) - (Number(x.position) || 0));
    for (const el of els) {
      if (el.type !== undefined && el.type !== 0) continue; // 0 = regular; 1 deleted, 2 private, 3 unavailable
      const raw = obj(el.video);
      if (!raw) continue;
      if (raw.privacy !== undefined && idOf(raw.privacy) !== 1) continue;
      if (raw.isLive === true) continue;
      const vch = handleOfActor(raw.channel);
      const vacct = handleOfActor(raw.account);
      if ((vch && vch === ch) || (acct && vacct === acct)) continue; // the creator's own upload
      const v = peertubeVideoToVideo(raw, b.origin);
      if (!v || seen.has(v.id) || !watchId(v.id)) continue;
      seen.add(v.id);
      items.push({ id: v.id, sponsored: false, affiliated: false, ...(updated ? { addedAt: Math.floor(updated / 1000) } : {}) });
      videos.push(v);
      took++;
      if (items.length >= CREATOR_TASTE_MAX_ITEMS) break;
    }
    if (took) used.push({ name: typeof p.displayName === "string" ? p.displayName.slice(0, 80) : "Playlist", url: typeof p.url === "string" ? p.url : "" });
    if (items.length >= CREATOR_TASTE_MAX_ITEMS) break;
  }
  return { items, videos, playlists: used };
}

// ---------------------------------------------------------------- resolution

export interface CreatorProfileInfo {
  text: string;
  displayName?: string;
  /** Owner account handle, `name@host`. */
  ownerAccount?: string;
}

export interface TasteDeps {
  now(): number;
  profile(): Promise<CreatorProfileInfo>;
  /** Relays the viewer configured. Empty: the Nostr source is skipped. */
  relays: readonly string[];
  nostrQuery?(filter: NostrFilter): Promise<NostrEvent[]>;
  /** Event id and signature check. */
  verify(e: NostrEvent): Promise<boolean>;
  /** GET a URL as text (absent offline: the URL source is skipped). */
  fetchText?(url: string): Promise<string>;
  playlists(ownerAccount: string | undefined): Promise<PlaylistBundle[]>;
}

const errNote = (e: unknown) => (e instanceof TypeError ? "couldn't reach it" : e instanceof Error ? e.message : String(e)).slice(0, 160);

/** Try the three sources in order; the first with at least one pick wins. */
export async function resolveCreatorTaste(handle: string, fallbackName: string, deps: TasteDeps): Promise<TasteResolution> {
  const h = handle.toLowerCase();
  const attempts: SourceAttempt[] = [];
  let profile: CreatorProfileInfo | null = null;
  let profileErr = "";
  try {
    profile = await deps.profile();
  } catch (e) {
    profileErr = errNote(e);
  }
  const name = (profile?.displayName || fallbackName || h).slice(0, 60);
  const done = (taste: CreatorTaste | null): TasteResolution => ({ handle: h, name, taste, attempts, checkedAt: deps.now() });
  const base = { handle: h, name, fetchedAt: deps.now() };

  // 1. A signed NIP-51 list from the creator's published npub.
  const pk = profile ? findNpub(profile.text) : null;
  if (!profile) attempts.push({ source: "nostr", outcome: "skipped", note: `channel profile unavailable (${profileErr})` });
  else if (!pk) attempts.push({ source: "nostr", outcome: "skipped", note: "no npub in the channel description" });
  else if (!deps.relays.length || !deps.nostrQuery) attempts.push({ source: "nostr", outcome: "skipped", note: "no relays configured" });
  else {
    try {
      const sets = await curationSets(await deps.nostrQuery({ kinds: [KIND_VIDEO_CURATION], authors: [pk], limit: 20 }), pk, deps.verify);
      const refs = sets.sets.flatMap((s) => s.refs);
      if (!refs.length) attempts.push({ source: "nostr", outcome: "none", note: "no public video curation set (kind 30005) from this npub" });
      else {
        const evs: NostrEvent[] = [];
        for (const f of refFilters(refs)) evs.push(...(await deps.nostrQuery(f)));
        const items = await curationItems(sets, evs, deps.verify);
        if (!items.length) attempts.push({ source: "nostr", outcome: "none", note: "its videos don't point back to PeerTube (no origin or r tag)" });
        else {
          attempts.push({ source: "nostr", outcome: "found", note: `${items.length} picks` });
          return done({ ...base, source: "nostr", pubkey: pk, detail: sets.sets.map((s) => s.title).join(", ").slice(0, 200), refs: sets.sets.map((s) => `${KIND_VIDEO_CURATION}:${pk}:${s.d}`), items, videos: [] });
        }
      }
    } catch (e) {
      attempts.push({ source: "nostr", outcome: "error", note: errNote(e) });
    }
  }

  // 2. A taste-list URL in the channel description.
  const urls = profile ? tasteListUrls(profile.text) : [];
  if (!profile) attempts.push({ source: "url", outcome: "skipped", note: "channel profile unavailable" });
  else if (!urls.length) attempts.push({ source: "url", outcome: "skipped", note: "no taste-list link in the channel description" });
  else if (!deps.fetchText) attempts.push({ source: "url", outcome: "skipped", note: "needs the network" });
  else {
    let note = "";
    for (const url of urls) {
      try {
        const list = parseTasteListJson(await deps.fetchText(url));
        if (!list.items.length) {
          note = "the linked list is empty";
          continue;
        }
        const items = [...list.items].sort((a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0)).slice(0, CREATOR_TASTE_MAX_ITEMS);
        attempts.push({ source: "url", outcome: "found", note: `${items.length} picks` });
        return done({ ...base, source: "url", detail: list.name, refs: [url], items, videos: [] });
      } catch (e) {
        note = `${new URL(url).host}: ${errNote(e)}`;
      }
    }
    attempts.push({ source: "url", outcome: note.includes(":") ? "error" : "none", note: note || "not a taste list" });
  }

  // 3. Public PeerTube playlists, minus the creator's own uploads.
  try {
    const bundles = await deps.playlists(profile?.ownerAccount);
    const pub = bundles.filter((b) => isPublicPlaylist(b.playlist));
    const picks = playlistPicks(h, profile?.ownerAccount, bundles);
    if (!picks.items.length) {
      attempts.push({ source: "playlists", outcome: "none", note: pub.length ? `${pub.length} public playlist${pub.length === 1 ? "" : "s"}, only the creator's own uploads` : "no public playlists" });
    } else {
      attempts.push({ source: "playlists", outcome: "found", note: `${picks.items.length} picks in ${picks.playlists.length} playlist${picks.playlists.length === 1 ? "" : "s"}` });
      return done({
        ...base,
        source: "playlists",
        detail: picks.playlists.map((p) => p.name).join(", ").slice(0, 200),
        refs: picks.playlists.map((p) => p.url).filter(Boolean),
        items: picks.items,
        videos: picks.videos.map(storeVideo),
      });
    }
  } catch (e) {
    attempts.push({ source: "playlists", outcome: "error", note: errNote(e) });
  }
  return done(null);
}

// ---------------------------------------------------------------- followed tastes (vault)

export interface TasteFollow {
  handle: string;
  name: string;
  /** Off: kept in the list, left out of ranking. */
  enabled: boolean;
  addedAt: number;
  /** Last check (ms), successful or not. */
  checkedAt: number;
  /** Last good result; null when the last check found no picks. */
  taste: CreatorTaste | null;
  /** Why the last refresh failed (network), if it did. The previous taste is kept. */
  error?: string;
}

function loadTaste(x: unknown): CreatorTaste | null {
  const o = obj(x);
  if (!o || typeof o.handle !== "string" || typeof o.name !== "string" || !SOURCE_ORDER.includes(o.source as TasteSourceKind)) return null;
  let items: TasteItem[];
  try {
    // Same validation as an imported list (ids, flags, sizes).
    items = parseTasteList({ v: 1, name: "x", items: Array.isArray(o.items) ? o.items.slice(0, CREATOR_TASTE_MAX_ITEMS) : [] }).items;
  } catch {
    return null;
  }
  const t: CreatorTaste = {
    handle: o.handle.toLowerCase(),
    name: o.name.slice(0, 60),
    source: o.source as TasteSourceKind,
    detail: typeof o.detail === "string" ? o.detail.slice(0, 200) : "",
    refs: Array.isArray(o.refs) ? o.refs.filter((r): r is string => typeof r === "string").slice(0, 16) : [],
    items,
    videos: Array.isArray(o.videos) ? (o.videos.map(loadVideo).filter(Boolean) as Video[]).slice(0, CREATOR_TASTE_MAX_ITEMS).map(storeVideo) : [],
    fetchedAt: Number(o.fetchedAt) || 0,
  };
  if (typeof o.pubkey === "string" && HEX64.test(o.pubkey)) t.pubkey = o.pubkey;
  return t;
}

/** Validate followed tastes read from the vault (invalid entries are dropped). */
export function loadTasteFollows(x: unknown): TasteFollow[] {
  if (!Array.isArray(x)) return [];
  const out: TasteFollow[] = [];
  for (const r of x) {
    const o = obj(r);
    if (!o || typeof o.handle !== "string" || !/^[^@\s]+@[^@\s]+$/.test(o.handle)) continue;
    if (out.some((f) => f.handle === o.handle)) continue;
    const f: TasteFollow = {
      handle: o.handle.toLowerCase(),
      name: typeof o.name === "string" ? o.name.slice(0, 60) : o.handle,
      enabled: o.enabled !== false,
      addedAt: Number(o.addedAt) || 0,
      checkedAt: Number(o.checkedAt) || 0,
      taste: loadTaste(o.taste),
    };
    if (typeof o.error === "string") f.error = o.error.slice(0, 200);
    out.push(f);
  }
  return out;
}

/** Apply a fresh resolution to a followed taste. A network error keeps the old picks. */
export function applyResolution(f: TasteFollow, r: TasteResolution): TasteFollow {
  const failed = !r.taste && r.attempts.some((a) => a.outcome === "error") && !r.attempts.some((a) => a.outcome === "none");
  if (failed) return { ...f, checkedAt: r.checkedAt, error: r.attempts.filter((a) => a.outcome === "error").map((a) => a.note).join("; ") };
  const next: TasteFollow = { ...f, name: r.name || f.name, checkedAt: r.checkedAt, taste: r.taste };
  delete next.error;
  return next;
}

export function refreshDue(f: TasteFollow, now: number, maxAgeMs = TASTE_REFRESH_MS): boolean {
  return f.enabled && now - f.checkedAt >= maxAgeMs;
}

// ---------------------------------------------------------------- ranking

/** Track-record key for a creator's taste (stable across renames). */
export const trackKey = (handle: string) => `creator:${handle.toLowerCase()}`;

/**
 * `via` names for followed tastes: the creator's name, made unique against
 * subscribed list names and each other, since core caps per `via`.
 */
export function creatorVias(follows: readonly TasteFollow[], taken: readonly string[]): Map<string, string> {
  const used = new Set(taken);
  const out = new Map<string, string>();
  for (const f of follows) {
    let via = f.taste?.name || f.name;
    if (used.has(via)) via = `${via} (${f.handle})`;
    used.add(via);
    out.set(f.handle, via);
  }
  return out;
}

/**
 * A followed taste as a ranker source: kind `taste`, `via` = creator name, strength
 * from its own track record. Items missing from `videos` (e.g. Nostr or URL picks
 * not resolved yet) are left out until they resolve.
 */
export function creatorTasteList(f: TasteFollow, via: string, videos: (id: string) => Video | undefined, strength?: number): ResolvedTasteList | null {
  const t = f.taste;
  if (!f.enabled || !t || !t.items.length) return null;
  const list: TasteList = { v: 1, name: via.slice(0, 80), author: f.handle, description: `${t.name}'s picks`, items: t.items };
  const vids = t.items.map((i) => videos(i.id)).filter((v): v is Video => !!v);
  return { list, videos: vids, via, trackKey: trackKey(f.handle), why: `In ${t.name}'s picks (${sourceShort(t)})`, ...(strength === undefined ? {} : { strength }) };
}

/** Replace core's generic taste why-line with the creator-taste wording. */
export function rewriteWhy(items: RankedItem[], lists: readonly ResolvedTasteList[]): RankedItem[] {
  const map = new Map<string, string>();
  for (const l of lists) if (l.why) map.set(`In the taste list "${l.via ?? l.list.name}"`, l.why);
  if (!map.size) return items;
  return items.map((i) => (i.why.some((w) => map.has(w)) ? { ...i, why: i.why.map((w) => map.get(w) ?? w) } : i));
}

/** Newest picks for the sheet: titles where known. */
export function newestPicks(t: CreatorTaste, videos: (id: string) => Video | undefined, n = 3): { id: string; title: string; creator?: string }[] {
  return t.items.slice(0, n).map((i) => {
    const v = videos(i.id);
    return v ? { id: i.id, title: v.title, creator: v.creatorName ?? v.creator } : { id: i.id, title: i.id };
  });
}
