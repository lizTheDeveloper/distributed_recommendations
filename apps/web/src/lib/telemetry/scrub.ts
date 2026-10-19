// Strict scrubbing for anything telemetry sends (THREAT_MODEL.md T34,
// docs/TELEMETRY.md). Crash reports keep only the error type, a scrubbed message,
// stack frames reduced to function + bundle file + line, the app's route name and
// coarse device facts. Everything else in a Sentry event is dropped by allow-list,
// not deny-list, so a field the SDK adds later doesn't leak by default.
//
// The text scrubber removes, wherever they appear: URLs of any scheme (PeerTube,
// taste lists, relays, local files), Nostr bech32 keys and ids (npub/nsec/…), hex
// keys and ids, UUIDs and PeerTube short ids, PeerTube paths, channel handles and
// email addresses, instance and relay host names, local file paths, JSON blobs
// (recipes, taste lists) and quoted strings (video titles and list names are
// quoted in the app's messages).

/** Screens the app has. Route names are the only "location" telemetry ever sends. */
export const ROUTES = ["home-reels", "home-grid", "follow", "matches", "studio", "settings", "recipe", "feed-settings", "feedback", "unknown"] as const;
export type Route = (typeof ROUTES)[number];

export function safeRoute(x: unknown): Route {
  return (ROUTES as readonly unknown[]).includes(x) ? (x as Route) : "unknown";
}

const MAX_TEXT = 300;

// Top-level domains that show up in instance, relay and taste-list hosts. A bare
// host like "framatube.org" or "relay.example.social" is scrubbed; "app.js",
// "e.target" or "Object.keys" are not.
const TLDS =
  "org|com|net|io|tv|video|videos|social|tube|fr|de|uk|xyz|dev|app|me|info|eu|nl|ch|at|se|fi|it|es|pl|cz|be|jp|ca|au|us|online|site|space|cloud|club|live|media|network|zone|world|party|cafe|garden|land|lol|wtf|ninja|rocks|pub|town|city|blue|red|pink|gay|lgbt|coop|edu|gov|mil|int|onion|i2p|local|localhost|example|test|invalid|ru|ua|br|in|cn|kr|nz|no|dk|pt|ie|gr|ro|hu|sk|si|hr|lt|lv|ee|is|lu|tw|hk|sg|za|mx|ar|cl|co|pe";

