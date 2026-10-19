// Report intake: NIP-56 kind-1984 events addressed to the labeler, into the
// review queue.
//
// Addressing: NIP-56 defines no way to address a report to a moderator, so a
// report reaches this labeler when it carries an extra `["p", <labeler pubkey>]`
// tag WITHOUT a report type (the reported `p`/`e` tags keep theirs). Intake asks
// relays for `{kinds: [1984], "#p": [labeler]}`. A `p` tag for the labeler WITH
// a report type is a report about the labeler itself and is queued like any other.
//
// Rules:
// - signatures checked on a fresh object (packages/moderation `verifyNostrEvent`, T25);
// - dedupe by event id, and per (reporter, target, type): a reporter who reports
//   the same thing twice counts once;
// - per-reporter rate limit (accepted reports per 24 h, open reports at once);
// - ignored reporters, reports from the future or older than `maxReportAgeDays` are dropped;
// - reports never label anything by themselves. The one exception is the
//   optional auto-blur (config.autoBlur, OFF by default): N distinct TRUSTED
//   reporters on one video event add a temporary `!warn` (blur, never hide) that
//   expires unless a human confirms it.

import { createHash } from 'node:crypto';
import { KIND_REPORT, cleanDisplay, parseReport, query, verifyNostrEvent } from './deps.ts';
import type { NostrEvent, RelayOptions, ReportType } from './deps.ts';
import type { LabelerConfig } from './config.ts';
import type { LabelerContext } from './labeling.ts';
import { activeLabels, issueLabel } from './labeling.ts';
import type { LabelerStore } from './repo.ts';
import { targetFromKey } from './targets.ts';
import type { CaseRecord, ReportRecord } from './types.ts';

export const REPORT_CONTENT_KEEP = 2000;
export const MAX_TARGETS_PER_REPORT = 20;
const DAY = 86_400;

export interface IntakeStats {
  received: number;
  invalid: number;
  notAddressed: number;
  duplicate: number;
  merged: number;
  ignoredReporter: number;
  tooOld: number;
  future: number;
  rateLimited: number;
  accepted: number;
  casesOpened: number;
  casesReopened: number;
  autoBlurred: number;
  errors: string[];
}

const emptyStats = (): IntakeStats => ({
  received: 0,
  invalid: 0,
  notAddressed: 0,
  duplicate: 0,
  merged: 0,
  ignoredReporter: 0,
  tooOld: 0,
  future: 0,
  rateLimited: 0,
  accepted: 0,
  casesOpened: 0,
  casesReopened: 0,
  autoBlurred: 0,
  errors: [],
});

type Outcome = 'notAddressed' | 'ignoredReporter' | 'future' | 'tooOld' | 'invalid' | 'rateLimited' | 'merged' | 'accepted';

export function caseIdFor(target: string): string {
  return createHash('sha256').update(target).digest('hex').slice(0, 12);
}

export interface IngestOptions {
  config: LabelerConfig;
  store: LabelerStore;
  now?: number;
  /** Relay the events came from (not stored; reserved for logging). */
  relay?: string;
}

