// `applyModeration(candidates, policy, context)`: the on-device pre-filter that
// runs before core `rank()`. It returns
// - `allowed`: candidates to pass to `rank()` (hidden videos removed, blocked
//   match and taste-list sources dropped);
// - `warnings`: per video id, what to blur or label (attach after ranking with
//   `attachVerdicts`);
// - `hidden`: each hidden video with its reasons, so the UI can say "N hidden"
//   and explain them.
// Nothing here touches the network.

import type { BlockHit } from './blocks.ts';
import { BlockMatcher } from './blocks.ts';
import type { Candidate, CandidateSource, RankedItem, SourceKind, Video } from './core.ts';
import type { Label, TargetKey } from './labels.ts';
import { LabelIndex, normUrlTarget } from './labels.ts';
import type { InstanceDefaults } from './peertube.ts';
import type { ModerationAction, ModerationPolicy, RuleAction } from './policy.ts';
import { ACTION_RANK, PEERTUBE_INSTANCE_NAMESPACE, PEERTUBE_NSFW_NAMESPACE, actionForLabel } from './policy.ts';
import { HEX64, cleanDisplay, hostMatches, hostOf, normTag } from './text.ts';

/** Moderation facts about a video that core's `Video` doesn't carry. */
export interface VideoMeta {
  /** PeerTube `nsfw`. */
  nsfw?: boolean;
  /** PeerTube `nsfwFlags` bit field: 1 violent, 2 explicit sex. */
  nsfwFlags?: number;
  nsfwSummary?: string;
  /** Owner account handle `name@host` (core's `creator` is the channel). */
  account?: string;
  /** NIP-71 event for the video, if any (e.g. from `packages/bridge`). */
  eventId?: string;
  address?: string;
  /** Nostr pubkey of whoever signed the video event (creator or bridge). */
  pubkey?: string;
  description?: string;
  /** From `selfLabels(videoEvent)`. */
  selfLabels?: Label[];
}

/** Who stands behind a candidate source: a match's pubkey, a taste list's curator and address. */
export interface SourceMeta {
  pubkey?: string;
  /** Taste list address `30005:<pubkey>:<d>`, or a provisional list id. */
  list?: string;
}

/** A core `Candidate` with optional moderation facts. `rank()` ignores the extra field. */
export interface ModerationCandidate extends Candidate {
  moderation?: { video?: VideoMeta; source?: SourceMeta };
}

export interface ModerationContext {
  /** Labels from subscribed labelers (`fetchLabels`), plus any `labelsFromReports`. */
  labels?: LabelIndex;
  /** The viewer's PeerTube instances' public moderation data (`instanceDefaults`). */
  instances?: readonly InstanceDefaults[];
  /** Video facts by video, for callers that keep them outside the candidates. */
  videoMeta?: (video: Video) => VideoMeta | undefined;
  /** Source facts, for callers that keep them outside the candidates. */
  sourceMeta?: (source: CandidateSource, video: Video) => SourceMeta | undefined;
}

export type HideReason =
  | { kind: 'blocked'; list: BlockHit['list']; value: string; from?: string }
  | { kind: 'instance-blocklist'; instance: string; target: string }
  | { kind: 'label'; namespace: string; value: string; labeler: string; title: string; self?: boolean; reason?: string }
  | { kind: 'sources-blocked'; sources: number };

export interface Verdict {
  action: 'allow' | ModerationAction;
  /** Every reason that contributed, strongest first. */
  reasons: HideReason[];
  /** Short UI strings for the warning or label, deduplicated. */
  titles: string[];
}

export interface HiddenVideo {
  video: Video;
  reasons: HideReason[];
}

export interface DroppedSource {
  videoId: string;
  source: CandidateSource;
  reason: HideReason;
}

export interface ModerationResult {
  /** Pass these to core `rank()`. */
  allowed: Candidate[];
  /** Video id -> blur/label verdict (only for videos that are shown). */
  warnings: Map<string, Verdict>;
  /** One entry per hidden video. */
  hidden: HiddenVideo[];
  /** `hidden.length`, for "N hidden". */
  hiddenCount: number;
  /** Sources removed from videos that stay (e.g. a blocked curator's list entry). */
  droppedSources: DroppedSource[];
}

function channelUrls(handle: string | undefined, kind: 'video-channels' | 'accounts'): string[] {
  const m = handle ? /^([^@\s/]+)@([^@\s/]+)$/.exec(handle.replace(/^@/, '')) : null;
  if (!m) return [];
  const [, name, host] = m;
  const short = kind === 'video-channels' ? 'c' : 'a';
  return [`https://${host}/${kind}/${name}`, `https://${host}/${short}/${name}`];
}

