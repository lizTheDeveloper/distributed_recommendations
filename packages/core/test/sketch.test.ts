import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SKETCH_BUCKETS,
  SKETCH_TRANSPORT_MAX_BUCKET,
  buildSketch,
  decodeSketch,
  encodeSketch,
  isPaddingItem,
  selectSketchItems,
  sketchItems,
  sketchTargetBytes,
  validateSketch,
} from "../src/sketch.ts";
import type { HistoryEntry, SketchConsent, SketchTransport } from "../src/sketch.ts";
import { seededRng } from "../src/rng.ts";
import { ValidationError } from "../src/validate.ts";
import { NOW } from "./helpers.ts";

const HOUR = 3600_000;
const DAY = 24 * HOUR;
const utcHour = (d: Date) => d.getUTCHours();
const id = (n: number) => `https://tube.example/videos/watch/${n}`;
const consent = (patch: Partial<SketchConsent> = {}): SketchConsent => ({
  windowDays: 60,
  includeFinished: false,
  excludedTags: [],
  excludedHours: [],
  paused: false,
  ...patch,
});
const opts = (seed = 1, now = NOW, transport?: SketchTransport) => ({ now, rng: seededRng(seed), hourOf: utcHour, transport });
const bytes = (s: string) => new TextEncoder().encode(s).length;

function history(n: number): HistoryEntry[] {
  return Array.from({ length: n }, (_, i) => ({ videoId: id(i), at: new Date(NOW.getTime() - (i + 1) * HOUR), kind: "endorse" as const }));
}

test("selection honors window, finished watches, tags, hours and exclusions", () => {
  const at = (h: number) => new Date(Date.UTC(2026, 9, 18, h));
  const h: HistoryEntry[] = [
    { videoId: id(1), at: at(10), kind: "endorse" },
    { videoId: id(2), at: at(11), kind: "finish" },
    { videoId: id(3), at: at(12), kind: "endorse", tags: ["Health"] },
    { videoId: id(4), at: at(2), kind: "endorse" },
    { videoId: id(5), at: new Date(NOW.getTime() - 90 * DAY), kind: "endorse" },
    { videoId: id(6), at: at(13), kind: "endorse" },
    { videoId: id(7), at: at(14), kind: "endorse" },
    { videoId: id(7), at: at(1), kind: "finish" },
    { videoId: "not-a-url", at: at(15), kind: "endorse" },
    { videoId: id(8), at: new Date(NOW.getTime() + DAY), kind: "endorse" },
  ];
  const c = consent({ excludedTags: ["health"], excludedHours: [0, 1, 2, 3], excludedVideos: [id(6)] });
  assert.deepEqual(selectSketchItems(h, c, NOW, utcHour), [id(7), id(1)]);
  assert.deepEqual(selectSketchItems(h, { ...c, includeFinished: true }, NOW, utcHour), [id(2), id(1)]);
});

test("pads to a bucket with nonces and to an exact byte size (MLS transport: up to 256)", () => {
  for (const [n, bucket] of [[0, 64], [41, 64], [64, 64], [65, 128], [200, 256], [400, 256]] as const) {
    const { sketch } = buildSketch(history(n), consent(), { epoch: 0 }, opts(1, NOW, "mls"));
    assert.equal(sketch.items.length, bucket, `n=${n}`);
    assert.equal(bytes(encodeSketch(sketch)), sketchTargetBytes(bucket));
    assert.equal(sketchItems(sketch).size, Math.min(n, 256));
    assert.equal(sketch.items.filter(isPaddingItem).length, bucket - Math.min(n, 256));
  }
});

test("NIP-17 (the default transport) caps sketches at the 128 bucket, keeping the newest items", () => {
  assert.deepEqual({ ...SKETCH_TRANSPORT_MAX_BUCKET }, { nip17: 128, mls: 256 });
  for (const [n, bucket] of [[0, 64], [64, 64], [65, 128], [128, 128], [200, 128], [400, 128]] as const) {
    for (const transport of [undefined, "nip17"] as const) {
      const { sketch } = buildSketch(history(n), consent(), { epoch: 0 }, opts(1, NOW, transport));
      assert.equal(sketch.items.length, bucket, `n=${n}`);
      assert.equal(bytes(encodeSketch(sketch)), sketchTargetBytes(bucket));
      assert.equal(sketchItems(sketch).size, Math.min(n, 128));
    }
  }
  // history(n) is newest first: the 128 kept are ids 0..127.
  const { sketch } = buildSketch(history(200), consent(), { epoch: 0 }, opts());
  assert.deepEqual([...sketchItems(sketch)].sort(), history(128).map((h) => h.videoId).sort());
  // A NIP-17 receiver rejects the 256 bucket; a transport-agnostic one still accepts it.
  const big = buildSketch(history(200), consent(), { epoch: 0 }, opts(1, NOW, "mls")).sketch;
  assert.throws(() => validateSketch(big, { now: NOW, transport: "nip17" }), /length must be one of 64, 128/);
  assert.throws(() => decodeSketch(encodeSketch(big), { now: NOW, transport: "nip17" }), /bytes/);
  assert.ok(decodeSketch(encodeSketch(big), { now: NOW }));
  assert.ok(decodeSketch(encodeSketch(big), { now: NOW, transport: "mls" }));
  assert.ok(decodeSketch(encodeSketch(sketch), { now: NOW, transport: "nip17" }));
});

