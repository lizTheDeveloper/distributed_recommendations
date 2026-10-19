// Creator side: turn a collected aggregate into what the studio shows (and, if the
// creator chooses to publish, what is published: the same numbers, never a re-collection).
//
// Noise. Janus 0.7 adds the DP noise itself: with the task's
// `dp_strategy: PureDpDiscreteLaplace`, EACH aggregator adds discrete Laplace noise
// (sensitivity 2, substitution neighbours) to its own aggregate share before sending it
// to the collector, so each one alone gives epsilon-DP even if the other cheats. Noise is
// added in the field, so a negative noisy count arrives as a number just below the
// Field128 modulus; `centered` maps it back. `collectorSideNoise` is the fallback for
// aggregators without DP support; then the collector sees exact counts first, which
// protects published numbers only, not viewers against the creator.
//
// Thresholds (docs/ANALYTICS.md): any count under 20 is shown as "<20"; with fewer than
// 20 reports nothing is shown at all (Janus also refuses to collect a batch smaller
// than the task's min_batch_size).

import { CHANNELS, type Channel, DISPLAY_THRESHOLD } from "./channels.ts";
import { discreteLaplace, type Rng } from "./core.ts";

/** Prio3Histogram's field (VDAF-08 Field128): p = 2^128 - 28 * 2^64 + 1. */
export const FIELD128_MODULUS = 2n ** 128n - 28n * 2n ** 64n + 1n;

/** Map a field element to the integer nearest zero (values above p/2 are negative). */
export function centered(x: string | number | bigint, modulus: bigint = FIELD128_MODULUS): bigint {
  const v = typeof x === "bigint" ? x : BigInt(x);
  if (v < 0n || v >= modulus) throw new RangeError("not a field element");
  return v > modulus / 2n ? v - modulus : v;
}

export interface ChannelStat {
  channel: Channel;
  /** Noisy count, clamped at 0. Null when under the threshold (never show it). */
  count: number | null;
  /** "<20" or the count. */
  display: string;
  /** Share of all noisy counts, 0..1; null when under the threshold. */
  share: number | null;
}

export interface DiscoveryStats {
  /** Number of reports (viewers) in the batch. Exact: DAP does not noise it. */
  reportCount: number;
  reportCountDisplay: string;
  /** True when the whole batch is under the threshold: show nothing but "<20". */
  suppressed: boolean;
  channels: ChannelStat[];
  window?: { start: number; durationSeconds: number };
}

export interface PostprocessInput {
  /** The collected histogram, one entry per channel, as field elements (strings from JSON are fine). */
  aggregate: readonly (string | number | bigint)[];
  reportCount: number;
  threshold?: number;
  window?: { start: number; durationSeconds: number };
}

export function postprocess(input: PostprocessInput): DiscoveryStats {
  const threshold = input.threshold ?? DISPLAY_THRESHOLD;
  if (threshold < DISPLAY_THRESHOLD) throw new RangeError(`threshold must be at least ${DISPLAY_THRESHOLD}`);
  if (input.aggregate.length !== CHANNELS.length) throw new RangeError("aggregate length");
  if (!Number.isInteger(input.reportCount) || input.reportCount < 0) throw new RangeError("reportCount");
  const noisy = input.aggregate.map((x) => {
    const c = centered(x);
    return c < 0n ? 0 : Number(c > 1_000_000_000n ? 1_000_000_000n : c);
  });
  const suppressed = input.reportCount < threshold;
  const sum = noisy.reduce((a, b) => a + b, 0);
  const channels = CHANNELS.map((channel, i): ChannelStat => {
    const n = noisy[i]!;
    if (suppressed || n < threshold) return { channel, count: null, display: `<${threshold}`, share: null };
    return { channel, count: n, display: String(n), share: sum > 0 ? n / sum : null };
  });
  return {
    reportCount: input.reportCount,
    reportCountDisplay: suppressed ? `<${threshold}` : String(input.reportCount),
    suppressed,
    channels,
    ...(input.window ? { window: input.window } : {}),
  };
}

/**
 * Fallback only (see top of file): add discrete Laplace noise for sensitivity 2 to
 * exact counts. Uses core's `discreteLaplace`, a floating-point reference sampler
 * (THREAT_MODEL T20); Janus's native sampler is exact and preferred.
 */
export function collectorSideNoise(counts: readonly number[], epsilon: number, rng: Rng): number[] {
  if (!(epsilon > 0)) throw new RangeError("epsilon must be positive");
  return counts.map((c) => c + discreteLaplace(epsilon / 2, rng));
}

/** What may be published (Q3): only the displayed values, same thresholds and noise. */
export function publishable(stats: DiscoveryStats): {
  reportCount: string;
  channels: { channel: Channel; value: string; share: string | null }[];
  window?: { start: number; durationSeconds: number };
} {
  return {
    reportCount: stats.reportCountDisplay,
    channels: stats.channels.map((c) => ({
      channel: c.channel,
      value: c.display,
      share: c.share === null ? null : `${Math.round(c.share * 100)}%`,
    })),
    ...(stats.window ? { window: stats.window } : {}),
  };
}

/**
 * Parse the output of Janus's `collect` tool (janus_tools, release/0.7):
 *   Number of reports: 31
 *   Interval start: ...
 *   Aggregation result: [12, 340282366920938462946865773367900766207, ...]
 */
export function parseCollectOutput(text: string): { reportCount: number; aggregate: string[] } {
  const n = /^Number of reports:\s*(\d+)\s*$/m.exec(text);
  const r = /^Aggregation result:\s*\[([0-9,\s]*)\]\s*$/m.exec(text);
  if (!n || !r) throw new Error("unrecognized collect output");
  const aggregate = r[1]!.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
  return { reportCount: Number(n[1]), aggregate };
}
