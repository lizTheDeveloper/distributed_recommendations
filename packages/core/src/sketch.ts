import type { Rng } from "./types.ts";
import { randomHex, shuffle } from "./rng.ts";
import { ValidationError, array, fail, number, plainObject, string } from "./validate.ts";

/**
 * A taste sketch: the list of video ids one match sends another
 * (wire format: docs/PROTOCOL.md, "Taste sketch").
 *
 * `items` mixes real canonical video URLs with padding nonces (64 lowercase hex
 * characters, i.e. 32 random bytes). A nonce can never equal a real id, because real
 * ids are http(s) URLs, so receivers just drop them. The list length is always one of
 * `SKETCH_BUCKETS`, and `padding` (random hex) makes the encoded JSON exactly
 * `sketchTargetBytes(bucket)` bytes. On the wire, after encryption, a sketch reveals
 * only its bucket, not how many items it holds or how long their URLs are.
 */
export interface TasteSketch {
  v: 1;
  /** Strictly increasing per sender and match. Receivers reject replays. */
  epoch: number;
  /** Unix seconds. */
  issuedAt: number;
  /** Unix seconds. */
  expiresAt: number;
  /** 32 random bytes, hex. */
  nonce: string;
  items: string[];
  padding: string;
}

/** One local history event. Only the device ever sees these. */
export interface HistoryEntry {
  videoId: string;
  at: Date;
  /** `endorse` = liked or saved; `finish` = watched at least 80%. */
  kind: "endorse" | "finish";
  tags?: string[];
}

/** What a user agreed to share with one match (DESIGN.md, Match protocol step 2). */
export interface SketchConsent {
  /** Rolling window, 1..365 days. */
  windowDays: number;
  /** Include finished watches as well as endorsements. Default off. */
  includeFinished: boolean;
  excludedTags: string[];
  /** Local hours of day (0..23) whose events are never shared, e.g. late night. */
  excludedHours: number[];
  /** Per-match exclusions: these ids are never sent to this match. */
  excludedVideos?: string[];
  /** Quiet pause (D2): keep sending, but the content stops changing. */
  paused: boolean;
}

/** Per-match sender state. */
export interface SketchState {
  /** Last epoch sent; 0 before the first sketch. */
  epoch: number;
  lastSent?: TasteSketch;
}

export interface BuildSketchOptions {
  now: Date;
  rng: Rng;
  /** Sketch lifetime; default 14 days, at most `SKETCH_LIMITS.maxTtlSec`. */
  ttlSec?: number;
  /** Local hour of a timestamp; default `Date#getHours`. Injected for tests. */
  hourOf?: (d: Date) => number;
}

/** Allowed lengths of `items`. */
export const SKETCH_BUCKETS = [64, 128, 256] as const;

export const SKETCH_LIMITS = {
  maxItemLength: 512,
  defaultTtlSec: 14 * 86_400,
  maxTtlSec: 30 * 86_400,
  clockSkewSec: 300,
  bytesPerItem: 160,
  overheadBytes: 512,
} as const;

const PADDING_ITEM = /^[0-9a-f]{64}$/;
const VIDEO_ID = /^https?:\/\/[^\s]+$/;
const HEX = /^[0-9a-f]*$/;
const KEYS = ["v", "epoch", "issuedAt", "expiresAt", "nonce", "items", "padding"] as const;

/** Exact encoded size, in UTF-8 bytes, of a sketch with `bucket` items. */
export function sketchTargetBytes(bucket: number): number {
  return SKETCH_LIMITS.overheadBytes + bucket * SKETCH_LIMITS.bytesPerItem;
}

/** True for a padding nonce. */
export function isPaddingItem(item: string): boolean {
  return PADDING_ITEM.test(item);
}

/** The real video ids in a sketch, padding removed. */
export function sketchItems(sketch: TasteSketch): Set<string> {
  return new Set(sketch.items.filter((x) => !isPaddingItem(x)));
}

