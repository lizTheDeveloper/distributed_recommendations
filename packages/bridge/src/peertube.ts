// Minimal unauthenticated PeerTube REST client (public endpoints only).
//
// PeerTube's default rate limit is 50 requests / 10 s per IP, so requests are
// spaced by `minIntervalMs` (default 250 ms = 4 req/s).

import type { PtCaption, PtChapter, PtPage, PtVideo } from './types.ts';

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface PeerTubeClientOptions {
  fetch?: FetchLike;
  minIntervalMs?: number;
  userAgent?: string;
}

/** Accepts `framatube.org`, `https://framatube.org/`, etc. Returns an https origin. */
export function normalizeInstance(instance: string): string {
  const withScheme = /^[a-z]+:\/\//i.test(instance) ? instance : `https://${instance}`;
  const u = new URL(withScheme);
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error(`unsupported instance URL: ${instance}`);
  return u.origin;
}

/** Channel handle: `name`, `name@host`, or `@name@host`. */
export function parseChannelHandle(handle: string): { name: string; host?: string } {
  const h = handle.replace(/^@/, '');
  const [name, host, ...rest] = h.split('@');
  if (!name || rest.length || !/^[\w.\-:]+$/.test(name)) throw new Error(`invalid channel handle: ${handle}`);
  return host ? { name, host } : { name };
}

export class PeerTubeClient {
  readonly base: string;
  private readonly fetchImpl: FetchLike;
  private readonly minIntervalMs: number;
  private readonly userAgent: string;
  private last = 0;

  constructor(instance: string, opts: PeerTubeClientOptions = {}) {
    this.base = normalizeInstance(instance);
    this.fetchImpl = opts.fetch ?? ((u, i) => fetch(u, i));
    this.minIntervalMs = opts.minIntervalMs ?? 250;
    this.userAgent = opts.userAgent ?? 'match-feed-bridge/0.1 (+PeerTube->NIP-71)';
  }

  private async get<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
    const wait = this.last + this.minIntervalMs - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.last = Date.now();
    const url = new URL(path, this.base);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
    const res = await this.fetchImpl(url.href, {
      headers: { accept: 'application/json', 'user-agent': this.userAgent },
    });
    if (!res.ok) throw new Error(`PeerTube ${res.status} for ${url.href}`);
    return (await res.json()) as T;
  }

  video(id: string): Promise<PtVideo> {
    return this.get<PtVideo>(`/api/v1/videos/${encodeURIComponent(id)}`);
  }

  async captions(id: string): Promise<PtCaption[]> {
    return (await this.get<PtPage<PtCaption>>(`/api/v1/videos/${encodeURIComponent(id)}/captions`)).data ?? [];
  }

  /** Chapters (PeerTube >= 6.0). Returns [] on older instances. */
  async chapters(id: string): Promise<PtChapter[]> {
    try {
      return (await this.get<{ chapters: PtChapter[] }>(`/api/v1/videos/${encodeURIComponent(id)}/chapters`)).chapters ?? [];
    } catch {
      return [];
    }
  }

  /** Page through a channel's videos (summary objects; no file lists). */
  async *channelVideos(handle: string, opts: { limit?: number; pageSize?: number } = {}): AsyncGenerator<PtVideo> {
    const { name, host } = parseChannelHandle(handle);
    const h = host ? `${name}@${host}` : name;
    const pageSize = Math.min(opts.pageSize ?? 25, 100);
    const limit = opts.limit ?? Infinity;
    let start = 0;
    let yielded = 0;
    while (yielded < limit) {
      const page = await this.get<PtPage<PtVideo>>(`/api/v1/video-channels/${encodeURIComponent(h)}/videos`, {
        start,
        count: pageSize,
        sort: '-publishedAt',
      });
      for (const v of page.data) {
        if (yielded >= limit) return;
        yielded++;
        yield v;
      }
      start += page.data.length;
      if (page.data.length === 0 || start >= page.total) return;
    }
  }
}
