// Copies the web client's static build (apps/web/dist) into www/ for Capacitor, then
// adds the native bridge script and applies the brand. apps/web is never modified, except that
// `npm run build` is run there when dist/ is missing (it writes only apps/web/dist*).
//
// Left out of www/: app.js.map (size; source paths), sw.js (a service worker adds nothing
// when the shell is already on the device, and Android would need resolveServiceWorkerRequests).
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const app = join(here, "..");
const web = join(app, "..", "web");
const dist = join(web, "dist");
const out = join(app, process.argv.includes("--out") ? process.argv[process.argv.indexOf("--out") + 1] : "www");
const brand = JSON.parse(readFileSync(join(app, "brand.json"), "utf8"));
const SKIP = new Set(["app.js.map", "sw.js"]);

if (!existsSync(join(dist, "index.html"))) {
  if (!existsSync(join(web, "node_modules"))) {
    console.error(`apps/web/dist is missing and apps/web has no node_modules. Run: (cd apps/web && npm ci && npm run build)`);
    process.exit(1);
  }
  console.log("apps/web/dist missing: running npm run build in apps/web");
  execFileSync("npm", ["run", "build"], { cwd: web, stdio: "inherit" });
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(dist, out, { recursive: true, filter: (src) => !SKIP.has(relative(dist, src)) });

// index.html: brand the title and load the bridge before app.js (app.js is deferred, the
// bridge is not, so window.MatchFeedNative exists before the app boots). Same-origin script,
// so the page CSP (script-src 'self') allows it unchanged.
const indexPath = join(out, "index.html");
let html = readFileSync(indexPath, "utf8");
const tag = '<script src="app.js" defer></script>';
if (!html.includes(tag)) throw new Error(`index.html no longer contains ${tag}; update scripts/sync-web.mjs`);
html = html.replace(tag, `<script src="native-bridge.js"></script>\n${tag}`);
html = html.replace(/<title>[^<]*<\/title>/, `<title>${brand.displayName}</title>`);
writeFileSync(indexPath, html);

const manifestPath = join(out, "manifest.webmanifest");
if (existsSync(manifestPath)) {
  const m = JSON.parse(readFileSync(manifestPath, "utf8"));
  m.name = brand.displayName;
  m.short_name = brand.shortName;
  writeFileSync(manifestPath, JSON.stringify(m, null, 2) + "\n");
}
console.log(`www ready: ${relative(app, out)} (from apps/web/dist)`);
