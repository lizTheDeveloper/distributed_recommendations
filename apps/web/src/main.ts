// Live entry: real PeerTube instances over the network.
import { installBufferShim } from "./lib/match/buffer.ts";
import { boot } from "./boot.ts";
import { createCatalog } from "./lib/catalog.ts";
import { browserKV } from "./lib/storage.ts";
import { EXAMPLES } from "./examples.ts";
import { buildConfig } from "./lib/telemetry/config.ts";
import { scriptLoader } from "./lib/telemetry/controller.ts";

installBufferShim();

void boot({
  root: document.getElementById("app")!,
  catalog: createCatalog((url, init) => fetch(url, init)),
  kv: browserKV(),
  mode: "live",
  now: () => new Date(),
  examples: EXAMPLES,
  devTools: typeof __MF_DEV__ !== "undefined" && __MF_DEV__,
  // Opt-in telemetry: endpoints from the build (empty = hidden). crash.js is
  // fetched only after the viewer turns crash reports on.
  telemetry: buildConfig(),
  loadCrashReporter: scriptLoader("./crash.js"),
});

// Offline shell for the installed PWA. Never caches API responses or history.
if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}