/** Canonical encoding: JSON with keys in a fixed order. */
export function encodeSketch(s: TasteSketch): string {
  return JSON.stringify({
    v: s.v,
    epoch: s.epoch,
    issuedAt: s.issuedAt,
    expiresAt: s.expiresAt,
    nonce: s.nonce,
    items: s.items,
    padding: s.padding,
  });
}

function utf8Length(s: string): number {
  return new TextEncoder().encode(s).length;
}

/** Choose the sharable items from local history, newest first, honoring consent. */
export function selectSketchItems(
  history: readonly HistoryEntry[],
  consent: SketchConsent,
  now: Date,
  hourOf: (d: Date) => number = (d) => d.getHours(),
): string[] {
  const from = now.getTime() - consent.windowDays * 86_400_000;
  const tags = new Set(consent.excludedTags.map((t) => t.toLowerCase()));
  const hours = new Set(consent.excludedHours);
  const excluded = new Set(consent.excludedVideos ?? []);
  const blocked = new Set<string>();
  const latest = new Map<string, number>();
  for (const h of history) {
    const t = h.at.getTime();
    if (!(t > from && t <= now.getTime())) continue;
    if (h.kind === "finish" && !consent.includeFinished) continue;
    if (!VIDEO_ID.test(h.videoId) || h.videoId.length > SKETCH_LIMITS.maxItemLength) continue;
    // One excluded event (tag, hour) withholds the video entirely.
    if ((h.tags ?? []).some((x) => tags.has(x.toLowerCase())) || hours.has(hourOf(h.at))) {
      blocked.add(h.videoId);
      continue;
    }
    latest.set(h.videoId, Math.max(latest.get(h.videoId) ?? -Infinity, t));
  }
  return [...latest.entries()]
    .filter(([id]) => !blocked.has(id) && !excluded.has(id))
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .map(([id]) => id);
}

function pack(real: string[], epoch: number, opts: BuildSketchOptions): TasteSketch {
  const ttl = Math.min(opts.ttlSec ?? SKETCH_LIMITS.defaultTtlSec, SKETCH_LIMITS.maxTtlSec);
  const issuedAt = Math.floor(opts.now.getTime() / 1000);
  const nonce = randomHex(opts.rng, 32);
  let items = real.slice(0, SKETCH_BUCKETS[SKETCH_BUCKETS.length - 1]);
  for (;;) {
    for (const bucket of SKETCH_BUCKETS) {
      if (items.length > bucket) continue;
      const padded = items.slice();
      while (padded.length < bucket) padded.push(randomHex(opts.rng, 32));
      const sketch: TasteSketch = {
        v: 1,
        epoch,
        issuedAt,
        expiresAt: issuedAt + ttl,
        nonce,
        items: shuffle(padded, opts.rng),
        padding: "",
      };
      const room = sketchTargetBytes(bucket) - utf8Length(encodeSketch(sketch));
      if (room < 0) continue;
      sketch.padding = randomHex(opts.rng, Math.ceil(room / 2)).slice(0, room);
      return sketch;
    }
    // Even the largest bucket overflows (very long URLs): drop the oldest item.
    items = items.slice(0, -1);
  }
}

/**
 * Build the next sketch for one match.
 *
 * When `consent.paused` is set (quiet pause, D2), the real items of the last sketch
 * are re-sent in a fresh envelope (new epoch, expiry, nonce and padding), minus any
 * `excludedVideos`. The peer sees a normal, on-schedule sketch whose content has
 * stopped changing; nothing on the wire says "paused".
 */
