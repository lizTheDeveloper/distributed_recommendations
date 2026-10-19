// Ties consent to what loads and what's sent. Nothing is fetched, loaded or
// initialized until the matching switch is on:
// - crash reports: the crash reporter bundle (crash.js, @sentry/browser) is
//   injected only after toggle (a) is on, and closed when it goes off;
// - usage analytics: the small Umami client sends only while toggle (c) is on.
// Bug reports go through sendFeedback() directly, only when the viewer presses Send.

import type { TelemetryConfig } from "./config.ts";
import type { TelemetryConsent } from "./consent.ts";
import type { DeviceFacts } from "./diagnostics.ts";
import { deviceClass } from "./diagnostics.ts";
import type { CrashContext, Route } from "./scrub.ts";
import type { Fetch } from "./usage.ts";
import { createUsageClient } from "./usage.ts";

/** What crash.js exposes (src/telemetry/crash-entry.ts). */
export interface CrashReporter {
  start(opts: { dsn: string; release: string; environment: string; context: () => CrashContext }): void;
  stop(): void;
  setRoute(route: Route): void;
}

export interface TelemetryDeps {
  config: TelemetryConfig;
  consent(): TelemetryConsent;
  /** Load the crash reporter bundle. Called at most once, and only after opt-in. */
  loadCrashReporter(): Promise<CrashReporter>;
  fetch: Fetch;
  device: DeviceFacts;
  environment?: string;
}

export interface Telemetry {
  /** Re-read consent: start or stop crash reports and usage analytics. */
  apply(): void;
  /** The viewer moved to another screen. */
  screen(route: Route): void;
  /** A feature was used (allow-listed names only; anything else is dropped). */
  event(name: string, data?: unknown): void;
  route(): Route;
  /** For tests and the settings disclosure. */
  state(): { crashLoaded: boolean; crashRunning: boolean; usageOn: boolean };
}

export function createTelemetry(d: TelemetryDeps): Telemetry {
  let route: Route = "unknown";
  let reporter: CrashReporter | null = null;
  let loading: Promise<CrashReporter | null> | null = null;
  let crashRunning = false;
  const env = { browser: d.device.browser, os: d.device.os, device: deviceClass(d.device.screen) };
  const usage = d.config.umami ? createUsageClient(d.config.umami.host, { websiteId: d.config.umami.websiteId, ...env }, d.fetch) : null;
  const ctx = (): CrashContext => ({ route, appVersion: d.config.appVersion, browser: d.device.browser, os: d.device.os, screen: d.device.screen });
  const usageOn = () => !!usage && d.consent().usage;
  const crashWanted = () => !!d.config.glitchtip && d.consent().crash;

  function syncCrash() {
    if (!crashWanted()) {
      if (reporter && crashRunning) reporter.stop();
      crashRunning = false;
      return;
    }
    if (reporter) {
      if (!crashRunning) {
        reporter.start({ dsn: d.config.glitchtip!.raw, release: `web@${d.config.appVersion}`, environment: d.environment ?? "production", context: ctx });
        crashRunning = true;
      }
      return;
    }
    if (!loading) {
      loading = d.loadCrashReporter().then(
        (r) => {
          reporter = r;
          syncCrash();
          return r;
        },
        () => {
          loading = null;
          return null;
        },
      );
    }
  }

  return {
    apply() {
      syncCrash();
    },
    screen(r) {
      if (r === route) return;
      route = r;
      if (crashRunning) reporter?.setRoute(r);
      if (usageOn()) usage!.screen(r);
    },
    event(name, data) {
      if (usageOn()) usage!.event(name, data, route);
    },
    route: () => route,
    state: () => ({ crashLoaded: !!reporter, crashRunning, usageOn: usageOn() }),
  };
}

/** Browser loader for crash.js: a same-origin script tag, so CSP `script-src 'self'` covers it. */
export function scriptLoader(src: string): () => Promise<CrashReporter> {
  return () =>
    new Promise((resolve, reject) => {
      const g = globalThis as { __mfCrash?: CrashReporter };
      if (g.__mfCrash) return resolve(g.__mfCrash);
      const s = document.createElement("script");
      s.src = src;
      s.async = true;
      s.onload = () => (g.__mfCrash ? resolve(g.__mfCrash) : reject(new Error("crash reporter missing")));
      s.onerror = () => reject(new Error("couldn't load the crash reporter"));
      document.head.appendChild(s);
    });
}
