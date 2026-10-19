// The labeler's vocabulary IS packages/moderation's `match-feed.moderation`
// rules. Nothing is redefined here: values, titles and default actions are read
// from DEFAULT_LABEL_RULES, so a value the moderation package does not know
// can't be issued.

import { DEFAULT_LABEL_RULES, MATCH_FEED_NAMESPACE } from './deps.ts';
import type { LabelRule } from './deps.ts';

export const NAMESPACE = MATCH_FEED_NAMESPACE;

export interface VocabularyEntry {
  value: string;
  title: string;
  /** What clients do with default settings. */
  action: 'hide' | 'blur' | 'label';
  /** When set, the viewer's NSFW / violence setting decides (hide, blur or show). */
  category?: 'nsfw' | 'violence';
}

export const VOCABULARY: readonly VocabularyEntry[] = Object.freeze(
  DEFAULT_LABEL_RULES.filter((r: LabelRule) => r.namespace === MATCH_FEED_NAMESPACE && !r.value.includes('*')).map((r: LabelRule) => {
    const e: VocabularyEntry = { value: r.value, title: r.title ?? r.value, action: r.action === 'ignore' ? 'label' : r.action };
    if (r.category) e.category = r.category;
    return Object.freeze(e);
  }),
);

const BY_VALUE = new Map(VOCABULARY.map((e) => [e.value, e]));

export function vocabularyEntry(value: string): VocabularyEntry | undefined {
  return BY_VALUE.get(value);
}

/** Throws unless every value is in the moderation package's vocabulary. Returns them deduplicated. */
export function checkValues(values: readonly string[]): string[] {
  if (!values.length) throw new TypeError('at least one label value is needed');
  const out: string[] = [];
  for (const v of values) {
    if (!BY_VALUE.has(v)) throw new TypeError(`unknown label value "${v}"; known: ${VOCABULARY.map((e) => e.value).join(', ')}`);
    if (!out.includes(v)) out.push(v);
  }
  return out;
}

/** Strongest default effect of a set of values (hide > blur > label), for summaries. */
export function strongestAction(values: readonly string[]): 'hide' | 'blur' | 'label' {
  const rank = { label: 1, blur: 2, hide: 3 } as const;
  let best: 'hide' | 'blur' | 'label' = 'label';
  for (const v of values) {
    const a = BY_VALUE.get(v)?.action ?? 'label';
    if (rank[a] > rank[best]) best = a;
  }
  return best;
}

/** Values that mean "possibly illegal": they need a legal ground and an escalation check. */
export const ILLEGAL_VALUES: ReadonlySet<string> = new Set(['illegal']);

/** NIP-56 report type → suggested label value(s), shown to reviewers as a hint only. */
export const REPORT_TYPE_HINTS: Readonly<Record<string, readonly string[]>> = {
  nudity: ['nudity', 'sexual', 'porn'],
  malware: ['malware'],
  profanity: ['profanity', 'hate'],
  illegal: ['illegal'],
  spam: ['spam', 'scam'],
  impersonation: ['impersonation'],
  other: [],
};
