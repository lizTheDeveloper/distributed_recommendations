// From the ledger to upload jobs: one report per (viewer, creator, closed window).
//
// What one report says: "in window W, this viewer mostly found this creator through
// channel C". It is a one-hot vector over CHANNELS (Prio3Histogram), so:
// - the creator sees the share of VIEWERS by channel, not of views. Bounding each
//   viewer to one report per creator per window is what makes the DP noise meaningful
//   (sensitivity 2 under substitution) and stops the number of uploads from revealing
//   how much someone watched;
// - Prio3's proof makes the aggregators reject anything that is not exactly one-hot,
//   so one device cannot add 1,000 votes in one report (it can still send many reports:
//   see "Sybils" in docs/ANALYTICS_IMPLEMENTATION.md).
//
// Timing: reports for window W are planned when W closes and sent at an independent,
// random time for each creator in [W end + 1 h, W end + 73 h]. The DAP timestamp is
// the window start (time_precision = 28 days), so neither the report nor its upload
// time says when the views happened, and uploads for different creators are not sent
// together.

import { CHANNEL_INDEX, CHANNELS, type Channel, windowEnd, windowIndex, windowStart } from "./channels.ts";
import type { TaskConfig } from "./config.ts";
import type { Rng } from "./core.ts";
import { type ChannelCounts, dropWindow, type Ledger } from "./ledger.ts";
import { channelAllowed, type ContributionSettings } from "./settings.ts";

export const SCHEDULE = Object.freeze({
  /** Earliest upload after the window closes. */
  minDelaySeconds: 3600,
  /** Uniform random extra delay, drawn separately for each creator. */
  jitterSeconds: 72 * 3600,
  /** After this, a job is dropped: the creator collects at window end + 7 days. */
  deadlineSeconds: 6 * 24 * 3600,
  /** Retry backoff after a failed upload (doubles, capped). */
  retryBaseSeconds: 15 * 60,
  retryMaxSeconds: 12 * 3600,
  /** Most reports one device sends per window. Creators past this are skipped at random. */
  maxReportsPerWindow: 200,
});

export interface UploadJob {
  /** Local id for bookkeeping only; never sent. */
  id: string;
  creator: string;
  taskId: string;
  window: number;
  /** Index into CHANNELS. */
  measurement: number;
  /** Unix seconds: not before / not after. */
  notBefore: number;
  deadline: number;
  attempts: number;
  /** The encoded DAP report, once generated (base64url). Retries resend the same bytes. */
  report?: string;
  /** Last failure, for local diagnostics only. */
  lastError?: string;
}

/**
 * The channel to report: the most-viewed channel among those the switches still allow.
 * Ties are broken at random. Null when no allowed channel has views.
 */
export function chooseChannel(counts: ChannelCounts, settings: ContributionSettings, rng: Rng): Channel | null {
  let best: Channel[] = [];
  let max = 0;
  for (const ch of CHANNELS) {
    const n = counts[ch] ?? 0;
    if (n <= 0 || !channelAllowed(ch, settings)) continue;
    if (n > max) {
      max = n;
      best = [ch];
    } else if (n === max) best.push(ch);
  }
  if (best.length === 0) return null;
  return best[Math.min(best.length - 1, Math.floor(rng() * best.length))]!;
}

export interface PlanOptions {
  now: Date;
  settings: ContributionSettings;
  /** Valid task configs by creator key (already checked with `checkTaskConfig`). */
  configs: ReadonlyMap<string, TaskConfig>;
  rng: Rng;
  /** Random id source for job ids (defaults to rng-based hex). */
  newId?: () => string;
}

export interface PlanResult {
  ledger: Ledger;
  jobs: UploadJob[];
}

/**
 * Turn every closed window in the ledger into upload jobs, then delete those windows'
 * tallies. Creators without a valid config get no job (and their tallies are deleted
 * too). Windows past the upload deadline are dropped without jobs.
 * Nothing is planned while contribution is off or private watching is on; the ledger
 * is left alone in that case (contribution off should also clear it: `clearLedger`).
 */
export function planReports(ledger: Ledger, existing: readonly UploadJob[], opts: PlanOptions): PlanResult {
  const { now, settings, configs, rng } = opts;
  if (!settings.contribute || settings.privateWatching) return { ledger, jobs: [...existing] };
  const nowS = Math.floor(now.getTime() / 1000);
  const current = windowIndex(now);
  const newId =
    opts.newId ??
    (() => Array.from({ length: 4 }, () => Math.floor(rng() * 0x10000).toString(16).padStart(4, "0")).join(""));
  const have = new Set(existing.map((j) => `${j.window}|${j.creator}`));
  const jobs = [...existing];
  let out = ledger;
  for (const key of Object.keys(ledger.windows)) {
    const w = Number(key);
    if (w >= current) continue; // still open
    const end = windowEnd(w);
    if (nowS < end + SCHEDULE.deadlineSeconds) {
      const creators = Object.keys(ledger.windows[key]!);
      // Random order, so the per-window cap does not favour any creator.
      for (let i = creators.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [creators[i], creators[j]] = [creators[j]!, creators[i]!];
      }
      let planned = jobs.filter((j) => j.window === w).length;
      for (const creator of creators) {
        if (planned >= SCHEDULE.maxReportsPerWindow) break;
        if (have.has(`${w}|${creator}`)) continue;
        const config = configs.get(creator);
        if (!config || config.creator !== creator) continue;
        const ch = chooseChannel(ledger.windows[key]![creator]!, settings, rng);
        if (ch === null) continue;
        const notBefore = Math.max(nowS, end + SCHEDULE.minDelaySeconds + Math.floor(rng() * SCHEDULE.jitterSeconds));
        jobs.push({
          id: newId(),
          creator,
          taskId: config.taskId,
          window: w,
          measurement: CHANNEL_INDEX[ch],
          notBefore,
          deadline: end + SCHEDULE.deadlineSeconds,
          attempts: 0,
        });
        planned++;
      }
    }
    out = dropWindow(out, w);
  }
  return { ledger: out, jobs };
}

/** Jobs whose time has come, and the jobs list without the expired ones. */
export function dueJobs(jobs: readonly UploadJob[], now: Date): { due: UploadJob[]; keep: UploadJob[] } {
  const nowS = Math.floor(now.getTime() / 1000);
  const keep = jobs.filter((j) => nowS < j.deadline);
  return { due: keep.filter((j) => j.notBefore <= nowS), keep };
}

/**
 * May this job still be sent? Re-checks the switches at send time: turning a channel
 * (or everything) off after the views, or being in private watching now, stops it.
 */
export function stillAllowed(job: UploadJob, settings: ContributionSettings): boolean {
  const ch = CHANNELS[job.measurement];
  return ch !== undefined && channelAllowed(ch, settings);
}

/** The DAP report timestamp for a job: its window start (as a Date). */
export function reportTime(job: Pick<UploadJob, "window">): Date {
  return new Date(windowStart(job.window) * 1000);
}

/** Next attempt time after a failure: exponential backoff with full jitter, within the deadline. */
export function retryAt(job: UploadJob, now: Date, rng: Rng): number {
  const nowS = Math.floor(now.getTime() / 1000);
  const cap = Math.min(SCHEDULE.retryMaxSeconds, SCHEDULE.retryBaseSeconds * 2 ** Math.min(job.attempts, 10));
  return nowS + 60 + Math.floor(rng() * cap);
}
