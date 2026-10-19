// Exports for transparency reports.
//
// `statementsOfReasons` follows the structure of EU DSA Art. 17(3) (Regulation
// (EU) 2022/2065): what restriction, facts and circumstances (and whether a
// notice prompted it), use of automated means, the legal or contractual ground,
// and redress. A labeler that only publishes its own labels is probably not a
// "hosting service" under Art. 3(g)(iii), so Art. 17 may not bind it; the
// format is used because it is the recognised one. See README "Transparency".
//
// Public exports (`public: true`) leave out targets and reviewer names, in the
// spirit of Art. 24(5) ("no personal data" in submissions to the Commission's
// database).

import { createHmac, randomBytes } from 'node:crypto';
import { toNpub } from './deps.ts';
import type { LabelerConfig } from './config.ts';
import type { DailyStats } from './intake.ts';
import type { LabelerStore } from './repo.ts';
import { verifyAuditChain } from './store.ts';
import { subjectKind, targetKey } from './targets.ts';
import type { AuditEntry, LabelRecord } from './types.ts';
import { ILLEGAL_VALUES, strongestAction, vocabularyEntry } from './vocabulary.ts';

export interface Period {
  since?: number;
  until?: number;
}

const inPeriod = (t: number, p: Period) => (p.since === undefined || t >= p.since) && (p.until === undefined || t < p.until);
const iso = (t: number) => new Date(t * 1000).toISOString();

export interface StatementOfReasons {
  decision_id: string;
  decision_date: string;
  labeler: string;
  /** Art. 17(3)(a): the restriction. Labels restrict visibility on subscribed clients only. */
  restriction: 'visibility';
  visibility_effect: 'hide' | 'blur' | 'label';
  viewer_controlled: boolean;
  labels: { value: string; title: string }[];
  subject_kinds: string[];
  targets?: string[];
  territorial_scope: string;
  duration: string;
  /** Art. 17(3)(b) */
  facts_and_circumstances: string;
  source: 'notice' | 'own_initiative';
  notices: number;
  /** Art. 17(3)(c) */
  automated_detection: boolean;
  automated_decision: boolean;
  /** Art. 17(3)(d)/(e) */
  ground: 'illegal_content' | 'incompatible_with_policy';
  legal_ground?: string;
  policy_ground?: string;
  /** Art. 17(3)(f) */
  redress: string;
  retracted_at?: string;
  retraction_reason?: string;
  reviewer?: string;
}

export function statementOfReasons(l: LabelRecord, store: LabelerStore, config: LabelerConfig, opts: { public?: boolean } = {}): StatementOfReasons {
  const c = l.caseId ? store.getCase(l.caseId) : undefined;
  const notices = c?.reportIds.length ?? 0;
  const illegal = l.values.some((v) => ILLEGAL_VALUES.has(v));
  const redress = [
    config.appealUrl ? `Ask us to review this decision: ${config.appealUrl}` : config.contact ? `Ask us to review this decision: ${config.contact}` : 'Contact the labeler operator to ask for a review',
    'a certified out-of-court dispute settlement body (DSA Art. 21) where applicable',
    'the courts',
    'and, for the content itself, the instance that hosts it',
  ].join('; ');
  const s: StatementOfReasons = {
    decision_id: l.id,
    decision_date: iso(l.decidedAt),
    labeler: toNpub(l.event.pubkey),
    restriction: 'visibility',
    visibility_effect: strongestAction(l.values),
    viewer_controlled: l.values.some((v) => !!vocabularyEntry(v)?.category),
    labels: l.values.map((v) => ({ value: v, title: vocabularyEntry(v)?.title ?? v })),
    subject_kinds: [...new Set(l.targets.map(subjectKind))],
    territorial_scope: 'worldwide, on clients whose users subscribed to this labeler; the content is not removed',
    duration: l.expiresAt ? `until ${iso(l.expiresAt)}` : 'until retracted',
    facts_and_circumstances: l.reason,
    source: notices ? 'notice' : 'own_initiative',
    notices,
    automated_detection: false,
    automated_decision: l.automated,
    ground: illegal ? 'illegal_content' : 'incompatible_with_policy',
    redress,
  };
  if (illegal && l.legalGround) s.legal_ground = l.legalGround;
  if (config.policyUrl) s.policy_ground = `${config.policyUrl}#${l.values.join(',')}`;
  if (l.retraction) {
    s.retracted_at = iso(l.retraction.at);
    s.retraction_reason = l.retraction.reason;
  }
  if (!opts.public) {
    s.targets = l.targets.map(targetKey);
    s.reviewer = l.reviewer;
  }
  return s;
}

export function statementsOfReasons(store: LabelerStore, config: LabelerConfig, opts: Period & { public?: boolean } = {}): StatementOfReasons[] {
  return store
    .labels()
    .filter((l) => inPeriod(l.decidedAt, opts))
    .map((l) => statementOfReasons(l, store, config, opts));
}

