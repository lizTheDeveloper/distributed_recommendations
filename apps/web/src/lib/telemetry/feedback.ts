// Bug reports and feedback (toggle b). Sent only when the viewer presses Send,
// so this works whether or not crash reports or usage analytics are on.
//
// Transport: one Sentry envelope with one `event` item, POSTed to GlitchTip's
// `/api/<project>/envelope/` with the DSN's public key in the query string. Checked
// against GlitchTip 6.2.6 source (apps/event_ingest): it also accepts `feedback`
// and `user_report` items, but stores them as a UserReport that is linked to an
// issue only if the associated event is already ingested, lists them only per
// issue, and deletes them only together with their issue. A standalone report
// would be invisible in the UI and outlive the retention period. So the report is
// a captured message instead: grouped by category (fingerprint), deleted with the
// other events after GLITCHTIP_EVENT_RETENTION_DAYS.
//
// No SDK is needed for this, so a bug report doesn't load the crash reporter.

import type { RecentError, DeviceFacts } from "./diagnostics.ts";
import { scrubText } from "./scrub.ts";

export type FeedbackCategory = "bug" | "idea" | "other";
export const FEEDBACK_CATEGORIES: { id: FeedbackCategory; label: string }[] = [
  { id: "bug", label: "Something's broken" },
  { id: "idea", label: "Idea" },
  { id: "other", label: "Other" },
];

export const MAX_FEEDBACK_TEXT = 4000;

export interface Dsn {
  /** The DSN as configured, for the crash reporter. */
  raw: string;
  publicKey: string;
  projectId: string;
  /** Origin plus any path prefix, no trailing slash. */
  base: string;
  origin: string;
}

/** Parse a Sentry/GlitchTip DSN (`https://<key>@host[/prefix]/<project>`). Null if malformed. */
export function parseDsn(dsn: string): Dsn | null {
  let u: URL;
  try {
    u = new URL(dsn.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && !(u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1"))) return null;
  if (!u.username || u.password || u.search || u.hash) return null;
  const parts = u.pathname.split("/").filter(Boolean);
  const projectId = parts.pop();
  if (!projectId || !/^\d+$/.test(projectId) || !/^[0-9a-f-]{16,40}$/i.test(u.username)) return null;
  const prefix = parts.length ? "/" + parts.join("/") : "";
  return { raw: dsn.trim(), publicKey: u.username, projectId, base: `${u.origin}${prefix}`, origin: u.origin };
}

export function envelopeUrl(d: Dsn): string {
  return `${d.base}/api/${d.projectId}/envelope/?sentry_key=${encodeURIComponent(d.publicKey)}&sentry_version=7`;
}

/** Settings that are safe to report: switches and choices, nothing that reveals history or relationships. */
export interface SettingsSummary {
  privateWatching: boolean;
  p2p: boolean;
  popularSection: boolean;
  discoveryStats: boolean;
  defaultView: string;
  theme: string;
  retentionDays: number;
  passphrase: boolean;
  storage: string;
  relaysConfigured: boolean;
  recipe: string;
  crashReports: boolean;
  usageAnalytics: boolean;
}

export interface Diagnostics extends DeviceFacts {
  appVersion: string;
  recentErrors: RecentError[];
  settings: SettingsSummary;
}

export interface FeedbackInput {
  category: FeedbackCategory;
  text: string;
  email?: string;
  diagnostics?: Diagnostics | null;
}

export function validEmail(s: string): boolean {
  return s.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

/**
 * The event exactly as it will be sent (minus event_id and timestamp, which the
 * sender adds). The form shows this object to the viewer before Send.
 */
export function feedbackEvent(input: FeedbackInput, appVersion: string): Record<string, unknown> {
  const category: FeedbackCategory = (["bug", "idea", "other"] as const).includes(input.category) ? input.category : "other";
  const text = scrubText(input.text, MAX_FEEDBACK_TEXT).trim();
  const email = input.email && validEmail(input.email.trim()) ? input.email.trim() : undefined;
  const contexts: Record<string, unknown> = { feedback: email ? { message: text, contact_email: email } : { message: text } };
  const d = input.diagnostics;
  if (d) {
    contexts.diagnostics = {
      app_version: d.appVersion,
      browser: d.browser,
      os: d.os,
      screen: d.screen,
      recent_errors: d.recentErrors.map((e) => `${e.type}: ${scrubText(e.message, 200)} (screen ${e.route}, minute ${e.minute})`),
      settings: { ...d.settings },
    };
  }
  return {
    level: "info",
    logger: "feedback",
    platform: "javascript",
    message: `[${category}] ${text}`,
    fingerprint: ["user-feedback", category],
    release: `web@${appVersion}`,
    tags: { kind: "feedback", category, app_version: appVersion, diagnostics: d ? "attached" : "none" },
    contexts,
  };
}

function hexId(rand: (n: number) => Uint8Array): string {
  return [...rand(16)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** A Sentry envelope holding one event item. */
export function envelope(event: Record<string, unknown>, opts: { eventId: string; now: Date }): string {
  const body = { ...event, event_id: opts.eventId, timestamp: opts.now.getTime() / 1000 };
  const payload = JSON.stringify(body);
  return [
    JSON.stringify({ event_id: opts.eventId, sent_at: opts.now.toISOString(), sdk: { name: "meme-video.feedback", version: "1" } }),
    JSON.stringify({ type: "event", content_type: "application/json", length: new TextEncoder().encode(payload).length }),
    payload,
  ].join("\n");
}

export type FetchLike = (url: string, init: RequestInit) => Promise<{ ok: boolean; status: number }>;

/**
 * Send a bug report. `text/plain` keeps it a simple CORS request (no preflight),
 * as the Sentry SDKs do; GlitchTip reads the envelope regardless of content type.
 */
export async function sendFeedback(
  dsn: Dsn,
  input: FeedbackInput,
  appVersion: string,
  fetchFn: FetchLike,
  rand: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n)),
  now = new Date(),
): Promise<void> {
  const ev = feedbackEvent(input, appVersion);
  if (!String((ev.contexts as { feedback: { message: string } }).feedback.message)) throw new Error("Write something first.");
  const res = await fetchFn(envelopeUrl(dsn), {
    method: "POST",
    body: envelope(ev, { eventId: hexId(rand), now }),
    headers: { "Content-Type": "text/plain;charset=UTF-8" },
    credentials: "omit",
    referrerPolicy: "no-referrer",
    cache: "no-store",
    mode: "cors",
  });
  if (!res.ok) throw new Error(res.status === 429 ? "The server is busy. Try again later." : `The server answered ${res.status}.`);
}
