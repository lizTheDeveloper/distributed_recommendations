// Labeler configuration: a JSON file with no secrets in it. Keys come from the
// environment (see signer.ts). Parsing is strict: unknown keys are rejected, as
// in packages/moderation's policy parser.

import { readFileSync } from 'node:fs';
import { parsePubkey } from './deps.ts';

export interface LabelerConfig {
  v: 1;
  /** The labeler's public key (hex). The signer must produce this key. */
  labeler: string;
  /** Where labels and retractions are published. */
  publishRelays: string[];
  /** Where reports (kind 1984, `#p` = labeler) are read from. */
  intakeRelays: string[];
  /** SQLite path, or a `.json` path for the JSON store. */
  store: string;
  rateLimit: {
    /** Reports accepted per reporter per 24 h (by the report's created_at). */
    perDay: number;
    /** Open reports one reporter may have in the queue at once. */
    maxOpen: number;
  };
  /** Reports older than this are ignored (days). */
  maxReportAgeDays: number;
  /** Reporters whose reports count toward auto-blur (hex). Also highlighted in the queue. */
  trustedReporters: string[];
  /** Reporters whose reports are dropped (abusive reporting). */
  ignoredReporters: string[];
  autoBlur: {
    /** Off by default. Humans decide; this only adds a temporary warning. */
    enabled: boolean;
    /** Independent trusted reporters needed. */
    threshold: number;
    /** How long the automatic warning lasts unless a human confirms it. */
    ttlHours: number;
  };
  retention: {
    /** Delete report records (including reporter text) this many days after their case is resolved. */
    resolvedReportDays: number;
  };
  /** Who reviewers are (names used in the audit log). Empty = any non-empty name. */
  reviewers: string[];
  /** Shown in transparency exports (DSA Art. 17(3)(f) redress information). */
  contact?: string;
  policyUrl?: string;
  appealUrl?: string;
}

export const DEFAULT_CONFIG: Omit<LabelerConfig, 'labeler'> = {
  v: 1,
  publishRelays: [],
  intakeRelays: [],
  store: './data/labeler.sqlite',
  rateLimit: { perDay: 20, maxOpen: 50 },
  maxReportAgeDays: 30,
  trustedReporters: [],
  ignoredReporters: [],
  autoBlur: { enabled: false, threshold: 3, ttlHours: 72 },
  retention: { resolvedReportDays: 90 },
  reviewers: [],
};

const KEYS = ['v', 'labeler', 'publishRelays', 'intakeRelays', 'store', 'rateLimit', 'maxReportAgeDays', 'trustedReporters', 'ignoredReporters', 'autoBlur', 'retention', 'reviewers', 'contact', 'policyUrl', 'appealUrl'];

function obj(o: unknown, path: string, keys: readonly string[]): Record<string, unknown> {
  if (!o || typeof o !== 'object' || Array.isArray(o)) throw new TypeError(`${path}: expected an object`);
  for (const k of Object.keys(o)) if (!keys.includes(k)) throw new TypeError(`${path}.${k}: unknown key`);
  return o as Record<string, unknown>;
}

function int(v: unknown, path: string, min: number, max: number, d: number): number {
  if (v === undefined) return d;
  if (!Number.isInteger(v) || (v as number) < min || (v as number) > max) throw new TypeError(`${path}: integer ${min}–${max}`);
  return v as number;
}

function relays(v: unknown, path: string): string[] {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.length > 16) throw new TypeError(`${path}: at most 16 relay URLs`);
  return v.map((u, i) => {
    if (typeof u !== 'string' || !/^wss?:\/\/[^\s]+$/.test(u)) throw new TypeError(`${path}[${i}]: ws(s):// URL`);
    return u;
  });
}

function keys(v: unknown, path: string): string[] {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.length > 1000) throw new TypeError(`${path}: at most 1000 keys`);
  return [...new Set(v.map((k, i) => {
    if (typeof k !== 'string') throw new TypeError(`${path}[${i}]: npub or hex`);
    return parsePubkey(k);
  }))];
}

function optStr(v: unknown, path: string, max = 300): string | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== 'string' || !v || v.length > max) throw new TypeError(`${path}: 1–${max} characters`);
  return v;
}

