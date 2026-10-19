// Catalog access through core's PeerTube client. `fetch` is injected: the live app
// passes the browser's, the offline artifact passes one that serves a snapshot.

import type { FetchLike, PeerTubeClient, Video } from "./core.ts";
import { createPeerTubeClient, peertubeVideoToVideo } from "./core.ts";
import type { PlaylistBundle } from "./creatortaste.ts";
import { MAX_PLAYLISTS, isPublicPlaylist } from "./creatortaste.ts";
import type { ChannelRef } from "./handles.ts";
import type { VideoMeta } from "./reels.ts";
import { watchId } from "./videos.ts";

/** Tier 1 public counts for a channel (ANALYTICS.md). */
export interface ChannelStats {
  handle: string;
  displayName?: string;
  followers?: number;
  /** Over `videos` (most recent public videos fetched). */
  views: number;
  likes: number;
  videos: { video: Video; views: number; likes: number }[];
}

/** Public profile text of a channel, scanned for a Match Feed identity (npub). */
export interface ChannelProfile {
  handle: string;
  displayName?: string;
  /** Channel description, support text and owner account description. */
  text: string;
  /** Owner account handle, `name@host`. */
  ownerAccount?: string;
}

export interface Catalog {
  instanceVideos(origin: string, which: "trending" | "recent", count?: number): Promise<Video[]>;
  /** One page of an instance's list (core client `start`/`count`), for Reels' infinite scroll. */
  instancePage(origin: string, which: "trending" | "recent", start: number, count: number): Promise<Video[]>;
  /** Aspect ratio and live flag seen in PeerTube responses (core's `Video` drops them). */
  meta(id: string): VideoMeta | undefined;
  channelProfile(c: ChannelRef, via?: readonly string[]): Promise<ChannelProfile>;
  channelVideos(c: ChannelRef, count?: number): Promise<Video[]>;
  /** Resolve a canonical watch URL to a video via its origin instance. */
  resolveVideo(id: string): Promise<Video | null>;
  /**
   * Tags for a video (list endpoints omit them). Asks `via` instances first (ones that
   * listed the video, so they hold a federated copy and are known to allow CORS),
   * then the origin. Returns null if nobody answers.
   */
  videoTags(id: string, via: readonly string[]): Promise<string[] | null>;
  channelStats(c: ChannelRef): Promise<ChannelStats>;
  /**
   * A channel's public playlists with their elements, read from the channel's home
   * instance: the channel's own playlists, then (with `ownerAccount`) the owner
   * account's. At most MAX_PLAYLISTS, most recently updated first.
   */
  creatorPlaylists(c: ChannelRef, ownerAccount?: string): Promise<PlaylistBundle[]>;
}

