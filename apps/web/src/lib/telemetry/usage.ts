// Usage analytics (toggle c): coarse events from a fixed allow-list, sent to a
// self-hosted Umami through its HTTP API (`POST /api/send`) by this small client
// instead of Umami's tracker script. The tracker reads location.href,
// document.referrer, the page title, screen size and language on its own; this
// client sends only what's listed here. Event names and every data value come
// from enumerations below, so no video, creator, list, search or peer can reach
// the payload. docs/TELEMETRY.md has the same list.

import type { Route } from "./scrub.ts";
import { safeRoute } from "./scrub.ts";

/** Allowed custom events and, for each, the allowed data keys and values. */
export const USAGE_EVENTS = {
  /** The app started (with usage analytics already on). */
  "app-open": { view: ["reels", "grid"], display: ["browser", "installed"] },
  /** Feature used. Never who or what. */
  "follow-creator": {},
  "unfollow-creator": {},
  "follow-taste": {},
  "subscribe-taste-list": { source: ["url", "paste", "example"] },
  "match-requested": {},
  "match-accepted": {},
  "preview-requested": {},
  "endorse": {},
  "not-interested": {},
  "share": {},
  "recipe-selected": { kind: ["built-in", "custom"], recipe: ["default", "following", "discovery", "custom", "other"] },
  "recipe-imported": {},
  "view-mode": { view: ["reels", "grid"] },
  "feed-settings-opened": {},
  "private-watching": { on: ["true", "false"] },
  "bug-report-sent": { category: ["bug", "idea", "other"] },
} as const satisfies Record<string, Record<string, readonly string[]>>;

export type UsageEventName = keyof typeof USAGE_EVENTS;
type DataFor<N extends UsageEventName> = { [K in keyof (typeof USAGE_EVENTS)[N]]?: (typeof USAGE_EVENTS)[N][K] extends readonly (infer V)[] ? V : never };

export type DeviceClass = "mobile" | "tablet" | "desktop";

/** Coarse facts about the device, computed on it (no user-agent string is parsed by the server for these). */
export interface UsageEnv {
  websiteId: string;
  browser: string;
  os: string;
  device: DeviceClass;
}

export interface UmamiPayload {
  type: "event";
  payload: {
    website: string;
    hostname: string;
    url: string;
    name?: string;
    data?: Record<string, string>;
    browser: string;
    os: string;
    device: DeviceClass;
  };
}

/** Keep only allow-listed keys with allow-listed values. */
export function filterData(name: string, data: unknown): Record<string, string> | undefined {
  const spec = (USAGE_EVENTS as Record<string, Record<string, readonly string[]>>)[name];
  if (!spec || typeof data !== "object" || data === null) return undefined;
  const out: Record<string, string> = {};
  for (const [k, allowed] of Object.entries(spec)) {
    const v = (data as Record<string, unknown>)[k];
    const sv = typeof v === "boolean" ? String(v) : v;
    if (typeof sv === "string" && allowed.includes(sv)) out[k] = sv;
  }
  return Object.keys(out).length ? out : undefined;
}

/** A screen view: Umami's page view with the route as its path. */
export function screenPayload(route: Route, env: UsageEnv): UmamiPayload {
  return { type: "event", payload: { website: env.websiteId, hostname: "app", url: `/${safeRoute(route)}`, browser: env.browser, os: env.os, device: env.device } };
}

/** A custom event, or null if the name isn't allow-listed. */
export function eventPayload<N extends UsageEventName>(name: N, data: DataFor<N> | undefined, route: Route, env: UsageEnv): UmamiPayload | null;
export function eventPayload(name: string, data: unknown, route: Route, env: UsageEnv): UmamiPayload | null;
export function eventPayload(name: string, data: unknown, route: Route, env: UsageEnv): UmamiPayload | null {
  if (!Object.prototype.hasOwnProperty.call(USAGE_EVENTS, name)) return null;
  const p = screenPayload(route, env);
  p.payload.name = name;
  const d = filterData(name, data);
  if (d) p.payload.data = d;
  return p;
}

export type Fetch = (url: string, init: RequestInit) => Promise<unknown>;

/**
 * Sends payloads to `${host}/api/send`. No cookies, no referrer, no cache token,
 * no custom headers beyond the JSON content type. At most `maxPerSession` sends
 * per page load, so a bug can't flood the server.
 */
export function createUsageClient(host: string, env: UsageEnv, fetchFn: Fetch, maxPerSession = 200) {
  let sent = 0;
  const endpoint = host.replace(/\/+$/, "") + "/api/send";
  const post = (p: UmamiPayload | null) => {
    if (!p || sent >= maxPerSession) return;
    sent++;
    fetchFn(endpoint, {
      method: "POST",
      body: JSON.stringify(p),
      headers: { "Content-Type": "application/json" },
      credentials: "omit",
      referrerPolicy: "no-referrer",
      cache: "no-store",
      keepalive: true,
      mode: "cors",
    }).catch(() => undefined);
  };
  return {
    screen(route: Route) {
      post(screenPayload(route, env));
    },
    event(name: string, data: unknown, route: Route) {
      post(eventPayload(name, data, route, env));
    },
  };
}