export interface TransparencySummary {
  period: { since?: string; until?: string };
  labeler: string;
  reports: { received: number; accepted: number; rateLimited: number; rejected: number; byType: Record<string, number> };
  decisions: {
    labels: number;
    byValue: Record<string, number>;
    bySubject: Record<string, number>;
    byEffect: Record<string, number>;
    automated: number;
    fromNotices: number;
    ownInitiative: number;
    retractions: number;
    dismissals: number;
    escalations: Record<string, number>;
    /** Median hours from a case opening to a human label or dismissal. */
    medianHoursToDecision?: number;
  };
  openCasesNow: number;
  auditChain: 'intact' | string;
}

export function transparencySummary(store: LabelerStore, config: LabelerConfig, p: Period = {}): TransparencySummary {
  const reports = { received: 0, accepted: 0, rateLimited: 0, rejected: 0, byType: {} as Record<string, number> };
  for (const d of store.driver.list('meta') as unknown[]) {
    const s = d as DailyStats;
    if (!s || typeof s !== 'object' || typeof s.day !== 'string') continue;
    const t = Date.parse(`${s.day}T00:00:00Z`) / 1000;
    if (!inPeriod(t, p)) continue;
    reports.received += s.received;
    reports.accepted += s.accepted;
    reports.rateLimited += s.rateLimited;
    reports.rejected += s.rejected;
    for (const [k, v] of Object.entries(s.byType)) reports.byType[k] = (reports.byType[k] ?? 0) + v;
  }
  const count = (o: Record<string, number>, k: string) => (o[k] = (o[k] ?? 0) + 1);
  const labels = store.labels().filter((l) => inPeriod(l.decidedAt, p));
  const decisions: TransparencySummary['decisions'] = {
    labels: labels.length,
    byValue: {},
    bySubject: {},
    byEffect: {},
    automated: 0,
    fromNotices: 0,
    ownInitiative: 0,
    retractions: 0,
    dismissals: 0,
    escalations: {},
  };
  for (const l of labels) {
    l.values.forEach((v) => count(decisions.byValue, v));
    new Set(l.targets.map(subjectKind)).forEach((k) => count(decisions.bySubject, k));
    count(decisions.byEffect, strongestAction(l.values));
    if (l.automated) decisions.automated++;
    if (l.caseId && store.getCase(l.caseId)?.reportIds.length) decisions.fromNotices++;
    else decisions.ownInitiative++;
  }
  const audit = store.auditLog();
  const hours: number[] = [];
  for (const e of audit) {
    if (!inPeriod(e.at, p)) continue;
    if (e.action === 'retract') decisions.retractions++;
    if (e.action === 'dismiss') decisions.dismissals++;
    if (e.action === 'escalate') count(decisions.escalations, String(e.details?.to ?? 'other'));
    if ((e.action === 'label' || e.action === 'dismiss') && e.caseId) {
      const c = store.getCase(e.caseId);
      if (c) hours.push((e.at - c.openedAt) / 3600);
    }
  }
  if (hours.length) {
    hours.sort((a, b) => a - b);
    const m = hours.length >> 1;
    decisions.medianHoursToDecision = Math.round((hours.length % 2 ? hours[m] : (hours[m - 1] + hours[m]) / 2) * 10) / 10;
  }
  const chain = verifyAuditChain(audit);
  return {
    period: { ...(p.since !== undefined ? { since: iso(p.since) } : {}), ...(p.until !== undefined ? { until: iso(p.until) } : {}) },
    labeler: toNpub(config.labeler),
    reports,
    decisions,
    openCasesNow: store.cases('open').length,
    auditChain: chain.ok ? 'intact' : `BROKEN at seq ${chain.seq}: ${chain.why}`,
  };
}

/** Audit entries for a period; `public` replaces reviewer names with a stable pseudonym and drops targets and internal notes. */
export function exportAudit(store: LabelerStore, opts: Period & { public?: boolean } = {}): AuditEntry[] {
  const pseudonym = (name: string) => `reviewer-${createHmac('sha256', pseudonymKey(store)).update(name).digest('hex').slice(0, 10)}`;
  return store
    .auditLog()
    .filter((e) => inPeriod(e.at, opts))
    .map((e) => {
      if (!opts.public) return e;
      // Targets (pubkeys, URLs) and internal notes are left out, so the public
      // copy no longer verifies against the hash chain; the full export does.
      const { details, targets: _t, ...rest } = e;
      const pub: AuditEntry = { ...rest, actor: e.actorKind === 'human' ? pseudonym(e.actor) : e.actor };
      if (details) {
        const { note: _n, ...d } = details;
        pub.details = d;
      }
      return pub;
    });
}

/** A random key, kept in the store, so pseudonyms are stable but can't be reversed by guessing names. */
function pseudonymKey(store: LabelerStore): Buffer {
  let k = store.getMeta<string>('audit.pseudonymKey');
  if (!k) {
    k = randomBytes(32).toString('hex');
    store.setMeta('audit.pseudonymKey', k);
  }
  return Buffer.from(k, 'hex');
}

/** RFC 4180 CSV. Nested values are JSON. Cells starting with = + - @ are prefixed with ' (spreadsheet injection). */
export function toCsv(rows: readonly object[]): string {
  if (!rows.length) return '';
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const cell = (v: unknown) => {
    if (v === undefined || v === null) return '';
    let s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => cell((r as Record<string, unknown>)[c])).join(','))].join('\r\n') + '\r\n';
}
