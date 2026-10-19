// NIP-56 reports (kind 1984), checked against
// https://raw.githubusercontent.com/nostr-protocol/nips/master/56.md on 2026-10-19.
//
// The package only BUILDS unsigned report events. The app shows the report to the
// user, signs it with the user's key and publishes it to relays the user chose.
// Nothing here signs or sends.

import type { EventTemplate, NostrEvent } from './types.ts';
import { HEX64, cleanDisplay } from './text.ts';

export const KIND_REPORT = 1984;

/** The report types NIP-56 defines, in its order. */
export const REPORT_TYPES = ['nudity', 'malware', 'profanity', 'illegal', 'spam', 'impersonation', 'other'] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

/** UI copy for each type (from the NIP's own descriptions). */
export const REPORT_TYPE_LABELS: Readonly<Record<ReportType, string>> = {
  nudity: 'Nudity or sexual content',
  malware: 'Malware or a malicious link',
  profanity: 'Profanity or hateful speech',
  illegal: 'Something that may be illegal',
  spam: 'Spam',
  impersonation: 'Pretending to be someone else',
  other: 'Something else',
};

/** Max length of the free-text `content` we let users attach. */
export const REPORT_CONTENT_MAX = 2000;

/**
 * What is being reported.
 * - `video`: a NIP-71 video event (kinds 21/22/34235/34236), e.g. one published by
 *   `packages/bridge`. `pubkey` is the event's author.
 * - `creator`: a person's key (profile report).
 * - `taste-list`: a public taste list, a NIP-51 video curation set (kind 30005).
 *
 * A PeerTube video that has no Nostr event can't be reported over NIP-56 (the NIP
 * requires a `p` tag); report it to its instance (`peertube.ts`) instead.
 */
export type ReportTarget =
  | { type: 'video'; eventId: string; pubkey: string; address?: string; relay?: string }
  | { type: 'creator'; pubkey: string; relay?: string }
  | { type: 'taste-list'; eventId: string; pubkey: string; address?: string; relay?: string };

export interface BuildReportOptions {
  /** Free text from the reporter. Control and bidi characters are stripped. */
  content?: string;
  /** Unix seconds; default now. */
  createdAt?: number;
  /**
   * Optional NIP-32 qualification (the NIP allows `L`/`l` tags), e.g.
   * `{ namespace: "social.nos.ontology", value: "NS-nud" }`.
   */
  label?: { namespace: string; value: string };
  /**
   * Add an `a` tag for addressable targets (default true). NIP-56 defines only
   * `e`, `p` and `x`; the `a` tag lets labelers find every version of an
   * addressable event and is ignored by clients that don't know it.
   */
  includeAddress?: boolean;
}

const ADDRESS = /^(\d{1,5}):([0-9a-f]{64}):(.{0,512})$/s;

function check(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new TypeError(msg);
}

/** Build an unsigned NIP-56 report. Throws on malformed targets. */
export function buildReport(target: ReportTarget, type: ReportType, opts: BuildReportOptions = {}): EventTemplate {
  check(REPORT_TYPES.includes(type), `unknown report type: ${String(type)}`);
  check(HEX64.test(target.pubkey), 'pubkey must be 64 lowercase hex characters');
  check(!target.relay || /^wss?:\/\//.test(target.relay), 'relay hint must be a ws(s):// URL');
  const hint = target.relay ? [target.relay] : [];
  const tags: string[][] = [];
  if (target.type === 'creator') {
    tags.push(['p', target.pubkey, type]);
  } else {
    check(type !== 'impersonation', 'impersonation is a profile report: report the creator instead');
    check(HEX64.test(target.eventId), 'eventId must be 64 lowercase hex characters');
    // NIP-56: "If reporting a note, an `e` tag MUST also be included"; the report
    // type goes on the tag being reported.
    tags.push(['e', target.eventId, type, ...hint]);
    tags.push(['p', target.pubkey]);
    if (target.address && opts.includeAddress !== false) {
      const m = ADDRESS.exec(target.address);
      check(m && m[2] === target.pubkey, 'address must be <kind>:<author pubkey>:<d>');
      if (target.type === 'taste-list') check(m[1] === '30005', 'a taste list is a kind 30005 curation set');
      tags.push(['a', target.address, ...hint]);
    }
  }
  if (opts.label) {
    const ns = cleanDisplay(opts.label.namespace, 128);
    const v = cleanDisplay(opts.label.value, 128);
    check(ns && v, 'label namespace and value must be non-empty');
    tags.push(['L', ns], ['l', v, ns]);
  }
  return {
    kind: KIND_REPORT,
    created_at: opts.createdAt ?? Math.floor(Date.now() / 1000),
    tags,
    content: cleanDisplay(opts.content ?? '', REPORT_CONTENT_MAX),
  };
}

/** A parsed report, for clients that use reports from people they trust (NIP-56 "Client behavior"). */
export interface ParsedReport {
  id: string;
  reporter: string;
  createdAt: number;
  type: ReportType;
  /** `e:<id>` or `p:<pubkey>` (or `x:<hash>`), the thing reported. */
  target: string;
  /** The reported author (`p`). */
  pubkey?: string;
}

/** Read the reported target(s) out of a kind-1984 event. Unknown types count as `other`. */
export function parseReport(e: NostrEvent): ParsedReport[] {
  if (e.kind !== KIND_REPORT) return [];
  const out: ParsedReport[] = [];
  const p = e.tags.find((t) => t[0] === 'p' && HEX64.test(t[1] ?? ''))?.[1];
  for (const t of e.tags) {
    if ((t[0] === 'e' || t[0] === 'p' || t[0] === 'x') && t[1] && t[2]) {
      const type = (REPORT_TYPES as readonly string[]).includes(t[2]) ? (t[2] as ReportType) : 'other';
      out.push({ id: e.id, reporter: e.pubkey, createdAt: e.created_at, type, target: `${t[0]}:${t[1]}`, pubkey: p });
    }
  }
  return out;
}
