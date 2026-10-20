// Live entry: real PeerTube instances over the network.
import { installBufferShim } from "./lib/match/buffer.ts";
import { boot } from "./boot.ts";
import { createCatalog } from "./lib/catalog.ts";
import { browserKV } from "./lib/storage.ts";
import { EXAMPLES } from "./examples.ts";
import { EDITORIAL } from "./editorial.ts";
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
  editorial: EDITORIAL,
  devTools: typeof __MF_DEV__ !== "undefined" && __MF_DEV__,
  // Opt-in telemetry: endpoints from the build (empty = hidden). crash.js is
  // fetched only after the viewer turns crash reports on.
  telemetry: buildConfig(),
  loadCrashReporter: scriptLoader("./crash.js"),
});

// The service worker (offline shell, update prompt) is registered by the app
// (src/app.ts) once it starts, so it can show "Update available".
