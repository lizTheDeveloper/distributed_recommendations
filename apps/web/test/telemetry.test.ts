import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ASK_AFTER_MS,
  ASK_DELAY_ON_LAUNCH_MS,
  MAX_REASKS,
  SNOOZE_MS,
  answer,
  askDelay,
  decline,
  defaultConsent,
  loadConsent,
  noteLaunch,
  setToggle,
  snooze,
} from "../src/lib/telemetry/consent.ts";
import { createLimiter, looksSensitive, safeRoute, sampleRate, scrubBreadcrumb, scrubEvent, scrubFrameFile, scrubText } from "../src/lib/telemetry/scrub.ts";
import { USAGE_EVENTS, createUsageClient, eventPayload, filterData, screenPayload } from "../src/lib/telemetry/usage.ts";
import { envelope, envelopeUrl, feedbackEvent, parseDsn, sendFeedback } from "../src/lib/telemetry/feedback.ts";
import { resolveConfig } from "../src/lib/telemetry/config.ts";
import { createTelemetry } from "../src/lib/telemetry/controller.ts";
import type { CrashReporter } from "../src/lib/telemetry/controller.ts";
import { browserFamily, createErrorLog, osFamily, screenClass } from "../src/lib/telemetry/diagnostics.ts";
import { defaultSettings, loadSettings } from "../src/lib/settings.ts";

const T0 = Date.UTC(2026, 9, 19, 12);

// ---- consent ----

test("telemetry defaults: all three switches off, separate from discovery stats", () => {
  const s = defaultSettings();
  assert.deepEqual([s.telemetry.crash, s.telemetry.diagnostics, s.telemetry.usage], [false, false, false]);
  assert.equal(s.telemetry.prompt.state, "pending");
  assert.equal(s.analytics.contribute, true, "creator discovery stats keep their decided default");
  // Garbage in storage never turns anything on.
  const bad = loadSettings({ telemetry: { crash: "yes", usage: 1, diagnostics: null, prompt: { state: "bogus", launches: -4 } } }).telemetry;
  assert.deepEqual([bad.crash, bad.usage, bad.diagnostics, bad.prompt.state, bad.prompt.launches], [false, false, false, "pending", 0]);
  assert.equal(loadConsent({ crash: true, prompt: { state: "pending" } }).prompt.state, "answered", "something on implies an answer");
  assert.equal(loadConsent({ prompt: { state: "snoozed" } }).prompt.state, "never", "a snooze without a date isn't re-asked");
});

test("ask once, later: not on first paint, after 3 minutes or on the second launch", () => {
  let c = noteLaunch(defaultConsent());
  assert.equal(askDelay(c, T0, T0, true), ASK_AFTER_MS, "first launch: after a few minutes of use");
  assert.equal(askDelay(c, T0 + 60_000, T0, true), ASK_AFTER_MS - 60_000);
  assert.equal(askDelay(c, T0, T0, false), null, "nothing configured: never ask");
  c = noteLaunch(c);
  assert.equal(askDelay(c, T0, T0, true), ASK_DELAY_ON_LAUNCH_MS, "second launch: shortly after start, not on first paint");
  assert.ok(ASK_DELAY_ON_LAUNCH_MS > 0);
});

