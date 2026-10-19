import type { Video } from "./core.ts";

/** JSON-safe form of a `Video` (dates as ISO strings) for the local cache. */
export interface StoredVideo extends Omit<Video, "publishedAt"> {
  publishedAt: string;
}

export function storeVideo(v: Video): StoredVideo {
  return { ...v, publishedAt: v.publishedAt.toISOString() };
}

export function loadVideo(s: unknown): Video | null {
  if (typeof s !== "object" || s === null) return null;
  const o = s as Record<string, unknown>;
  if (typeof o.id !== "string" || typeof o.title !== "string" || typeof o.creator !== "string") return null;
  const publishedAt = new Date(typeof o.publishedAt === "string" ? o.publishedAt : NaN);
  if (Number.isNaN(publishedAt.getTime())) return null;
  const v: Video = {
    id: o.id,
    title: o.title,
    creator: o.creator,
    durationSec: typeof o.durationSec === "number" ? o.durationSec : 0,
    publishedAt,
    tags: Array.isArray(o.tags) ? o.tags.filter((t): t is string => typeof t === "string") : [],
  };
  if (typeof o.creatorName === "string") v.creatorName = o.creatorName;
  if (typeof o.language === "string") v.language = o.language;
  if (typeof o.thumbnailUrl === "string" && /^https:\/\//.test(o.thumbnailUrl)) v.thumbnailUrl = o.thumbnailUrl;
  if (typeof o.url === "string") v.url = o.url;
  return v;
}

/** Host of a video's origin instance (from its canonical URL). */
export function videoHost(v: Video): string {
  try {
    return new URL(v.id).host;
  } catch {
    return v.creator.split("@")[1] ?? "";
  }
}

/** The id segment of a PeerTube watch URL: `/videos/watch/<id>` or `/w/<id>`. */
export function watchId(url: string): { origin: string; id: string } | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const m = /^\/(?:videos\/watch|w)\/([A-Za-z0-9-]{6,64})\/?$/.exec(u.pathname);
  return m ? { origin: u.origin, id: m[1] } : null;
}

/**
 * PeerTube embed URL on the video's origin instance. P2P is off unless the viewer
 * turned it on: with P2P, other viewers of the same video can see your IP.
 */
export function embedUrl(v: Video, opts: { p2p: boolean }): string | null {
  const w = watchId(v.url ?? v.id);
  if (!w) return null;
  const q = new URLSearchParams({
    p2p: opts.p2p ? "1" : "0",
    peertubeLink: "0",
    warningTitle: "0",
    title: "0",
  });
  return `${w.origin}/videos/embed/${encodeURIComponent(w.id)}?${q}`;
}

/** Tier 0 link: PeerTube's own stats page for a video (the owner must be signed in). */
export function statsUrl(v: Video): string | null {
  const w = watchId(v.url ?? v.id);
  return w ? `${w.origin}/stats/videos/${encodeURIComponent(w.id)}` : null;
}

export function formatDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${r}` : `${m}:${r}`;
}

/** Stable gradient for a placeholder thumbnail. */
export function placeholderGradient(seed: string): string {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  const a = (h >>> 0) % 360;
  const b = (a + 40 + ((h >>> 9) % 80)) % 360;
  return `linear-gradient(135deg, hsl(${a} 45% 32%), hsl(${b} 55% 58%))`;
}
