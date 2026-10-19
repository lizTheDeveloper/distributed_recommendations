// Coarse device facts and an in-memory list of recent errors, for crash reports
// and the optional "attach diagnostics" part of a bug report. Nothing here is
// stored or sent on its own.

import { scrubText } from "./scrub.ts";

export type ScreenClass = "small" | "medium" | "large";

/** Browser family from a user-agent string. Order matters: Edge and Opera say "Chrome" too. */
export function browserFamily(ua: string): string {
  if (/Edg\//.test(ua)) return "Edge";
  if (/OPR\/|Opera/.test(ua)) return "Opera";
  if (/SamsungBrowser\//.test(ua)) return "Samsung Internet";
  if (/Firefox\/|FxiOS\//.test(ua)) return "Firefox";
  if (/Chrome\/|CriOS\/|Chromium\//.test(ua)) return "Chrome";
  if (/Safari\//.test(ua)) return "Safari";
  return "Other";
}

export function osFamily(ua: string): string {
  if (/Android/.test(ua)) return "Android";
  if (/iPhone|iPad|iPod/.test(ua)) return "iOS";
  if (/Windows/.test(ua)) return "Windows";
  if (/Mac OS X|Macintosh/.test(ua)) return "macOS";
  if (/CrOS/.test(ua)) return "ChromeOS";
  if (/Linux/.test(ua)) return "Linux";
  return "Other";
}

/** By the narrower side of the viewport (CSS px): phone, tablet/small laptop, desktop. */
export function screenClass(width: number, height: number): ScreenClass {
  const w = Math.min(width, height);
  return w < 600 ? "small" : w < 1000 ? "medium" : "large";
}

export function deviceClass(s: ScreenClass): "mobile" | "tablet" | "desktop" {
  return s === "small" ? "mobile" : s === "medium" ? "tablet" : "desktop";
}

export interface DeviceFacts {
  browser: string;
  os: string;
  screen: ScreenClass;
}

export function deviceFacts(): DeviceFacts {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  const w = typeof window !== "undefined" ? window.innerWidth : 0;
  const h = typeof window !== "undefined" ? window.innerHeight : 0;
  return { browser: browserFamily(ua), os: osFamily(ua), screen: screenClass(w, h) };
}

export interface RecentError {
  type: string;
  message: string;
  route: string;
  /** Minutes since the page loaded (not a clock time). */
  minute: number;
}

/** The last few errors on this page, scrubbed as they're recorded. Memory only. */
export function createErrorLog(max = 5) {
  const items: RecentError[] = [];
  return {
    add(err: unknown, route: string, sinceLoadMs: number) {
      const e = err as { name?: unknown; message?: unknown } | null;
      const type = typeof e?.name === "string" && /^[A-Za-z_$][\w$]{0,40}$/.test(e.name) ? e.name : "Error";
      const message = scrubText(typeof e?.message === "string" ? e.message : typeof err === "string" ? err : "", 200);
      items.push({ type, message, route, minute: Math.floor(sinceLoadMs / 60000) });
      if (items.length > max) items.shift();
    },
    list(): RecentError[] {
      return items.map((i) => ({ ...i }));
    },
  };
}
