// Offline entry for the single-file artifact build: the network is unavailable, so
// the catalog is served from a snapshot of real PeerTube API responses through the
// same core client the live app uses.
import { startApp } from "./app.ts";
import { createCatalog } from "./lib/catalog.ts";
import type { Snapshot } from "./lib/snapshotFetch.ts";
import { snapshotFetch } from "./lib/snapshotFetch.ts";
import { browserKV } from "./lib/storage.ts";
import { DEFAULT_INSTANCES } from "./lib/settings.ts";
import { EXAMPLES } from "./examples.ts";
import data from "./snapshot/snapshot.json";

const snap = data as unknown as Snapshot;
const fetchedAt = new Date(snap.fetchedAt);
const count = new Set(
  [...Object.values(snap.instances).flatMap((i) => [...i.trending, ...i.recent]), ...snap.extra].map((v) => v.url),
).size;
const hosts = Object.keys(snap.instances).map((o) => new URL(o).host);

const kv = browserKV();
// The snapshot only covers the default instances; keep settings consistent with it.
try {
  const raw = kv.get("mf.v1.settings");
  if (raw) {
    const s = JSON.parse(raw);
    s.instances = DEFAULT_INSTANCES;
    kv.set("mf.v1.settings", JSON.stringify(s));
  }
} catch {
  /* ignore */
}

startApp({
  root: document.getElementById("app")!,
  catalog: createCatalog(snapshotFetch(snap)),
  kv,
  mode: "snapshot",
  now: () => fetchedAt,
  snapshotNote: `${count} real videos from ${hosts.join(" and ")}, captured ${fetchedAt.toISOString().slice(0, 10)}. This build can't use the network: no live refresh, playback or URL import, and thumbnails are color placeholders. Ranking, follows, taste lists, recipes and settings all work, and are saved in this browser.`,
  examples: EXAMPLES,
});
