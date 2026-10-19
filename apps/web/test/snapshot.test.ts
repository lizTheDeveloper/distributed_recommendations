import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createCatalog } from "../src/lib/catalog.ts";
import { snapshotFetch } from "../src/lib/snapshotFetch.ts";
import type { Snapshot } from "../src/lib/snapshotFetch.ts";

const snap = JSON.parse(readFileSync(new URL("../src/snapshot/snapshot.json", import.meta.url), "utf8")) as Snapshot;

test("the snapshot serves real data through core's PeerTube client", async () => {
  const cat = createCatalog(snapshotFetch(snap));
  const origin = Object.keys(snap.instances)[0];
  const trending = await cat.instanceVideos(origin, "trending", 50);
  assert.ok(trending.length >= 20);
  assert.ok(trending.every((v) => /^https:\/\//.test(v.id) && v.creator.includes("@")));
  const [name, host] = trending[0].creator.split("@");
  const own = await cat.channelVideos({ name, host });
  assert.ok(own.some((v) => v.id === trending[0].id));
  const stats = await cat.channelStats({ name, host });
  assert.ok(stats.videos.length >= 1);
  assert.equal(await cat.resolveVideo("https://nowhere.example/videos/watch/zzzzzzzz").catch(() => "err"), "err");
});

test("every example-list item resolves offline", async () => {
  const cat = createCatalog(snapshotFetch(snap));
  for (const f of ["tilvids-picks.json", "framatube-picks.json"]) {
    const list = JSON.parse(readFileSync(new URL(`../public/examples/${f}`, import.meta.url), "utf8"));
    for (const it of list.items) assert.ok(await cat.resolveVideo(it.id), it.id);
  }
});
