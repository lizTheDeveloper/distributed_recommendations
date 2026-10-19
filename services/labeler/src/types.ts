// Records the labeler keeps. All JSON-serializable.

import type { NostrEvent, ReportType } from './deps.ts';
import type { PublishResult } from './deps.ts';
import type { Target } from './targets.ts';

export type CaseStatus = 'open' | 'labeled' | 'dismissed';

/** One NIP-56 report addressed to the labeler (deduplicated per reporter, target and type). */
export interface ReportRecord {
  /** Event id of the most recent report from this reporter for this target and type. */
  id: string;
  reporter: string;
  createdAt: number;
  receivedAt: number;
  type: ReportType;
  /** `e:<id>`, `p:<pubkey>` or `x:<hash>`. */
  target: string;
  /** The reported author (`p` tag), when the target is an event. */
  pubkey?: string;
  /** The reporter's free text (display-safe, capped). Personal data: purged by retention. */
  content: string;
  caseId: string;
  trusted: boolean;
  /** Earlier report event ids folded into this one. */
  duplicates: string[];
}

/** Escalation to someone with the power or the duty to act (instance operator, hotline, police). */
export interface Escalation {
  to: 'instance' | 'ncmec' | 'iwf' | 'inhope' | 'law-enforcement' | 'other';
  at: number;
  by: string;
  /** Ticket or report number from the receiving side. Never the material itself. */
  reference?: string;
}

/** The review queue item: every report about one target. */
export interface CaseRecord {
  id: string;
  target: string;
  status: CaseStatus;
  openedAt: number;
  updatedAt: number;
  reportIds: string[];
  /** Distinct reporters, and how many of them are trusted. */
  reporters: string[];
  trustedReporters: string[];
  types: Partial<Record<ReportType, number>>;
  labelIds: string[];
  autoBlurId?: string;
  escalations: Escalation[];
  resolvedAt?: number;
}

export interface LabelRecord {
  /** The kind-1985 event id. */
  id: string;
  event: NostrEvent;
  namespace: string;
  values: string[];
  targets: Target[];
  /** Public reason (the event's content). */
  reason: string;
  /** Internal note, never published. */
  note?: string;
  /** For `illegal`: the law relied on (DSA Art. 17(3)(d)). Not published in the event. */
  legalGround?: string;
  expiresAt?: number;
  reviewer: string;
  automated: boolean;
  decidedAt: number;
  caseId?: string;
  relays: PublishResult[];
  retraction?: { eventId: string; at: number; by: string; reason: string; relays: PublishResult[] };
}

export type AuditAction = 'label' | 'retract' | 'dismiss' | 'reopen' | 'escalate' | 'auto-blur' | 'purge' | 'intake';

export interface AuditEntry {
  seq: number;
  at: number;
  actor: string;
  actorKind: 'human' | 'automated' | 'system';
  action: AuditAction;
  caseId?: string;
  labelId?: string;
  targets?: string[];
  values?: string[];
  reason?: string;
  details?: Record<string, unknown>;
  /** sha256 hex of the previous entry (`0`×64 for the first). */
  prev: string;
  /** sha256 hex over prev and this entry's other fields: a tamper-evident chain. */
  hash: string;
}

export interface ReporterState {
  pubkey: string;
  /** When (our clock) this reporter's reports were accepted in the last 24 h. */
  recent: number[];
  dropped: number;
}
