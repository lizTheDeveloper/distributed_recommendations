import type { SourceKind } from "./core.ts";
import { SOURCE_KINDS } from "./core.ts";
import type { TelemetryConsent } from "./telemetry/consent.ts";
import { defaultConsent, loadConsent } from "./telemetry/consent.ts";

export type Theme = "auto" | "light" | "dark";

export interface Settings {
  /** PeerTube instance origins the catalog is read from. */
  instances: string[];
  /** Show a separate "Popular on your instances" section after the personal feed. */
  showPopular: boolean;
  /** When on, nothing you watch or endorse is recorded. */
  privateWatching: boolean;
  /** Peer-to-peer streaming in the player. Off: other viewers can't see your IP. */
  p2p: boolean;
  /** Contribute anonymous discovery-channel stats (ANALYTICS.md Q1: on by default). */
  analytics: { contribute: boolean; perKind: Record<SourceKind, boolean> };
  theme: Theme;
  /** Sharing window: history older than this many days is deleted on this device. */
  retentionDays: RetentionDays;
  /** What Home opens with. */
  defaultView: FeedView;
  /** Nostr relays for Match (none by default: Match stays local until you add one). */
  relays: string[];
  /**
   * Opt-in crash reports, bug-report diagnostics and usage analytics (docs/TELEMETRY.md).
   * All off until the viewer says yes. Separate from `analytics` (creator discovery stats).
   */
  telemetry: TelemetryConsent;
  /** First-run onboarding finished or skipped (src/ui/onboarding.ts). */
  onboarded: boolean;
  /** Topics picked at onboarding: a starting tag profile for explore relevance, until the first endorsement. */
  topics: string[];
  /** Native shells only: opt-in local notifications for match requests (off by default). */
  nativeNotify: boolean;
  /** Native shells only: opt-in background relay checks (off by default; device-key mode only). */
  nativeBackground: boolean;
  /**
   * How Match reaches Nostr (docs/TRANSPORT.md): "direct" = WebSockets to `relays`
   * (they see your IP); "ohttp" = the private relay compiled into the build, through
   * Oblivious HTTP (the gateway's relays replace `relays`). Only offered when the
   * build has a private relay.
   */
  matchTransport: "direct" | "ohttp";
  /** OHTTP strict timing: constant-rate cover traffic and one key per request (slower, ~30 MB/day). */
  ohttpStrict: boolean;
}

/** Topics offered at onboarding (common PeerTube tags; lowercase). */
export const ONBOARDING_TOPICS = [
  "linux", "opensource", "privacy", "programming", "science", "music", "gaming", "art", "blender", "diy",
  "cooking", "education", "climate", "history", "politics", "film",
] as const;

export type FeedView = "reels" | "grid";

export const MAX_RELAYS = 6;

/**
 * Relays offered as one-tap additions under Matches, Relays. None is on by default:
 * the viewer picks. The first is the one this deployment runs (infra/relay); the rest
 * are public strfry relays whose NIP-11 limits fit gift wraps (max message 128 KiB+).
 */
export const SUGGESTED_RELAYS: readonly { url: string; note: string }[] = [
  { url: "wss://relay.multiversegames.ai", note: "ours: no IP logs, gift wraps deleted at expiry" },
  { url: "wss://relay.damus.io", note: "public" },
  { url: "wss://nos.lol", note: "public" },
  { url: "wss://relay.primal.net", note: "public" },
];

/**
 * A relay URL: `wss://` anywhere, or plain `ws://` only on this machine (the local
 * dev relay). Returns the normalized URL or null.
 */
export function parseRelayUrl(text: string): string | null {
  let u: URL;
  try {
    u = new URL(text.trim());
  } catch {
    return null;
  }
  if (u.username || u.password || u.search || u.hash) return null;
  const local = u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "[::1]";
  if (u.protocol !== "wss:" && !(u.protocol === "ws:" && local)) return null;
  const s = u.toString();
  return s.endsWith("/") && u.pathname === "/" ? s.slice(0, -1) : s;
}

export const RETENTION_CHOICES = [30, 60, 90] as const;
export type RetentionDays = (typeof RETENTION_CHOICES)[number];
export const DEFAULT_RETENTION: RetentionDays = 60;

export const DEFAULT_INSTANCES = ["https://framatube.org", "https://tilvids.com"];

export function defaultSettings(): Settings {
  const perKind = {} as Record<SourceKind, boolean>;
  for (const k of SOURCE_KINDS) perKind[k] = true;
  return {
    instances: [...DEFAULT_INSTANCES],
    showPopular: true,
    privateWatching: false,
    p2p: false,
    analytics: { contribute: true, perKind },
    theme: "auto",
    retentionDays: DEFAULT_RETENTION,
    defaultView: "reels",
    relays: [],
    telemetry: defaultConsent(),
    onboarded: false,
    topics: [],
    nativeNotify: false,
    nativeBackground: false,
    matchTransport: "ohttp",
    ohttpStrict: false,
  };
}

/** Merge stored settings over defaults, dropping anything malformed. */
export function loadSettings(x: unknown): Settings {
  const d = defaultSettings();
  if (typeof x !== "object" || x === null) return d;
  const o = x as Record<string, unknown>;
  const bool = (v: unknown, def: boolean) => (typeof v === "boolean" ? v : def);
  if (Array.isArray(o.instances)) {
    const xs = o.instances.filter((s): s is string => typeof s === "string" && /^https:\/\/[^/]+$/.test(s));
    d.instances = [...new Set(xs)].slice(0, 8);
  }
  d.showPopular = bool(o.showPopular ?? o.trendingAsTaste, d.showPopular); // trendingAsTaste: pre-cap name
  d.privateWatching = bool(o.privateWatching, d.privateWatching);
  d.p2p = bool(o.p2p, d.p2p);
  const a = o.analytics as Record<string, unknown> | undefined;
  if (a && typeof a === "object") {
    d.analytics.contribute = bool(a.contribute, true);
    const pk = a.perKind as Record<string, unknown> | undefined;
    if (pk && typeof pk === "object") for (const k of SOURCE_KINDS) d.analytics.perKind[k] = bool(pk[k], true);
  }
  if ((RETENTION_CHOICES as readonly unknown[]).includes(o.retentionDays)) d.retentionDays = o.retentionDays as RetentionDays;
  if (o.defaultView === "grid" || o.defaultView === "reels") d.defaultView = o.defaultView;
  if (Array.isArray(o.relays)) {
    const rs = o.relays.map((r) => (typeof r === "string" ? parseRelayUrl(r) : null)).filter((r): r is string => !!r);
    d.relays = [...new Set(rs)].slice(0, MAX_RELAYS);
  }
  d.telemetry = loadConsent(o.telemetry);
  d.onboarded = bool(o.onboarded, false);
  if (Array.isArray(o.topics)) d.topics = [...new Set(o.topics.filter((t): t is string => typeof t === "string" && /^[\p{L}\p{N}_-]{1,32}$/u.test(t)).map((t) => t.toLowerCase()))].slice(0, 12);
  d.nativeNotify = bool(o.nativeNotify, false);
  d.nativeBackground = bool(o.nativeBackground, false);
  // Existing installs that already chose relays keep them (direct) until they switch.
  d.matchTransport = o.matchTransport === "direct" || o.matchTransport === "ohttp" ? o.matchTransport : d.relays.length ? "direct" : "ohttp";
  d.ohttpStrict = bool(o.ohttpStrict, false);
  if (o.theme === "light" || o.theme === "dark" || o.theme === "auto") d.theme = o.theme;
  return d;
}