test("Turn on selected / No thanks / Not now transitions", () => {
  const c = noteLaunch(noteLaunch(defaultConsent()));
  const yes = answer(c, { crash: true, usage: true }, T0);
  assert.deepEqual([yes.crash, yes.diagnostics, yes.usage, yes.prompt.state], [true, false, true, "answered"]);
  assert.equal(askDelay(yes, T0 + SNOOZE_MS * 3, T0, true), null, "answered: never asked again");

  const no = decline(yes, T0);
  assert.deepEqual([no.crash, no.diagnostics, no.usage, no.prompt.state], [false, false, false, "never"]);
  assert.equal(askDelay(no, T0 + SNOOZE_MS * 3, T0, true), null);

  // Not now: ask again in ~30 days, at most MAX_REASKS more times.
  let s = c;
  for (let i = 1; i <= MAX_REASKS; i++) {
    s = snooze(s, T0);
    assert.equal(s.prompt.state, "snoozed");
    assert.equal(s.prompt.nextAskAt, T0 + SNOOZE_MS);
    assert.ok(askDelay(s, T0, T0, true)! >= SNOOZE_MS - 1, "not before the snooze ends");
    assert.equal(askDelay(s, T0 + SNOOZE_MS + 1, T0 + SNOOZE_MS + 1, true), ASK_DELAY_ON_LAUNCH_MS, "due: shortly after a launch");
  }
  s = snooze(s, T0);
  assert.equal(s.prompt.state, "never", "the third Not now ends the asking");
  assert.equal(askDelay(s, T0 + 10 * SNOOZE_MS, T0, true), null);
  assert.deepEqual([s.crash, s.diagnostics, s.usage], [false, false, false]);
});

test("changing a switch in Settings counts as an answer", () => {
  const c = setToggle(defaultConsent(), "usage", true, T0);
  assert.equal(c.usage, true);
  assert.equal(c.prompt.state, "answered");
  assert.equal(setToggle(c, "usage", false, T0).usage, false);
  // Round-trips through settings storage.
  assert.deepEqual(loadSettings(JSON.parse(JSON.stringify({ telemetry: c }))).telemetry, c);
});

// ---- scrubber ----

/** Realistic sensitive strings: each entry is [input, substrings that must not survive]. */
const CORPUS: [string, string[]][] = [
  ["Failed to fetch https://framatube.org/api/v1/videos/9c9de5e8-0a1b-46c5-a3fc-3d2f1a2b3c4d?start=0&count=50", ["framatube", "9c9de5e8", "start=0"]],
  ["TypeError: NetworkError when attempting to fetch resource. (tilvids.com)", ["tilvids"]],
  ['Couldn\'t load "My secret playlist about recovery"', ["secret playlist", "recovery"]],
  ["Endorsed “Cob oven build — part 2” at 22:14", ["Cob oven"]],
  ["relay wss://relay.damus.io/ refused: auth-required", ["damus", "wss://"]],
  ["ws://127.0.0.1:7777 closed", ["7777", "127.0.0.1"]],
  ["pubkey npub1sg6plzptd64u62a878hep2kev88swjh3tw00gjsfl8f237lmu63q0uf63m not found", ["npub1", "sg6plzptd64u"]],
  ["bad key nsec1vl029mgpspedva04g90vltkh6fvh240zqtv9k0t9af8935ke9laqsnlfe5", ["nsec1", "vl029mgps"]],
  ["profile nprofile1qqsrhuxx8l9ex335q7he0f09aej04zpazpl0ne2cgukyawd24mayt8gpp4mhxue69uhhytnc9e3k7mgpz4mhxue69uhkg6nzv9ejuumpv34kytnrdaksjlyr9p", ["nprofile1"]],
  ["sig check failed for 3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d", ["3bf0c63fcb93"]],
  ["event 5c83da77af1dec6d7289834998ad7aafbd9e2191396d75ec3cc27f5a77226f36 expired", ["5c83da77"]],
  ['Unexpected token in JSON at position 3: {"v":1,"name":"Slow craft picks","items":[]}', ["Slow craft", "items"]],
  ['recipe import failed: {"weights":{"follow":1,"taste":0.6},"exploreShare":0.05}', ["weights", "exploreShare"]],
  ["at /home/alice/projects/app/src/app.ts:12:4", ["alice", "/home/"]],
  ["C:\\Users\\Alice\\AppData\\Local\\app\\app.js", ["Alice", "Users"]],
  ["file:///Users/bob/Library/Caches/app.js:1", ["bob", "Users"]],
  ["~/Downloads/taste-list.json is not readable", ["Downloads", "taste-list"]],
  ["blender@video.blender.org not found", ["blender"]],
  ["follow @hearth@craft.tube failed", ["hearth", "craft.tube"]],
  ["contact me at someone.private@mail.example", ["someone.private"]],
  ["taste list https://example.org/lists/taste.json?token=abc", ["taste.json", "token=abc", "example.org"]],
  ["missing /w/kkGMgK9ZtnKfYAgnEtQxbv in cache", ["kkGMgK9ZtnKfYAgnEtQxbv"]],
  ["id kkGMgK9ZtnKfYAgnEtQxbv not in snapshot", ["kkGMgK9ZtnKfYAgnEtQxbv"]],
  ["/videos/watch/9c9de5e8-0a1b-46c5-a3fc-3d2f1a2b3c4d", ["9c9de5e8"]],
  ["peertube.tv/c/some_channel/videos returned 404", ["peertube.tv", "some_channel"]],
  ["blob:https://app.example/1234-5678 revoked", ["app.example"]],
  ["chrome-extension://abcdefghijklmnopabcdefghijklmnop/content.js", ["abcdefghijklmnop"]],
  ["Ines endorsed 'Kiln firing at night' (overlap 0.56)", ["Kiln firing"]],
  ["hidden\u202eevil\u202c text with //cdn.example.net/x.js", ["\u202e", "cdn.example.net"]],
];

