// A FetchLike that answers PeerTube API requests from a stored snapshot, so the
// offline artifact runs the same code path (core client + mapping) as the live app.

import type { FetchLike, FetchResponseLike } from "./core.ts";

type Raw = Record<string, unknown> & { uuid?: string; shortUUID?: string; url?: string; channel?: { name?: string; host?: string; displayName?: string } };

export interface Snapshot {
  fetchedAt: string;
  instances: Record<string, { trending: Raw[]; recent: Raw[] }>;
  extra: Raw[];
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
  const page = (data: Raw[], count: number) => ok({ total: data.length, data: data.slice(0, count) });

  return async (url) => {
    const u = new URL(url);
    const count = Number(u.searchParams.get("count") ?? 20);
    const sort = u.searchParams.get("sort") ?? "-publishedAt";
    const p = u.pathname;
    if (p === "/api/v1/videos") {
      const inst = snap.instances[u.origin];
      if (!inst) return notFound;
      return page(sort === "-trending" ? inst.trending : inst.recent, count);
    }
    let m = /^\/api\/v1\/video-channels\/([^/]+)\/videos$/.exec(p);
    if (m) {
      const raw = decodeURIComponent(m[1]);
      const [name, host] = raw.includes("@") ? raw.split("@") : [raw, u.host];
      const vids = all
        .filter((v) => v.channel?.name === name && v.channel?.host === host)
        .sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)));
      return page(vids, count);
    }
    m = /^\/api\/v1\/video-channels\/([^/]+)$/.exec(p);
    if (m) {
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