export function parseConfig(json: unknown): LabelerConfig {
  const o = obj(json, 'config', KEYS);
  if (o.v !== 1) throw new TypeError('config.v: must be 1');
  if (typeof o.labeler !== 'string') throw new TypeError('config.labeler: the labeler npub or hex pubkey');
  const rl = o.rateLimit === undefined ? {} : obj(o.rateLimit, 'config.rateLimit', ['perDay', 'maxOpen']);
  const ab = o.autoBlur === undefined ? {} : obj(o.autoBlur, 'config.autoBlur', ['enabled', 'threshold', 'ttlHours']);
  const rt = o.retention === undefined ? {} : obj(o.retention, 'config.retention', ['resolvedReportDays']);
  if (ab.enabled !== undefined && typeof ab.enabled !== 'boolean') throw new TypeError('config.autoBlur.enabled: boolean');
  const c: LabelerConfig = {
    v: 1,
    labeler: parsePubkey(o.labeler),
    publishRelays: relays(o.publishRelays, 'config.publishRelays'),
    intakeRelays: relays(o.intakeRelays, 'config.intakeRelays'),
    store: optStr(o.store, 'config.store', 1024) ?? DEFAULT_CONFIG.store,
    rateLimit: {
      perDay: int(rl.perDay, 'config.rateLimit.perDay', 1, 10_000, DEFAULT_CONFIG.rateLimit.perDay),
      maxOpen: int(rl.maxOpen, 'config.rateLimit.maxOpen', 1, 100_000, DEFAULT_CONFIG.rateLimit.maxOpen),
    },
    maxReportAgeDays: int(o.maxReportAgeDays, 'config.maxReportAgeDays', 1, 3650, DEFAULT_CONFIG.maxReportAgeDays),
    trustedReporters: keys(o.trustedReporters, 'config.trustedReporters'),
    ignoredReporters: keys(o.ignoredReporters, 'config.ignoredReporters'),
    autoBlur: {
      enabled: (ab.enabled as boolean | undefined) ?? false,
      // At least 2: one reporter alone must never trigger anything.
      threshold: int(ab.threshold, 'config.autoBlur.threshold', 2, 1000, DEFAULT_CONFIG.autoBlur.threshold),
      ttlHours: int(ab.ttlHours, 'config.autoBlur.ttlHours', 1, 24 * 30, DEFAULT_CONFIG.autoBlur.ttlHours),
    },
    retention: { resolvedReportDays: int(rt.resolvedReportDays, 'config.retention.resolvedReportDays', 1, 3650, DEFAULT_CONFIG.retention.resolvedReportDays) },
    reviewers: (() => {
      if (o.reviewers === undefined) return [];
      if (!Array.isArray(o.reviewers)) throw new TypeError('config.reviewers: array of names');
      return o.reviewers.map((r, i) => optStr(r, `config.reviewers[${i}]`, 64)!);
    })(),
  };
  const contact = optStr(o.contact, 'config.contact');
  const policyUrl = optStr(o.policyUrl, 'config.policyUrl');
  const appealUrl = optStr(o.appealUrl, 'config.appealUrl');
  if (contact) c.contact = contact;
  if (policyUrl) c.policyUrl = policyUrl;
  if (appealUrl) c.appealUrl = appealUrl;
  if (c.trustedReporters.some((k) => c.ignoredReporters.includes(k))) throw new TypeError('config: a reporter cannot be both trusted and ignored');
  return c;
}

export function loadConfig(path: string): LabelerConfig {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    throw new Error(`cannot read config ${path}: ${(err as Error).message}`);
  }
  return parseConfig(JSON.parse(text));
}

/** Reviewer names: non-empty, display-safe, and in `config.reviewers` when that list is set. */
export function checkReviewer(name: string | undefined, config: Pick<LabelerConfig, 'reviewers'>): string {
  const n = (name ?? '').trim();
  if (!n || n.length > 64 || /[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/.test(n)) {
    throw new TypeError('a reviewer name is required (--reviewer or LABELER_REVIEWER), 1–64 printable characters');
  }
  if (config.reviewers.length && !config.reviewers.includes(n)) throw new TypeError(`reviewer "${n}" is not in config.reviewers`);
  if (n === 'auto-blur' || n === 'system') throw new TypeError(`"${n}" is reserved`);
  return n;
}
