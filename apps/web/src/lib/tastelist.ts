// Public taste lists, format v1 (PROVISIONAL: PROTOCOL.md does not define one yet;
// see docs/WEB_APP.md). Follows PROTOCOL.md conventions: version field, unknown keys
// rejected, size checked before JSON.parse, canonical video URLs as ids, no control
// or bidi characters in display strings.

import { ValidationError, array, boolean, fail, has, number, plainObject, string } from "./core.ts";

export interface TasteItem {
  /** Canonical PeerTube watch URL. */
  id: string;
  note?: string;
  /** Paid placement (FTC Endorsement Guides). Shown as a visible label. */
  sponsored: boolean;
  /** Curator has a material connection (own channel, friend, employer). */
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

export const TASTE_LIST_LIMITS = {
  maxJsonBytes: 64 * 1024,
  maxItems: 256,
  maxName: 80,
  maxAuthor: 120,
  maxDescription: 500,
  maxNote: 280,
  maxIdLength: 512,
} as const;

const TOP = ["v", "name", "author", "description", "updatedAt", "items"] as const;
const ITEM = ["id", "note", "sponsored", "affiliated", "addedAt"] as const;
const URL_RE = /^https?:\/\/[^\s]+$/;
const MAX_TS = 4102444800; // 2100-01-01

export function parseTasteList(json: unknown): TasteList {
  const L = TASTE_LIST_LIMITS;
  const o = plainObject(json, "list", TOP, ["v", "name", "items"]);
  if (o.v !== 1) fail("list.v", "must be 1");
  const list: TasteList = { v: 1, name: string(o.name, "list.name", L.maxName), items: [] };
  if (has(o, "author")) list.author = string(o.author, "list.author", L.maxAuthor);
  if (has(o, "description")) list.description = string(o.description, "list.description", L.maxDescription);
  if (has(o, "updatedAt")) list.updatedAt = number(o.updatedAt, "list.updatedAt", 0, MAX_TS, true);
  const seen = new Set<string>();
  array(o.items, "list.items", L.maxItems).forEach((raw, i) => {
    const p = `list.items[${i}]`;
    const it = plainObject(raw, p, ITEM, ["id"]);
    const id = string(it.id, `${p}.id`, L.maxIdLength, URL_RE);
    if (seen.has(id)) fail(`${p}.id`, "is a duplicate");
    seen.add(id);
    const item: TasteItem = {
      id,
      sponsored: has(it, "sponsored") ? boolean(it.sponsored, `${p}.sponsored`) : false,
      affiliated: has(it, "affiliated") ? boolean(it.affiliated, `${p}.affiliated`) : false,
    };
    if (has(it, "note")) item.note = string(it.note, `${p}.note`, L.maxNote);
    if (has(it, "addedAt")) item.addedAt = number(it.addedAt, `${p}.addedAt`, 0, MAX_TS, true);
    list.items.push(item);
  });
  return list;
}

/** Parse taste-list JSON text, enforcing the size limit before parsing. */
export function parseTasteListJson(text: string): TasteList {
  if (typeof text !== "string") fail("list", "must be JSON text");
  if (new TextEncoder().encode(text).length > TASTE_LIST_LIMITS.maxJsonBytes) {
    fail("list", `must be at most ${TASTE_LIST_LIMITS.maxJsonBytes} bytes`);
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new ValidationError("list", "is not valid JSON");
  }
  return parseTasteList(json);
}

/** Human-readable error for any parse failure. */
export function errorText(e: unknown): string {
  if (e instanceof ValidationError) return e.message;
  if (e instanceof Error) return e.message;
  return String(e);
}
