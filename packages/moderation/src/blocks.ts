// Local block lists: creators, instances, npubs, tags, keywords, single videos
// and taste lists, plus imported public NIP-51 mute lists.
//
// `BlockState` is plain JSON. The caller stores it encrypted (in apps/web, the
// vault: it says whom the viewer avoids, which is sensitive) and passes it back in.
// Parsing follows PROTOCOL.md conventions: version field, unknown keys rejected,
// size checked before JSON.parse.

import { HEX64, fold, hostMatches, normHandle, normHost, normTag } from './text.ts';

export type BlockKind = 'creator' | 'instance' | 'npub' | 'tag' | 'keyword' | 'video' | 'tasteList';

/** A public mute list (NIP-51 kind 10000) the viewer imported. Only its public tags are used. */
export interface MuteImport {
  /** Author of the mute list (hex). */
  from: string;
  eventId: string;
  createdAt: number;
  npubs: string[];
  tags: string[];
  keywords: string[];
}

export interface BlockState {
  v: 1;
  /** Channel or account handles, `name@host`, lowercased. */
  creators: string[];
  /** Hosts; a block also covers subdomains. */
  instances: string[];
  /** Hex pubkeys: creators' Nostr keys, matches, taste-list curators. */
  npubs: string[];
  /** Hashtags, folded, without `#`. */
  tags: string[];
  /** Words or phrases matched against titles, channel names, tags and descriptions. */
  keywords: string[];
  /** Canonical video URLs. */
  videos: string[];
  /** Taste-list addresses (`30005:<pubkey>:<d>`) or provisional list ids. */
  tasteLists: string[];
  imports: MuteImport[];
}

export const BLOCK_LIMITS = {
  maxJsonBytes: 1024 * 1024,
  maxPerList: 5000,
  maxImports: 20,
  maxKeyword: 100,
  minKeyword: 2,
  maxValue: 512,
} as const;

const LIST_FIELD: Readonly<Record<BlockKind, Exclude<keyof BlockState, 'v' | 'imports'>>> = {
  creator: 'creators',
  instance: 'instances',
  npub: 'npubs',
  tag: 'tags',
  keyword: 'keywords',
  video: 'videos',
  tasteList: 'tasteLists',
};

export function emptyBlockState(): BlockState {
  return { v: 1, creators: [], instances: [], npubs: [], tags: [], keywords: [], videos: [], tasteLists: [], imports: [] };
}

/** Normalize one value for a list; throws `TypeError` when it can't be used. */
export function normalizeBlockValue(kind: BlockKind, value: string): string {
  if (typeof value !== 'string') throw new TypeError(`${kind}: expected a string`);
  if (value.length > BLOCK_LIMITS.maxValue) throw new TypeError(`${kind}: too long`);
  switch (kind) {
    case 'creator':
      return normHandle(value);
    case 'instance':
      return normHost(value);
    case 'npub': {
      const v = value.trim().toLowerCase();
      if (!HEX64.test(v)) throw new TypeError('npub: expected 64 hex characters (use parsePubkey for npub1…)');
      return v;
    }
    case 'tag': {
      const t = normTag(value);
      if (!t || t.length > 64) throw new TypeError('tag: empty or longer than 64');
      return t;
    }
    case 'keyword': {
      const k = fold(value).replace(/\s+/g, ' ');
      if (k.length < BLOCK_LIMITS.minKeyword || k.length > BLOCK_LIMITS.maxKeyword) {
        throw new TypeError(`keyword: must be ${BLOCK_LIMITS.minKeyword}–${BLOCK_LIMITS.maxKeyword} characters`);
      }
      return k;
    }
    case 'video': {
      const u = new URL(value.trim());
      if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new TypeError('video: expected an http(s) URL');
      return u.toString();
    }
    case 'tasteList': {
      const v = value.trim();
      if (!v) throw new TypeError('tasteList: empty');
      return v;
    }
  }
}

/** A new state with `value` added to the `kind` list (no-op if present). */
export function addBlock(state: BlockState, kind: BlockKind, value: string): BlockState {
  const field = LIST_FIELD[kind];
  const v = normalizeBlockValue(kind, value);
  if (state[field].includes(v)) return state;
  if (state[field].length >= BLOCK_LIMITS.maxPerList) throw new RangeError(`${field}: at most ${BLOCK_LIMITS.maxPerList} entries`);
  return { ...state, [field]: [...state[field], v] };
}