/** All label targets that refer to this video, its creator or its instance. */
export function videoTargetKeys(video: Video, meta: VideoMeta = {}): TargetKey[] {
  const keys = new Set<TargetKey>();
  const url = (u: string | undefined) => {
    const n = u && normUrlTarget(u);
    if (n) keys.add(`r:${n}`);
  };
  url(video.id);
  url(video.url);
  const host = hostOf(video.id);
  if (host) url(`https://${host}`);
  for (const u of channelUrls(video.creator, 'video-channels')) url(u);
  for (const u of channelUrls(meta.account, 'accounts')) url(u);
  if (meta.eventId && HEX64.test(meta.eventId)) keys.add(`e:${meta.eventId}`);
  if (meta.address) keys.add(`a:${meta.address}`);
  if (meta.pubkey && HEX64.test(meta.pubkey)) keys.add(`p:${meta.pubkey}`);
  for (const t of video.tags ?? []) {
    const n = normTag(t);
    if (n) keys.add(`t:${n}`);
  }
  return [...keys];
}

function synthLabel(namespace: string, value: string, target: string, reason?: string): Label {
  return { id: `${namespace}:${value}:${target}`, labeler: namespace, namespace, value, targets: [target], createdAt: 0, self: true, ...(reason ? { reason } : {}) };
}

/** PeerTube's own NSFW signals as labels: the video's flag and flags, and NSFW instances. */
function peertubeLabels(video: Video, meta: VideoMeta, instances: readonly InstanceDefaults[]): Label[] {
  const out: Label[] = [];
  const reason = cleanDisplay(meta.nsfwSummary ?? '', 200) || undefined;
  const flags = Number.isInteger(meta.nsfwFlags) ? (meta.nsfwFlags as number) : 0;
  if (flags & 1) out.push(synthLabel(PEERTUBE_NSFW_NAMESPACE, 'violent', video.id, reason));
  if (flags & 2) out.push(synthLabel(PEERTUBE_NSFW_NAMESPACE, 'explicitSex', video.id, reason));
  // NSFW without a specific flag (older instances, or the creator chose none).
  if (meta.nsfw && !(flags & 3)) out.push(synthLabel(PEERTUBE_NSFW_NAMESPACE, 'nsfw', video.id, reason));
  const host = hostOf(video.id);
  if (host && instances.some((d) => d.isNSFW && hostOf(d.instance) === host)) {
    out.push(synthLabel(PEERTUBE_INSTANCE_NAMESPACE, 'nsfw', video.id));
  }
  return out;
}

function handleHost(handle: string | undefined): string | undefined {
  const m = handle ? /@([^@\s/]+)$/.exec(handle) : null;
  return m ? m[1].toLowerCase() : undefined;
}

interface Compiled {
  policy: ModerationPolicy;
  blocks: BlockMatcher;
  labels: LabelIndex;
  instances: readonly InstanceDefaults[];
  subscribed: Set<string>;
}

function compile(policy: ModerationPolicy, ctx: ModerationContext): Compiled {
  return {
    policy,
    blocks: new BlockMatcher(policy.blocks),
    labels: ctx.labels ?? LabelIndex.empty(),
    instances: ctx.instances ?? [],
    subscribed: new Set([...policy.settings.labelers.map((l) => l.pubkey), 'reports']),
  };
}

