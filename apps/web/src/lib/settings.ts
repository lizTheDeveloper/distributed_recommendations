import type { SourceKind } from "./core.ts";
import { SOURCE_KINDS } from "./core.ts";

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
}

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
  if (o.theme === "light" || o.theme === "dark" || o.theme === "auto") d.theme = o.theme;
  return d;
}
