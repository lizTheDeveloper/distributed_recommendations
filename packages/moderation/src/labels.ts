// NIP-32 labels (kind 1985), checked against
// https://raw.githubusercontent.com/nostr-protocol/nips/master/32.md on 2026-10-19.
//
// The viewer subscribes to labelers by npub. We fetch the labelers' kind-1985
// events (and their NIP-09 deletions) from relays the viewer configured, verify
// them, and build an index from target to labels. Matching is on the device.
//
// Privacy: the REQ filters by labeler (`authors`) only, never by the videos on
// screen, so relays learn which labelers you follow, not what you watch.

import type { EventTemplate, NostrEvent, QueryFn, VerifyFn } from './types.ts';
import { HEX64, cleanDisplay, fold, isSafeDisplay, normTag } from './text.ts';

export const KIND_LABEL = 1985;
export const KIND_DELETION = 5;

/** The namespace NIP-32 implies when an `l` tag has no mark and there's no `L` tag. */
export const UGC_NAMESPACE = 'ugc';

export const LABEL_LIMITS = {
  /** Labels (`l` tags) kept per event. */
  maxLabelsPerEvent: 64,
  /** Targets kept per event (bulk labeling is allowed by the NIP). */
  maxTargetsPerEvent: 1000,
  maxNamespace: 128,
  maxValue: 128,
  maxContent: 500,
} as const;

/** What a label is attached to: `e:<id>`, `a:<kind:pk:d>`, `p:<pubkey>`, `r:<url>`, `t:<topic>`. */
export type TargetKey = string;

export interface Label {
  /** Id of the kind-1985 event (or the self-labelled event). */
  id: string;
  /** Who applied it: the labeler's hex pubkey, or the author for self-labels. */
  labeler: string;
  namespace: string;
  value: string;
  targets: TargetKey[];
  createdAt: number;
  /** NIP-40 expiration, if any. */
  expiresAt?: number;
  /** Short explanation from the event content (display-safe). */
  reason?: string;
  /** True for labels an author put on their own event (`l` tags on a non-1985 event, or NIP-36). */
  self?: boolean;
}

/** Normalize a URL target so `https://Host/x` and `https://host/x` match. */
export function normUrlTarget(u: string): string | undefined {
  try {
    const url = new URL(u);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined;
    url.hash = '';
    let s = url.toString();
    if (url.pathname === '/' && !url.search) s = s.replace(/\/$/, '');
    return s;
  } catch {
    return undefined;
  }
}

function targetKey(t: string[]): TargetKey | undefined {
  const [name, v] = t;
  if (typeof v !== 'string' || !v) return undefined;
  switch (name) {
    case 'e':
    case 'p':
      return HEX64.test(v) ? `${name}:${v}` : undefined;
    case 'a':
      return /^\d{1,5}:[0-9a-f]{64}:.{0,512}$/s.test(v) ? `a:${v}` : undefined;
    case 'r': {
      const u = normUrlTarget(v);
      return u ? `r:${u}` : undefined;
    }
    case 't': {
      const tag = normTag(v);
      return tag ? `t:${tag}` : undefined;
    }
    default:
      return undefined;
  }
}