function judgeVideo(video: Video, meta: VideoMeta, c: Compiled): Verdict {
  const reasons: { rank: number; r: HideReason; title?: string }[] = [];
  const hide = (r: HideReason) => reasons.push({ rank: ACTION_RANK.hide, r });

  // 1. The viewer's own block lists.
  const b = c.blocks;
  const host = hostOf(video.id);
  const hits = [
    b.video(video.id),
    b.creator(video.creator),
    b.creator(meta.account),
    b.instance(host),
    b.instance(handleHost(video.creator)),
    b.instance(handleHost(meta.account)),
    b.npub(meta.pubkey),
    ...(video.tags ?? []).map((t) => b.tag(t)),
    b.keyword([video.title, video.creatorName, meta.description, ...(video.tags ?? [])]),
  ];
  for (const h of hits) if (h) hide({ kind: 'blocked', list: h.list, value: h.value, ...(h.from ? { from: h.from } : {}) });

  // 2. The viewer's instances' own blocklists (admin mutes).
  if (c.policy.settings.instanceBlocklists) {
    const accounts = [video.creator, meta.account].filter((x): x is string => !!x).map((x) => x.toLowerCase());
    const hosts = [host, handleHost(video.creator), handleHost(meta.account)].filter((x): x is string => !!x);
    for (const d of c.instances) {
      for (const a of accounts) if (d.blockedAccounts.includes(a)) hide({ kind: 'instance-blocklist', instance: d.instance, target: a });
      for (const h of hosts) {
        const blocked = d.blockedHosts.find((bh) => hostMatches(h, bh));
        if (blocked) hide({ kind: 'instance-blocklist', instance: d.instance, target: blocked });
      }
    }
  }

  // 3. Labels: subscribed labelers, self-labels, PeerTube flags.
  const labels = [
    ...c.labels.labelsFor(videoTargetKeys(video, meta)).filter((l) => c.subscribed.has(l.labeler)),
    ...(meta.selfLabels ?? []).map((l) => ({ ...l, self: true })),
    ...peertubeLabels(video, meta, c.instances),
  ];
  for (const l of labels) {
    const { action, title } = actionForLabel(l, c.policy.settings);
    if (action === 'ignore') continue;
    // Self-labels may add a warning, never more than a blur: a creator can't use
    // a self-label to hide someone else's content, and hiding their own is moot.
    const eff: RuleAction = l.self && action === 'hide' && l.namespace !== PEERTUBE_NSFW_NAMESPACE && l.namespace !== PEERTUBE_INSTANCE_NAMESPACE ? 'blur' : action;
    reasons.push({
      rank: ACTION_RANK[eff],
      title,
      r: {
        kind: 'label',
        namespace: l.namespace,
        value: cleanDisplay(l.value, 64),
        labeler: l.labeler,
        title,
        ...(l.self ? { self: true } : {}),
        ...(l.reason ? { reason: l.reason } : {}),
      },
    });
  }

  reasons.sort((a, z) => z.rank - a.rank);
  const top = reasons[0]?.rank ?? 0;
  const action: Verdict['action'] = top >= ACTION_RANK.hide ? 'hide' : top === ACTION_RANK.blur ? 'blur' : top === ACTION_RANK.label ? 'label' : 'allow';
  const titles = [...new Set(reasons.map((x) => x.title).filter((t): t is string => !!t))];
  return { action, reasons: reasons.map((x) => x.r), titles };
}

const SOURCE_OWNER_KINDS: readonly SourceKind[] = ['match', 'taste', 'circle'];

/** Why a source must be dropped, or undefined. Only match, taste and circle sources have owners. */
function judgeSource(source: CandidateSource, meta: SourceMeta | undefined, c: Compiled): HideReason | undefined {
  if (!SOURCE_OWNER_KINDS.includes(source.kind)) return undefined;
  const b = c.blocks;
  const hit = b.npub(meta?.pubkey) ?? b.tasteList(meta?.list) ?? (source.kind === 'taste' ? b.tasteList(source.via) : undefined);
  if (hit) return { kind: 'blocked', list: hit.list, value: hit.value, ...(hit.from ? { from: hit.from } : {}) };
  // A labeler can mark a curator or a list as spam (T7) or payola (T8): a `hide`
  // label on the source's pubkey or address drops the source.
  const keys: TargetKey[] = [];
  if (meta?.pubkey && HEX64.test(meta.pubkey)) keys.push(`p:${meta.pubkey}`);
  if (meta?.list && /^\d+:[0-9a-f]{64}:/.test(meta.list)) keys.push(`a:${meta.list}`);
  for (const l of c.labels.labelsFor(keys)) {
    if (!c.subscribed.has(l.labeler)) continue;
    const { action, title } = actionForLabel(l, c.policy.settings);
    if (action === 'hide') return { kind: 'label', namespace: l.namespace, value: cleanDisplay(l.value, 64), labeler: l.labeler, title };
  }
  return undefined;
}

/** Judge a single video, e.g. a deep link or search result that never went through the feed. */
export function moderateVideo(video: Video, policy: ModerationPolicy, ctx: ModerationContext = {}, meta?: VideoMeta): Verdict {
  return judgeVideo(video, { ...(ctx.videoMeta?.(video) ?? {}), ...(meta ?? {}) }, compile(policy, ctx));
}

/**
 * The pre-filter for core `rank()`:
 *
 *   const m = applyModeration(candidates, policy, ctx);
 *   const items = attachVerdicts(rank(m.allowed, recipe, opts), m);
 *   // m.hiddenCount -> "N hidden"
 */
