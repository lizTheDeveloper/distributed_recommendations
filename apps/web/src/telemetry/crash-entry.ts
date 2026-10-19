// The crash reporter, built as its own file (dist/crash.js) and loaded by the app
// only after the viewer turns on crash & error reports (lib/telemetry/controller.ts).
// Viewers who don't opt in never download or initialize it.
//
// @sentry/browser 10.76.0, configured for the minimum: no default integrations
// (so no breadcrumbs of console, clicks, fetch/XHR URLs or navigation, no
// HTTP-context URL and headers, no session tracking), no tracing, no replay, no
// client reports, sendDefaultPii off. Every event and breadcrumb goes through the
// allow-list scrubber, then a sampling and rate limit, then a final check that
// refuses anything still looking sensitive.

import {
  addBreadcrumb,
  browserApiErrorsIntegration,
  close,
  dedupeIntegration,
  functionToStringIntegration,
  globalHandlersIntegration,
  inboundFiltersIntegration,
  init,
  linkedErrorsIntegration,
} from "@sentry/browser";
import type { CrashReporter } from "../lib/telemetry/controller.ts";
import type { CrashContext, Route } from "../lib/telemetry/scrub.ts";
import { createLimiter, eventKey, looksSensitive, sampleRate, scrubBreadcrumb, scrubEvent } from "../lib/telemetry/scrub.ts";

let active = false;
let route: Route = "unknown";

const reporter: CrashReporter = {
  start({ dsn, release, environment, context }) {
    const limiter = createLimiter();
    const ctx = (): CrashContext => ({ ...context(), route });
    active = true;
    init({
      dsn,
      release,
      environment,
      sendDefaultPii: false,
      sendClientReports: false,
      defaultIntegrations: false,
      integrations: [
        inboundFiltersIntegration(),
        functionToStringIntegration(),
        browserApiErrorsIntegration(),
        globalHandlersIntegration(),
        linkedErrorsIntegration(),
        dedupeIntegration(),
      ],
      // No performance tracing (tracesSampleRate unset, no tracing integration),
      // no profiling, no replay, no logs.
      enableLogs: false,
      maxBreadcrumbs: 10,
      sampleRate: 1,
      transportOptions: { fetchOptions: { referrerPolicy: "no-referrer", credentials: "omit" } },
      beforeBreadcrumb: (b) => scrubBreadcrumb(b) as typeof b | null,
      beforeSend(event) {
        if (!active) return null;
        if (Math.random() >= sampleRate(event)) return null;
        const clean = scrubEvent(event, ctx());
        if (!limiter.allow(eventKey(clean), Date.now())) return null;
        if (looksSensitive(JSON.stringify(clean))) return null;
        return clean as unknown as typeof event;
      },
      beforeSendTransaction: () => null,
    });
  },
  stop() {
    active = false;
    void close(2000);
  },
  setRoute(r) {
    route = r;
    if (active) addBreadcrumb({ category: "route", message: r, level: "info" });
  },
};

(globalThis as { __mfCrash?: CrashReporter }).__mfCrash = reporter;
