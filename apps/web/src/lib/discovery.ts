// Tier 2 creator discovery stats on this device (docs/ANALYTICS.md decisions,
// docs/ANALYTICS_IMPLEMENTATION.md hooks): the ledger, upload jobs and the cache of
// creators' task configs, all in the encrypted vault. Pure: the app does the I/O.
//
// Viewers contribute by default with per-channel off switches (Q1); creators opt in
// by publishing a task config, and only configs naming an independent helper from
// the build's allowlist are accepted. With an empty allowlist (the default build)
// nothing is looked up or sent: the device only keeps its own tally.

import type { SourceKind } from "./core.ts";
import type { Ledger, TaskConfig, UploadJob, Channel } from "./analytics/pkg.ts";
import { CHANNELS, channelOf, checkTaskConfig, emptyLedger, fromWebSettings, loadLedger, recordView } from "./analytics/pkg.ts";
import type { Settings } from "./settings.ts";

export interface DiscoveryState {
  ledger: Ledger;
  jobs: UploadJob[];
  /** creator key -> last lookup: a valid config, or none found (with when). */
  configs: Record<string, { config: TaskConfig | null; checkedAt: number; reason?: string }>;
}

export const CONFIG_CACHE_MS = 24 * 60 * 60 * 1000;

export function emptyDiscovery(): DiscoveryState {
  return { ledger: emptyLedger(), jobs: [], configs: {} };
}

/** The helper allowlist compiled into this build (MF_DAP_HELPERS: https origins; empty = Tier 2 uploads off). */
export function helperAllowlist(raw: string | undefined): string[] {
  const out: string[] = [];
  for (const x of (raw ?? "").split(/[\s,]+/)) {
    try {
      const u = new URL(x.trim());
      if (u.protocol === "https:" && !u.username && !u.password && !out.includes(u.origin)) out.push(u.origin);
    } catch {
      /* not a URL */
    }
  }
  return out;
}

export function loadJobs(x: unknown): UploadJob[] {
  if (!Array.isArray(x)) return [];
  return x
    .filter((j) => j && typeof j === "object" && typeof j.id === "string" && typeof j.creator === "string" && typeof j.taskId === "string" && Number.isInteger(j.window) && Number.isInteger(j.measurement) && Number.isFinite(j.notBefore) && Number.isFinite(j.deadline))
    .slice(0, 200) as UploadJob[];
}

export function loadConfigs(x: unknown, helpers: readonly string[], now: Date): DiscoveryState["configs"] {
  const out: DiscoveryState["configs"] = {};
  if (!x || typeof x !== "object") return out;
  for (const [creator, v] of Object.entries(x as Record<string, unknown>).slice(0, 500)) {
    const o = v as { config?: unknown; checkedAt?: unknown; reason?: unknown };
    if (!o || typeof o.checkedAt !== "number") continue;
    if (o.config) {
      // Re-check on load: the allowlist or the expiry may have changed.
      const r = checkTaskConfig(o.config, { creator, now, allowedHelpers: helpers });
      if (r.ok) out[creator] = { config: r.config, checkedAt: o.checkedAt };
      continue;
    }
    out[creator] = { config: null, checkedAt: o.checkedAt, ...(typeof o.reason === "string" ? { reason: o.reason.slice(0, 80) } : {}) };
  }
  return out;
}

export function loadDiscovery(ledger: unknown, jobs: unknown, configs: unknown, helpers: readonly string[], now: Date): DiscoveryState {
  return { ledger: loadLedger(ledger), jobs: loadJobs(jobs), configs: loadConfigs(configs, helpers, now) };
}

/** The view hook (replaces the old per-kind tally): creator and channel only, never the video. */
export function noteView(d: DiscoveryState, creator: string, via: SourceKind | "search" | undefined, at: Date, s: Pick<Settings, "analytics" | "privateWatching">): DiscoveryState {
  const ledger = recordView(d.ledger, { creator: creator.toLowerCase(), channel: channelOf(via), at }, fromWebSettings(s));
  return ledger === d.ledger ? d : { ...d, ledger };
}

/** Totals per channel over the ledger's open windows, for "what your device would contribute". */
export function channelTotals(l: Ledger): Record<Channel, number> {
  const out = Object.fromEntries(CHANNELS.map((c) => [c, 0])) as Record<Channel, number>;
  for (const win of Object.values(l.windows)) for (const counts of Object.values(win)) for (const c of CHANNELS) out[c] += counts[c] ?? 0;
  return out;
}

/** Creators with views whose config is unknown or older than a day. */
export function configsDue(d: DiscoveryState, nowMs: number, max = 20): string[] {
  const creators = new Set<string>();
  for (const win of Object.values(d.ledger.windows)) for (const c of Object.keys(win)) creators.add(c);
  return [...creators].filter((c) => !d.configs[c] || nowMs - d.configs[c].checkedAt > CONFIG_CACHE_MS).slice(0, max);
}

/** Valid configs, for planReports and runUploads. */
export function validConfigs(d: DiscoveryState): Map<string, TaskConfig> {
  const m = new Map<string, TaskConfig>();
  for (const [k, v] of Object.entries(d.configs)) if (v.config) m.set(k, v.config);
  return m;
}
