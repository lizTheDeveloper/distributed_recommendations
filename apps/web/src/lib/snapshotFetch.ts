// A FetchLike that answers PeerTube API requests from a stored snapshot, so the
// offline artifact runs the same code path (core client + mapping) as the live app.

import type { FetchLike, FetchResponseLike } from "./core.ts";

type Raw = Record<string, unknown> & { uuid?: string; shortUUID?: string; url?: string; channel?: { name?: string; host?: string; displayName?: string } };

export interface SnapshotChannel {
  info: { displayName?: string; description?: string; support?: string; ownerAccount?: { name?: string; host?: string; description?: string } };
  playlists: Raw[];
  accountPlaylists: Raw[];
}

export interface Snapshot {
  fetchedAt: string;
  instances: Record<string, { trending: Raw[]; recent: Raw[] }>;
  extra: Raw[];
  /** Follow taste: public profiles and playlists of a few channels (`name@host`). */
  channels?: Record<string, SnapshotChannel>;
  /** Playlist uuid → its elements (`{ position, type, video }`). */
  playlistVideos?: Record<string, Raw[]>;
}

/** Channels whose captured playlists hold at least one video by someone else. */
export function snapshotTasteChannels(snap: Snapshot): string[] {
  const out: string[] = [];
  for (const [handle, c] of Object.entries(snap.channels ?? {})) {
    const own = `${c.info.ownerAccount?.name}@${c.info.ownerAccount?.host}`;
    const els = [...c.playlists, ...c.accountPlaylists].flatMap((p) => snap.playlistVideos?.[String(p.uuid)] ?? []);
    const other = els.some((e) => {
      const v = e.video as Raw | undefined;
      const a = v?.account as { name?: string; host?: string } | undefined;
      return v && `${v.channel?.name}@${v.channel?.host}` !== handle && `${a?.name}@${a?.host}` !== own;
    });
    if (other) out.push(handle);
  }
  return out;
}

const ok = (body: unknown): FetchResponseLike => ({ ok: true, status: 200, json: async () => body });
const notFound: FetchResponseLike = { ok: false, status: 404, json: async () => ({}) };

export function snapshotFetch(snap: Snapshot): FetchLike {
  const all: Raw[] = [];
  const byKey = new Map<string, Raw>();
  for (const list of [...Object.values(snap.instances).flatMap((i) => [...i.trending, ...i.recent]), snap.extra]) {
    for (const v of Array.isArray(list) ? list : [list]) {
      if (!v.url || byKey.has(v.url)) continue;
      all.push(v);
      byKey.set(v.url, v);
      if (v.uuid) byKey.set(v.uuid, v);
      if (v.shortUUID) byKey.set(v.shortUUID, v);
    }
  }
  const page = (data: Raw[], count: number, start = 0) => ok({ total: data.length, data: data.slice(start, start + count) });

  return async (url) => {
    const u = new URL(url);
    const count = Number(u.searchParams.get("count") ?? 20);
    const sort = u.searchParams.get("sort") ?? "-publishedAt";
    const start = Number(u.searchParams.get("start") ?? 0);
    const p = u.pathname;
    if (p === "/api/v1/videos") {
      const inst = snap.instances[u.origin];
      if (!inst) return notFound;
      return page(sort === "-trending" ? inst.trending : inst.recent, count, start);
    }
    let m = /^\/api\/v1\/video-channels\/([^/]+)\/videos$/.exec(p);
    if (m) {
      const raw = decodeURIComponent(m[1]);
      const [name, host] = raw.includes("@") ? raw.split("@") : [raw, u.host];
      const vids = all
        .filter((v) => v.channel?.name === name && v.channel?.host === host)
        .sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)));
      return page(vids, count, start);
    }
    m = /^\/api\/v1\/video-channels\/([^/]+)\/video-playlists$/.exec(p);
    if (m) {
      const c = snap.channels?.[`${decodeURIComponent(m[1])}@${u.host}`];
      return c ? page(c.playlists, count, start) : page([], count);
    }
    m = /^\/api\/v1\/accounts\/([^/]+)\/video-playlists$/.exec(p);
    if (m) {
      const name = decodeURIComponent(m[1]);
      const c = Object.values(snap.channels ?? {}).find((x) => x.info.ownerAccount?.name === name && x.info.ownerAccount?.host === u.host);
      return c ? page(c.accountPlaylists, count, start) : page([], count);
    }
    m = /^\/api\/v1\/video-playlists\/([^/]+)\/videos$/.exec(p);
    if (m) {
      const els = snap.playlistVideos?.[decodeURIComponent(m[1])];
      return els ? page(els, count, start) : notFound;
    }
    m = /^\/api\/v1\/video-channels\/([^/]+)$/.exec(p);
    if (m) {
      const c = snap.channels?.[`${decodeURIComponent(m[1])}@${u.host}`];
      if (c) return ok(c.info);
      const v = all.find((x) => x.channel?.name === decodeURIComponent(m![1]) && x.channel?.host === u.host);
      return v ? ok({ displayName: v.channel?.displayName }) : notFound;
    }
    m = /^\/api\/v1\/videos\/([^/]+)$/.exec(p);
    if (m) {
      const v = byKey.get(decodeURIComponent(m[1]));
      return v ? ok(v) : notFound;
    }
    return notFound;
  };
}