export function applyModeration(candidates: readonly ModerationCandidate[], policy: ModerationPolicy, ctx: ModerationContext = {}): ModerationResult {
  const c = compile(policy, ctx);
  const verdicts = new Map<string, Verdict>();
  const metaById = new Map<string, VideoMeta>();
  // Merge video facts across candidates of the same video first, so the verdict
  // doesn't depend on candidate order.
  for (const cand of candidates) {
    const id = cand?.video?.id;
    if (typeof id !== 'string') continue;
    const m = { ...(metaById.get(id) ?? {}), ...(ctx.videoMeta?.(cand.video) ?? {}), ...(cand.moderation?.video ?? {}) };
    const prev = metaById.get(id);
    if (prev?.selfLabels && cand.moderation?.video?.selfLabels) m.selfLabels = [...prev.selfLabels, ...cand.moderation.video.selfLabels];
    metaById.set(id, m);
  }

  const allowed: Candidate[] = [];
  const dropped: DroppedSource[] = [];
  const keptPerVideo = new Map<string, number>();
  const videos = new Map<string, Video>();
  for (const cand of candidates) {
    const id = cand?.video?.id;
    if (typeof id !== 'string') continue;
    videos.set(id, cand.video);
    let v = verdicts.get(id);
    if (!v) {
      v = judgeVideo(cand.video, metaById.get(id) ?? {}, c);
      verdicts.set(id, v);
    }
    if (v.action === 'hide') continue;
    const why = judgeSource(cand.source, cand.moderation?.source ?? ctx.sourceMeta?.(cand.source, cand.video), c);
    if (why) {
      dropped.push({ videoId: id, source: cand.source, reason: why });
      continue;
    }
    keptPerVideo.set(id, (keptPerVideo.get(id) ?? 0) + 1);
    // Pass the candidate through unchanged (rank() ignores `moderation`).
    allowed.push(cand);
  }

  const hidden: HiddenVideo[] = [];
  const warnings = new Map<string, Verdict>();
  for (const [id, v] of verdicts) {
    const video = videos.get(id)!;
    if (v.action === 'hide') {
      hidden.push({ video, reasons: v.reasons });
    } else if (!keptPerVideo.get(id)) {
      const reasons = dropped.filter((d) => d.videoId === id).map((d) => d.reason);
      hidden.push({ video, reasons: [{ kind: 'sources-blocked', sources: reasons.length }, ...reasons] });
    } else if (v.action !== 'allow') {
      warnings.set(id, v);
    }
  }
  const droppedSources = dropped.filter((d) => keptPerVideo.get(d.videoId));
  return { allowed, warnings, hidden, hiddenCount: hidden.length, droppedSources };
}

/** A ranked item with its moderation verdict, for the card (blur overlay, label chips). */
export type ModeratedItem = RankedItem & { moderation?: Verdict };

/** Attach blur/label verdicts to `rank()` output. */
export function attachVerdicts(items: readonly RankedItem[], result: Pick<ModerationResult, 'warnings'>): ModeratedItem[] {
  return items.map((it) => {
    const v = result.warnings.get(it.video.id);
    return v ? { ...it, moderation: v } : { ...it };
  });
}

/**
 * Accounts and hosts that are safe to ask an instance about with
 * `/api/v1/blocklist/status`: by default only those of explore candidates,
 * which came from that instance's public listings anyway. Asking about match,
 * circle or taste-list videos would tell the instance what your matches like.
 */
export function publicSubjects(
  candidates: readonly ModerationCandidate[],
  opts: { kinds?: readonly SourceKind[]; videoMeta?: (v: Video) => VideoMeta | undefined } = {},
): { accounts: string[]; hosts: string[] } {
  const kinds = opts.kinds ?? ['explore'];
  const accounts = new Set<string>();
  const hosts = new Set<string>();
  for (const cand of candidates) {
    if (!kinds.includes(cand.source.kind)) continue;
    const meta = { ...(opts.videoMeta?.(cand.video) ?? {}), ...(cand.moderation?.video ?? {}) };
    for (const h of [cand.video.creator, meta.account]) if (h && /^[^@\s]+@[^@\s]+$/.test(h)) accounts.add(h.toLowerCase());
    const host = hostOf(cand.video.id);
    if (host) hosts.add(host);
  }
  return { accounts: [...accounts], hosts: [...hosts] };
}

/**
 * Moderation facts from a raw PeerTube video JSON (list or detail endpoint), for
 * building a `videoMeta` index alongside core's `peertubeVideoToVideo`.
 */
export function peertubeVideoMeta(raw: unknown): VideoMeta {
  const o = raw as Record<string, unknown>;
  if (!o || typeof o !== 'object') return {};
  const meta: VideoMeta = {};
  if (typeof o.nsfw === 'boolean') meta.nsfw = o.nsfw;
  if (Number.isInteger(o.nsfwFlags)) meta.nsfwFlags = o.nsfwFlags as number;
  if (typeof o.nsfwSummary === 'string') meta.nsfwSummary = cleanDisplay(o.nsfwSummary, 200);
  const acc = o.account as Record<string, unknown> | undefined;
  if (acc && typeof acc.name === 'string' && typeof acc.host === 'string') meta.account = `${acc.name}@${acc.host}`.toLowerCase();
  if (typeof o.description === 'string') meta.description = o.description.slice(0, 10_000);
  else if (typeof o.truncatedDescription === 'string') meta.description = o.truncatedDescription;
  return meta;
}
