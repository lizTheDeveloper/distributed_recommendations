// Bundles bridge/native-bridge.ts (window.MatchFeedNative over Capacitor plugins) into
// www/native-bridge.js. One IIFE, no eval, so it runs under the page CSP.
import { build } from "esbuild";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const app = join(dirname(fileURLToPath(import.meta.url)), "..");
await build({
  entryPoints: [join(app, "bridge", "native-bridge.ts")],
  outfile: join(app, process.argv[2] ?? "www", "native-bridge.js"),
  bundle: true,
  format: "iife",
  target: ["chrome89", "safari15"],
  minify: false,
  legalComments: "inline",
  logLevel: "info",
});
