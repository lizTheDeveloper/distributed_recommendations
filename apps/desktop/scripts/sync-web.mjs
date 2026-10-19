// Prepares www/ for Tauri: the same copy step as mobile (apps/mobile/scripts/sync-web.mjs:
// apps/web/dist minus sw.js and the source map, branded from apps/mobile/brand.json, with
// <script src="native-bridge.js"> before app.js), then bundles the desktop bridge into it.
import { execFileSync } from "node:child_process";
import { build } from "esbuild";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const app = join(dirname(fileURLToPath(import.meta.url)), "..");
execFileSync(process.execPath, [join(app, "..", "mobile", "scripts", "sync-web.mjs"), "--out", "../desktop/www"], { stdio: "inherit" });
await build({
  entryPoints: [join(app, "bridge", "native-bridge.ts")],
  outfile: join(app, "www", "native-bridge.js"),
  bundle: true,
  format: "iife",
  target: ["chrome105", "safari16"],
  legalComments: "inline",
  logLevel: "info",
});