/** A new state without `value` in the `kind` list. */
export function removeBlock(state: BlockState, kind: BlockKind, value: string): BlockState {
  const field = LIST_FIELD[kind];
  let v: string;
  try {
    v = normalizeBlockValue(kind, value);
  } catch {
    v = value;
  }
  if (!state[field].includes(v)) return state;
  return { ...state, [field]: state[field].filter((x) => x !== v) };
}

/** Add or replace an imported mute list (a newer list from the same author wins). */
export function importMuteList(state: BlockState, imp: MuteImport): BlockState {
  const old = state.imports.find((i) => i.from === imp.from);
  if (old && old.createdAt >= imp.createdAt) return state;
  const rest = state.imports.filter((i) => i.from !== imp.from);
  if (rest.length >= BLOCK_LIMITS.maxImports) throw new RangeError(`at most ${BLOCK_LIMITS.maxImports} imported mute lists`);
  return { ...state, imports: [...rest, imp] };
}

export function removeMuteImport(state: BlockState, from: string): BlockState {
  return { ...state, imports: state.imports.filter((i) => i.from !== from) };
}

// ---- Serialization -------------------------------------------------------

const TOP_KEYS = ['v', 'creators', 'instances', 'npubs', 'tags', 'keywords', 'videos', 'tasteLists', 'imports'];
const IMPORT_KEYS = ['from', 'eventId', 'createdAt', 'npubs', 'tags', 'keywords'];

function plain(o: unknown, path: string, keys: readonly string[]): Record<string, unknown> {
  if (!o || typeof o !== 'object' || Array.isArray(o)) throw new TypeError(`${path}: expected an object`);
  for (const k of Object.keys(o)) if (!keys.includes(k)) throw new TypeError(`${path}.${k}: unknown key`);
  return o as Record<string, unknown>;
}

function list(o: unknown, path: string, kind: BlockKind | null, max: number): string[] {
  if (o === undefined) return [];
  if (!Array.isArray(o)) throw new TypeError(`${path}: expected an array`);
  if (o.length > max) throw new TypeError(`${path}: more than ${max} entries`);
  const out = new Set<string>();
  for (const [i, x] of o.entries()) {
    if (typeof x !== 'string') throw new TypeError(`${path}[${i}]: expected a string`);
    out.add(kind ? normalizeBlockValue(kind, x) : x);
  }
  return [...out];
}

/** Strict parse of a stored state. Throws `TypeError` on anything unexpected. */
export function parseBlockState(json: unknown): BlockState {
  const o = plain(json, 'blocks', TOP_KEYS);
  if (o.v !== 1) throw new TypeError('blocks.v: must be 1');
  const M = BLOCK_LIMITS.maxPerList;
  const state: BlockState = {
    v: 1,
    creators: list(o.creators, 'blocks.creators', 'creator', M),
    instances: list(o.instances, 'blocks.instances', 'instance', M),
    npubs: list(o.npubs, 'blocks.npubs', 'npub', M),
    tags: list(o.tags, 'blocks.tags', 'tag', M),
    keywords: list(o.keywords, 'blocks.keywords', 'keyword', M),
    videos: list(o.videos, 'blocks.videos', 'video', M),
    tasteLists: list(o.tasteLists, 'blocks.tasteLists', 'tasteList', M),
    imports: [],
  };
  if (o.imports !== undefined) {
    if (!Array.isArray(o.imports) || o.imports.length > BLOCK_LIMITS.maxImports) throw new TypeError('blocks.imports: bad list');
    for (const [i, raw] of o.imports.entries()) {
      const p = `blocks.imports[${i}]`;
      const im = plain(raw, p, IMPORT_KEYS);
      if (typeof im.from !== 'string' || !HEX64.test(im.from)) throw new TypeError(`${p}.from: hex pubkey`);
      if (typeof im.eventId !== 'string' || !HEX64.test(im.eventId)) throw new TypeError(`${p}.eventId: hex id`);
      if (!Number.isInteger(im.createdAt) || (im.createdAt as number) < 0) throw new TypeError(`${p}.createdAt: integer`);
      state.imports.push({
        from: im.from,
        eventId: im.eventId,
        createdAt: im.createdAt as number,
        npubs: list(im.npubs, `${p}.npubs`, 'npub', M),
        tags: list(im.tags, `${p}.tags`, 'tag', M),
        keywords: list(im.keywords, `${p}.keywords`, 'keyword', M),
      });
    }
  }
  return state;
}

