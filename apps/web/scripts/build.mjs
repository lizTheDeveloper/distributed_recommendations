// Build the web client.
//
//   node scripts/build.mjs                 # dist/ (PWA) + dist-artifact/index.html
//   node scripts/build.mjs --artifact-only # just the single-file artifact
//   node scripts/build.mjs --dev [--port N]  # watch + serve dist/ on http://localhost:8080

import * as esbuild from "esbuild";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const dev = args.includes("--dev");
const artifactOnly = args.includes("--artifact-only");
const port = Number(args[args.indexOf("--port") + 1]) || 8080;

const FONTS =
  "https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,700&family=Atkinson+Hyperlegible:wght@400;700&family=JetBrains+Mono:wght@400;600&display=swap";

const common = {
  bundle: true,
  target: ["es2020", "chrome100", "firefox100", "safari15"],
  logLevel: "info",
  legalComments: "none",
};

function copyPublic(dist) {
  cpSync(join(root, "public"), dist, { recursive: true });
}

function stampServiceWorker(dist) {
  const js = readFileSync(join(dist, "app.js"));
  const css = readFileSync(join(dist, "app.css"));
  const id = createHash("sha256").update(js).update(css).digest("hex").slice(0, 12);
  const p = join(dist, "sw.js");
  writeFileSync(p, readFileSync(p, "utf8").replace("__BUILD__", id));
}

async function buildApp() {
  const dist = join(root, "dist");
  rmSync(dist, { recursive: true, force: true });
  mkdirSync(dist, { recursive: true });
  copyPublic(dist);
  await esbuild.build({ ...common, entryPoints: [join(root, "src/main.ts")], outfile: join(dist, "app.js"), format: "iife", minify: true, sourcemap: "linked" });
  await esbuild.build({ ...common, entryPoints: [join(root, "src/styles.css")], outfile: join(dist, "app.css"), minify: true });
  stampServiceWorker(dist);
}

async function buildArtifact() {
  const js = await esbuild.build({ ...common, entryPoints: [join(root, "src/main-artifact.ts")], format: "iife", minify: true, write: false });
  // The stylesheet has no imports; inline it verbatim so the theme selectors keep the
  // documented form (esbuild would rewrite [data-theme="light"] to [data-theme=light]).
  const cssText = readFileSync(join(root, "src/styles.css"), "utf8");
  const script = js.outputFiles[0].text.replace(/<\/(script)/gi, "<\\/$1");
  const style = cssText.replace(/<\/(style)/gi, "<\\/$1");
  // claude.ai artifact: content only (no <html>/<head>/<body>), <title> first,
  // everything inline except the Google Fonts stylesheet.
  const html = [
    "<title>Match Feed Client</title>",
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
  writeFileSync(join(dist, "sw.js"), "// no service worker in dev\n");
  const ctxJs = await esbuild.context({ ...common, entryPoints: [join(root, "src/main.ts")], outfile: join(dist, "app.js"), format: "iife", sourcemap: "inline" });
  const ctxCss = await esbuild.context({ ...common, entryPoints: [join(root, "src/styles.css")], outfile: join(dist, "app.css") });
  await Promise.all([ctxJs.watch(), ctxCss.watch()]);
  const { hosts, port: p } = await ctxJs.serve({ servedir: dist, port });
  console.log(`Match Feed dev server: http://${hosts[0] === "0.0.0.0" ? "localhost" : hosts[0]}:${p}/ (rebuilds on save; reload the page)`);
} else {
  if (!artifactOnly) await buildApp();
  await buildArtifact();
}
