// The viewer's moderation state (packages/moderation), how it is stored, and the
// app's policy on top of it. Pure: no network, no DOM.
//
// Stored in the encrypted vault as `moderation`: it says whom the viewer avoids,
// which labelers they trust and whether they opted into NSFW (moderation README,
// hook 1). Label events and instance defaults are cached with it so the index can
// be rebuilt on load (deletions apply).

import type {
  BlockKind,
  HideReason,
  InstanceDefaults,
  ModerationPolicy,
  ModerationSettings,
  NostrEvent,
  SensitiveMode,
  SourceMeta,
} from "./moderation/pkg.ts";
import { addBlock, defaultPolicy, parsePolicyJson, removeBlock, serializePolicy, setSensitiveMode } from "./moderation/pkg.ts";
import type { CandidateSource, Video } from "./core.ts";
import type { NativePlatform } from "./native.ts";
import { shortNpub } from "./bech32.ts";

export interface ModState {
  policy: ModerationPolicy;
  /** Raw kind-1985/kind-5 events from subscribed labelers (signatures checked when indexed). */
  labelEvents: NostrEvent[];
  /** Unix seconds of the last label fetch (incremental `since`). */
  labelsAt: number;
  /** The catalog instances' public moderation data (`/api/v1/config`, public blocklist log). */
  instances: InstanceDefaults[];
  /** Unix seconds of the last instance-defaults fetch. */
  instancesAt: number;
}

export const LABEL_EVENTS_CAP = 5000;
export const LABEL_REFRESH_S = 4 * 60 * 60;
export const INSTANCE_REFRESH_S = 24 * 60 * 60;

export function emptyModState(): ModState {
  return { policy: defaultPolicy(), labelEvents: [], labelsAt: 0, instances: [], instancesAt: 0 };
}

const obj = (x: unknown): Record<string, unknown> | null => (x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : null);

/** Validate what the vault returned; anything malformed falls back to the defaults. */
export function loadModState(x: unknown): ModState {
  const o = obj(x);
  const m = emptyModState();
  if (!o) return m;
  try {
    if (typeof o.policy === "string") m.policy = parsePolicyJson(o.policy);
  } catch {
    /* keep defaults */
  }
  if (Array.isArray(o.labelEvents)) m.labelEvents = o.labelEvents.filter((e) => obj(e) && typeof (e as NostrEvent).id === "string").slice(-LABEL_EVENTS_CAP) as NostrEvent[];
  if (typeof o.labelsAt === "number") m.labelsAt = o.labelsAt;
  if (Array.isArray(o.instances)) m.instances = o.instances.filter((d) => obj(d) && typeof (d as InstanceDefaults).instance === "string" && Array.isArray((d as InstanceDefaults).blockedAccounts) && Array.isArray((d as InstanceDefaults).blockedHosts)) as InstanceDefaults[];
  if (typeof o.instancesAt === "number") m.instancesAt = o.instancesAt;
  return m;
}

export function storeModState(m: ModState): unknown {
  return { policy: serializePolicy(m.policy), labelEvents: m.labelEvents.slice(-LABEL_EVENTS_CAP), labelsAt: m.labelsAt, instances: m.instances, instancesAt: m.instancesAt };
}

/**
 * The settings actually applied. On iOS in the native shell NSFW is always hidden
 * and has no switch (App Review 1.2: only "turned on via your website").
 */
export function effectiveSettings(s: ModerationSettings, platform: NativePlatform | undefined): ModerationSettings {
  if (platform === "ios" && s.nsfw !== "hide") return setSensitiveMode(s, "nsfw", "hide");
  return s;
}

export function effectivePolicy(p: ModerationPolicy, platform: NativePlatform | undefined): ModerationPolicy {
  const settings = effectiveSettings(p.settings, platform);
  return settings === p.settings ? p : { ...p, settings };
}

/** Whether this build may offer the NSFW switch at all. */
export function nsfwSwitchAllowed(platform: NativePlatform | undefined): boolean {
  return platform !== "ios";
}

/**
 * NSFW "show" takes two separate actions: choosing Show (step 1) only opens the
 * confirmation; `confirmAdult` comes from the second button. Going stricter needs
 * nothing. Returns the new settings, or "confirm" when step 2 is needed.
 */