/** Add verified, addressed reports to the queue. Pure bookkeeping: no network. */
export function ingestReports(events: readonly NostrEvent[], opts: IngestOptions): { stats: IntakeStats; touched: string[] } {
  const { config, store } = opts;
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const stats = emptyStats();
  const touched = new Set<string>();
  const trusted = new Set(config.trustedReporters);
  const ignored = new Set(config.ignoredReporters);
  const daily: Record<string, number> = {};

  for (const e of events) {
    stats.received++;
    if (!e || e.kind !== KIND_REPORT || !verifyNostrEvent(e)) {
      stats.invalid++;
      continue;
    }
    if (store.seen(e.id)) {
      stats.duplicate++;
      continue;
    }
    const outcome = store.tx((): Outcome => {
      store.markSeen(e.id, now);
      if (!e.tags.some((t) => t[0] === 'p' && t[1] === config.labeler && !t[2])) return 'notAddressed';
      if (ignored.has(e.pubkey)) return 'ignoredReporter';
      if (e.created_at > now + 600) return 'future';
      if (e.created_at < now - config.maxReportAgeDays * DAY) return 'tooOld';
      const parsed = parseReport(e).slice(0, MAX_TARGETS_PER_REPORT);
      if (!parsed.length) return 'invalid';

      // Rate limit per reporter: accepted reports in the last 24 h (our clock, not
      // the reporter's), and open reports in the queue.
      const rs = store.getReporter(e.pubkey);
      rs.recent = rs.recent.filter((t) => t > now - DAY);
      const open = store.reports().filter((r) => r.reporter === e.pubkey && store.getCase(r.caseId)?.status === 'open').length;
      if (rs.recent.length >= config.rateLimit.perDay || open >= config.rateLimit.maxOpen) {
        rs.dropped++;
        store.putReporter(rs);
        return 'rateLimited';
      }

      const reportedPubkey = e.tags.find((t) => t[0] === 'p' && /^[0-9a-f]{64}$/.test(t[1] ?? '') && !(t[1] === config.labeler && !t[2]))?.[1];
      const content = cleanDisplay(e.content, REPORT_CONTENT_KEEP);
      let merged = false;
      let added = false;
      for (const r of parsed) {
        const key = store.reportKey({ reporter: e.pubkey, target: r.target, type: r.type });
        const existing = store.getReport(key);
        if (existing) {
          merged = true;
          if (e.created_at > existing.createdAt) {
            existing.duplicates.push(existing.id);
            existing.id = e.id;
            existing.createdAt = e.created_at;
            existing.content = content;
          } else existing.duplicates.push(e.id);
          store.putReport(existing);
          continue;
        }
        added = true;
        const caseId = caseIdFor(r.target);
        let c = store.getCase(caseId);
        if (!c) {
          c = { id: caseId, target: r.target, status: 'open', openedAt: now, updatedAt: now, reportIds: [], reporters: [], trustedReporters: [], types: {}, labelIds: [], escalations: [] } satisfies CaseRecord;
          stats.casesOpened++;
        }
        const newReporter = !c.reporters.includes(e.pubkey);
        if (newReporter) c.reporters.push(e.pubkey);
        if (newReporter && trusted.has(e.pubkey)) c.trustedReporters.push(e.pubkey);
        c.types[r.type] = (c.types[r.type] ?? 0) + 1;
        c.reportIds.push(e.id);
        c.updatedAt = now;
        // A dismissed case comes back when someone new reports it; a labeled one stays labeled.
        if (c.status === 'dismissed' && newReporter) {
          c.status = 'open';
          delete c.resolvedAt;
          stats.casesReopened++;
          store.audit({ at: now, actor: 'system', actorKind: 'system', action: 'reopen', caseId, targets: [c.target], reason: 'new report from a different reporter after dismissal' });
        }
        store.putCase(c);
        const rec: ReportRecord = {
          id: e.id,
          reporter: e.pubkey,
          createdAt: e.created_at,
          receivedAt: now,
          type: r.type as ReportType,
          target: r.target,
          content,
          caseId,
          trusted: trusted.has(e.pubkey),
          duplicates: [],
          ...(reportedPubkey ? { pubkey: reportedPubkey } : {}),
        };
        store.putReport(rec);
        touched.add(caseId);
        daily[r.type] = (daily[r.type] ?? 0) + 1;
      }
      if (!added && merged) return 'merged';
      rs.recent.push(now);
      store.putReporter(rs);
      return 'accepted';
    });
    stats[outcome]++;
  }
  recordDailyStats(store, now, stats, daily);
  return { stats, touched: [...touched] };
}

/** Aggregate counters per UTC day, kept after report records are purged (transparency reports). */
function recordDailyStats(store: LabelerStore, now: number, s: IntakeStats, byType: Record<string, number>): void {
  if (!s.received) return;
  const day = new Date(now * 1000).toISOString().slice(0, 10);
  const key = `stats:${day}`;
  const prev = store.getMeta<DailyStats>(key) ?? { day, received: 0, accepted: 0, rateLimited: 0, rejected: 0, byType: {} };
  prev.received += s.received - s.duplicate;
  prev.accepted += s.accepted;
  prev.rateLimited += s.rateLimited;
  prev.rejected += s.invalid + s.notAddressed + s.ignoredReporter + s.tooOld + s.future;
  for (const [k, v] of Object.entries(byType)) prev.byType[k] = (prev.byType[k] ?? 0) + v;
  store.setMeta(key, prev);
}

export interface DailyStats {
  day: string;
  received: number;
  accepted: number;
  rateLimited: number;
  rejected: number;
  byType: Record<string, number>;
}

/**
 * Auto-blur (off by default): a temporary `!warn` on a reported video event once
 * `threshold` distinct trusted reporters reported it. Blur only, with an expiry;
 * the case stays open for a human.
 */
