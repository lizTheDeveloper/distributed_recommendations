// Headless check for opt-in telemetry (docs/TELEMETRY.md, "Checks").
//
//   PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node scripts/telemetry-check.mjs [--shots DIR] [--glitchtip URL --umami URL --umami-site UUID]
//
// By default it starts two local mock servers that stand in for GlitchTip and Umami
// (recording every request), builds the app with them configured, serves it on
// 127.0.0.1, and drives it in headless Chromium at 390x844:
//   1. before opt-in: zero requests to either host and crash.js never fetched,
//      on the first launch and on the second (until the question is answered);
//   2. the question appears on the second launch, all switches off;
//   3. after "Turn on selected" (crash + usage): crash.js loads, Umami gets
//      allow-listed events, a thrown error reaches GlitchTip scrubbed;
//   4. a bug report sends exactly what the preview showed;
//   5. after turning both off: nothing more is sent;
//   6. a build without endpoints shows no telemetry UI and loads nothing.
// Every request outside 127.0.0.1 is blocked, so no real data goes anywhere.
// With --glitchtip/--umami it targets local docker instances instead of the mocks
// (infra/glitchtip, infra/umami) and checks only what the client sends.
//
// Playwright is not a dependency of this package; point PLAYWRIGHT_MODULE at an
// installed copy (or install it in a scratch directory).

import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, rmSync, existsSync, mkdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const arg = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : null);
const shots = arg("--shots");
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- mock GlitchTip and Umami ----
function mock(name) {
  const requests = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Headers", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      if (req.method !== "OPTIONS") requests.push({ method: req.method, url: req.url, headers: req.headers, body });
      res.setHeader("Content-Type", "application/json");
      res.end(name === "glitchtip" ? JSON.stringify({ id: "0".repeat(32) }) : "{}");
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, requests, origin: `http://127.0.0.1:${server.address().port}` })));
}

function serveDir(dir) {
  const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".webmanifest": "application/manifest+json", ".map": "application/json" };
  const served = [];
  const server = createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    served.push(p);
    let f = join(dir, p === "/" ? "index.html" : p);
    if (!f.startsWith(dir) || !existsSync(f) || statSync(f).isDirectory()) {
      res.statusCode = 404;
      return res.end();
    }
    res.setHeader("Content-Type", types[extname(f)] ?? "application/octet-stream");
    res.end(readFileSync(f));
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, served, origin: `http://127.0.0.1:${server.address().port}` })));
}

function build(outdir, env) {
  const r = spawnSync(process.execPath, [join(root, "scripts/build.mjs"), "--app-only", "--outdir", outdir], { cwd: root, env: { ...process.env, ...env }, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`build failed:\n${r.stdout}\n${r.stderr}`);
}

const SITE = arg("--umami-site") ?? "11111111-2222-4333-8444-555555555555";
const KEY = "0123456789abcdef0123456789abcdef";
const external = !!(arg("--glitchtip") || arg("--umami"));
const gt = external ? { requests: [], origin: new URL(arg("--glitchtip")).origin } : await mock("glitchtip");
const um = external ? { requests: [], origin: new URL(arg("--umami")).origin } : await mock("umami");
const dsn = external ? arg("--glitchtip") : `${gt.origin.replace("http://", `http://${KEY}@`)}/1`;

const work = mkdtempSync(join(tmpdir(), "mf-telemetry-"));
const withDir = join(work, "with");
const withoutDir = join(work, "without");
build(withDir, { MF_GLITCHTIP_DSN: dsn, MF_UMAMI_HOST: um.origin, MF_UMAMI_WEBSITE_ID: SITE });
build(withoutDir, { MF_GLITCHTIP_DSN: "", MF_UMAMI_HOST: "", MF_UMAMI_WEBSITE_ID: "" });
check("configured build has crash.js; CSP lists both hosts", existsSync(join(withDir, "crash.js")) && readFileSync(join(withDir, "index.html"), "utf8").includes(`connect-src 'self' ${gt.origin} ${um.origin}`));
check("unconfigured build has no crash.js and an unchanged CSP", !existsSync(join(withoutDir, "crash.js")) && readFileSync(join(withoutDir, "index.html"), "utf8").includes("connect-src 'self' https:"));
check("app.js never contains the Sentry SDK", !/SENTRY_SDK|sentry\.javascript\.browser/.test(readFileSync(join(withDir, "app.js"), "utf8")));

const site = await serveDir(withDir);
const plain = await serveDir(withoutDir);

// Browser: every request leaving 127.0.0.1 is aborted, and every request to the
// telemetry hosts is recorded from the browser's side too.
const browser = await chromium.launch();
const seen = [];
async function newPage(ctx) {
  const page = await ctx.newPage();
  await page.route("**/*", (route) => {
    const u = new URL(route.request().url());
    if (u.hostname === "127.0.0.1" || u.protocol === "data:" || u.protocol === "blob:") return route.continue();
    return route.abort();
  });
  page.on("request", (r) => seen.push({ url: r.url(), headers: r.headers() }));
  page.on("pageerror", () => {});
  return page;
}
const toTelemetry = () => seen.filter((r) => r.url.startsWith(gt.origin) || r.url.startsWith(um.origin));
const crashJs = () => seen.filter((r) => r.url.endsWith("/crash.js"));
const umEvents = () => um.requests.filter((r) => r.method === "POST").map((r) => JSON.parse(r.body));
const gtEnvelopes = () => gt.requests.filter((r) => r.method === "POST").map((r) => r.body.split("\n").map((l) => JSON.parse(l)));

const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: "block" });
let page = await newPage(ctx);

