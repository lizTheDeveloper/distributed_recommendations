// Reviewer decisions. Every decision is written to the audit log in the same
// transaction as the record it changes.
//
// - label:   a NIP-32 kind-1985 event built by packages/moderation's
//            `buildLabelEvent` (one namespace, `match-feed.moderation`), with
//            an optional NIP-40 `expiration`. Its content is the PUBLIC reason.
// - retract: a NIP-09 kind-5 deletion request naming the label (`e`) and its
//            kind (`k` 1985). packages/moderation's `buildLabelIndex` drops a
//            label when the same labeler published a deletion for it, whether or
//            not the relay honours the deletion.
// - dismiss / reopen / escalate: queue and audit only, nothing published.

import { KIND_DELETION, KIND_LABEL, LABEL_LIMITS, buildLabelEvent, cleanDisplay, publish, signWith, verifySignedEvent } from './deps.ts';
import type { EventTemplate, NostrEvent, PublishResult, RelayOptions, Signer } from './deps.ts';
import type { LabelerStore } from './repo.ts';
import { targetFromKey, targetKey } from './targets.ts';
import type { Target } from './targets.ts';
import type { CaseRecord, Escalation, LabelRecord } from './types.ts';
import { ILLEGAL_VALUES, NAMESPACE, checkValues } from './vocabulary.ts';

export const REASON_MIN = 10;

export interface LabelerContext {
  store: LabelerStore;
  /** Expected labeler pubkey (hex). */
  labeler: string;
  /** Needed to publish. Dry runs work without one. */
  signer?: Signer;
  relays: readonly string[];
  relayOptions?: RelayOptions;
  now?: () => number;
}

const nowOf = (ctx: LabelerContext) => (ctx.now ?? (() => Math.floor(Date.now() / 1000)))();

export class PublishError extends Error {
  readonly results: PublishResult[];
  constructor(msg: string, results: PublishResult[]) {
    super(msg);
    this.results = results;
  }
}

function checkReason(reason: string | undefined, what: string): string {
  const r = cleanDisplay(reason ?? '', LABEL_LIMITS.maxContent);
  if (r.length < REASON_MIN) throw new TypeError(`${what}: a reason of at least ${REASON_MIN} characters is required`);
  return r;
}

async function signAndPublish(ctx: LabelerContext, t: EventTemplate): Promise<{ event: NostrEvent; results: PublishResult[] }> {
  if (!ctx.signer) throw new Error('no signer: run with --signer bunker|key to publish');
  if (!ctx.relays.length) throw new Error('no publish relays configured (config.publishRelays)');
  const event = (await signWith(ctx.signer, t, { verify: verifySignedEvent })) as NostrEvent;
  if (event.pubkey !== ctx.labeler) throw new Error(`signer key ${event.pubkey} is not the configured labeler ${ctx.labeler}`);
  const results = await publish([...ctx.relays], event, ctx.relayOptions);
  if (!results.some((r) => r.ok)) {
    throw new PublishError(`no relay accepted the event: ${results.map((r) => `${r.relay}: ${r.message}`).join('; ')}`, results);
  }
  return { event, results };
}

export interface LabelInput {
  targets: Target[];
  values: string[];
  /** Public: goes in the event content and the statement of reasons. */
  reason: string;
  /** Internal only. */
  note?: string;
  /** Required for `illegal`: the law relied on, for the statement of reasons. */
  legalGround?: string;
  /** NIP-40, Unix seconds. */
  expiresAt?: number;
  reviewer: string;
  caseId?: string;
  /** Only the auto-blur path sets this. */
  automated?: boolean;
}

/** The unsigned label event a decision would publish (for dry runs and the web preview). */
export function labelTemplate(input: LabelInput, now: number): EventTemplate {
  const values = checkValues(input.values);
  const reason = checkReason(input.reason, 'label');
  if (!input.targets.length) throw new TypeError('label: at least one target');
  if (input.expiresAt !== undefined && (!Number.isInteger(input.expiresAt) || input.expiresAt <= now)) throw new TypeError('label: expiry must be in the future');
  if (values.some((v) => ILLEGAL_VALUES.has(v)) && !input.legalGround?.trim()) {
    throw new TypeError('label "illegal": give the legal ground relied on (--legal-ground), see README "Illegal content"');
  }
  return buildLabelEvent(input.targets, NAMESPACE, values, { createdAt: now, content: reason, ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}) });
}

