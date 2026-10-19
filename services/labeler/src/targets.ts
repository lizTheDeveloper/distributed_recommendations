// What a reviewer labels, as NIP-32 target tags the moderation package matches
// (`videoTargetKeys` / `judgeSource` in packages/moderation/src/moderate.ts):
//
//   video:<watch URL>          r  the PeerTube video URL
//   event:<64 hex>             e  the NIP-71 video event (e.g. from packages/bridge)
//   creator:<npub|hex>         p  a Nostr key (creator, curator, match)
//   channel:<name@host>        r  https://host/video-channels/name
//   account:<name@host>        r  https://host/accounts/name
//   instance:<host>            r  https://host (every video on that instance)
//   list:30005:<hex>:<d>       a  a taste list (NIP-51 curation set)
//   address:<kind>:<hex>:<d>   a  any addressable event (e.g. a 34235 video)
//   tag:<hashtag>              t  a hashtag

import { buildLabelEvent, normHandle, normHost, normUrlTarget, parsePubkey } from './deps.ts';
import type { TargetKey } from './deps.ts';

export type TargetTagType = 'e' | 'p' | 'a' | 'r' | 't';
export interface Target {
  type: TargetTagType;
  value: string;
}

export type SubjectKind = 'video' | 'creator' | 'instance' | 'taste-list' | 'tag' | 'event';

export const TARGET_PREFIXES = ['video', 'event', 'creator', 'channel', 'account', 'instance', 'list', 'address', 'tag'] as const;

const HEX64 = /^[0-9a-f]{64}$/;
const ADDRESS = /^(\d{1,5}):([0-9a-f]{64}):(.{0,512})$/s;

/** Check a target with the moderation package's own tag validation. */
function validated(t: Target): Target {
  buildLabelEvent([t], 'check', ['check'], { createdAt: 1 });
  return t;
}

/** Parse `kind:value` (see the table above). Throws with a helpful message. */
export function parseTargetSpec(spec: string): Target {
  const i = spec.indexOf(':');
  if (i < 1) throw new TypeError(`target must look like <kind>:<value>, kinds: ${TARGET_PREFIXES.join(', ')}`);
  const kind = spec.slice(0, i).trim().toLowerCase();
  const v = spec.slice(i + 1).trim();
  switch (kind) {
    case 'video': {
      const u = normUrlTarget(v);
      if (!u || new URL(u).pathname === '/') throw new TypeError(`video: expected the video's https:// URL, got ${v}`);
      return validated({ type: 'r', value: u });
    }
    case 'event':
      if (!HEX64.test(v)) throw new TypeError('event: expected a 64-hex event id');
      return validated({ type: 'e', value: v });
    case 'creator':
      return validated({ type: 'p', value: parsePubkey(v) });
    case 'channel':
    case 'account': {
      const [name, host] = normHandle(v).split('@');
      return validated({ type: 'r', value: `https://${host}/${kind === 'channel' ? 'video-channels' : 'accounts'}/${name}` });
    }
    case 'instance':
      return validated({ type: 'r', value: `https://${normHost(v)}` });
    case 'list':
    case 'address': {
      const m = ADDRESS.exec(v);
      if (!m) throw new TypeError(`${kind}: expected <kind>:<64 hex pubkey>:<d>`);
      if (kind === 'list' && m[1] !== '30005') throw new TypeError('list: a taste list is a kind 30005 curation set');
      return validated({ type: 'a', value: v });
    }
    case 'tag':
      if (!v.replace(/^#+/, '')) throw new TypeError('tag: empty');
      return validated({ type: 't', value: v.replace(/^#+/, '').toLowerCase() });
    default:
      throw new TypeError(`unknown target kind "${kind}"; kinds: ${TARGET_PREFIXES.join(', ')}`);
  }
}

/** The label target for a report's target key (`e:<id>` / `p:<pk>`). `x:` blobs can't be labeled. */
export function targetFromKey(key: TargetKey | string): Target | undefined {
  const i = key.indexOf(':');
  const type = key.slice(0, i);
  const value = key.slice(i + 1);
  if ((type === 'e' || type === 'p') && HEX64.test(value)) return { type, value };
  if (type === 'a' && ADDRESS.test(value)) return { type, value };
  if (type === 'r' && normUrlTarget(value)) return { type, value: normUrlTarget(value)! };
  if (type === 't' && value) return { type, value };
  return undefined;
}

export function targetKey(t: Target): string {
  return `${t.type}:${t.value}`;
}

/** What kind of subject a target names, for queue display and transparency counts. */
export function subjectKind(t: Target): SubjectKind {
  switch (t.type) {
    case 'p':
      return 'creator';
    case 'e':
      return 'event';
    case 't':
      return 'tag';
    case 'a':
      return t.value.startsWith('30005:') ? 'taste-list' : 'video';
    case 'r': {
      const u = new URL(t.value);
      if (u.pathname === '/' || u.pathname === '') return 'instance';
      if (/^\/(video-channels|c|accounts|a)\/[^/]+\/?$/.test(u.pathname)) return 'creator';
      return 'video';
    }
  }
}
