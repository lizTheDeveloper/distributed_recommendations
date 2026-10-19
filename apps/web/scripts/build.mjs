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
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
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
/** The display name and colors: src/brand.json is the one place they live (src/brand.ts reads it too). */
const brand = JSON.parse(readFileSync(join(root, "src/brand.json"), "utf8"));
const escHtml = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

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

// Every third-party module comes from apps/web's own node_modules (declared in
// package.json, pinned by its lockfile). packages/match, packages/moderation and
// packages/taste are imported from source; their bare imports (nostr-tools,
// @noble/*, @scure/*) are resolved here, never from those packages' node_modules,
// so `npm ci` in apps/web alone is enough and the output depends on one lockfile.
const PSI_WEB = join(root, "node_modules/@openmined/psi.js/psi_wasm_web.js");
if (!existsSync(PSI_WEB)) throw new Error("@openmined/psi.js isn't installed: run npm ci in apps/web");
const OWN_DEPS = /^(nostr-tools|nostr-wasm|@noble\/[^/]+|@scure\/[^/]+)(\/.*)?$/;
const ownDeps = {
  name: "apps-web-deps",
  setup(b) {
    b.onResolve({ filter: OWN_DEPS }, async (args) => {
      if (args.pluginData === "own") return undefined;
      const r = await b.resolve(args.path, { resolveDir: root, kind: args.kind, pluginData: "own" });
      if (r.errors.length) return { errors: r.errors };
      return { path: r.path, sideEffects: r.sideEffects };
    });
  },
};

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
  plugins: [ownDeps],
  // psi.ts reads import.meta.url only to hand it to createRequire, which the shim ignores.
  logOverride: { "empty-import-meta": "silent" },
};
const appOpts = (dev) => ({
  ...common,
  plugins: [ownDeps, matchShims("script")],
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

/** index.html placeholders and the web manifest, from src/brand.json. */
function brandPublic(dist) {
  const p = join(dist, "index.html");
  const html = readFileSync(p, "utf8")
    .replaceAll("__APP_NAME__", escHtml(brand.name))
    .replaceAll("__APP_DESCRIPTION__", escHtml(brand.description))
    .replaceAll("__THEME_COLOR__", escHtml(brand.themeColor))
    .replaceAll("__THEME_COLOR_DARK__", escHtml(brand.themeColorDark));
  if (html.includes("__APP_")) throw new Error("index.html has an unknown placeholder");
  writeFileSync(p, html);
  const manifest = {
    id: "./",
    name: brand.name,
    short_name: brand.shortName,
    description: brand.description,
    lang: "en",
    dir: "ltr",
    start_url: "./",
    scope: "./",
    display: "standalone",
    orientation: "any",
    background_color: brand.backgroundColor,
    theme_color: brand.themeColor,
    categories: ["entertainment", "video"],
    icons: [
      { src: "icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "icon-maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    // Android Chrome: an installed PWA can receive shared PeerTube links. The page reads
    // these parameters and asks before contacting the video's host (src/lib/incoming.ts).
    share_target: { action: "./", method: "GET", params: { title: "share_title", text: "share_text", url: "share_url" } },
    shortcuts: [
      { name: "Reels", url: "./?view=reels", icons: [{ src: "icon-192.png", sizes: "192x192", type: "image/png" }] },
      { name: "Matches", url: "./?screen=matches", icons: [{ src: "icon-192.png", sizes: "192x192", type: "image/png" }] },
    ],
  };
  writeFileSync(join(dist, "manifest.webmanifest"), JSON.stringify(manifest, null, 2) + "\n");
}

function copyPublic(dist) {
  cpSync(join(root, "public"), dist, { recursive: true });
  brandPublic(dist);
  const sec = join(dist, ".well-known/security.txt");
  if (existsSync(sec) && /example\.(org|com)/.test(readFileSync(sec, "utf8").replace(/^#.*$/gm, ""))) throw new Error("public/.well-known/security.txt still has placeholder values");
  // The browser build of @openmined/psi.js 2.0.6 (Apache-2.0), loaded only when a
  // Match preview runs.
  cpSync(PSI_WEB, join(dist, "psi.js"));
}

/** Every file in dist/, sorted, as paths relative to it ("app.js", "fonts/x.woff2"). */
function listFiles(dist, sub = "") {
  const out = [];
  for (const name of readdirSync(join(dist, sub)).sort()) {
    const rel = sub ? `${sub}/${name}` : name;
    if (statSync(join(dist, rel)).isDirectory()) out.push(...listFiles(dist, rel));
    else out.push(rel);
  }
  return out;
}

/**
 * Precache list and cache id for public/sw.js. The id is a SHA-256 over the path and
 * bytes of every built file except sw.js itself, so any change (index.html, fonts,
 * manifest, psi.js…) gives a new cache. Deterministic: sorted paths, no timestamps.
 * Not precached: source maps, crash.js (fetched only after opt-in), example lists
 * and .well-known/ (fetched on demand, network first).
 */
function stampServiceWorker(dist) {
  const files = listFiles(dist).filter((f) => f !== "sw.js");
  const hash = createHash("sha256");
  for (const f of files) hash.update(f + "\0").update(readFileSync(join(dist, f))).update("\0");
  const id = hash.digest("hex").slice(0, 16);
  const precache = ["./", ...files.filter((f) => !/\.map$/.test(f) && f !== "crash.js" && !f.startsWith("examples/") && !f.startsWith(".well-known/")).map((f) => "./" + f)];
  const p = join(dist, "sw.js");
  const src = readFileSync(p, "utf8");
  if (!src.includes("__BUILD__") || !src.includes("__PRECACHE__")) throw new Error("sw.js placeholders missing");
  writeFileSync(p, src.replace("__BUILD__", id).replace('"__PRECACHE__"', JSON.stringify(precache)));
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
  const js = await esbuild.build({ ...common, plugins: [ownDeps, matchShims("inline")], define: { __MF_DEV__: "true", __MF_TELEMETRY__: JSON.stringify({ appVersion }) }, entryPoints: [join(root, "src/main-artifact.ts")], format: "iife", minify: true, write: false });
  // The stylesheet has no imports; inline it verbatim so the theme selectors keep the
  // documented form (esbuild would rewrite [data-theme="light"] to [data-theme=light]).
  const cssText = readFileSync(join(root, "src/styles.css"), "utf8");
  const script = js.outputFiles[0].text.replace(/<\/(script)/gi, "<\\/$1");
  const style = cssText.replace(/<\/(style)/gi, "<\\/$1");
  // claude.ai artifact: content only (no <html>/<head>/<body>), <title> first,
  // everything inline except the Google Fonts stylesheet.
  const html = [
    `<title>${escHtml(brand.name)}</title>`,
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">',
    '<meta name="claude:viewport-fit-sides" content="cover">',
    `<link rel="stylesheet" href="${FONTS}">`,
    `<style>${style}</style>`,
    `<div id="app"><p style="padding:16px">Loading ${escHtml(brand.name)}…</p></div>`,
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
  console.log(`${brand.name} dev server: http://${hosts[0] === "0.0.0.0" ? "localhost" : hosts[0]}:${p}/ (rebuilds on save; reload the page)`);
} else {
  if (!artifactOnly) await buildApp();
  if (!appOnly) await buildArtifact();
}