function resolveCase(ctx: LabelerContext, caseId: string | undefined): CaseRecord | undefined {
  if (!caseId) return undefined;
  const c = ctx.store.getCase(caseId);
  if (!c) throw new TypeError(`no case ${caseId}`);
  return c;
}

/** Sign, publish and record a label decision. */
export async function issueLabel(ctx: LabelerContext, input: LabelInput): Promise<LabelRecord> {
  const now = nowOf(ctx);
  const c = resolveCase(ctx, input.caseId);
  const targets = input.targets.length ? input.targets : c ? [targetFromKey(c.target)].filter((t): t is Target => !!t) : [];
  const t = labelTemplate({ ...input, targets }, now);
  const { event, results } = await signAndPublish(ctx, t);
  const values = checkValues(input.values);
  const rec: LabelRecord = {
    id: event.id,
    event,
    namespace: NAMESPACE,
    values,
    targets,
    reason: event.content,
    reviewer: input.reviewer,
    automated: !!input.automated,
    decidedAt: now,
    relays: results,
    ...(input.note ? { note: cleanDisplay(input.note, 2000) } : {}),
    ...(input.legalGround ? { legalGround: cleanDisplay(input.legalGround, 500) } : {}),
    ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
    ...(c ? { caseId: c.id } : {}),
  };
  ctx.store.tx(() => {
    ctx.store.putLabel(rec);
    if (c) {
      const fresh = ctx.store.getCase(c.id)!;
      fresh.labelIds.push(rec.id);
      if (input.automated) fresh.autoBlurId = rec.id;
      else {
        fresh.status = 'labeled';
        fresh.resolvedAt = now;
      }
      fresh.updatedAt = now;
      ctx.store.putCase(fresh);
    }
    ctx.store.audit({
      at: now,
      actor: input.reviewer,
      actorKind: input.automated ? 'automated' : 'human',
      action: input.automated ? 'auto-blur' : 'label',
      labelId: rec.id,
      targets: targets.map(targetKey),
      values,
      reason: rec.reason,
      ...(c ? { caseId: c.id } : {}),
      details: {
        relays: results.map((r) => ({ relay: r.relay, ok: r.ok })),
        ...(rec.expiresAt ? { expiresAt: rec.expiresAt } : {}),
        ...(rec.legalGround ? { legalGround: rec.legalGround } : {}),
        ...(rec.note ? { note: rec.note } : {}),
      },
    });
  });
  return rec;
}

/** The unsigned NIP-09 deletion request for a label. */
export function retractionTemplate(labelId: string, reason: string, now: number): EventTemplate {
  if (!/^[0-9a-f]{64}$/.test(labelId)) throw new TypeError('retract: label id must be 64 hex');
  return {
    kind: KIND_DELETION,
    created_at: now,
    tags: [
      ['e', labelId],
      ['k', String(KIND_LABEL)],
    ],
    content: checkReason(reason, 'retract'),
  };
}