export function chooseNsfw(s: ModerationSettings, mode: SensitiveMode, confirmAdult: boolean, now: number): ModerationSettings | "confirm" {
  if (mode === "show" && !confirmAdult) return "confirm";
  return setSensitiveMode(s, "nsfw", mode, { confirmAdult, now });
}

export const BLOCK_KIND_LABEL: Record<BlockKind, string> = {
  creator: "Blocked creator",
  instance: "Blocked instance",
  npub: "Blocked person (Nostr key)",
  tag: "Muted tag",
  keyword: "Muted word",
  video: "Hidden video",
  tasteList: "Blocked taste list",
};

/** Plain-language reason for the "N hidden" sheet. */
export function reasonText(r: HideReason, labelerName: (pubkey: string) => string = shortNpub): string {
  switch (r.kind) {
    case "blocked": {
      const v = r.list === "npub" ? shortNpub(r.value) : r.list === "tag" ? `#${r.value}` : r.list === "keyword" ? `"${r.value}"` : r.value;
      return `${BLOCK_KIND_LABEL[r.list]}: ${v}${r.from ? ` (from ${shortNpub(r.from)}'s mute list)` : ""}`;
    }
    case "instance-blocklist":
      return `Blocked by ${hostText(r.instance)}'s moderators: ${r.target}`;
    case "label": {
      const who = r.self ? (r.namespace.startsWith("peertube") ? "flagged by its creator or instance" : "self-labeled by its creator") : r.labeler === "reports" ? "reported by people you trust" : `labeled by ${labelerName(r.labeler)}`;
      return `${r.title}, ${who}${r.reason ? `: ${r.reason}` : ""}`;
    }
    case "sources-blocked":
      return r.sources === 1 ? "Only recommended by a source you blocked" : `Only recommended by ${r.sources} sources you blocked`;
  }
}

function hostText(origin: string): string {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
}

/** Is this reason one the viewer can undo from the hidden sheet (their own block)? */
export function undoableBlock(r: HideReason): { kind: BlockKind; value: string } | null {
  return r.kind === "blocked" && !r.from ? { kind: r.list, value: r.value } : null;
}

export function block(p: ModerationPolicy, kind: BlockKind, value: string): ModerationPolicy {
  return { ...p, blocks: addBlock(p.blocks, kind, value) };
}

export function unblock(p: ModerationPolicy, kind: BlockKind, value: string): ModerationPolicy {
  return { ...p, blocks: removeBlock(p.blocks, kind, value) };
}

/** What a video's Block/Mute dialog offers. */
export function blockChoices(v: Video): { kind: BlockKind; value: string; label: string }[] {
  const out: { kind: BlockKind; value: string; label: string }[] = [];
  const name = v.creatorName ?? v.creator;
  if (/^[^@\s]+@[^@\s]+$/.test(v.creator)) out.push({ kind: "creator", value: v.creator.toLowerCase(), label: `Block creator: ${name} (${v.creator})` });
  try {
    out.push({ kind: "instance", value: new URL(v.id).host, label: `Block instance: everything hosted on ${new URL(v.id).host}` });
  } catch {
    /* no host */
  }
  for (const t of (v.tags ?? []).slice(0, 8)) out.push({ kind: "tag", value: t, label: `Mute tag: #${t}` });
  return out;
}

/**
 * Who stands behind a ranker source, so blocking a person or list drops it
 * (moderation README hook 4). `taste` sources map by `via`; `match` by the peer's
 * name as the match service reports it.
 */
export function sourceMetaFor(
  tasteOwners: ReadonlyMap<string, SourceMeta>,
  matchPeers: ReadonlyMap<string, string>,
): (source: CandidateSource) => SourceMeta | undefined {
  return (source) => {
    if (source.kind === "taste" && source.via) return tasteOwners.get(source.via) ?? { list: source.via };
    if (source.kind === "match" && source.via) {
      const pk = matchPeers.get(source.via);
      return pk ? { pubkey: pk } : undefined;
    }
    return undefined;
  };
}

/** Relays to read labels from: the viewer's, plus any each labeler advertises. */
export function labelRelays(viewerRelays: readonly string[], s: ModerationSettings): string[] {
  return [...new Set([...viewerRelays, ...s.labelers.flatMap((l) => l.relays ?? [])])].slice(0, 12);
}
