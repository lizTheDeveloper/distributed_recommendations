// Build the web client.
//
//   node scripts/build.mjs                 # dist/ (PWA) + dist-artifact/index.html
//   node scripts/build.mjs --artifact-only # just the single-file artifact
//   node scripts/build.mjs --dev [--port N]  # watch + serve dist/ on http://localhost:8080
//   node scripts/build.mjs --app-only [--outdir DIR]  # just the PWA, optionally elsewhere
//
// Opt-in telemetry endpoints (docs/TELEMETRY.md), read from the environment at
// build time. Empty or unset hides the feature (no switch, no card, no request):
//   MF_GLITCHTIP_DSN       https://<public key>@errors.example.org/<project id>
//   MF_UMAMI_HOST          https://stats.example.org
//   MF_UMAMI_WEBSITE_ID    the Umami website id (a UUID)
// The offline artifact is always built without them.

import * as esbuild from "esbuild";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const dev = args.includes("--dev");
const artifactOnly = args.includes("--artifact-only");
const appOnly = args.includes("--app-only");
const port = Number(args[args.indexOf("--port") + 1]) || 8080;
const outdir = args.includes("--outdir") ? args[args.indexOf("--outdir") + 1] : null;

const appVersion = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;

/** Telemetry config from the environment, checked here so a typo fails the build. */
function telemetryEnv() {
  const env = (k) => (process.env[k] ?? "").trim();
  const dsn = env("MF_GLITCHTIP_DSN");
  const umamiHost = env("MF_UMAMI_HOST");
  const umamiWebsiteId = env("MF_UMAMI_WEBSITE_ID");
  const origins = [];
  const local = (u) => u.hostname === "localhost" || u.hostname === "127.0.0.1";
  if (dsn) {
    const u = new URL(dsn);
    if (!u.username || !/\/\d+$/.test(u.pathname) || (u.protocol !== "https:" && !(u.protocol === "http:" && local(u))))
      throw new Error("MF_GLITCHTIP_DSN must look like https://<key>@host/<project id> (http only for localhost)");
    origins.push(u.origin);
  }
  if (umamiHost || umamiWebsiteId) {
    const u = new URL(umamiHost);
    if (u.protocol !== "https:" && !(u.protocol === "http:" && local(u))) throw new Error("MF_UMAMI_HOST must be https (http only for localhost)");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(umamiWebsiteId)) throw new Error("MF_UMAMI_WEBSITE_ID must be the website's UUID");
    origins.push(u.origin);
  }
  return { config: { glitchtipDsn: dsn, umamiHost, umamiWebsiteId, appVersion }, origins: [...new Set(origins)] };
}
const telemetry = telemetryEnv();

const FONTS =
  "https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,700&family=Atkinson+Hyperlegible:wght@400;700&family=JetBrains+Mono:wght@400;600&display=swap";

const matchModules = join(root, "../../packages/match/node_modules");
// The web app pins its own @openmined/psi.js (2.0.6, same as packages/match) for the
// browser build; fall back to match's copy.
const PSI_WEB = [join(root, "node_modules"), matchModules]
  .map((d) => join(d, "@openmined/psi.js/psi_wasm_web.js"))
  .find((p) => existsSync(p));
if (!PSI_WEB) throw new Error("@openmined/psi.js isn't installed: run npm install in apps/web");

/**
 * packages/match is imported from source (src/lib/match/pkg.ts). Its PSI adapter is
 * written for Node: `createRequire` from `node:module` loads @openmined/psi.js. In the
 * browser, `node:module` resolves to shims/node-module.js, which loads psi.js's web
 * build (WASM embedded): from dist/psi.js on demand in the live build, or inlined in
 * the single-file artifact. `Buffer` is installed by src/lib/match/buffer.ts.
 */
function matchShims(psi /* "script" | "inline" */) {
  return {
    name: "match-browser-shims",
    setup(b) {
      b.onResolve({ filter: /^node:module$/ }, () => ({ path: join(root, "shims/node-module.js") }));
      b.onResolve({ filter: /^mf-psi-source$/ }, () => ({ path: join(root, `shims/psi-${psi}.js`) }));
      b.onResolve({ filter: /^@openmined\/psi\.js\/psi_wasm_web\.js$/ }, () => ({ path: PSI_WEB }));
      // psi_wasm_web.js only require()s "url" when there's no document (never here).
      b.onResolve({ filter: /^url$/ }, () => ({ path: "url", external: true }));
    },
  };
}

const common = {
  bundle: true,
  target: ["es2020", "chrome100", "firefox100", "safari15"],
  logLevel: "info",
  legalComments: "none",
  nodePaths: [join(root, "node_modules"), matchModules],
  // psi.ts reads import.meta.url only to hand it to createRequire, which the shim ignores.
  logOverride: { "empty-import-meta": "silent" },
};
const appOpts = (dev) => ({
  ...common,
  plugins: [matchShims("script")],
  define: { __MF_DEV__: String(dev), __MF_TELEMETRY__: JSON.stringify(telemetry.config) },
});

