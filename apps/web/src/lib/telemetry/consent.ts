// Opt-in telemetry consent (docs/TELEMETRY.md). Three separate choices, all off by
// default, asked once as a question after the app has been used for a while.
// Pure state transitions; the app persists the result in `settings.telemetry`.
//
// This is separate from the creator discovery-stats switch (settings.analytics,
// ANALYTICS.md Tier 2), which keeps its decided default.

export type TelemetryToggle = "crash" | "diagnostics" | "usage";
export const TELEMETRY_TOGGLES: readonly TelemetryToggle[] = ["crash", "diagnostics", "usage"];

/**
 * pending: never asked yet. snoozed: "Not now" (ask again later, a limited number
 * of times). answered: "Turn on selected", or the viewer changed a switch in
 * Settings. never: "No thanks", or every re-ask was used up.
 */
export type PromptState = "pending" | "snoozed" | "answered" | "never";

export interface TelemetryConsent {
  /** (a) Crash and error reports, sent automatically. */
  crash: boolean;
  /** (b) Attach diagnostics to bug reports by default. Reports go only when you press Send. */
  diagnostics: boolean;
  /** (c) Coarse usage events from a fixed allow-list. */
  usage: boolean;
  prompt: {
    state: PromptState;
    /** App starts counted so far (capped). */
    launches: number;
    /** "Not now" presses. */
    snoozes: number;
    /** When a snoozed question may be asked again (ms since epoch). */
    nextAskAt: number | null;
    /** When the viewer last answered or changed a switch (ms), for the record. */
    decidedAt: number | null;
  };
}

/** Ask on the second launch, or after this much use in the first session. */
export const ASK_AFTER_MS = 3 * 60 * 1000;
/** On a later launch, wait this long after start, so it's never on first paint. */
export const ASK_DELAY_ON_LAUNCH_MS = 20 * 1000;
/** "Not now" asks again after about a month... */
export const SNOOZE_MS = 30 * 24 * 60 * 60 * 1000;
/** ...at most this many more times. */
export const MAX_REASKS = 2;
const LAUNCH_CAP = 1000;

export function defaultConsent(): TelemetryConsent {
  return { crash: false, diagnostics: false, usage: false, prompt: { state: "pending", launches: 0, snoozes: 0, nextAskAt: null, decidedAt: null } };
}

/** Validate stored consent. Anything malformed falls back to "off, not asked". */
export function loadConsent(x: unknown): TelemetryConsent {
  const d = defaultConsent();
  if (typeof x !== "object" || x === null) return d;
  const o = x as Record<string, unknown>;
  for (const k of TELEMETRY_TOGGLES) d[k] = o[k] === true;
  const p = o.prompt as Record<string, unknown> | undefined;
  if (p && typeof p === "object") {
    if (p.state === "pending" || p.state === "snoozed" || p.state === "answered" || p.state === "never") d.prompt.state = p.state;
    const int = (v: unknown, max: number) => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? Math.min(v, max) : 0);
    d.prompt.launches = int(p.launches, LAUNCH_CAP);
    d.prompt.snoozes = int(p.snoozes, MAX_REASKS + 1);
    d.prompt.nextAskAt = typeof p.nextAskAt === "number" && Number.isFinite(p.nextAskAt) ? p.nextAskAt : null;
    d.prompt.decidedAt = typeof p.decidedAt === "number" && Number.isFinite(p.decidedAt) ? p.decidedAt : null;
  }
  // A snooze without a date can't be honored: treat it as asked-and-declined for now.
  if (d.prompt.state === "snoozed" && d.prompt.nextAskAt === null) d.prompt.state = "never";
  // Pending or snoozed with something on is inconsistent (only an answer turns things on).
  if ((d.prompt.state === "pending" || d.prompt.state === "snoozed") && (d.crash || d.diagnostics || d.usage)) d.prompt.state = "answered";
  return d;
}

/** Count an app start. */
export function noteLaunch(c: TelemetryConsent): TelemetryConsent {
  return { ...c, prompt: { ...c.prompt, launches: Math.min(LAUNCH_CAP, c.prompt.launches + 1) } };
}

/**
 * How long from now until the question should appear, or null for "don't ask".
 * `sessionStart` is when this app start began; `available` is false when the build
 * has no telemetry endpoints (then there's nothing to ask about).
 */
export function askDelay(c: TelemetryConsent, now: number, sessionStart: number, available: boolean): number | null {
  if (!available) return null;
  const p = c.prompt;
  if (p.state === "answered" || p.state === "never") return null;
  const sinceStart = Math.max(0, now - sessionStart);
  if (p.state === "snoozed") {
    if (p.nextAskAt === null || p.snoozes > MAX_REASKS) return null;
    // Due: still wait a little into the session, never on first paint.
    const due = Math.max(0, p.nextAskAt - now);
    return Math.max(due, ASK_DELAY_ON_LAUNCH_MS - sinceStart);
  }
  // pending
  if (p.launches >= 2) return Math.max(0, ASK_DELAY_ON_LAUNCH_MS - sinceStart);
  return Math.max(0, ASK_AFTER_MS - sinceStart);
}

/** "Turn on selected": exactly the chosen switches are on; never ask again. */
export function answer(c: TelemetryConsent, chosen: Partial<Record<TelemetryToggle, boolean>>, now: number): TelemetryConsent {
  return {
    crash: chosen.crash === true,
    diagnostics: chosen.diagnostics === true,
    usage: chosen.usage === true,
    prompt: { ...c.prompt, state: "answered", nextAskAt: null, decidedAt: now },
  };
}

/** "No thanks": everything off, never ask again. */
export function decline(c: TelemetryConsent, now: number): TelemetryConsent {
  return { crash: false, diagnostics: false, usage: false, prompt: { ...c.prompt, state: "never", nextAskAt: null, decidedAt: now } };
}

/** "Not now": nothing changes; ask again in about 30 days, at most MAX_REASKS more times. */
export function snooze(c: TelemetryConsent, now: number): TelemetryConsent {
  const snoozes = c.prompt.snoozes + 1;
  if (snoozes > MAX_REASKS) return { ...c, crash: false, diagnostics: false, usage: false, prompt: { ...c.prompt, state: "never", snoozes, nextAskAt: null } };
  return { ...c, prompt: { ...c.prompt, state: "snoozed", snoozes, nextAskAt: now + SNOOZE_MS } };
}

/** A switch changed in Settings. That counts as an answer, so the card stops asking. */
export function setToggle(c: TelemetryConsent, key: TelemetryToggle, on: boolean, now: number): TelemetryConsent {
  return { ...c, [key]: on, prompt: { ...c.prompt, state: "answered", nextAskAt: null, decidedAt: now } };
}