/** First run shows the onboarding dialog; skip it the way a viewer would. */
async function skipOnboarding(p) {
  const skip = p.locator("#onb-skip");
  if (await skip.isVisible().catch(() => false)) await skip.click();
}

// 1. First launch: nothing asked, nothing sent.
await page.goto(site.origin + "/");
await page.waitForSelector(".bottombar");
await page.waitForSelector("#onboarding", { timeout: 5000 }).catch(() => {});
await skipOnboarding(page);
await sleep(3000);
check("first launch: no question on first paint", (await page.locator("#telemetry-card").count()) === 0);
check("first launch: zero requests to GlitchTip/Umami, crash.js not fetched", toTelemetry().length === 0 && crashJs().length === 0, `${toTelemetry().length} requests`);

// 2. Second launch: the question appears shortly after start, all switches off.
await page.reload();
await page.waitForSelector(".bottombar");
check("second launch: still nothing on first paint", (await page.locator("#telemetry-card").count()) === 0);
await page.waitForSelector("#telemetry-card", { timeout: 40_000 });
const boxes = await page.locator("#telemetry-card input[type=checkbox]").evaluateAll((els) => els.map((e) => [e.id, e.checked]));
check("question offers three switches, all off", boxes.length === 3 && boxes.every(([, c]) => c === false), JSON.stringify(boxes));
check("question is a non-modal region", (await page.locator("#telemetry-card").getAttribute("role")) === "region" && (await page.locator("[aria-modal=true]").count()) === 0);
check("before opt-in: zero requests to GlitchTip/Umami, crash.js not fetched", toTelemetry().length === 0 && crashJs().length === 0);
if (shots) {
  mkdirSync(shots, { recursive: true });
  await page.screenshot({ path: join(shots, "telemetry-consent-card.png") });
}

// 3. Opt in to crash reports and usage analytics.
await page.check("#tc-crash");
await page.check("#tc-usage");
await page.click("#tc-yes");
await page.waitForFunction(() => !document.getElementById("telemetry-card"));
await sleep(1500);
check("after opt-in: crash.js fetched once", crashJs().length === 1);
// Go to Sharing & privacy the phone way: Settings (bottom bar) → sheet link.
const goPrivacy = async () => {
  await page.click("#bt-settings");
  await page.click(".linkrows >> text=Sharing & privacy");
};
await goPrivacy();
await page.waitForSelector("#telemetry-panel");
await sleep(800);
const events = umEvents();
check("Umami got the app-open and the screen view", events.some((e) => e.payload.name === "app-open") && events.some((e) => e.payload.url === "/settings" && !e.payload.name), JSON.stringify(events.map((e) => [e.payload.url, e.payload.name ?? ""])));
const allowedKeys = new Set(["website", "hostname", "url", "name", "data", "browser", "os", "device"]);
check("Umami payloads carry only allow-listed fields", events.every((e) => e.type === "event" && Object.keys(e.payload).every((k) => allowedKeys.has(k)) && /^\/[a-z-]+$/.test(e.payload.url)));

