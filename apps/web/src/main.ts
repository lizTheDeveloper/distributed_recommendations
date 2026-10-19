// Live entry: real PeerTube instances over the network.
import { boot } from "./boot.ts";
import { createCatalog } from "./lib/catalog.ts";
import { browserKV } from "./lib/storage.ts";
import { EXAMPLES } from "./examples.ts";

void boot({
  root: document.getElementById("app")!,
  catalog: createCatalog((url, init) => fetch(url, init)),
  kv: browserKV(),
  mode: "live",
  now: () => new Date(),
  examples: EXAMPLES,
});

// Offline shell for the installed PWA. Never caches API responses or history.
if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}
