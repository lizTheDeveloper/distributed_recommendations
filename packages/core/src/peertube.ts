// Minimal PeerTube REST client for the public catalog.
//
// Privacy: only unauthenticated, public endpoints are used, with credentials and
// referrer omitted. Never send watch history or endorsements to an instance
// (OSS_STACK.md, section 2). Field names verified against framatube.org (PeerTube
// v8) on 2026-10-19; see test/fixtures/peertube-*.json.

import type { Video } from "./types.ts";

/** The subset of the WHATWG `Response` this client needs. */
export interface FetchResponseLike {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

/** A `fetch`-compatible function (inject a stub in tests). */
export type FetchLike = (url: string, init?: RequestInit) => Promise<FetchResponseLike>;

export interface PeerTubeClientOptions {
  /** Instance origin, e.g. "https://framatube.org". */
  baseUrl: string;
  fetch?: FetchLike;
}

export interface PageOptions {
  /** 1..100, default 20 (PeerTube caps count at 100). */
  count?: number;
  start?: number;
  /** e.g. "-publishedAt" (default), "-trending", "-views". */
  sort?: string;
}

export interface ListOptions extends PageOptions {
  /** Only videos hosted on this instance. */
  isLocal?: boolean;
  languageOneOf?: string[];
  tagsOneOf?: string[];
}

export interface VideoPage {
  total: number;
  videos: Video[];
}

export class PeerTubeError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "PeerTubeError";
    this.status = status;
  }
}

export interface PeerTubeClient {
  /** `GET /api/v1/videos`: recent videos known to the instance (local and federated). */
  listVideos(opts?: ListOptions): Promise<VideoPage>;
  /** `GET /api/v1/video-channels/{handle}/videos`; handle is `name` or `name@host`. */
  channelVideos(handle: string, opts?: PageOptions): Promise<VideoPage>;
  /** `GET /api/v1/search/videos`. */
  searchVideos(query: string, opts?: PageOptions): Promise<VideoPage>;
  /** `GET /api/v1/videos/{id}` (id, uuid or shortUUID). Includes tags. */
  getVideo(id: string): Promise<Video>;
}

type Obj = Record<string, unknown>;

function isObj(x: unknown): x is Obj {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function str(x: unknown): string | undefined {
  return typeof x === "string" && x.length > 0 ? x : undefined;
}

function pickThumbnail(raw: Obj, baseUrl: string): string | undefined {
  const thumbs = Array.isArray(raw.thumbnails) ? raw.thumbnails.filter(isObj) : [];
  const usable = thumbs
    .filter((t) => str(t.fileUrl) && typeof t.width === "number")
    .sort((a, b) => (a.width as number) - (b.width as number));
  const wide = usable.filter((t) => t.aspectRatio === undefined || t.aspectRatio === "16:9");
  const pick = wide.find((t) => (t.width as number) >= 480) ?? wide[wide.length - 1] ?? usable[0];
  if (pick) return pick.fileUrl as string;
  const path = str(raw.thumbnailPath) ?? str(raw.previewPath);
  if (!path) return undefined;
  try {
    return new URL(path, baseUrl).toString();
  } catch {
    return undefined;
  }
}

/**
 * Map one PeerTube video object (list, search or detail) to a `Video`. Returns null
 * if required fields are missing. `id` is the canonical watch URL on the origin
 * instance, so the same video federated to many instances gets one id.
 */
export function peertubeVideoToVideo(raw: unknown, baseUrl: string): Video | null {
  if (!isObj(raw)) return null;
  const owner = isObj(raw.channel) ? raw.channel : isObj(raw.account) ? raw.account : undefined;
  const ownerName = owner && str(owner.name);
  const ownerHost = owner && str(owner.host);
  const uuid = str(raw.uuid);
  let id = str(raw.url);
  if (!id && uuid && raw.isLocal === true) id = new URL(`/videos/watch/${uuid}`, baseUrl).toString();
  const title = str(raw.name);
  const published = new Date(str(raw.publishedAt) ?? str(raw.createdAt) ?? NaN);
  if (!id || !/^https?:\/\//.test(id) || !title || !ownerName || !ownerHost || Number.isNaN(published.getTime())) {
    return null;
  }
  const video: Video = {
    id,
    title,
    creator: `${ownerName}@${ownerHost}`,
    durationSec: typeof raw.duration === "number" && raw.duration >= 0 ? raw.duration : 0,
    publishedAt: published,
    tags: Array.isArray(raw.tags) ? raw.tags.filter((t): t is string => typeof t === "string") : [],
    url: id,
  };
  const displayName = owner && str(owner.displayName);
  if (displayName) video.creatorName = displayName;
  const language = isObj(raw.language) ? str(raw.language.id) : undefined;
  if (language) video.language = language;
  const thumb = pickThumbnail(raw, baseUrl);
  if (thumb) video.thumbnailUrl = thumb;
  return video;
}

/** Create a client for one instance. Uses `globalThis.fetch` unless one is injected. */
export function createPeerTubeClient(opts: PeerTubeClientOptions): PeerTubeClient {
  const base = new URL(opts.baseUrl);
  if (base.protocol !== "https:" && base.protocol !== "http:") throw new Error("baseUrl must be http(s)");
  const origin = base.origin;
  const doFetch: FetchLike = opts.fetch ?? ((url, init) => globalThis.fetch(url, init));

  async function get(path: string, params: Record<string, string | number | boolean | string[] | undefined>) {
    const url = new URL(path, origin);
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined) continue;
      if (Array.isArray(v)) for (const x of v) url.searchParams.append(k, x);
      else url.searchParams.set(k, String(v));
    }
    const res = await doFetch(url.toString(), {
      headers: { accept: "application/json" },
      credentials: "omit",
      referrerPolicy: "no-referrer",
    });
    if (!res.ok) throw new PeerTubeError(res.status, `PeerTube ${url.pathname} returned ${res.status}`);
    return res.json();
  }

  function paging(p: PageOptions = {}) {
    const count = Math.min(100, Math.max(1, Math.floor(p.count ?? 20)));
    const start = Math.max(0, Math.floor(p.start ?? 0));
    const sort = p.sort ?? "-publishedAt";
    if (!/^-?[A-Za-z]{1,32}$/.test(sort)) throw new Error(`invalid sort: ${sort}`);
    return { count, start, sort };
  }

  async function page(path: string, params: Parameters<typeof get>[1]): Promise<VideoPage> {
    const body = await get(path, params);
    if (!isObj(body) || !Array.isArray(body.data)) throw new PeerTubeError(200, `PeerTube ${path}: unexpected body`);
    const videos = body.data.map((v) => peertubeVideoToVideo(v, origin)).filter((v): v is Video => v !== null);
    return { total: typeof body.total === "number" ? body.total : videos.length, videos };
  }

  return {
    listVideos: async (o = {}) =>
      page("/api/v1/videos", {
        ...paging(o),
        isLocal: o.isLocal,
        languageOneOf: o.languageOneOf,
        tagsOneOf: o.tagsOneOf,
      }),
    channelVideos: async (handle, o) => page(`/api/v1/video-channels/${encodeURIComponent(handle)}/videos`, paging(o)),
    searchVideos: async (query, o) => page("/api/v1/search/videos", { ...paging(o), search: query }),
    async getVideo(id) {
      const body = await get(`/api/v1/videos/${encodeURIComponent(id)}`, {});
      const video = peertubeVideoToVideo(body, origin);
      if (!video) throw new PeerTubeError(200, `PeerTube video ${id}: unexpected body`);
      return video;
    },
  };
}
