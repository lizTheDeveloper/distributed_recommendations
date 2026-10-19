// The viewer's moderation settings and the label vocabulary that maps
// (namespace, value) to an action: hide, blur (warn), or label only.
//
// Settings are serializable JSON (PROTOCOL.md conventions: `v`, unknown keys
// rejected). Store them with the block lists; they reveal which labelers the
// viewer trusts and whether they opted into NSFW, so encrypt them too.

import type { BlockState } from './blocks.ts';
import { emptyBlockState, parseBlockState } from './blocks.ts';
import type { Label } from './labels.ts';
import { UGC_NAMESPACE } from './labels.ts';
import { HEX64, cleanDisplay, fold } from './text.ts';

/** What happens to a video. `ignore` is only for rules (drop the label silently). */
export type ModerationAction = 'hide' | 'blur' | 'label';
export type RuleAction = ModerationAction | 'ignore';

/** How a sensitive-content category is shown. */
export type SensitiveMode = 'hide' | 'blur' | 'show';

/** Categories whose action follows the viewer's setting instead of the rule. */
export type SensitiveCategory = 'nsfw' | 'violence';

export const ACTION_RANK: Readonly<Record<RuleAction, number>> = { ignore: 0, label: 1, blur: 2, hide: 3 };

/** Provisional namespace for labels our own labeler (or anyone reusing it) emits. */
export const MATCH_FEED_NAMESPACE = 'match-feed.moderation';
/** Synthetic namespaces for signals that don't come from a labeler. */
export const PEERTUBE_NSFW_NAMESPACE = 'peertube.nsfw';
export const PEERTUBE_INSTANCE_NAMESPACE = 'peertube.instance';
export const REPORTS_NAMESPACE = 'nip56';
export const CONTENT_WARNING_NAMESPACE = 'content-warning';

export interface LabelRule {
  namespace: string;
  /** Exact value, `*` for any, or a prefix ending in `*` (`NS-*`). Case-insensitive. */
  value: string;
  /** Used unless `category` is set. */
  action: RuleAction;
  /** When set, the viewer's mode for that category decides (hide/blur/show → label). */
  category?: SensitiveCategory;
  /** Restrict the rule to one labeler (hex). */
  labeler?: string;
  /** Short UI text, e.g. "Nudity". */
  title?: string;
}

const r = (namespace: string, value: string, action: RuleAction, title: string, category?: SensitiveCategory): LabelRule =>
  category ? { namespace, value, action, title, category } : { namespace, value, action, title };

/**
 * Built-in vocabulary. Viewer rules (`settings.rules`) are checked first and win.
 * Unknown values from subscribed labelers get `settings.unknownLabels`.
 */