export function buildSketch(
  history: readonly HistoryEntry[],
  consent: SketchConsent,
  state: SketchState,
  opts: BuildSketchOptions,
): { sketch: TasteSketch; state: SketchState } {
  if (!(consent.windowDays >= 1 && consent.windowDays <= 365)) {
    throw new RangeError("consent.windowDays must be between 1 and 365");
  }
  let real: string[];
  if (consent.paused) {
    const excluded = new Set(consent.excludedVideos ?? []);
    real = state.lastSent ? [...sketchItems(state.lastSent)].filter((id) => !excluded.has(id)) : [];
  } else {
    real = selectSketchItems(history, consent, opts.now, opts.hourOf);
  }
  const sketch = pack(real, state.epoch + 1, opts);
  return { sketch, state: { epoch: sketch.epoch, lastSent: sketch } };
}

/** Options for `validateSketch`. */
export interface ValidateSketchOptions {
  now: Date;
  /** Highest epoch already accepted from this sender; the new one must be greater. */
  lastEpoch?: number;
}

/**
 * Validate an incoming (already decrypted) sketch: exact keys, version, bucket size,
 * item format, freshness, expiry, monotonic epoch and size limits. Throws
 * `ValidationError`.
 */
export function validateSketch(raw: unknown, opts: ValidateSketchOptions): TasteSketch {
  const o = plainObject(raw, "sketch", KEYS, KEYS);
  if (o.v !== 1) fail("sketch.v", "must be 1");
  const epoch = number(o.epoch, "sketch.epoch", 1, Number.MAX_SAFE_INTEGER, true);
  const issuedAt = number(o.issuedAt, "sketch.issuedAt", 0, 1e11, true);
  const expiresAt = number(o.expiresAt, "sketch.expiresAt", 0, 1e11, true);
  const nonce = string(o.nonce, "sketch.nonce", 64, PADDING_ITEM);
  const items = array(o.items, "sketch.items", SKETCH_BUCKETS[SKETCH_BUCKETS.length - 1]);
  if (!(SKETCH_BUCKETS as readonly number[]).includes(items.length)) {
    fail("sketch.items", `length must be one of ${SKETCH_BUCKETS.join(", ")}`);
  }
  const unique = new Set<string>();
  items.forEach((x, i) => {
    const s = string(x, `sketch.items[${i}]`, SKETCH_LIMITS.maxItemLength);
    if (!isPaddingItem(s) && !VIDEO_ID.test(s)) fail(`sketch.items[${i}]`, "is neither a video URL nor padding");
    if (unique.has(s)) fail(`sketch.items[${i}]`, "is a duplicate");
    unique.add(s);
  });
  const padding = string(o.padding, "sketch.padding", sketchTargetBytes(items.length), HEX, 0);

  const nowSec = Math.floor(opts.now.getTime() / 1000);
  if (issuedAt > nowSec + SKETCH_LIMITS.clockSkewSec) fail("sketch.issuedAt", "is in the future");
  if (expiresAt <= issuedAt) fail("sketch.expiresAt", "must be after issuedAt");
  if (expiresAt - issuedAt > SKETCH_LIMITS.maxTtlSec) fail("sketch.expiresAt", "lifetime is too long");
  if (expiresAt <= nowSec) fail("sketch.expiresAt", "has expired");
  if (opts.lastEpoch !== undefined && epoch <= opts.lastEpoch) fail("sketch.epoch", "is not newer than the last accepted epoch");

  const sketch: TasteSketch = { v: 1, epoch, issuedAt, expiresAt, nonce, items: items as string[], padding };
  if (utf8Length(encodeSketch(sketch)) > sketchTargetBytes(items.length)) {
    fail("sketch", "is larger than its bucket allows");
  }
  return sketch;
}

/** Parse sketch JSON text with a size cap before `JSON.parse`, then validate. */
export function decodeSketch(text: string, opts: ValidateSketchOptions): TasteSketch {
  const max = sketchTargetBytes(SKETCH_BUCKETS[SKETCH_BUCKETS.length - 1]);
  if (typeof text !== "string" || utf8Length(text) > max) fail("sketch", `must be JSON text of at most ${max} bytes`);
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ValidationError("sketch", "is not valid JSON");
  }
  return validateSketch(raw, opts);
}
