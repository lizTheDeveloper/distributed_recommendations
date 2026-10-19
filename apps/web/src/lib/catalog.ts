// Catalog access through core's PeerTube client. `fetch` is injected: the live app
// passes the browser's, the offline artifact passes one that serves a snapshot.

import type { FetchLike, PeerTubeClient, Video } from "./core.ts";
import { createPeerTubeClient, peertubeVideoToVideo } from "./core.ts";
import type { ChannelRef } from "./handles.ts";
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

export interface Catalog {
  instanceVideos(origin: string, which: "trending" | "recent", count?: number): Promise<Video[]>;
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
}

export function createCatalog(fetchFn: FetchLike): Catalog {
  const clients = new Map<string, PeerTubeClient>();
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
