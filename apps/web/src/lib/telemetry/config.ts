// Build-time telemetry configuration (scripts/build.mjs reads MF_GLITCHTIP_DSN,
// MF_UMAMI_HOST and MF_UMAMI_WEBSITE_ID). An empty value hides that feature:
// no switch, no card, no request. The offline artifact build always gets an
// empty configuration.

import type { Dsn } from "./feedback.ts";
import { parseDsn } from "./feedback.ts";

export interface RawTelemetryConfig {
  glitchtipDsn?: string;
  umamiHost?: string;
  umamiWebsiteId?: string;
  appVersion?: string;
}

export interface TelemetryConfig {
  /** Crash reports and bug reports (GlitchTip). */
  glitchtip: Dsn | null;
  /** Usage analytics (Umami). */
  umami: { host: string; websiteId: string } | null;
  appVersion: string;
}

export function parseUmamiHost(s: string | undefined): string | null {
  if (!s) return null;
  try {
    const u = new URL(s.trim());
    const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
    if (u.protocol !== "https:" && !(u.protocol === "http:" && local)) return null;
    if (u.username || u.password || u.search || u.hash) return null;
    return (u.origin + u.pathname).replace(/\/+$/, "");
  } catch {
    return null;
  }
}

export function resolveConfig(raw: RawTelemetryConfig | null | undefined): TelemetryConfig {
  const r = raw ?? {};
  const host = parseUmamiHost(r.umamiHost);
  const site = r.umamiWebsiteId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(r.umamiWebsiteId) ? r.umamiWebsiteId.toLowerCase() : null;
  return {
    glitchtip: r.glitchtipDsn ? parseDsn(r.glitchtipDsn) : null,
    umami: host && site ? { host, websiteId: site } : null,
    appVersion: typeof r.appVersion === "string" && /^[\w.+-]{1,40}$/.test(r.appVersion) ? r.appVersion : "0.0.0",
  };
}

/** The configuration compiled into this build. */
export function buildConfig(): TelemetryConfig {
  return resolveConfig(typeof __MF_TELEMETRY__ !== "undefined" ? __MF_TELEMETRY__ : null);
}

export function available(c: TelemetryConfig): boolean {
  return !!(c.glitchtip || c.umami);
}