test("scrubber removes every sensitive token from a realistic corpus", () => {
  for (const [input, banned] of CORPUS) {
    const out = scrubText(input);
    for (const b of banned) assert.ok(!out.includes(b), `"${b}" survived in: ${out}`);
    assert.equal(looksSensitive(out), false, `still looks sensitive: ${out}`);
    assert.ok(out.length <= 300);
  }
});

test("scrubber keeps messages that are useful and harmless", () => {
  assert.equal(scrubText("TypeError: e.target is null"), "TypeError: e.target is null");
  assert.equal(scrubText("recipe.weights.follow: must be between 0 and 10"), "recipe.weights.follow: must be between 0 and 10");
  assert.equal(scrubText("Cannot read properties of undefined (reading 'map')"), "Cannot read properties of undefined (reading '<str>')");
  assert.equal(scrubText("Object.keys called on non-object"), "Object.keys called on non-object");
  assert.equal(scrubText("x".repeat(1000)).length, 300);
  assert.equal(scrubText(undefined), "");
});

test("stack frames keep only the bundle file name; routes are allow-listed", () => {
  assert.equal(scrubFrameFile("https://memevideo.example/app.js?v=3"), "app:///app.js");
  assert.equal(scrubFrameFile("http://127.0.0.1:8080/crash.js"), "app:///crash.js");
  assert.equal(scrubFrameFile("/home/alice/app/dist/app.js"), "app:///app.js");
  assert.equal(scrubFrameFile("chrome-extension://abc/inject.js"), "app:///<other>");
  assert.equal(scrubFrameFile("https://framatube.org/videos/embed/9c9de5e8"), "app:///<other>");
  assert.equal(safeRoute("home-reels"), "home-reels");
  assert.equal(safeRoute("https://framatube.org/w/abc"), "unknown");
});