/**
 * The CSP allows the configured telemetry hosts explicitly (and only when
 * configured). connect-src already has `https:` for user-chosen PeerTube
 * instances, so this matters for http://localhost test servers and keeps the
 * policy correct if connect-src is ever narrowed.
 */
function stampCsp(dist) {
  if (!telemetry.origins.length) return;
  const p = join(dist, "index.html");
  const html = readFileSync(p, "utf8");
  const next = html.replace(/connect-src 'self'/, `connect-src 'self' ${telemetry.origins.join(" ")}`);
  if (next === html) throw new Error("index.html CSP has no connect-src 'self' to extend");
  writeFileSync(p, next);
}

/** dist/crash.js: @sentry/browser and the scrubber, fetched only after opt-in. Built only with a DSN. */
async function buildCrashReporter(dist, dev) {
  if (!telemetry.config.glitchtipDsn) return;
  await esbuild.build({ ...common, entryPoints: [join(root, "src/telemetry/crash-entry.ts")], outfile: join(dist, "crash.js"), format: "iife", minify: !dev, sourcemap: dev ? "inline" : "linked" });
}

function copyPublic(dist) {
  cpSync(join(root, "public"), dist, { recursive: true });
  // The browser build of @openmined/psi.js 2.0.6 (Apache-2.0), loaded only when a
  // Match preview runs.
  cpSync(PSI_WEB, join(dist, "psi.js"));
}

function stampServiceWorker(dist) {
  const js = readFileSync(join(dist, "app.js"));
  const css = readFileSync(join(dist, "app.css"));
  const id = createHash("sha256").update(js).update(css).digest("hex").slice(0, 12);
  const p = join(dist, "sw.js");
  writeFileSync(p, readFileSync(p, "utf8").replace("__BUILD__", id));
}

async function buildApp() {
  const dist = outdir ? resolve(process.cwd(), outdir) : join(root, "dist");
  rmSync(dist, { recursive: true, force: true });
  mkdirSync(dist, { recursive: true });
  copyPublic(dist);
  await esbuild.build({ ...appOpts(false), entryPoints: [join(root, "src/main.ts")], outfile: join(dist, "app.js"), format: "iife", minify: true, sourcemap: "linked" });
  await esbuild.build({ ...common, entryPoints: [join(root, "src/styles.css")], outfile: join(dist, "app.css"), minify: true });
  await buildCrashReporter(dist, false);
  stampCsp(dist);
  stampServiceWorker(dist);
}

async function buildArtifact() {
  // The artifact is the offline demo: dev tools on (on-demand sketches), PSI inlined.
  // Telemetry stays disabled offline: no endpoints compiled in (and the app ignores them in snapshot mode).
  const js = await esbuild.build({ ...common, plugins: [matchShims("inline")], define: { __MF_DEV__: "true", __MF_TELEMETRY__: JSON.stringify({ appVersion }) }, entryPoints: [join(root, "src/main-artifact.ts")], format: "iife", minify: true, write: false });
  // The stylesheet has no imports; inline it verbatim so the theme selectors keep the
  // documented form (esbuild would rewrite [data-theme="light"] to [data-theme=light]).
  const cssText = readFileSync(join(root, "src/styles.css"), "utf8");
  const script = js.outputFiles[0].text.replace(/<\/(script)/gi, "<\\/$1");
  const style = cssText.replace(/<\/(style)/gi, "<\\/$1");
  // claude.ai artifact: content only (no <html>/<head>/<body>), <title> first,
  // everything inline except the Google Fonts stylesheet.
  const html = [
    "<title>Match Feed Client</title>",
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">',
    '<meta name="claude:viewport-fit-sides" content="cover">',
    `<link rel="stylesheet" href="${FONTS}">`,
    `<style>${style}</style>`,
    '<div id="app"><p style="padding:16px">Loading Match Feed…</p></div>',
    `<script>${script}</script>`,
    "",
  ].join("\n");
  const out = join(root, "dist-artifact");
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "index.html"), html);
  console.log(`dist-artifact/index.html ${(html.length / 1024).toFixed(1)} KiB`);
}

if (dev) {
  const dist = join(root, "dist");
  mkdirSync(dist, { recursive: true });
  copyPublic(dist);
  stampCsp(dist);
  await buildCrashReporter(dist, true);
  writeFileSync(join(dist, "sw.js"), "// no service worker in dev\n");
  const ctxJs = await esbuild.context({ ...appOpts(true), entryPoints: [join(root, "src/main.ts")], outfile: join(dist, "app.js"), format: "iife", sourcemap: "inline" });
  const ctxCss = await esbuild.context({ ...common, entryPoints: [join(root, "src/styles.css")], outfile: join(dist, "app.css") });
  await Promise.all([ctxJs.watch(), ctxCss.watch()]);
  const { hosts, port: p } = await ctxJs.serve({ servedir: dist, port });
  console.log(`Match Feed dev server: http://${hosts[0] === "0.0.0.0" ? "localhost" : hosts[0]}:${p}/ (rebuilds on save; reload the page)`);
} else {
  if (!artifactOnly) await buildApp();
  if (!appOnly) await buildArtifact();
}