export const DEFAULT_LABEL_RULES: readonly LabelRule[] = [
  // Our provisional namespace. Values follow NIP-56's report types where they overlap.
  r(MATCH_FEED_NAMESPACE, 'nudity', 'blur', 'Nudity', 'nsfw'),
  r(MATCH_FEED_NAMESPACE, 'sexual', 'blur', 'Sexual content', 'nsfw'),
  r(MATCH_FEED_NAMESPACE, 'porn', 'blur', 'Pornography', 'nsfw'),
  r(MATCH_FEED_NAMESPACE, 'violence', 'blur', 'Violence', 'violence'),
  r(MATCH_FEED_NAMESPACE, 'gore', 'blur', 'Graphic violence', 'violence'),
  r(MATCH_FEED_NAMESPACE, 'illegal', 'hide', 'Possibly illegal'),
  r(MATCH_FEED_NAMESPACE, 'malware', 'hide', 'Malware'),
  r(MATCH_FEED_NAMESPACE, 'scam', 'hide', 'Scam'),
  r(MATCH_FEED_NAMESPACE, 'spam', 'hide', 'Spam'),
  r(MATCH_FEED_NAMESPACE, 'hate', 'blur', 'Hateful content'),
  r(MATCH_FEED_NAMESPACE, 'harassment', 'blur', 'Harassment'),
  r(MATCH_FEED_NAMESPACE, 'self-harm', 'blur', 'Self-harm'),
  r(MATCH_FEED_NAMESPACE, 'profanity', 'label', 'Profanity'),
  r(MATCH_FEED_NAMESPACE, 'misleading', 'label', 'Misleading'),
  r(MATCH_FEED_NAMESPACE, 'impersonation', 'label', 'Impersonation'),
  // THREAT_MODEL T8 (payola): a labeler flags lists or videos with hidden paid placement.
  r(MATCH_FEED_NAMESPACE, 'undisclosed-sponsorship', 'label', 'Undisclosed sponsorship'),
  r(MATCH_FEED_NAMESPACE, 'ai-generated', 'label', 'AI-generated'),
  r(MATCH_FEED_NAMESPACE, '!hide', 'hide', 'Hidden by labeler'),
  r(MATCH_FEED_NAMESPACE, '!warn', 'blur', 'Warning from labeler'),
  // The ontology in NIP-56's example (`NS-nud`). Other codes: add viewer rules.
  r('social.nos.ontology', 'NS-*', 'blur', 'Nudity or sex', 'nsfw'),
  // NIP-36 content-warning on a video event (the bridge sets it for PeerTube NSFW).
  r(CONTENT_WARNING_NAMESPACE, '*', 'blur', 'Content warning', 'nsfw'),
  // PeerTube's own flags (video `nsfw`, `nsfwFlags`) and NSFW instances.
  r(PEERTUBE_NSFW_NAMESPACE, 'violent', 'blur', 'Violent (creator-flagged)', 'violence'),
  r(PEERTUBE_NSFW_NAMESPACE, '*', 'blur', 'Sensitive (creator-flagged)', 'nsfw'),
  r(PEERTUBE_INSTANCE_NAMESPACE, 'nsfw', 'blur', 'From an NSFW instance', 'nsfw'),
  // Reports from people you trust (NIP-56 "Client behavior"): reports are easy to
  // game, so they warn and never hide.
  r(REPORTS_NAMESPACE, 'nudity', 'blur', 'Reported for nudity', 'nsfw'),
  r(REPORTS_NAMESPACE, 'impersonation', 'label', 'Reported as impersonation'),
  r(REPORTS_NAMESPACE, '*', 'blur', 'Reported by people you trust'),
  // User-generated labels carry no authority of their own.
  r(UGC_NAMESPACE, '*', 'label', 'Label'),
];

export interface LabelerSubscription {
  /** Hex pubkey (convert npubs with `parsePubkey`). */
  pubkey: string;
  name?: string;
  /** Relays the labeler publishes to, in addition to the viewer's relays. */
  relays?: string[];
}

export interface ModerationSettings {
  v: 1;
  /** Default `blur`. `show` requires `adultConfirmedAt` (see `setSensitiveMode`). */
  nsfw: SensitiveMode;
  /** Default `blur`. */
  violence: SensitiveMode;
  labelers: LabelerSubscription[];
  /** Viewer overrides, checked before `DEFAULT_LABEL_RULES`. */
  rules: LabelRule[];
  /** Action for labels no rule covers, from labelers the viewer subscribed to. Default `label`. */
  unknownLabels: 'label' | 'ignore';
  /** Honour the viewer's PeerTube instances' own blocklists. Default true. */
  instanceBlocklists: boolean;
  /** Distinct trusted reporters needed before reports warn (0 = off). Default 3, per NIP-56. */
  reportThreshold: number;
  /** Unix seconds when the viewer confirmed they are an adult and chose to see NSFW. */
  adultConfirmedAt?: number;
}

/** What `applyModeration` takes: settings plus the block lists. Both serializable. */
export interface ModerationPolicy {
  settings: ModerationSettings;
  blocks: BlockState;
}

export const DEFAULT_SETTINGS: Readonly<ModerationSettings> = Object.freeze({
  v: 1,
  nsfw: 'blur',
  violence: 'blur',
  labelers: [],
  rules: [],
  unknownLabels: 'label',
  instanceBlocklists: true,
  reportThreshold: 3,
});

/**
 * For app-store builds. Apple 1.2: incidental NSFW content must be "hidden by
 * default and only displayed when the user turns it on via your website". Google
 * Play UGC: it must be "hidden by default behind filters that require at least two
 * user actions in order to completely disable". So NSFW starts hidden here.
 */
export const APP_STORE_SETTINGS: Readonly<ModerationSettings> = Object.freeze({ ...DEFAULT_SETTINGS, nsfw: 'hide' as const });

export function defaultPolicy(store = false): ModerationPolicy {
  const s = store ? APP_STORE_SETTINGS : DEFAULT_SETTINGS;
  return { settings: { ...s, labelers: [], rules: [] }, blocks: emptyBlockState() };
}

/**
 * Change a sensitive category's mode. Turning NSFW to `show` takes two separate
 * user actions (the toggle, then an explicit adult confirmation): pass
 * `confirmAdult: true` only from that second step. Going stricter needs nothing.
 */