test("scrubEvent is an allow-list: request, user, IP, extra, SDK contexts and other breadcrumbs are dropped", () => {
  const raw = {
    event_id: "0123456789abcdef0123456789abcdef",
    timestamp: 1792411200,
    level: "error",
    platform: "javascript",
    release: "web@0.1.0",
    environment: "production",
    server_name: "alice-laptop",
    transaction: "https://framatube.org/w/kkGMgK9ZtnKfYAgnEtQxbv",
    request: { url: "https://memevideo.example/?list=https://example.org/taste.json", headers: { Referer: "https://framatube.org/", "User-Agent": "Mozilla/5.0" } },
    user: { id: "npub1sg6plzptd64u62a878hep2kev88swjh3tw00gjsfl8f237lmu63q0uf63m", ip_address: "203.0.113.7", email: "a@b.example" },
    extra: { recipe: '{"weights":{"follow":1}}', title: "Cob oven build" },
    tags: { custom: "framatube.org" },
    contexts: { trace: { trace_id: "abc" }, culture: { locale: "fr-FR", timezone: "Europe/Paris" }, device: { model: "Pixel" } },
    modules: { "some-module": "1.0" },
    breadcrumbs: [
      { category: "fetch", data: { url: "https://framatube.org/api/v1/videos" } },
      { category: "console", message: "loaded Cob oven build" },
      { category: "ui.click", message: "button#follow blender@video.blender.org" },
      { category: "route", message: "home-reels", timestamp: 1 },
      { category: "route", message: "https://evil.example/" },
    ],
    exception: {
      values: [
        {
          type: "TypeError",
          value: 'Failed to load "Cob oven build" from https://framatube.org/w/kkGMgK9ZtnKfYAgnEtQxbv for npub1sg6plzptd64u62a878hep2kev88swjh3tw00gjsfl8f237lmu63q0uf63m',
          mechanism: { type: "onerror", handled: false, data: { url: "https://framatube.org" } },
          stacktrace: {
            frames: [
              { filename: "https://memevideo.example/app.js?x=1", function: "loadInstance", lineno: 1, colno: 2345, vars: { title: "Cob oven build" }, context_line: "secret" },
              { filename: "chrome-extension://abc/x.js", function: "inject", lineno: 3 },
              { filename: "/home/alice/dist/app.js", function: "<anonymous>", lineno: 9 },
            ],
          },
        },
      ],
    },
  };
  const out = scrubEvent(raw, { route: "home-reels", appVersion: "0.1.0", browser: "Firefox", os: "Android", screen: "small" });
  const json = JSON.stringify(out);
  for (const banned of ["framatube", "kkGMgK9Z", "npub1", "203.0.113.7", "a@b.example", "Cob oven", "alice", "taste.json", "Referer", "Mozilla", "fr-FR", "Paris", "Pixel", "trace_id", "some-module", "blender", "evil.example", "secret", "weights", "loaded"]) {
    assert.ok(!json.includes(banned), `"${banned}" survived: ${json}`);
  }
  assert.equal(looksSensitive(json), false);
  assert.deepEqual(Object.keys(out).sort(), ["breadcrumbs", "contexts", "environment", "event_id", "exception", "level", "platform", "release", "tags", "timestamp", "transaction"].sort());
  assert.equal(out.transaction, "home-reels");
  assert.deepEqual(out.tags, { route: "home-reels", app_version: "0.1.0", browser: "Firefox", os: "Android", screen: "small" });
  assert.deepEqual(out.breadcrumbs, [{ category: "route", message: "home-reels", level: "info", timestamp: 1 }, { category: "route", message: "unknown", level: "info" }]);
  const ex = (out.exception as { values: { type: string; mechanism: unknown; stacktrace: { frames: unknown[] } }[] }).values[0];
  assert.equal(ex.type, "TypeError");
  assert.deepEqual(ex.mechanism, { type: "onerror", handled: false });
  assert.deepEqual(ex.stacktrace.frames, [
    { filename: "app:///app.js", abs_path: "app:///app.js", in_app: true, function: "loadInstance", lineno: 1, colno: 2345 },
    { filename: "app:///<other>", abs_path: "app:///<other>", in_app: false, function: "inject", lineno: 3 },
    { filename: "app:///app.js", abs_path: "app:///app.js", in_app: true, function: "<anonymous>", lineno: 9 },
  ]);
  assert.equal(scrubBreadcrumb({ category: "xhr", data: { url: "https://x.example" } }), null);
});

test("crash sampling and rate limits", () => {
  assert.equal(sampleRate({ exception: { values: [{ mechanism: { handled: false } }] } }), 1, "crashes always");
  assert.equal(sampleRate({ exception: { values: [{ mechanism: { handled: true } }] } }), 0.25);
  const lim = createLimiter({ perSession: 3, burst: 2, refillMs: 1000 });
  assert.equal(lim.allow("a", 0), true);
  assert.equal(lim.allow("a", 0), false, "same error once per session");
  assert.equal(lim.allow("b", 0), true);
  assert.equal(lim.allow("c", 0), false, "burst used up");
  assert.equal(lim.allow("c", 1000), true, "refilled");
  assert.equal(lim.allow("d", 100_000), false, "per-session cap");
});

