// Headless Chromium run of the main flows, with axe-core accessibility checks.
//
//   npm run build && npm run check:ui -- [--shots DIR] [--only live|artifact] [--proxy-from-env]
//
// Serves dist/ (live build) and dist-artifact/ (offline snapshot) on 127.0.0.1 and
// drives each at 390x844 (phone) and 1280x900 (desktop):
//   onboarding (skippable, keyboard), Reels (rail, ⋯ More → Report with its confirm
//   step, Block), "N hidden", Grid (card menu), the feed settings sheet (focus trap),
//   Settings (moderation: NSFW two-step, labeler field; install/offline panel),
//   Matches (identity, offline demo peer), Creator studio "Publish my picks"
//   (dry run), light and dark themes, reduced motion, and (live) offline reload
//   from the service worker.
// axe-core (pinned in package.json) runs on each screen; any serious or critical
// violation fails the run. PeerTube embeds are cross-origin and excluded.
// The live run contacts the default PeerTube instances (framatube.org, tilvids.com);
// it never adds a relay. With --proxy-from-env, Chromium uses $HTTPS_PROXY.
// Playwright and axe-core come from node_modules (PLAYWRIGHT_MODULE overrides).

import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { extname, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const arg = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : null);
const shots = arg("--shots");
const only = arg("--only");
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const AXE = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
if (shots) mkdirSync(shots, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

// ---- static server ----
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".map": "application/json", ".txt": "text/plain" };
function serve() {
  const server = createServer((req, res) => {
    const u = new URL(req.url, "http://x");
    if (u.pathname.startsWith("/artifact")) {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      // The artifact is a fragment (claude.ai wraps it); give it a document.
      return res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"></head><body>${readFileSync(join(root, "dist-artifact/index.html"), "utf8")}</body></html>`);
    }
    let p = join(root, "dist", decodeURIComponent(u.pathname));
    if (existsSync(p) && statSync(p).isDirectory()) p = join(p, "index.html");
    if (!existsSync(p)) {
      res.statusCode = 404;
      return res.end("not found");
    }
    res.setHeader("Content-Type", TYPES[extname(p)] ?? "application/octet-stream");
    res.end(readFileSync(p));
  });
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r({ server, origin: `http://127.0.0.1:${server.address().port}` })));
}

// ---- axe ----
const axeSummary = [];
async function axe(page, label) {
  await page.addScriptTag({ content: AXE });
  const r = await page.evaluate(async () => {
    // eslint-disable-next-line no-undef
    const res = await axe.run(document, { exclude: [["iframe"]], resultTypes: ["violations"] });
    return res.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.slice(0, 3).map((n) => n.target.join(" ") + (v.id === "color-contrast" && n.any?.[0]?.data ? ` [${n.any[0].data.fgColor} on ${n.any[0].data.bgColor} = ${n.any[0].data.contrastRatio}]` : "")) }));
  });
  const bad = r.filter((v) => v.impact === "serious" || v.impact === "critical");
  axeSummary.push({ label, violations: r });
  check(`axe: ${label}`, bad.length === 0, bad.map((v) => `${v.impact} ${v.id}: ${v.nodes.join(", ")}`).join(" | ") || (r.length ? `${r.length} minor/moderate: ${r.map((v) => `${v.id} ${v.nodes.join(", ")}`).join("; ")}` : "clean"));
}

async function shot(page, name) {
  if (shots) await page.screenshot({ path: join(shots, `prod-${name}.png`) });
}

async function focusInside(page, sel, tabs = 30) {
  for (let i = 0; i < tabs; i++) {
    await page.keyboard.press("Tab");
    const inside = await page.evaluate((s) => !!document.activeElement?.closest(s), sel);
    if (!inside) return false;
  }
  return true;
}

/** Switch screens the way a viewer would: bottom bar on phones (Settings: the header tab, via the sheet's link), tabs on desktop. */
async function nav(page, vp, screen) {
  const id = vp.w < 860 && screen !== "settings" ? `bt-${screen}` : `tab-${screen}`;
  await page.evaluate((x) => document.getElementById(x)?.click(), id);
  await sleep(300);
}