function expirationOf(e: NostrEvent): number | undefined {
  const v = e.tags.find((t) => t[0] === 'expiration')?.[1];
  const n = v === undefined ? NaN : Number(v);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

/** `(namespace, value)` pairs from `L`/`l` tags, following the NIP's mark rules. */
function labelPairs(tags: string[][]): { namespace: string; value: string }[] {
  const L = new Set(tags.filter((t) => t[0] === 'L' && typeof t[1] === 'string').map((t) => t[1]));
  const out: { namespace: string; value: string }[] = [];
  for (const t of tags) {
    if (t[0] !== 'l' || typeof t[1] !== 'string' || !t[1]) continue;
    let ns = t[2];
    if (L.size) {
      // "If using an `L` tag, `l` tags MUST include a mark matching an `L` tag value."
      if (!ns || !L.has(ns)) continue;
    } else if (!ns) {
      ns = UGC_NAMESPACE; // "If none is included, `ugc` is implied."
    }
    // `L` values starting with `#` associate the target with a standard tag; that
    // is not moderation, so skip them.
    if (ns.startsWith('#')) continue;
    if (ns.length > LABEL_LIMITS.maxNamespace || t[1].length > LABEL_LIMITS.maxValue) continue;
    if (!isSafeDisplay(ns) || !isSafeDisplay(t[1])) continue;
    out.push({ namespace: ns, value: t[1] });
    if (out.length >= LABEL_LIMITS.maxLabelsPerEvent) break;
  }
  return out;
}

/** Labels in a kind-1985 event. Does not check the signature (see `buildLabelIndex`). */
export function parseLabelEvent(e: NostrEvent): Label[] {
  if (!e || e.kind !== KIND_LABEL || !Array.isArray(e.tags) || !HEX64.test(e.pubkey)) return [];
  const targets: TargetKey[] = [];
  for (const t of e.tags) {
    if (!Array.isArray(t)) return [];
    const k = targetKey(t);
    if (k && !targets.includes(k)) targets.push(k);
    if (targets.length >= LABEL_LIMITS.maxTargetsPerEvent) break;
  }
  // "The label event MUST include one or more tags representing the object or objects being labeled."
  if (!targets.length) return [];
  const expiresAt = expirationOf(e);
  const reason = cleanDisplay(e.content, LABEL_LIMITS.maxContent) || undefined;
  return labelPairs(e.tags).map(({ namespace, value }) => ({
    id: e.id,
    labeler: e.pubkey,
    namespace,
    value,
    targets,
    createdAt: e.created_at,
    ...(expiresAt ? { expiresAt } : {}),
    ...(reason ? { reason } : {}),
  }));
}

/**
 * Self-labels on a non-1985 event (e.g. a NIP-71 video): its own `L`/`l` tags, and
 * a NIP-36 `content-warning` tag, which `packages/bridge` emits for PeerTube NSFW
 * videos. They target the event itself. Self-labels can only add warnings; the
 * moderation policy never lets them remove one.
 */
export function selfLabels(e: NostrEvent): Label[] {
  if (!e || e.kind === KIND_LABEL || !Array.isArray(e.tags) || !HEX64.test(e.id)) return [];
  const targets = [`e:${e.id}`];
  const out: Label[] = labelPairs(e.tags).map(({ namespace, value }) => ({
    id: e.id,
    labeler: e.pubkey,
    namespace,
    value,
    targets,
    createdAt: e.created_at,
    self: true,
  }));
  const cw = e.tags.find((t) => t[0] === 'content-warning');
  if (cw) {
    const reason = cleanDisplay(cw[1] ?? '', LABEL_LIMITS.maxContent) || undefined;
    out.push({ id: e.id, labeler: e.pubkey, namespace: 'content-warning', value: 'content-warning', targets, createdAt: e.created_at, self: true, ...(reason ? { reason } : {}) });
  }
  return out;
}

export interface BuildLabelOptions {
  createdAt?: number;
  content?: string;
  /** NIP-40 expiration (Unix seconds). */
  expiresAt?: number;
}

/**
 * An unsigned kind-1985 event, for labeler tooling and tests. One namespace per
 * event, as the NIP asks ("publishers SHOULD limit labeling events to a single namespace").
 */
export function buildLabelEvent(
  targets: readonly { type: 'e' | 'p' | 'a' | 'r' | 't'; value: string; relay?: string }[],
  namespace: string,
  values: readonly string[],
  opts: BuildLabelOptions = {},
): EventTemplate {
  if (!targets.length) throw new TypeError('a label needs at least one target');
  if (!values.length) throw new TypeError('a label needs at least one value');
  if (!namespace || !isSafeDisplay(namespace)) throw new TypeError('bad namespace');
  const tags: string[][] = [['L', namespace]];
  for (const v of values) {
    if (!v || !isSafeDisplay(v)) throw new TypeError('bad label value');
    tags.push(['l', v, namespace]);
  }
  for (const t of targets) {
    const tag = [t.type, t.value, ...(t.relay ? [t.relay] : [])];
    if (!targetKey(tag)) throw new TypeError(`bad ${t.type} target: ${t.value}`);
    tags.push(tag);
  }
  if (opts.expiresAt) tags.push(['expiration', String(opts.expiresAt)]);
  return { kind: KIND_LABEL, created_at: opts.createdAt ?? Math.floor(Date.now() / 1000), tags, content: cleanDisplay(opts.content ?? '', LABEL_LIMITS.maxContent) };
}

/** Labels by target, from the labelers the viewer subscribes to. */
export class LabelIndex {
  private readonly byTarget = new Map<TargetKey, Label[]>();
  readonly labels: readonly Label[];

  constructor(labels: readonly Label[]) {
    this.labels = labels;
    for (const l of labels) {
      for (const t of l.targets) {
        const list = this.byTarget.get(t);
        if (list) list.push(l);
        else this.byTarget.set(t, [l]);
      }
    }
  }

  /** Every label on any of `keys`, deduplicated by (labeler, namespace, value). */
  labelsFor(keys: Iterable<TargetKey>): Label[] {
    const seen = new Set<string>();
    const out: Label[] = [];
    for (const k of keys) {
      for (const l of this.byTarget.get(k) ?? []) {
        const id = `${l.labeler}\u0000${fold(l.namespace)}\u0000${fold(l.value)}`;
        if (seen.has(id)) continue;
        seen.add(id);
        out.push(l);
      }
    }
    return out;
  }

  get size(): number {
    return this.labels.length;
  }

  static empty(): LabelIndex {
    return new LabelIndex([]);
  }
}

export interface BuildLabelIndexOptions {
  /** Hex pubkeys of subscribed labelers. Events by anyone else are ignored. */
  labelers: readonly string[];
  /** Signature check (`verifyNostrEvent`). Required: relays are untrusted. */
  verify: VerifyFn;
  /** Unix seconds, for NIP-40 expiry. Default now. */
  now?: number;
}

/**
 * Build the index from relay events: kind-1985 labels plus kind-5 deletions
 * (NIP-09) by the same labeler, which retract labels (NIP-32 "Other Notes").
 */
export function buildLabelIndex(events: readonly NostrEvent[], opts: BuildLabelIndexOptions): LabelIndex {
  const allowed = new Set(opts.labelers.map((p) => p.toLowerCase()));
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const seen = new Set<string>();
  const deleted = new Set<string>(); // `${pubkey}:${eventId}`
  const labels: Label[] = [];
  for (const e of events) {
    if (!e || seen.has(e.id) || !allowed.has(e.pubkey)) continue;
    if (e.kind !== KIND_LABEL && e.kind !== KIND_DELETION) continue;
    if (!opts.verify(e)) continue;
    seen.add(e.id);
    if (e.kind === KIND_DELETION) {
      for (const t of e.tags) if (t[0] === 'e' && HEX64.test(t[1] ?? '')) deleted.add(`${e.pubkey}:${t[1]}`);
      continue;
    }
    for (const l of parseLabelEvent(e)) if (!l.expiresAt || l.expiresAt > now) labels.push(l);
  }
  return new LabelIndex(labels.filter((l) => !deleted.has(`${l.labeler}:${l.id}`)));
}

export interface FetchLabelsOptions {
  /** Hex pubkeys (use `parsePubkey` on npubs first). */
  labelers: readonly string[];
  /** Relays to ask: the viewer's configured relays plus any the labeler advertises. */
  relays: readonly string[];
  query: QueryFn;
  verify: VerifyFn;
  /** Only labels newer than this (Unix seconds), for incremental refresh. */
  since?: number;
  /** Per-relay limit (default 5,000). */
  limit?: number;
  now?: number;
}

/** Raw label and deletion events by the subscribed labelers. Store them, then `buildLabelIndex`. */
export async function fetchLabelEvents(opts: Omit<FetchLabelsOptions, 'verify' | 'now'>): Promise<NostrEvent[]> {
  const authors = [...new Set(opts.labelers.map((p) => p.toLowerCase()))].filter((p) => HEX64.test(p));
  if (!authors.length || !opts.relays.length) return [];
  return opts.query(opts.relays, {
    kinds: [KIND_LABEL, KIND_DELETION],
    authors,
    ...(opts.since !== undefined ? { since: opts.since } : {}),
    limit: opts.limit ?? 5000,
  });
}

/** Fetch and index in one step. */
export async function fetchLabels(opts: FetchLabelsOptions): Promise<LabelIndex> {
  const events = await fetchLabelEvents(opts);
  return buildLabelIndex(events, { labelers: opts.labelers, verify: opts.verify, now: opts.now });
}