// ---- usage analytics allow-list ----

const ENV = { websiteId: "11111111-2222-4333-8444-555555555555", browser: "Firefox", os: "Linux", device: "desktop" as const };

test("usage events: only allow-listed names, keys and values; no URL, referrer, title or language", () => {
  assert.equal(eventPayload("watched-video", { id: "https://framatube.org/w/x" }, "home-reels", ENV), null);
  assert.equal(eventPayload("__proto__", {}, "home-reels", ENV), null);
  const p = eventPayload("subscribe-taste-list", { source: "url", url: "https://example.org/taste.json", name: "Slow craft picks" }, "follow", ENV)!;
  assert.deepEqual(p, { type: "event", payload: { website: ENV.websiteId, hostname: "app", url: "/follow", browser: "Firefox", os: "Linux", device: "desktop", name: "subscribe-taste-list", data: { source: "url" } } });
  assert.equal(filterData("view-mode", { view: "https://evil.example" }), undefined);
  assert.deepEqual(filterData("private-watching", { on: true }), { on: "true" });
  assert.deepEqual(filterData("follow-creator", { handle: "blender@video.blender.org" }), undefined);
  assert.deepEqual(screenPayload("https://x.example" as never, ENV).payload.url, "/unknown");
  // Every allow-listed value is a fixed, short, harmless token.
  for (const [name, spec] of Object.entries(USAGE_EVENTS)) {
    assert.match(name, /^[a-z-]{3,30}$/);
    for (const vals of Object.values(spec as Record<string, readonly string[]>)) for (const v of vals) assert.match(v, /^[a-z-]{2,12}$/);
  }
  for (const k of ["referrer", "title", "language", "screen", "id", "ip", "userAgent"]) assert.ok(!(k in p.payload));
});

test("usage client: one JSON POST per event, no credentials or referrer, capped per session", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const client = createUsageClient("https://stats.example/", ENV, async (url, init) => calls.push({ url, init }), 3);
  client.screen("settings");
  client.event("endorse", { videoId: "x" }, "home-reels");
  client.event("not-on-the-list", {}, "home-reels");
  client.event("share", {}, "home-reels");
  client.event("share", {}, "home-reels");
  assert.equal(calls.length, 3, "unknown event dropped; cap reached");
  assert.equal(calls[0].url, "https://stats.example/api/send");
  assert.equal(calls[0].init.credentials, "omit");
  assert.equal(calls[0].init.referrerPolicy, "no-referrer");
  assert.deepEqual(JSON.parse(String(calls[1].init.body)).payload.data, undefined);
});

// ---- nothing loads before consent ----

