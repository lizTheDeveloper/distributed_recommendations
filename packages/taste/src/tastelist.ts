// Taste list format v1 (docs/WEB_APP.md, "Taste list format, v1"; PROVISIONAL).
//
// Same rules as apps/web/src/lib/tastelist.ts, which this can replace: version
// field, unknown keys rejected, size checked before JSON.parse, canonical watch URLs
// as ids, no control or bidi characters in strings (core's validation helpers).
// test/tastelist.test.ts runs every vector through both parsers.

import { ValidationError, array, boolean, fail, has, number, plainObject, string } from '../../core/src/validate.ts';
import type { Pick, PicksSet } from './types.ts';

export { ValidationError };

export interface TasteItem {
  /** Canonical PeerTube watch URL. */
  id: string;
  note?: string;
  sponsored: boolean;
  affiliated: boolean;
  /** Unix seconds. */
  addedAt?: number;
}

export interface TasteList {
  v: 1;
  name: string;
  author?: string;
  description?: string;
  /** Unix seconds. */
  updatedAt?: number;
  items: TasteItem[];
}

/** Identical to apps/web TASTE_LIST_LIMITS. */
export const TASTE_LIST_LIMITS = {
  maxJsonBytes: 64 * 1024,
  maxItems: 256,
  maxName: 80,
  maxAuthor: 120,
  maxDescription: 500,
  maxNote: 280,
  maxIdLength: 512,
} as const;

/** Latest accepted timestamp (2100-01-01), as in apps/web. */
export const MAX_TIMESTAMP = 4102444800;

const TOP = ['v', 'name', 'author', 'description', 'updatedAt', 'items'] as const;
const ITEM = ['id', 'note', 'sponsored', 'affiliated', 'addedAt'] as const;
const URL_RE = /^https?:\/\/[^\s]+$/;

/** Strictly validate an untrusted taste-list object. Throws `ValidationError`. */
export function parseTasteList(json: unknown): TasteList {
  const L = TASTE_LIST_LIMITS;
  const o = plainObject(json, 'list', TOP, ['v', 'name', 'items']);
  if (o.v !== 1) fail('list.v', 'must be 1');
  const list: TasteList = { v: 1, name: string(o.name, 'list.name', L.maxName), items: [] };
  if (has(o, 'author')) list.author = string(o.author, 'list.author', L.maxAuthor);
  if (has(o, 'description')) list.description = string(o.description, 'list.description', L.maxDescription);
  if (has(o, 'updatedAt')) list.updatedAt = number(o.updatedAt, 'list.updatedAt', 0, MAX_TIMESTAMP, true);
  const seen = new Set<string>();
  array(o.items, 'list.items', L.maxItems).forEach((raw, i) => {
    const p = `list.items[${i}]`;
    const it = plainObject(raw, p, ITEM, ['id']);
    const id = string(it.id, `${p}.id`, L.maxIdLength, URL_RE);
    if (seen.has(id)) fail(`${p}.id`, 'is a duplicate');
    seen.add(id);
    const item: TasteItem = {
      id,
      sponsored: has(it, 'sponsored') ? boolean(it.sponsored, `${p}.sponsored`) : false,
      affiliated: has(it, 'affiliated') ? boolean(it.affiliated, `${p}.affiliated`) : false,
    };
    if (has(it, 'note')) item.note = string(it.note, `${p}.note`, L.maxNote);
    if (has(it, 'addedAt')) item.addedAt = number(it.addedAt, `${p}.addedAt`, 0, MAX_TIMESTAMP, true);
    list.items.push(item);
  });
  return list;
}

/** Parse taste-list JSON text, enforcing the size limit before parsing. */
export function parseTasteListJson(text: string): TasteList {
  if (typeof text !== 'string') fail('list', 'must be JSON text');
  if (new TextEncoder().encode(text).length > TASTE_LIST_LIMITS.maxJsonBytes) {
    fail('list', `must be at most ${TASTE_LIST_LIMITS.maxJsonBytes} bytes`);
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new ValidationError('list', 'is not valid JSON');
  }
  return parseTasteList(json);
}

/** A parsed taste list as picks (no video refs; resolve them with `findBridgedVideo`). */
export function picksFromTasteList(list: TasteList, d = 'picks'): PicksSet {
  const set: PicksSet = { d, title: list.name, items: [] };
  if (list.author !== undefined) set.author = list.author;
  if (list.description !== undefined) set.description = list.description;
  if (list.updatedAt !== undefined) set.updatedAt = list.updatedAt;
  set.items = list.items.map((i) => {
    const p: Pick = { url: i.id, sponsored: i.sponsored, affiliated: i.affiliated };
    if (i.note !== undefined) p.note = i.note;
    if (i.addedAt !== undefined) p.addedAt = i.addedAt;
    return p;
  });
  return set;
}

/** Stable: dated picks newest first, then undated ones in their given order. */
export function newestFirst<T extends { addedAt?: number }>(items: readonly T[]): T[] {
  return items
    .map((p, i) => ({ p, i }))
    .sort((a, b) => (b.p.addedAt ?? -1) - (a.p.addedAt ?? -1) || a.i - b.i)
    .map((x) => x.p);
}

/** Oldest first (NIP-51 tag order: new items are appended), undated picks first. */
export function oldestFirst<T extends { addedAt?: number }>(items: readonly T[]): T[] {
  return items
    .map((p, i) => ({ p, i }))
    .sort((a, b) => (a.p.addedAt ?? -1) - (b.p.addedAt ?? -1) || a.i - b.i)
    .map((x) => x.p);
}