/** Parse stored JSON text, checking the size before parsing. */
export function parseBlockStateJson(text: string): BlockState {
  if (new TextEncoder().encode(text).length > BLOCK_LIMITS.maxJsonBytes) throw new TypeError('blocks: too large');
  return parseBlockState(JSON.parse(text));
}

export function serializeBlockState(state: BlockState): string {
  return JSON.stringify(parseBlockState(state));
}

// ---- Matching ------------------------------------------------------------

function keywordRegex(k: string): RegExp {
  const esc = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+');
  // Whole words only: "ass" must not hide "class".
  return new RegExp(`(?<![\\p{L}\\p{N}])${esc}(?![\\p{L}\\p{N}])`, 'iu');
}

export type BlockHit = { list: BlockKind; value: string; from?: string };

/** A compiled view of a `BlockState` for fast checks. Build once per feed render. */
export class BlockMatcher {
  readonly creators: ReadonlySet<string>;
  readonly instances: readonly string[];
  readonly videos: ReadonlySet<string>;
  readonly tasteLists: ReadonlySet<string>;
  private readonly npubs = new Map<string, string | undefined>();
  private readonly tags = new Map<string, string | undefined>();
  private readonly keywords: { k: string; re: RegExp; from?: string }[] = [];

  constructor(state: BlockState) {
    this.creators = new Set(state.creators);
    this.instances = [...state.instances];
    this.videos = new Set(state.videos);
    this.tasteLists = new Set(state.tasteLists);
    for (const n of state.npubs) this.npubs.set(n, undefined);
    for (const t of state.tags) this.tags.set(t, undefined);
    for (const k of state.keywords) this.keywords.push({ k, re: keywordRegex(k) });
    for (const im of state.imports) {
      for (const n of im.npubs) if (!this.npubs.has(n)) this.npubs.set(n, im.from);
      for (const t of im.tags) if (!this.tags.has(t)) this.tags.set(t, im.from);
      for (const k of im.keywords) this.keywords.push({ k, re: keywordRegex(k), from: im.from });
    }
  }

  creator(handle: string | undefined): BlockHit | undefined {
    if (!handle) return undefined;
    const h = handle.toLowerCase().replace(/^@/, '');
    return this.creators.has(h) ? { list: 'creator', value: h } : undefined;
  }

  instance(host: string | undefined): BlockHit | undefined {
    if (!host) return undefined;
    const b = this.instances.find((i) => hostMatches(host.toLowerCase(), i));
    return b ? { list: 'instance', value: b } : undefined;
  }

  npub(hex: string | undefined): BlockHit | undefined {
    if (!hex) return undefined;
    const k = hex.toLowerCase();
    if (!this.npubs.has(k)) return undefined;
    const from = this.npubs.get(k);
    return { list: 'npub', value: k, ...(from ? { from } : {}) };
  }

  tag(tag: string): BlockHit | undefined {
    const t = normTag(tag);
    if (!this.tags.has(t)) return undefined;
    const from = this.tags.get(t);
    return { list: 'tag', value: t, ...(from ? { from } : {}) };
  }

  keyword(texts: readonly (string | undefined)[]): BlockHit | undefined {
    if (!this.keywords.length) return undefined;
    const hay = texts.filter((t): t is string => !!t).map((t) => t.normalize('NFKC'));
    for (const { k, re, from } of this.keywords) {
      if (hay.some((h) => re.test(h))) return { list: 'keyword', value: k, ...(from ? { from } : {}) };
    }
    return undefined;
  }

  video(id: string): BlockHit | undefined {
    return this.videos.has(id) ? { list: 'video', value: id } : undefined;
  }

  tasteList(key: string | undefined): BlockHit | undefined {
    return key && this.tasteLists.has(key) ? { list: 'tasteList', value: key } : undefined;
  }
}