// A crash: thrown from a timer with sensitive strings in the message.
const SECRET = "boom at https://framatube.org/w/kkGMgK9ZtnKfYAgnEtQxbv for npub1sg6plzptd64u62a878hep2kev88swjh3tw00gjsfl8f237lmu63q0uf63m in /home/alice/x.js";
await page.evaluate((m) => setTimeout(() => { throw new TypeError(m); }, 0), SECRET);
await page.waitForFunction(() => true);
for (let i = 0; i < 20 && gtEnvelopes().length < 1; i++) await sleep(250);
const crash = gtEnvelopes().find((env) => env.some((x) => x.exception));
check("a thrown error reaches GlitchTip", !!crash);
if (crash) {
  const raw = JSON.stringify(crash);
  check("crash report is scrubbed (no URL, npub, path, IP, user)", !/framatube|kkGMgK9Z|npub1|alice|ip_address|"user"|"request"/.test(raw), raw.slice(0, 400));
  const ev = crash.find((x) => x.exception);
  check("crash report carries the route and coarse device facts", ev.tags?.route === "settings" && ["small", "medium", "large"].includes(ev.tags?.screen));
}

// 4. Bug report: the preview is exactly what's sent.
await page.click("#fb-open");
await page.fill("#fb-text", "Reels froze after I followed blender@video.blender.org");
await page.fill("#fb-email", "tester@example.org");
await page.check("#fb-attach");
await sleep(200);
const preview = JSON.parse(await page.locator("#fb-preview").textContent());
if (shots) {
  await page.locator("#telemetry-panel").screenshot({ path: join(shots, "telemetry-feedback.png") });
}
const before = gtEnvelopes().length;
await page.click("#fb-send");
for (let i = 0; i < 20 && gtEnvelopes().length <= before; i++) await sleep(250);
const fb = gtEnvelopes().at(-1)?.[2];
if (fb) {
  const { event_id, timestamp, ...rest } = fb;
  check("bug report sent equals the preview", JSON.stringify(rest) === JSON.stringify(preview));
  check("bug report text scrubbed, email kept, diagnostics attached", !JSON.stringify(fb).includes("blender") && fb.contexts.feedback.contact_email === "tester@example.org" && !!fb.contexts.diagnostics);
} else check("bug report sent", false);
await sleep(500);
if (shots) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.locator("#telemetry-panel").scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(shots, "telemetry-settings.png") });
}

// 5. Turn both off: nothing more goes out.
await page.uncheck("#tp-crash");
await page.uncheck("#tp-usage");
await sleep(500);
const counts = [gt.requests.length, um.requests.length];
await page.click("#bt-matches");
await page.evaluate(() => setTimeout(() => { throw new Error("after opt-out"); }, 0));
await sleep(1500);
check("after turning off: no further requests", gt.requests.length === counts[0] && um.requests.length === counts[1], `${gt.requests.length - counts[0]} / ${um.requests.length - counts[1]} new`);
check("no request to the telemetry hosts carried cookies or a referrer", toTelemetry().every((r) => !r.headers.cookie && !r.headers.referer));
await page.close();
await ctx.close();

// 6. A build without endpoints: no UI, nothing loaded, even with consent stored.
const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
page = await newPage(ctx2);
await page.goto(plain.origin + "/");
await page.waitForSelector("#onboarding", { timeout: 5000 }).catch(() => {});
await skipOnboarding(page);
await page.evaluate(() => localStorage.setItem("mf.v1.settings", JSON.stringify({ onboarded: true, telemetry: { crash: true, diagnostics: true, usage: true, prompt: { state: "answered", launches: 5 } } })));
const n0 = seen.length;
await page.reload();
await page.waitForSelector(".bottombar");
await page.click("#bt-settings");
const noLink = (await page.locator(".linkrows >> text=Report a bug").count()) === 0;
await page.click(".linkrows >> text=Sharing & privacy");
await sleep(1500);
check("unconfigured build: no telemetry panel, no bug-report link", (await page.locator("#telemetry-panel").count()) === 0 && noLink && (await page.locator("#app-menu >> text=Report a bug").count()) === 0);
check("unconfigured build: no crash.js and no telemetry requests", seen.slice(n0).every((r) => !r.url.endsWith("/crash.js") && !r.url.startsWith(gt.origin) && !r.url.startsWith(um.origin)));
await ctx2.close();

await browser.close();
for (const s of [site, plain, ...(external ? [] : [gt, um])]) s.server.close();
rmSync(work, { recursive: true, force: true });
console.log(failures ? `${failures} check(s) failed` : "all telemetry checks passed");
process.exit(failures ? 1 : 0);