export async function autoBlur(ctx: LabelerContext, config: LabelerConfig, caseIds: readonly string[], now: number): Promise<{ labeled: string[]; errors: string[] }> {
  const labeled: string[] = [];
  const errors: string[] = [];
  if (!config.autoBlur.enabled) return { labeled, errors };
  const active = activeLabels(ctx.store, now);
  for (const id of caseIds) {
    const c = ctx.store.getCase(id);
    if (!c || c.status !== 'open' || c.autoBlurId) continue;
    if (c.trustedReporters.length < config.autoBlur.threshold) continue;
    const target = targetFromKey(c.target);
    // Only single video events: never a whole creator, list or instance.
    if (!target || target.type !== 'e') continue;
    if (active.some((l) => l.targets.some((t) => t.type === target.type && t.value === target.value))) continue;
    const types = Object.keys(c.types).join(', ');
    try {
      await issueLabel(ctx, {
        targets: [target],
        values: ['!warn'],
        reason: `Automatic temporary warning: ${c.trustedReporters.length} trusted reporters reported this (${types}). A human will review it.`,
        expiresAt: now + config.autoBlur.ttlHours * 3600,
        reviewer: 'auto-blur',
        caseId: c.id,
        automated: true,
      });
      labeled.push(c.id);
    } catch (err) {
      errors.push(`auto-blur ${c.id}: ${(err as Error).message}`);
    }
  }
  return { labeled, errors };
}

export type QueryFn = (relay: string, filter: Record<string, unknown>) => Promise<NostrEvent[]>;

export interface RunIntakeOptions {
  config: LabelerConfig;
  store: LabelerStore;
  /** Needed only for auto-blur. */
  ctx?: LabelerContext;
  relayOptions?: RelayOptions;
  /** Defaults to packages/bridge's `query` (NIP-42 aware, retries). */
  query?: QueryFn;
  now?: number;
  /** Re-read this far back each run (seconds; default 2 days), since reports can be backdated. Dedupe makes it safe. */
  lookback?: number;
}

/** Read new reports from every intake relay and queue them. Relay errors are collected, not thrown. */
export async function runIntake(opts: RunIntakeOptions): Promise<IntakeStats> {
  const { config, store } = opts;
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  if (!config.intakeRelays.length) throw new Error('no intake relays configured (config.intakeRelays)');
  const q: QueryFn = opts.query ?? ((relay, filter) => query(relay, filter, opts.relayOptions) as Promise<NostrEvent[]>);
  const last = store.getMeta<number>('intake.lastRun');
  const floor = now - config.maxReportAgeDays * DAY;
  const since = Math.max(floor, last !== undefined ? last - (opts.lookback ?? 2 * DAY) : floor);
  const filter = { kinds: [KIND_REPORT], '#p': [config.labeler], since, limit: 2000 };
  const errors: string[] = [];
  const all = new Map<string, NostrEvent>();
  await Promise.all(
    config.intakeRelays.map(async (relay) => {
      try {
        for (const e of await q(relay, filter)) if (e && typeof e.id === 'string' && !all.has(e.id)) all.set(e.id, e);
      } catch (err) {
        errors.push(`${relay}: ${(err as Error).message}`);
      }
    }),
  );
  const { stats, touched } = ingestReports([...all.values()], { config, store, now });
  stats.errors.push(...errors);
  if (errors.length < config.intakeRelays.length) store.setMeta('intake.lastRun', now);
  if (opts.ctx && config.autoBlur.enabled) {
    const r = await autoBlur(opts.ctx, config, touched, now);
    stats.autoBlurred = r.labeled.length;
    stats.errors.push(...r.errors);
  }
  return stats;
}

/** Open cases, most urgent first: `illegal` reports, then trusted reporters, then reporters, then age. */
export function reviewQueue(store: LabelerStore): CaseRecord[] {
  return store.cases('open').sort(
    (a, b) =>
      Number(!!b.types.illegal) - Number(!!a.types.illegal) ||
      b.trustedReporters.length - a.trustedReporters.length ||
      b.reporters.length - a.reporters.length ||
      a.openedAt - b.openedAt,
  );
}

/**
 * Retention: delete report records (reporter text and pubkeys) for cases resolved
 * more than `retention.resolvedReportDays` ago, dedupe ids older than the report
 * age limit, and idle rate-limit state. Cases keep counts; the audit log is kept.
 */
export function purge(store: LabelerStore, config: LabelerConfig, now = Math.floor(Date.now() / 1000)): { reports: number; seen: number; reporters: number } {
  const out = { reports: 0, seen: 0, reporters: 0 };
  store.tx(() => {
    const cutoff = now - config.retention.resolvedReportDays * DAY;
    for (const r of store.reports()) {
      const c = store.getCase(r.caseId);
      if (c && c.status !== 'open' && c.resolvedAt !== undefined && c.resolvedAt < cutoff) {
        store.deleteReport(store.reportKey(r));
        out.reports++;
      }
    }
    const seenCutoff = now - (config.maxReportAgeDays + 1) * DAY;
    for (const s of store.seenEntries()) if (s.at < seenCutoff) (store.deleteSeen(s.id), out.seen++);
    for (const rs of store.reporterStates()) {
      if (!rs.recent.some((t) => t > now - DAY)) (store.deleteReporter(rs.pubkey), out.reporters++);
    }
    store.audit({ at: now, actor: 'system', actorKind: 'system', action: 'purge', details: out });
  });
  return out;
}