test("very long URLs push to a bigger bucket rather than leak length", () => {
  const long = Array.from({ length: 60 }, (_, i) => ({
    videoId: `https://tube.example/videos/watch/${"x".repeat(400)}${i}`,
    at: new Date(NOW.getTime() - HOUR),
    kind: "endorse" as const,
  }));
  const { sketch } = buildSketch(long, consent(), { epoch: 0 }, opts(1, NOW, "mls"));
  assert.equal(sketch.items.length, 256);
  assert.equal(bytes(encodeSketch(sketch)), sketchTargetBytes(256));
  // Over NIP-17 there is no bigger bucket: the oldest items are dropped instead.
  const nip17 = buildSketch(long, consent(), { epoch: 0 }, opts()).sketch;
  assert.equal(nip17.items.length, 128);
  assert.equal(bytes(encodeSketch(nip17)), sketchTargetBytes(128));
  assert.ok(sketchItems(nip17).size < 60 && sketchItems(nip17).size > 0);
});

test("padding nonces never collide with real ids and items are shuffled", () => {
  const { sketch } = buildSketch(history(30), consent(), { epoch: 0 }, opts());
  for (const x of sketch.items) assert.ok(isPaddingItem(x) !== x.startsWith("https://"));
  const firstReal = sketch.items.findIndex((x) => !isPaddingItem(x));
  assert.ok(firstReal >= 0);
  assert.notDeepEqual(sketch.items.slice(0, 30), history(30).map((h) => h.videoId));
});

test("epochs increase and the sketch validates on the other side", () => {
  const s1 = buildSketch(history(10), consent(), { epoch: 0 }, opts(1));
  const s2 = buildSketch(history(12), consent(), s1.state, opts(2, new Date(NOW.getTime() + 7 * DAY)));
  assert.equal(s1.sketch.epoch, 1);
  assert.equal(s2.sketch.epoch, 2);
  const later = new Date(NOW.getTime() + 7 * DAY);
  const got = decodeSketch(encodeSketch(s2.sketch), { now: later, lastEpoch: 1 });
  assert.deepEqual(got, s2.sketch);
  assert.throws(() => validateSketch(s1.sketch, { now: NOW, lastEpoch: 1 }), /not newer/);
});

test("quiet pause re-sends the same content in a fresh envelope", () => {
  const first = buildSketch(history(10), consent(), { epoch: 0 }, opts(1));
  const paused = buildSketch(history(30), consent({ paused: true }), first.state, opts(2, new Date(NOW.getTime() + 7 * DAY)));
  assert.deepEqual(sketchItems(paused.sketch), sketchItems(first.sketch));
  assert.equal(paused.sketch.epoch, 2);
  assert.ok(paused.sketch.expiresAt > first.sketch.expiresAt);
  assert.notEqual(paused.sketch.nonce, first.sketch.nonce);
  assert.equal(bytes(encodeSketch(paused.sketch)), bytes(encodeSketch(first.sketch)));
  // Per-match exclusions still apply while paused.
  const excl = buildSketch([], consent({ paused: true, excludedVideos: [id(0)] }), first.state, opts(3));
  assert.equal(sketchItems(excl.sketch).has(id(0)), false);
  assert.equal(sketchItems(excl.sketch).size, 9);
  // Paused before anything was sent: an all-padding sketch.
  const none = buildSketch(history(10), consent({ paused: true }), { epoch: 0 }, opts());
  assert.equal(sketchItems(none.sketch).size, 0);
});

test("validation rejects expired, future, oversized and malformed sketches", () => {
  const { sketch } = buildSketch(history(5), consent(), { epoch: 0 }, opts());
  const ok = () => structuredClone(sketch) as any;
  const v = (s: unknown, now = NOW) => validateSketch(s, { now });
  assert.ok(v(ok()));
  assert.throws(() => v(ok(), new Date(NOW.getTime() + 15 * DAY)), /expired/);
  assert.throws(() => v(ok(), new Date(NOW.getTime() - DAY)), /future/);
  const cases: Array<(s: any) => void> = [
    (s) => (s.v = 2),
    (s) => (s.extra = 1),
    (s) => delete s.padding,
    (s) => (s.epoch = 0),
    (s) => (s.epoch = 1.5),
    (s) => (s.items = s.items.slice(1)),
    (s) => (s.items[0] = "javascript:alert(1)"),
    (s) => (s.items[1] = s.items[0]),
    (s) => (s.nonce = "zz"),
    (s) => (s.padding = "not hex!"),
    (s) => (s.padding += "00".repeat(5000)),
    (s) => (s.expiresAt = s.issuedAt + 31 * 86_400),
    (s) => (s.expiresAt = s.issuedAt),
  ];
  for (const mutate of cases) {
    const s = ok();
    mutate(s);
    assert.throws(() => v(s), ValidationError, mutate.toString());
  }
  assert.throws(() => decodeSketch("{", { now: NOW }), /JSON/);
  assert.throws(() => decodeSketch("x".repeat(sketchTargetBytes(256) + 1), { now: NOW }), /bytes/);
});

test("buckets are the documented sizes", () => {
  assert.deepEqual([...SKETCH_BUCKETS], [64, 128, 256]);
});