export function setSensitiveMode(
  s: ModerationSettings,
  category: SensitiveCategory,
  mode: SensitiveMode,
  opts: { confirmAdult?: boolean; now?: number } = {},
): ModerationSettings {
  if (category === 'nsfw' && mode === 'show') {
    if (opts.confirmAdult !== true) throw new Error('showing NSFW needs an explicit adult confirmation');
    return { ...s, nsfw: 'show', adultConfirmedAt: opts.now ?? Math.floor(Date.now() / 1000) };
  }
  const next = { ...s, [category]: mode };
  if (category === 'nsfw') delete next.adultConfirmedAt;
  return next;
}

function valueMatches(pattern: string, value: string): boolean {
  const p = fold(pattern);
  const v = fold(value);
  if (p === '*') return true;
  if (p.endsWith('*')) return v.startsWith(p.slice(0, -1));
  return p === v;
}

export function modeToAction(mode: SensitiveMode): ModerationAction {
  return mode === 'show' ? 'label' : mode;
}

/** The rule that applies to a label, or undefined. Viewer rules first. */
export function findRule(label: Label, s: ModerationSettings): LabelRule | undefined {
  const match = (rule: LabelRule) =>
    fold(rule.namespace) === fold(label.namespace) && valueMatches(rule.value, label.value) && (!rule.labeler || rule.labeler === label.labeler);
  return s.rules.find(match) ?? DEFAULT_LABEL_RULES.find(match);
}

/** The action a label calls for under these settings (`ignore` = no effect). */
export function actionForLabel(label: Label, s: ModerationSettings): { action: RuleAction; title: string; category?: SensitiveCategory } {
  const rule = findRule(label, s);
  if (!rule) return { action: s.unknownLabels, title: cleanDisplay(label.value, 64) };
  const title = rule.title ?? cleanDisplay(label.value, 64);
  if (rule.category) return { action: modeToAction(s[rule.category]), title, category: rule.category };
  return { action: rule.action, title };
}

// ---- Parsing -------------------------------------------------------------

const SETTINGS_KEYS = ['v', 'nsfw', 'violence', 'labelers', 'rules', 'unknownLabels', 'instanceBlocklists', 'reportThreshold', 'adultConfirmedAt'];
const RULE_KEYS = ['namespace', 'value', 'action', 'category', 'labeler', 'title'];
const LABELER_KEYS = ['pubkey', 'name', 'relays'];
const MODES: readonly SensitiveMode[] = ['hide', 'blur', 'show'];
const ACTIONS: readonly RuleAction[] = ['hide', 'blur', 'label', 'ignore'];

function obj(o: unknown, path: string, keys: readonly string[]): Record<string, unknown> {
  if (!o || typeof o !== 'object' || Array.isArray(o)) throw new TypeError(`${path}: expected an object`);
  for (const k of Object.keys(o)) if (!keys.includes(k)) throw new TypeError(`${path}.${k}: unknown key`);
  return o as Record<string, unknown>;
}

function str(v: unknown, path: string, max: number): string {
  if (typeof v !== 'string' || !v || v.length > max || cleanDisplay(v, max) !== v) throw new TypeError(`${path}: 1–${max} safe characters`);
  return v;
}