export function createCatalog(rawFetch: FetchLike): Catalog {
  const clients = new Map<string, PeerTubeClient>();
  const metas = new Map<string, VideoMeta>();
  const capture = (raw: unknown, origin: string) => {
    if (typeof raw !== "object" || raw === null) return;
    const o = raw as Record<string, unknown>;
    const id = typeof o.url === "string" ? o.url : typeof o.uuid === "string" && o.isLocal === true ? `${origin}/videos/watch/${o.uuid}` : null;
    if (!id) return;
    const m: VideoMeta = {};
    if (typeof o.aspectRatio === "number" && o.aspectRatio > 0 && o.aspectRatio < 10) m.aspectRatio = o.aspectRatio;
    if (o.isLive === true) m.isLive = true;
    if (Object.keys(m).length) metas.set(id, m);
  };
  // Same responses core parses; this only reads the two fields core's Video omits.
  const fetchFn: FetchLike = async (url, init) => {
    const res = await rawFetch(url, init);
    if (!res.ok) return res;
    return {
      ok: res.ok,
      status: res.status,
      json: async () => {
        const body = await res.json();
        try {
          const origin = new URL(url).origin;
          const data = (body as { data?: unknown }).data;
          // Playlist elements wrap the video: `{ position, type, video }`.
          if (Array.isArray(data)) for (const r of data) capture(r && typeof r === "object" && "video" in r ? (r as { video: unknown }).video : r, origin);
          else capture(body, origin);
        } catch {
          /* not ours to judge */
        }
        return body;
      },
    };
  };
  const client = (origin: string) => {
    let c = clients.get(origin);
    if (!c) clients.set(origin, (c = createPeerTubeClient({ baseUrl: origin, fetch: fetchFn })));
    return c;
  };

  // Core's Video has no view/like counts or follower counts, so Tier 1 reads those
  // two public endpoints directly, with the same privacy options core uses.
  async function getJson(url: string): Promise<Record<string, unknown>> {
    const res = await fetchFn(url, { headers: { accept: "application/json" }, credentials: "omit", referrerPolicy: "no-referrer" });
    if (!res.ok) throw new Error(`${new URL(url).pathname} returned ${res.status}`);
    const body = await res.json();
    if (typeof body !== "object" || body === null) throw new Error("unexpected body");
    return body as Record<string, unknown>;
  }

  return {
    async instanceVideos(origin, which, count = 50) {
      const page = await client(origin).listVideos({ count, sort: which === "trending" ? "-trending" : "-publishedAt" });
      return page.videos;
    },
    async instancePage(origin, which, start, count) {
      const page = await client(origin).listVideos({ start, count, sort: which === "trending" ? "-trending" : "-publishedAt" });
      return page.videos;
    },
    meta: (id) => metas.get(id),
    async channelProfile(c, via = []) {
      // Ask instances that already serve the catalog (known to send CORS headers) for
      // the federated copy first, then the channel's home instance.
      let info: Record<string, unknown> | undefined;
      for (const origin of [...via, `https://${c.host}`]) {
        try {
          const handle = origin === `https://${c.host}` ? c.name : `${c.name}@${c.host}`;
          info = await getJson(`${origin}/api/v1/video-channels/${encodeURIComponent(handle)}`);
          break;
        } catch {
          /* next */
        }
      }
      if (!info) throw new Error("channel profile unavailable");
      const str = (x: unknown) => (typeof x === "string" ? x : "");
      const owner = (info.ownerAccount ?? {}) as Record<string, unknown>;
      const p: ChannelProfile = { handle: `${c.name}@${c.host}`, text: [str(info.description), str(info.support), str(owner.description)].join("\n").slice(0, 20_000) };
      if (typeof info.displayName === "string") p.displayName = info.displayName;
      if (str(owner.name) && str(owner.host)) p.ownerAccount = `${str(owner.name)}@${str(owner.host)}`;
      return p;
    },
    async channelVideos(c, count = 20) {
      // Ask the channel's home instance first; fall back to nothing (caller reports).
      const page = await client(`https://${c.host}`).channelVideos(c.name, { count });
      return page.videos;
    },
    async resolveVideo(id) {
      const w = watchId(id);
      if (!w) return null;
      const v = await client(w.origin).getVideo(w.id);
      return { ...v, id }; // keep the list's id so membership checks match
    },
    async videoTags(id, via) {
      const w = watchId(id);
      if (!w) return null;
      for (const origin of [...new Set([...via, w.origin])]) {
        try {
          return (await client(origin).getVideo(w.id)).tags;
        } catch {
          /* try the next instance */
        }
      }
      return null;
    },
    async channelStats(c) {
      const origin = `https://${c.host}`;
      const name = encodeURIComponent(c.name);
      const [info, vids] = await Promise.all([
        getJson(`${origin}/api/v1/video-channels/${name}`).catch(() => ({}) as Record<string, unknown>),
        getJson(`${origin}/api/v1/video-channels/${name}/videos?count=50&sort=-publishedAt`),
      ]);
      const data = Array.isArray(vids.data) ? vids.data : [];
      const videos = data
        .map((raw: Record<string, unknown>) => {
          const video = peertubeVideoToVideo(raw, origin);
          const n = (x: unknown) => (typeof x === "number" && x >= 0 ? x : 0);
          return video ? { video, views: n(raw.views), likes: n(raw.likes) } : null;
        })
        .filter((x): x is { video: Video; views: number; likes: number } => x !== null);
      const stats: ChannelStats = {
        handle: `${c.name}@${c.host}`,
        views: videos.reduce((s, v) => s + v.views, 0),
        likes: videos.reduce((s, v) => s + v.likes, 0),
        videos,
      };
      if (typeof info.displayName === "string") stats.displayName = info.displayName;
      if (typeof info.followersCount === "number") stats.followers = info.followersCount;
      return stats;
    },
    async creatorPlaylists(c, ownerAccount) {
      const origin = `https://${c.host}`;
      const lists: unknown[] = [];
      const page = await getJson(`${origin}/api/v1/video-channels/${encodeURIComponent(c.name)}/video-playlists?count=50&sort=-updatedAt`);
      if (Array.isArray(page.data)) lists.push(...page.data);
      const [acct, acctHost] = (ownerAccount ?? "").split("@");
      if (acct && acctHost === c.host) {
        try {
          const ap = await getJson(`${origin}/api/v1/accounts/${encodeURIComponent(acct)}/video-playlists?count=50&sort=-updatedAt`);
          if (Array.isArray(ap.data)) lists.push(...ap.data);
        } catch {
          /* the channel's own playlists are enough */
        }
      }
      const seen = new Set<string>();
      const pick = lists
        .filter((p): p is Record<string, unknown> => {
          if (!isPublicPlaylist(p)) return false;
          const o = p as Record<string, unknown>;
          if (typeof o.uuid !== "string" || seen.has(o.uuid) || o.videosLength === 0) return false;
          seen.add(o.uuid);
          return true;
        })
        .sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")))
        .slice(0, MAX_PLAYLISTS);
      return mapLimit(pick, 3, async (p) => {
        let elements: unknown[] = [];
        try {
          const els = await getJson(`${origin}/api/v1/video-playlists/${encodeURIComponent(String(p.uuid))}/videos?count=100`);
          if (Array.isArray(els.data)) elements = els.data;
        } catch {
          /* skip this playlist */
        }
        return { origin, playlist: p, elements };
      });
    },
  };
}

/** Run `fn` over `xs` with at most `n` in flight. Results keep input order. */
export async function mapLimit<T, R>(xs: readonly T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(xs.length);
  let i = 0;
  const worker = async () => {
    while (i < xs.length) {
      const k = i++;
      out[k] = await fn(xs[k]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, xs.length) }, worker));
  return out;
}