export async function retractLabel(ctx: LabelerContext, labelId: string, opts: { reason: string; reviewer: string; reopen?: boolean }): Promise<LabelRecord> {
  const now = nowOf(ctx);
  const rec = ctx.store.getLabel(labelId);
  if (!rec) throw new TypeError(`no label ${labelId} in this labeler's records`);
  if (rec.retraction) throw new TypeError(`label ${labelId} was already retracted`);
  const { event, results } = await signAndPublish(ctx, retractionTemplate(labelId, opts.reason, now));
  ctx.store.tx(() => {
    const fresh = ctx.store.getLabel(labelId)!;
    fresh.retraction = { eventId: event.id, at: now, by: opts.reviewer, reason: event.content, relays: results };
    ctx.store.putLabel(fresh);
    if (fresh.caseId) {
      const c = ctx.store.getCase(fresh.caseId);
      if (c) {
        if (c.autoBlurId === labelId) delete c.autoBlurId;
        const stillActive = c.labelIds.some((id) => id !== labelId && !ctx.store.getLabel(id)?.retraction);
        // With no label left in force, the case goes back to the queue unless told otherwise.
        if (!stillActive && c.status === 'labeled' && opts.reopen !== false) {
          c.status = 'open';
          delete c.resolvedAt;
        }
        c.updatedAt = now;
        ctx.store.putCase(c);
      }
    }
    ctx.store.audit({
      at: now,
      actor: opts.reviewer,
      actorKind: opts.reviewer === 'auto-blur' ? 'automated' : 'human',
      action: 'retract',
      labelId,
      targets: fresh.targets.map(targetKey),
      values: fresh.values,
      reason: event.content,
      ...(fresh.caseId ? { caseId: fresh.caseId } : {}),
      details: { deletionEventId: event.id, relays: results.map((r) => ({ relay: r.relay, ok: r.ok })) },
    });
  });
  return ctx.store.getLabel(labelId)!;
}

export function dismissCase(ctx: LabelerContext, caseId: string, opts: { reason: string; reviewer: string }): CaseRecord {
  const now = nowOf(ctx);
  const reason = checkReason(opts.reason, 'dismiss');
  return ctx.store.tx(() => {
    const c = ctx.store.getCase(caseId);
    if (!c) throw new TypeError(`no case ${caseId}`);
    if (c.status !== 'open') throw new TypeError(`case ${caseId} is ${c.status}, not open`);
    c.status = 'dismissed';
    c.resolvedAt = now;
    c.updatedAt = now;
    ctx.store.putCase(c);
    ctx.store.audit({ at: now, actor: opts.reviewer, actorKind: 'human', action: 'dismiss', caseId, targets: [c.target], reason });
    return c;
  });
}

export function reopenCase(ctx: LabelerContext, caseId: string, opts: { reason: string; reviewer: string }): CaseRecord {
  const now = nowOf(ctx);
  const reason = checkReason(opts.reason, 'reopen');
  return ctx.store.tx(() => {
    const c = ctx.store.getCase(caseId);
    if (!c) throw new TypeError(`no case ${caseId}`);
    c.status = 'open';
    delete c.resolvedAt;
    c.updatedAt = now;
    ctx.store.putCase(c);
    ctx.store.audit({ at: now, actor: opts.reviewer, actorKind: 'human', action: 'reopen', caseId, targets: [c.target], reason });
    return c;
  });
}

export const ESCALATION_TARGETS: readonly Escalation['to'][] = ['instance', 'ncmec', 'iwf', 'inhope', 'law-enforcement', 'other'];

/** Record that a case was passed to someone who can act. Stores a reference number, never material. */
export function escalateCase(ctx: LabelerContext, caseId: string, opts: { to: Escalation['to']; reviewer: string; reference?: string; reason: string }): CaseRecord {
  const now = nowOf(ctx);
  if (!ESCALATION_TARGETS.includes(opts.to)) throw new TypeError(`escalate: --to one of ${ESCALATION_TARGETS.join(', ')}`);
  const reason = checkReason(opts.reason, 'escalate');
  return ctx.store.tx(() => {
    const c = ctx.store.getCase(caseId);
    if (!c) throw new TypeError(`no case ${caseId}`);
    const e: Escalation = { to: opts.to, at: now, by: opts.reviewer, ...(opts.reference ? { reference: cleanDisplay(opts.reference, 200) } : {}) };
    c.escalations.push(e);
    c.updatedAt = now;
    ctx.store.putCase(c);
    ctx.store.audit({ at: now, actor: opts.reviewer, actorKind: 'human', action: 'escalate', caseId, targets: [c.target], reason, details: { to: e.to, ...(e.reference ? { reference: e.reference } : {}) } });
    return c;
  });
}

/** Labels this labeler issued that are still in force (not retracted, not expired). */
export function activeLabels(store: LabelerStore, now = Math.floor(Date.now() / 1000)): LabelRecord[] {
  return store.labels().filter((l) => !l.retraction && (!l.expiresAt || l.expiresAt > now));
}