/** Strict parse of stored settings (missing optional fields take defaults). */
export function parseModerationSettings(json: unknown): ModerationSettings {
  const o = obj(json, 'settings', SETTINGS_KEYS);
  if (o.v !== 1) throw new TypeError('settings.v: must be 1');
  const mode = (v: unknown, path: string, d: SensitiveMode): SensitiveMode => {
    if (v === undefined) return d;
    if (!MODES.includes(v as SensitiveMode)) throw new TypeError(`${path}: hide, blur or show`);
    return v as SensitiveMode;
  };
  const s: ModerationSettings = {
    v: 1,
    nsfw: mode(o.nsfw, 'settings.nsfw', DEFAULT_SETTINGS.nsfw),
    violence: mode(o.violence, 'settings.violence', DEFAULT_SETTINGS.violence),
    labelers: [],
    rules: [],
    unknownLabels: DEFAULT_SETTINGS.unknownLabels,
    instanceBlocklists: DEFAULT_SETTINGS.instanceBlocklists,
    reportThreshold: DEFAULT_SETTINGS.reportThreshold,
  };
  if (o.unknownLabels !== undefined) {
    if (o.unknownLabels !== 'label' && o.unknownLabels !== 'ignore') throw new TypeError('settings.unknownLabels: label or ignore');
    s.unknownLabels = o.unknownLabels;
  }
  if (o.instanceBlocklists !== undefined) {
    if (typeof o.instanceBlocklists !== 'boolean') throw new TypeError('settings.instanceBlocklists: boolean');
    s.instanceBlocklists = o.instanceBlocklists;
  }
  if (o.reportThreshold !== undefined) {
    if (!Number.isInteger(o.reportThreshold) || (o.reportThreshold as number) < 0 || (o.reportThreshold as number) > 100) {
      throw new TypeError('settings.reportThreshold: integer 0–100');
    }
    s.reportThreshold = o.reportThreshold as number;
  }
  if (o.adultConfirmedAt !== undefined) {
    if (!Number.isInteger(o.adultConfirmedAt) || (o.adultConfirmedAt as number) <= 0) throw new TypeError('settings.adultConfirmedAt: Unix seconds');
    s.adultConfirmedAt = o.adultConfirmedAt as number;
  }
  if (s.nsfw === 'show' && s.adultConfirmedAt === undefined) throw new TypeError('settings.nsfw: show requires adultConfirmedAt');
  if (o.labelers !== undefined) {
    if (!Array.isArray(o.labelers) || o.labelers.length > 32) throw new TypeError('settings.labelers: at most 32');
    const seen = new Set<string>();
    o.labelers.forEach((raw, i) => {
      const p = `settings.labelers[${i}]`;
      const l = obj(raw, p, LABELER_KEYS);
      if (typeof l.pubkey !== 'string' || !HEX64.test(l.pubkey)) throw new TypeError(`${p}.pubkey: hex`);
      if (seen.has(l.pubkey)) throw new TypeError(`${p}.pubkey: duplicate`);
      seen.add(l.pubkey);
      const sub: LabelerSubscription = { pubkey: l.pubkey };
      if (l.name !== undefined) sub.name = str(l.name, `${p}.name`, 80);
      if (l.relays !== undefined) {
        if (!Array.isArray(l.relays) || l.relays.length > 8) throw new TypeError(`${p}.relays: at most 8`);
        sub.relays = l.relays.map((u, j) => {
          const v = str(u, `${p}.relays[${j}]`, 256);
          if (!/^wss?:\/\/[^\s]+$/.test(v)) throw new TypeError(`${p}.relays[${j}]: ws(s):// URL`);
          return v;
        });
      }
      s.labelers.push(sub);
    });
  }
  if (o.rules !== undefined) {
    if (!Array.isArray(o.rules) || o.rules.length > 256) throw new TypeError('settings.rules: at most 256');
    o.rules.forEach((raw, i) => {
      const p = `settings.rules[${i}]`;
      const ru = obj(raw, p, RULE_KEYS);
      if (!ACTIONS.includes(ru.action as RuleAction)) throw new TypeError(`${p}.action: hide, blur, label or ignore`);
      const rule: LabelRule = { namespace: str(ru.namespace, `${p}.namespace`, 128), value: str(ru.value, `${p}.value`, 128), action: ru.action as RuleAction };
      if (ru.category !== undefined) {
        if (ru.category !== 'nsfw' && ru.category !== 'violence') throw new TypeError(`${p}.category: nsfw or violence`);
        rule.category = ru.category;
      }
      if (ru.labeler !== undefined) {
        if (typeof ru.labeler !== 'string' || !HEX64.test(ru.labeler)) throw new TypeError(`${p}.labeler: hex`);
        rule.labeler = ru.labeler;
      }
      if (ru.title !== undefined) rule.title = str(ru.title, `${p}.title`, 64);
      s.rules.push(rule);
    });
  }
  return s;
}

export const POLICY_MAX_JSON_BYTES = 1.5 * 1024 * 1024;

/** Parse `{settings, blocks}` from stored JSON text (size checked first). */
export function parsePolicyJson(text: string): ModerationPolicy {
  if (new TextEncoder().encode(text).length > POLICY_MAX_JSON_BYTES) throw new TypeError('policy: too large');
  const o = obj(JSON.parse(text), 'policy', ['settings', 'blocks']);
  return { settings: parseModerationSettings(o.settings), blocks: parseBlockState(o.blocks) };
}

export function serializePolicy(p: ModerationPolicy): string {
  return JSON.stringify({ settings: parseModerationSettings(p.settings), blocks: parseBlockState(p.blocks) });
}
