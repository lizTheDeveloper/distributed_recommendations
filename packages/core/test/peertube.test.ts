import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createPeerTubeClient, PeerTubeError, peertubeVideoToVideo } from "../src/peertube.ts";
import type { FetchLike } from "../src/peertube.ts";

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8"));

function stub(routes: Record<string, unknown>, calls: Array<{ url: string; init?: RequestInit }> = []): FetchLike {
  return async (url, init) => {
    calls.push({ url, init });
    const path = new URL(url).pathname;
    if (!(path in routes)) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => routes[path] };
  };
}

test("maps the live list response (federated videos)", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const client = createPeerTubeClient({
    baseUrl: "https://framatube.org",
    fetch: stub({ "/api/v1/videos": fixture("peertube-videos") }, calls),
  });
  const page = await client.listVideos({ count: 3 });
  assert.equal(page.total, 24223);
  assert.equal(page.videos.length, 3);
  const v = page.videos[0];
  assert.equal(v.id, "https://tube.tchncs.de/videos/watch/7516913d-a33b-46ca-9159-8a5523797af8");
  assert.equal(v.title, "Spiele von lokalen KIs programmieren lassen");
  assert.equal(v.creator, "ndwls@tube.tchncs.de");
  assert.equal(v.creatorName, "Nicht der Weisheit letzter Schluß");
  assert.equal(v.durationSec, 1398);
  assert.equal(v.language, "de");
  assert.equal(v.publishedAt.toISOString(), "2026-10-19T12:37:17.135Z");
  assert.deepEqual(v.tags, []);
  assert.match(v.thumbnailUrl!, /^https:\/\/framatube\.org\/lazy-static\/thumbnails\/.+\.png$/);
  assert.equal(page.videos[1].thumbnailUrl, (fixture("peertube-videos") as any).data[1].thumbnails[0].fileUrl);

  const url = new URL(calls[0].url);
  assert.equal(url.origin, "https://framatube.org");
  assert.equal(url.searchParams.get("count"), "3");
  assert.equal(url.searchParams.get("start"), "0");
  assert.equal(url.searchParams.get("sort"), "-publishedAt");
  assert.equal(calls[0].init?.credentials, "omit");
});

test("single video includes tags", async () => {
  const client = createPeerTubeClient({
    baseUrl: "https://framatube.org/",
    fetch: stub({ "/api/v1/videos/7516913d-a33b-46ca-9159-8a5523797af8": fixture("peertube-video") }),
  });
  const v = await client.getVideo("7516913d-a33b-46ca-9159-8a5523797af8");
  assert.deepEqual(v.tags, ["KI", "Künstliche Intelligenz", "Python", "Spieleklassiker"]);
  assert.equal(v.id, "https://tube.tchncs.de/videos/watch/7516913d-a33b-46ca-9159-8a5523797af8");
});

test("channel videos and search build the right requests", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const client = createPeerTubeClient({
    baseUrl: "https://framatube.org",
    fetch: stub(
      {
        "/api/v1/video-channels/ndwls%40tube.tchncs.de/videos": fixture("peertube-channel-videos"),
        "/api/v1/search/videos": fixture("peertube-search"),
      },
      calls,
    ),
  });
  const ch = await client.channelVideos("ndwls@tube.tchncs.de", { count: 2 });
  assert.equal(ch.videos.length, 2);
  assert.ok(ch.videos.every((v) => v.creator === "ndwls@tube.tchncs.de"));
  const s = await client.searchVideos("bread & butter", { count: 2, sort: "-match" });
  assert.equal(s.total, 126);
  assert.equal(s.videos[0].language, undefined, "null language id is dropped");
  const searchUrl = new URL(calls[1].url);
  assert.equal(searchUrl.searchParams.get("search"), "bread & butter");
  assert.equal(searchUrl.searchParams.get("sort"), "-match");
});

test("list filters are passed as repeated params; count is clamped", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const client = createPeerTubeClient({ baseUrl: "https://x.example", fetch: stub({ "/api/v1/videos": { total: 0, data: [] } }, calls) });
  await client.listVideos({ count: 500, isLocal: true, languageOneOf: ["en", "fr"] });
  const u = new URL(calls[0].url);
  assert.equal(u.searchParams.get("count"), "100");
  assert.equal(u.searchParams.get("isLocal"), "true");
  assert.deepEqual(u.searchParams.getAll("languageOneOf"), ["en", "fr"]);
  await assert.rejects(client.listVideos({ sort: "x;drop" }), /invalid sort/);
});

test("errors and malformed bodies", async () => {
  const client = createPeerTubeClient({
    baseUrl: "https://x.example",
    fetch: stub({ "/api/v1/videos": { nope: true }, "/api/v1/videos/bad": { name: "no url" } }),
  });
  await assert.rejects(client.listVideos(), PeerTubeError);
  await assert.rejects(client.getVideo("missing"), (e: unknown) => e instanceof PeerTubeError && e.status === 404);
  await assert.rejects(client.getVideo("bad"), PeerTubeError);
  assert.throws(() => createPeerTubeClient({ baseUrl: "ftp://x.example" }));
});

test("mapping skips malformed items and resolves relative thumbnails", () => {
  const base = "https://x.example";
  assert.equal(peertubeVideoToVideo(null, base), null);
  assert.equal(peertubeVideoToVideo({ url: "javascript:1", name: "x", publishedAt: "2026-01-01", channel: { name: "a", host: "b" } }, base), null);
  const v = peertubeVideoToVideo(
    { uuid: "u1", isLocal: true, name: "x", publishedAt: "2026-01-01T00:00:00Z", duration: 5, thumbnailPath: "/t.jpg", account: { name: "a", host: "x.example" } },
    base,
  );
  assert.equal(v?.id, "https://x.example/videos/watch/u1");
  assert.equal(v?.thumbnailUrl, "https://x.example/t.jpg");
  assert.equal(v?.creator, "a@x.example");
});