const PATTERNS: [RegExp, string][] = [
  // Any URL: https, wss (relays), file, blob, chrome-extension, ...
  [/\b[a-z][a-z0-9+.-]{1,30}:\/\/[^\s"'<>)\]}]*/gi, "<url>"],
  // Protocol-relative URLs.
  [/(^|[\s("'=])\/\/[^\s"'<>)\]}]+/g, "$1<url>"],
  // Nostr NIP-19: npub, nsec, nprofile, nevent, naddr, note, nrelay, ncryptsec.
  [/\b(?:npub|nsec|nprofile|nevent|naddr|note|nrelay|ncryptsec)1[02-9ac-hj-np-z]{6,}\b/gi, "<nostr>"],
  // Channel handles (name@host, @name@host) and email addresses.
  [/@?[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, "<handle>"],
  // Local paths: Unix home and system dirs, Windows drive paths, Android storage.
  [/(?:\/(?:home|Users|root|var|tmp|private|mnt|media|data|storage|sdcard|opt|srv|Volumes|run|usr|etc|proc)\/[^\s"'<>):]*)/g, "<path>"],
  [/\b[A-Za-z]:\\[^\s"'<>]*/g, "<path>"],
  [/~\/[^\s"'<>)]*/g, "<path>"],
  // PeerTube and API paths without a host.
  [/\/(?:w|c|a|p|videos\/watch|videos\/embed|video-channels|video-playlists|accounts|api\/v1)\/[^\s"'<>)]*/g, "<path>"],
  // UUIDs (PeerTube video ids).
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<id>"],
  // Hex keys, event ids, hashes (32+ hex digits).
  [/\b[0-9a-f]{32,}\b/gi, "<hex>"],
  // Bare host names with a known TLD (instances, relays, taste-list hosts).
  [new RegExp(`\\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+(?:${TLDS})\\b(?::\\d+)?`, "gi"), "<host>"],
  // JSON objects and arrays (recipes, taste lists, sketches).
  [/\{[^{}]*:[^{}]*\}/g, "<json>"],
  [/\[[^[\]]{40,}\]/g, "<json>"],
  // Quoted strings: titles, list and recipe names, peer names.
  [/"[^"\n]{1,400}"/g, '"<str>"'],
  [/“[^”\n]{1,400}”/g, '"<str>"'],
  [/«[^»\n]{1,400}»/g, '"<str>"'],
  [/'[^'\n]{2,400}'/g, "'<str>'"],
];

/** PeerTube short UUIDs: 20–24 base58 characters with a digit and an upper-case letter. */
function scrubShortIds(s: string): string {
  return s.replace(/\b[1-9A-HJ-NP-Za-km-z]{20,24}\b/g, (m) => (/[0-9]/.test(m) && /[A-Z]/.test(m) && /[a-z]/.test(m) ? "<id>" : m));
}

/** Scrub free text (error messages, bug-report text). */
export function scrubText(input: unknown, max = MAX_TEXT): string {
  if (typeof input !== "string") return "";
  // Strip control and bidi characters first, so nothing hides from the patterns.
  let s = input.replace(/[\u0000-\u0008\u000b-\u001f\u007f​-‏‪-‮⁦-⁩]/g, "");
  for (const [re, rep] of PATTERNS) s = s.replace(re, rep);
  s = scrubShortIds(s);
  if (s.length > max) s = s.slice(0, max - 1) + "…";
  return s;
}

/**
 * A script or page URL in a stack frame: only the bundle file name survives,
 * e.g. "https://app.example/app.js?x" → "app:///app.js". Anything else becomes
 * "app:///<other>" (extensions, other origins, eval).
 */
export function scrubFrameFile(input: unknown): string {
  if (typeof input !== "string") return "app:///<other>";
  const m = /\/([\w.-]+\.(?:js|mjs|cjs|ts|html))(?:[?#].*)?$/.exec(input);
  if (!m) return "app:///<other>";
  return ["app.js", "crash.js", "psi.js", "psi-frame.js", "sw.js", "index.html"].includes(m[1]) ? `app:///${m[1]}` : "app:///<other>";
}

function scrubFunction(input: unknown): string | undefined {
  if (typeof input !== "string") return undefined;
  // Function names are code identifiers; keep only identifier characters.
  const s = input.replace(/[^\w$.<>]/g, "").slice(0, 80);
  return s || undefined;
}

// ---- Sentry-shaped events ----

type Json = Record<string, unknown>;
const isObj = (x: unknown): x is Json => typeof x === "object" && x !== null && !Array.isArray(x);

interface Frame {
  function?: string;
  filename: string;
  abs_path: string;
  lineno?: number;
  colno?: number;
  in_app: boolean;
}

function scrubFrames(frames: unknown): Frame[] {
  if (!Array.isArray(frames)) return [];
  return frames.slice(-40).map((f: unknown) => {
    const o = isObj(f) ? f : {};
    const file = scrubFrameFile(o.filename ?? o.abs_path);
    const out: Frame = { filename: file, abs_path: file, in_app: file !== "app:///<other>" };
    const fn = scrubFunction(o.function);
    if (fn) out.function = fn;
    if (typeof o.lineno === "number" && Number.isFinite(o.lineno)) out.lineno = o.lineno;
    if (typeof o.colno === "number" && Number.isFinite(o.colno)) out.colno = o.colno;
    return out;
  });
}

const SAFE_TYPE = /^[A-Za-z_$][\w$.]{0,79}$/;

function scrubException(x: unknown): Json | null {
  if (!isObj(x) || !Array.isArray(x.values)) return null;
  const values = x.values.slice(-5).map((v: unknown) => {
    const o = isObj(v) ? v : {};
    const type = typeof o.type === "string" && SAFE_TYPE.test(o.type) ? o.type : "Error";
    const mech = isObj(o.mechanism) ? o.mechanism : {};
    const out: Json = {
      type,
      value: scrubText(o.value),
      mechanism: { type: typeof mech.type === "string" && SAFE_TYPE.test(mech.type) ? mech.type : "generic", handled: mech.handled !== false },
    };
    const st = isObj(o.stacktrace) ? o.stacktrace : null;
    if (st) out.stacktrace = { frames: scrubFrames(st.frames) };
    return out;
  });
  return { values };
}

/** Facts a crash report may carry, all coarse; set by the app, never from the SDK. */
export interface CrashContext {
  route: Route;
  appVersion: string;
  browser: string;
  os: string;
  screen: string;
}

const LEVELS = ["fatal", "error", "warning", "info", "debug", "log"];

/**
 * Reduce a Sentry event to the allow-listed fields. Returns a new object; the
 * input is not trusted to have any particular shape. Drops: request (URL, query,
 * headers), user (id, IP, email), breadcrumbs other than route changes, extra,
 * contexts from the SDK (trace ids, culture, device), server_name, modules,
 * debug_meta, spans, transaction (replaced by the route), attachments.
 */
export function scrubEvent(event: unknown, ctx: CrashContext): Json {
  const e = isObj(event) ? event : {};
  const out: Json = {};
  if (typeof e.event_id === "string" && /^[0-9a-f]{32}$/.test(e.event_id)) out.event_id = e.event_id;
  if (typeof e.timestamp === "number") out.timestamp = e.timestamp;
  out.platform = "javascript";
  out.level = typeof e.level === "string" && LEVELS.includes(e.level) ? e.level : "error";
  const exc = scrubException(e.exception);
  if (exc) out.exception = exc;
  if (typeof e.message === "string") out.message = scrubText(e.message);
  else if (isObj(e.message) && typeof e.message.formatted === "string") out.message = scrubText(e.message.formatted);
  if (typeof e.release === "string") out.release = scrubText(e.release, 80);
  if (typeof e.environment === "string") out.environment = scrubText(e.environment, 40);
  if (isObj(e.sdk)) out.sdk = { name: String(e.sdk.name ?? "").slice(0, 60), version: String(e.sdk.version ?? "").slice(0, 20) };
  if (Array.isArray(e.fingerprint)) out.fingerprint = e.fingerprint.slice(0, 4).map((f) => scrubText(String(f), 80));
  out.transaction = ctx.route;
  out.tags = { route: ctx.route, app_version: ctx.appVersion, browser: ctx.browser, os: ctx.os, screen: ctx.screen };
  out.contexts = { browser: { name: ctx.browser }, os: { name: ctx.os } };
  const crumbs = Array.isArray(e.breadcrumbs) ? e.breadcrumbs : isObj(e.breadcrumbs) && Array.isArray(e.breadcrumbs.values) ? e.breadcrumbs.values : [];
  const kept = crumbs.map((b) => scrubBreadcrumb(b)).filter((b): b is Json => !!b);
  if (kept.length) out.breadcrumbs = kept.slice(-10);
  return out;
}

/** Only the app's own route breadcrumbs survive, reduced to the route name. */
export function scrubBreadcrumb(b: unknown): Json | null {
  if (!isObj(b) || b.category !== "route") return null;
  const route = safeRoute(b.message);
  const out: Json = { category: "route", message: route, level: "info" };
  if (typeof b.timestamp === "number") out.timestamp = b.timestamp;
  return out;
}

/**
 * Last line of defense: true if a serialized payload still contains something
 * that looks sensitive. The sender refuses to send it. Tests run this over the
 * corpus too.
 */
export function looksSensitive(serialized: string): boolean {
  return /(?:https?|wss?|file):\/\/|\b(?:npub|nsec|nprofile|nevent|naddr)1[02-9ac-hj-np-z]{6,}|\b[0-9a-f]{64}\b|\/home\/|\/Users\/|[A-Za-z]:\\\\Users/i.test(serialized);
}

// ---- rate limiting and sampling ----

export interface Limiter {
  /** True if an event with this fingerprint may be sent now. */
  allow(key: string, now: number): boolean;
}

/**
 * At most `perSession` events per page load, the same fingerprint once per
 * session, and a token bucket of `burst` refilled at one per `refillMs`.
 */
export function createLimiter(opts: { perSession?: number; burst?: number; refillMs?: number } = {}): Limiter {
  const perSession = opts.perSession ?? 10;
  const burst = opts.burst ?? 5;
  const refillMs = opts.refillMs ?? 2 * 60 * 1000;
  const seen = new Set<string>();
  let sent = 0;
  let tokens = burst;
  let last = -1;
  return {
    allow(key, now) {
      if (last >= 0) tokens = Math.min(burst, tokens + (now - last) / refillMs);
      last = now;
      if (sent >= perSession || seen.has(key) || tokens < 1) return false;
      seen.add(key);
      sent++;
      tokens -= 1;
      return true;
    },
  };
}

/** Sample rate: crashes (unhandled errors) always; handled errors and messages at 25%. */
export function sampleRate(event: unknown): number {
  const e = isObj(event) ? event : {};
  const values = isObj(e.exception) && Array.isArray(e.exception.values) ? e.exception.values : [];
  const unhandled = values.some((v) => isObj(v) && isObj(v.mechanism) && v.mechanism.handled === false);
  return unhandled || e.level === "fatal" ? 1 : 0.25;
}

/** Fingerprint for de-duplication: exception type and scrubbed message. */
export function eventKey(scrubbed: Json): string {
  const exc = isObj(scrubbed.exception) && Array.isArray(scrubbed.exception.values) ? scrubbed.exception.values.at(-1) : null;
  if (isObj(exc)) return `${exc.type}:${exc.value}`;
  return `msg:${String(scrubbed.message ?? "")}`;
}