async function run(target, vp, origin, opts) {
  const tag = `${target}-${vp.name}`;
  const ctx = await opts.browser.newContext({
    viewport: { width: vp.w, height: vp.h },
    deviceScaleFactor: 1,
    bypassCSP: true, // only so axe can be injected; the app's own CSP is unchanged
    serviceWorkers: target === "live" ? "allow" : "block",
    ...(opts.ctx ?? {}),
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const url = target === "live" ? `${origin}/` : `${origin}/artifact`;
  await page.goto(url);

  // 1. Onboarding: shows on first run, keyboard reachable, skippable.
  const onb = page.locator("#onboarding");
  await onb.waitFor({ timeout: 15000 });
  check(`${tag}: onboarding opens on first run`, await onb.isVisible());
  check(`${tag}: onboarding traps focus`, await focusInside(page, "#onboarding", 25));
  await shot(page, `${tag}-onboarding-1`);
  await axe(page, `${tag} onboarding`);
  await page.click("#onb-t-science");
  check(`${tag}: topic toggles (aria-pressed)`, (await page.getAttribute("#onb-t-science", "aria-pressed")) === "true");
  await page.click("#onb-next");
  await sleep(target === "live" ? 4000 : 800);
  await shot(page, `${tag}-onboarding-2`);
  await page.keyboard.press("Tab");
  await page.click("#onb-next");
  await shot(page, `${tag}-onboarding-3`);
  await page.focus("#onb-next");
  await page.keyboard.press("Enter");
  await sleep(300);
  check(`${tag}: onboarding closes`, !(await onb.isVisible().catch(() => false)));

  // 2. Reels.
  await page.waitForSelector(".reel[data-vid]", { timeout: 30000 });
  await sleep(1500);
  await shot(page, `${tag}-reels`);
  await axe(page, `${tag} reels`);
  // Endorse two reels (for the picks flow).
  for (let i = 0; i < 2; i++) {
    const heart = page.locator(".reel.is-active .rail-btn[id$='-heart']");
    if (await heart.count()) await heart.first().click();
    await page.keyboard.press("j");
    await sleep(700);
  }
  // ⋯ More → Report → confirm step.
  await page.locator(".reel.is-active .rail-btn[id$='-more']").first().click();
  await page.waitForSelector("#reel-more");
  await page.click("#more-report");
  await page.waitForSelector("#report-dialog");
  await page.check("#rep-t-spam");
  await page.fill("#rep-details", "Same video posted many times");
  await shot(page, `${tag}-report-1`);
  await axe(page, `${tag} report`);
  await page.click("#rep-next");
  await page.waitForSelector("#rep-confirm-h");
  check(`${tag}: report confirm step shows the instance part`, (await page.textContent("#report-dialog")).includes("which hosts it"));
  await shot(page, `${tag}-report-2`);
  await page.click("#rep-done");
  await sleep(500);
  // ⋯ More → Block creator.
  await page.locator(".reel.is-active .rail-btn[id$='-more']").first().click();
  await page.click("#more-block");
  await page.waitForSelector("#block-dialog");
  await shot(page, `${tag}-block`);
  await page.click("#blk-0");
  await page.click("#blk-yes");
  await sleep(600);
  const pill = page.locator("#reels-hidden-pill");
  check(`${tag}: "N hidden" after report + block`, (await pill.count()) > 0, (await pill.count()) ? await pill.textContent() : "");
  if (await pill.count()) {
    await pill.click();
    await page.waitForSelector("#hidden-dialog");
    await shot(page, `${tag}-hidden`);
    await axe(page, `${tag} hidden sheet`);
    await page.keyboard.press("Escape");
  }

  // 3. Grid and the card menu.
  await page.click("#view-grid");
  await page.waitForSelector(".card[data-vid]", { timeout: 20000 });
  await shot(page, `${tag}-grid`);
  await axe(page, `${tag} grid`);
  await page.locator(".cardmenu summary").first().click();
  await shot(page, `${tag}-cardmenu`);
  check(`${tag}: card menu has Report and Block`, (await page.locator(".cardmenu[open] .menu").textContent()).includes("Report…"));
  await page.keyboard.press("Escape");

  // 4. Feed settings sheet: focus trap.
  await page.click(vp.w < 860 ? "#bt-settings" : "#gear-btn");
  await page.waitForSelector(".sheet.in", { timeout: 5000 }).catch(() => {});
  check(`${tag}: feed settings sheet traps focus`, await focusInside(page, ".sheet", 40));
  await shot(page, `${tag}-sheet`);
  await axe(page, `${tag} feed settings`);
  await page.keyboard.press("Escape");

  // 5. Matches: identity (and the offline demo peer asking).
  await nav(page, vp, "matches");
  await page.waitForSelector("#id-generate", { timeout: 5000 });
  await page.click("#id-generate");
  await sleep(1500);
  if (target === "artifact" && (await page.locator("#demo-incoming").count())) {
    await page.click("#demo-incoming");
    await sleep(2500);
  }
  await shot(page, `${tag}-matches`);
  await axe(page, `${tag} matches`);

  // 6. Creator studio: publish my picks, dry run.
  await nav(page, vp, "studio");
  await page.waitForSelector("#publish-picks");
  const boxes = page.locator("#publish-picks input[id^='pk-c-']");
  for (let i = 0; i < Math.min(2, await boxes.count()); i++) await boxes.nth(i).check();
  await page.click("#pk-preview");
  await page.waitForSelector("#pk-result", { timeout: 10000 });
  await page.click("#pk-sign-dry");
  await sleep(1200);
  const ev = await page.textContent("#pk-event").catch(() => "");
  check(`${tag}: picks dry run signs a kind-30005 event, sends nothing`, ev.includes('"kind": 30005') && ev.includes('"sig"') && (await page.textContent("#pk-result")).includes("not sent"));
  await page.locator("#publish-picks").scrollIntoViewIfNeeded();
  await shot(page, `${tag}-studio-picks`);
  await axe(page, `${tag} studio`);

  // 7. Settings: moderation (NSFW two steps), labeler field, app panel.
  await nav(page, vp, "settings");
  await page.waitForSelector("#moderation", { timeout: 5000 });
  await page.selectOption("#mod-nsfw", "show");
  await page.waitForSelector("#nsfw-confirm");
  check(`${tag}: NSFW "show" needs a second confirmation`, (await page.inputValue("#mod-nsfw")) !== "show");
  await shot(page, `${tag}-nsfw-confirm`);
  await page.click("#nsfw-no");
  await page.fill("#lab-npub", "npub1notvalid");
  await page.click("#lab-add");
  await sleep(300);
  check(`${tag}: invalid labeler npub is refused`, (await page.locator("#moderation .err").count()) > 0);
  await sleep(200);
  await page.evaluate(() => document.getElementById("moderation")?.scrollIntoView());
  await shot(page, `${tag}-settings-moderation`);
  await axe(page, `${tag} settings`);

  // 8. Dark theme and reduced motion on Home and Settings.
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await axe(page, `${tag} settings (dark)`);
  await shot(page, `${tag}-settings-dark`);
  await nav(page, vp, "home");
  await page.click("#view-reels");
  await sleep(800);
  await axe(page, `${tag} reels (dark, reduced motion)`);
  await shot(page, `${tag}-reels-dark`);
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "no-preference" });

  // 9. Live: the on-demand DAP bundle loads under the CSP; then offline reload from the service worker.
  if (target === "live") {
    const dapOk = await page.evaluate(
      () =>
        new Promise((r) => {
          const el = document.createElement("script");
          el.src = "./dap.js";
          el.onload = () => r(typeof globalThis.__MF_DAP__?.runUploads === "function" && !!globalThis.__MF_DAP__.divviupClient());
          el.onerror = () => r(false);
          document.head.appendChild(el);
        }),
    );
    check(`${tag}: dap.js (Tier 2 report client) loads in the browser`, dapOk);
    const ready = await page.evaluate(async () => !!(await navigator.serviceWorker?.ready.catch(() => null)));
    check(`${tag}: service worker installed`, ready);
    await ctx.setOffline(true);
    await page.reload();
    await page.waitForSelector(".topbar", { timeout: 15000 }).catch(() => {});
    check(`${tag}: app shell opens offline`, (await page.locator(".topbar h1").count()) > 0);
    check(`${tag}: offline notice`, (await page.locator("#offline-note").count()) > 0);
    await shot(page, `${tag}-offline`);
    await axe(page, `${tag} offline`);
    const cached = await page.evaluate(async () => {
      const out = [];
      for (const k of await caches.keys()) for (const r of await (await caches.open(k)).keys()) out.push(r.url);
      return out;
    });
    check(`${tag}: cache holds only same-origin shell files`, cached.length > 0 && cached.every((u) => u.startsWith(origin) && !/\/api\/|examples\/|\.map$/.test(u)), `${cached.length} entries`);
    await ctx.setOffline(false);
  }
  check(`${tag}: no uncaught page errors`, errors.length === 0, errors.slice(0, 3).join(" | "));
  await ctx.close();
}

const { server, origin } = await serve();
const proxy = args.includes("--proxy-from-env") && process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined;
// A launch flag, not Playwright's `proxy` option (which also proxies loopback and would hide the local server).
const browser = await chromium.launch(proxy ? { args: [`--proxy-server=${proxy.server}`] } : {});
const VPS = [
  { name: "390x844", w: 390, h: 844 },
  { name: "1280x900", w: 1280, h: 900 },
];
try {
  for (const target of ["artifact", "live"]) {
    if (only && only !== target) continue;
    for (const vp of VPS) {
      try {
        await run(target, vp, origin, { browser, ctx: proxy ? { ignoreHTTPSErrors: true } : {} });
      } catch (e) {
        check(`${target}-${vp.name}: flow ran to the end`, false, String(e).split("\n")[0]);
      }
    }
  }
} finally {
  await browser.close();
  server.close();
}
const counts = {};
for (const s of axeSummary) for (const v of s.violations) counts[`${v.impact} ${v.id}`] = (counts[`${v.impact} ${v.id}`] ?? 0) + 1;
console.log("\naxe violations by impact and rule (all screens):", Object.keys(counts).length ? counts : "none");
console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