function harness(cfg = { glitchtipDsn: "https://0123456789abcdef0123456789abcdef@errors.example/7", umamiHost: "https://stats.example", umamiWebsiteId: ENV.websiteId, appVersion: "0.1.0" }) {
  let consent = defaultConsent();
  const log: string[] = [];
  const reporter: CrashReporter = { start: () => log.push("start"), stop: () => log.push("stop"), setRoute: (r) => log.push(`route:${r}`) };
  const fetches: string[] = [];
  const t = createTelemetry({
    config: resolveConfig(cfg),
    consent: () => consent,
    loadCrashReporter: async () => (log.push("load"), reporter),
    fetch: async (url, init) => fetches.push(`${url} ${init.body}`),
    device: { browser: "Firefox", os: "Linux", screen: "large" },
  });
  return { t, log, fetches, set: (c: typeof consent) => (consent = c) };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

test("before consent: the crash reporter is never loaded and nothing is sent", async () => {
  const h = harness();
  h.t.apply();
  h.t.screen("home-reels");
  h.t.event("endorse");
  h.t.event("follow-creator");
  await tick();
  assert.deepEqual(h.log, []);
  assert.deepEqual(h.fetches, []);
  // "Not now" and "No thanks" keep it that way.
  h.set(snooze(defaultConsent(), T0));
  h.t.apply();
  h.t.screen("settings");
  h.set(decline(defaultConsent(), T0));
  h.t.apply();
  h.t.screen("follow");
  await tick();
  assert.deepEqual(h.log, []);
  assert.deepEqual(h.fetches, []);
});

test("after consent: exactly the chosen parts start; turning them off stops them", async () => {
  const h = harness();
  h.set(answer(defaultConsent(), { usage: true }, T0));
  h.t.apply();
  h.t.screen("matches");
  h.t.event("match-requested");
  await tick();
  assert.deepEqual(h.log, [], "usage only: the crash reporter still isn't loaded");
  assert.equal(h.fetches.length, 2);
  assert.ok(h.fetches.every((f) => f.startsWith("https://stats.example/api/send ")));

  h.set(answer(defaultConsent(), { crash: true, usage: true }, T0));
  h.t.apply();
  await tick();
  assert.deepEqual(h.log, ["load", "start"]);
  h.t.screen("studio");
  assert.deepEqual(h.log.at(-1), "route:studio");
  h.t.apply();
  await tick();
  assert.equal(h.log.filter((x) => x === "load").length, 1, "loaded once");

  h.set(setToggle(setToggle(h.t && answer(defaultConsent(), { crash: true, usage: true }, T0), "crash", false, T0), "usage", false, T0));
  h.t.apply();
  const before = h.fetches.length;
  h.t.screen("settings");
  h.t.event("share");
  await tick();
  assert.equal(h.log.at(-1), "stop");
  assert.equal(h.fetches.length, before, "usage off: nothing sent");
});

test("an empty build configuration hides everything, even with consent stored", async () => {
  const h = harness({ glitchtipDsn: "", umamiHost: "", umamiWebsiteId: "", appVersion: "0.1.0" });
  h.set(answer(defaultConsent(), { crash: true, diagnostics: true, usage: true }, T0));
  h.t.apply();
  h.t.screen("home-grid");
  h.t.event("endorse");
  await tick();
  assert.deepEqual(h.log, []);
  assert.deepEqual(h.fetches, []);
  assert.equal(resolveConfig({ glitchtipDsn: "not a dsn" }).glitchtip, null);
  assert.equal(resolveConfig({ umamiHost: "http://stats.example", umamiWebsiteId: ENV.websiteId }).umami, null, "plain http only for localhost");
});

// ---- bug reports ----

test("DSN parsing and the envelope endpoint", () => {
  const d = parseDsn("https://0123456789abcdef0123456789abcdef@errors.example/glitchtip/42")!;
  assert.equal(d.base, "https://errors.example/glitchtip");
  assert.equal(envelopeUrl(d), "https://errors.example/glitchtip/api/42/envelope/?sentry_key=0123456789abcdef0123456789abcdef&sentry_version=7");
  assert.equal(parseDsn("http://0123456789abcdef0123456789abcdef@errors.example/1"), null, "https only (except localhost)");
  assert.ok(parseDsn("http://0123456789abcdef0123456789abcdef@127.0.0.1:9001/1"));
  assert.equal(parseDsn("https://errors.example/1"), null);
});

test("bug report: scrubbed text, optional email, diagnostics only when attached", () => {
  const diagnostics = {
    appVersion: "0.1.0",
    browser: "Chrome",
    os: "Android",
    screen: "small" as const,
    recentErrors: [{ type: "TypeError", message: scrubText("x at https://framatube.org/w/abc"), route: "home-reels", minute: 2 }],
    settings: { privateWatching: false, p2p: false, popularSection: true, discoveryStats: true, defaultView: "reels", theme: "auto", retentionDays: 60, passphrase: false, storage: "encrypted", relaysConfigured: true, recipe: "default", crashReports: false, usageAnalytics: false },
  };
  const ev = feedbackEvent({ category: "bug", text: "Reels froze after I followed blender@video.blender.org on https://framatube.org/w/kkGMgK9ZtnKfYAgnEtQxbv", email: "me@example.org" }, "0.1.0");
  const json = JSON.stringify(ev);
  for (const b of ["blender", "framatube", "kkGMgK9Z"]) assert.ok(!json.includes(b), b);
  assert.deepEqual((ev.contexts as Record<string, unknown>).feedback, { message: "Reels froze after I followed <handle> on <url>", contact_email: "me@example.org" });
  assert.equal("diagnostics" in (ev.contexts as object), false);
  assert.deepEqual(ev.fingerprint, ["user-feedback", "bug"]);
  const withDiag = feedbackEvent({ category: "idea", text: "More themes", email: "not an email", diagnostics }, "0.1.0");
  const ctx = withDiag.contexts as { feedback: Record<string, unknown>; diagnostics: Record<string, unknown> };
  assert.equal(ctx.feedback.contact_email, undefined, "invalid email dropped");
  assert.deepEqual(Object.keys(ctx.diagnostics).sort(), ["app_version", "browser", "os", "recent_errors", "screen", "settings"]);
  assert.ok(!JSON.stringify(withDiag).includes("framatube"));
  assert.equal((withDiag.tags as Record<string, string>).diagnostics, "attached");
});

test("bug report envelope and send", async () => {
  const env = envelope({ message: "hi" }, { eventId: "0123456789abcdef0123456789abcdef", now: new Date(T0) });
  const [h1, h2, body] = env.split("\n");
  assert.equal(JSON.parse(h1).event_id, "0123456789abcdef0123456789abcdef");
  assert.equal(JSON.parse(h2).type, "event");
  assert.equal(JSON.parse(h2).length, new TextEncoder().encode(body).length);
  assert.equal(JSON.parse(body).timestamp, T0 / 1000);
  const seen: { url: string; init: RequestInit }[] = [];
  const dsn = parseDsn("https://0123456789abcdef0123456789abcdef@errors.example/7")!;
  await sendFeedback(dsn, { category: "other", text: "hello" }, "0.1.0", async (url, init) => (seen.push({ url, init }), { ok: true, status: 200 }), (n) => new Uint8Array(n).fill(1));
  assert.equal(seen[0].url, "https://errors.example/api/7/envelope/?sentry_key=0123456789abcdef0123456789abcdef&sentry_version=7");
  assert.deepEqual(seen[0].init.headers, { "Content-Type": "text/plain;charset=UTF-8" });
  assert.equal(seen[0].init.credentials, "omit");
  await assert.rejects(sendFeedback(dsn, { category: "bug", text: "   " }, "0.1.0", async () => ({ ok: true, status: 200 })), /Write something/);
  await assert.rejects(sendFeedback(dsn, { category: "bug", text: "x" }, "0.1.0", async () => ({ ok: false, status: 429 })), /busy/);
});

test("diagnostics are coarse", () => {
  assert.equal(browserFamily("Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0"), "Firefox");
  assert.equal(browserFamily("Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/141.0 Safari/537.36 Edg/141.0"), "Edge");
  assert.equal(osFamily("Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36"), "Android");
  assert.equal(osFamily("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)"), "iOS");
  assert.equal(screenClass(390, 844), "small");
  assert.equal(screenClass(1440, 900), "medium");
  assert.equal(screenClass(2560, 1440), "large");
  const log = createErrorLog(2);
  log.add(new TypeError("boom at https://framatube.org/w/x"), "home-reels", 150_000);
  log.add("plain", "settings", 0);
  log.add({ name: "Bad Name!", message: 5 }, "follow", 0);
  assert.deepEqual(log.list(), [
    { type: "Error", message: "plain", route: "settings", minute: 0 },
    { type: "Error", message: "", route: "follow", minute: 0 },
  ]);
});
