import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_PREVIEW_POLICY,
  PREVIEW_PRIVACY,
  emptyPreviewState,
  noisyPreviewCardinality,
  parsePreviewPolicy,
  previewBudgetRemaining,
  prunePreviews,
  requestPreview,
  respondToPreview,
  startPreviewRun,
} from "../src/preview.ts";
import type { PreviewResult, PreviewState, PsiCardinality } from "../src/preview.ts";
import { ValidationError } from "../src/validate.ts";
import { seededRng } from "../src/rng.ts";
import { NOW } from "./helpers.ts";

const DAY = 86_400_000;
const at = (days: number) => new Date(NOW.getTime() + days * DAY);

function ok(r: PreviewResult): PreviewState {
  assert.ok(r.ok, r.ok ? "" : r.reason);
  return r.state;
}

test("full flow: request, accept, run once", () => {
  let s = ok(requestPreview(emptyPreviewState(), { id: "r1", requester: "ana", target: "ben", now: NOW }));
  assert.deepEqual(startPreviewRun(s, "r1", { now: NOW, requesterSetSize: 30, targetSetSize: 30 }), { ok: false, reason: "not-accepted" });
  assert.deepEqual(respondToPreview(s, "r1", { by: "ana", accept: true, now: NOW }), { ok: false, reason: "not-target" });
  s = ok(respondToPreview(s, "r1", { by: "ben", accept: true, now: NOW }));
  assert.deepEqual(startPreviewRun(s, "r1", { now: NOW, requesterSetSize: 19, targetSetSize: 30 }), { ok: false, reason: "set-too-small" });
  assert.deepEqual(startPreviewRun(s, "r1", { now: NOW, requesterSetSize: 30, targetSetSize: 19 }), { ok: false, reason: "set-too-small" });
  s = ok(startPreviewRun(s, "r1", { now: NOW, requesterSetSize: 20, targetSetSize: 20 }));
  assert.equal(s.requests[0].status, "done");
  assert.deepEqual(startPreviewRun(s, "r1", { now: NOW, requesterSetSize: 30, targetSetSize: 30 }), { ok: false, reason: "not-accepted" });
});

test("declines count against the pair limit, in both directions", () => {
  let s = ok(requestPreview(emptyPreviewState(), { id: "r1", requester: "ana", target: "ben", now: NOW }));
  s = ok(respondToPreview(s, "r1", { by: "ben", accept: false, now: NOW }));
  assert.deepEqual(requestPreview(s, { id: "r2", requester: "ana", target: "ben", now: at(1) }), { ok: false, reason: "pair-limit" });
  assert.deepEqual(requestPreview(s, { id: "r2", requester: "ben", target: "ana", now: at(1) }), { ok: false, reason: "pair-limit" });
  assert.ok(requestPreview(s, { id: "r2", requester: "ana", target: "ben", now: at(7.01) }).ok);
});

test("per-requester weekly limit", () => {
  let s = emptyPreviewState();
  for (let i = 0; i < DEFAULT_PREVIEW_POLICY.maxPerRequesterPerWeek; i++) {
    s = ok(requestPreview(s, { id: `r${i}`, requester: "probe", target: `t${i}`, now: at(i / 10) }));
  }
  assert.deepEqual(requestPreview(s, { id: "x", requester: "probe", target: "new", now: at(1) }), { ok: false, reason: "requester-limit" });
  assert.ok(requestPreview(s, { id: "x", requester: "probe", target: "new", now: at(7.5) }).ok);
});

test("misc refusals and expiry", () => {
  const s0 = emptyPreviewState();
  assert.deepEqual(requestPreview(s0, { id: "a", requester: "x", target: "x", now: NOW }), { ok: false, reason: "self-request" });
  const s = ok(requestPreview(s0, { id: "a", requester: "x", target: "y", now: NOW }));
  assert.deepEqual(requestPreview(s, { id: "a", requester: "z", target: "w", now: NOW }), { ok: false, reason: "duplicate-id" });
  assert.deepEqual(respondToPreview(s, "nope", { by: "y", accept: true, now: NOW }), { ok: false, reason: "unknown-request" });
  assert.deepEqual(respondToPreview(s, "a", { by: "y", accept: true, now: at(8) }), { ok: false, reason: "expired" });
  const accepted = ok(respondToPreview(s, "a", { by: "y", accept: true, now: at(1) }));
  assert.deepEqual(respondToPreview(accepted, "a", { by: "y", accept: true, now: at(1) }), { ok: false, reason: "not-pending" });
  assert.deepEqual(startPreviewRun(accepted, "a", { now: at(8), requesterSetSize: 50, targetSetSize: 50 }), { ok: false, reason: "expired" });
  // Accepted records count against the target's yearly budget, so they are kept a year.
  assert.equal(prunePreviews(accepted, at(8)).requests.length, 1);
  assert.equal(prunePreviews(accepted, at(366)).requests.length, 0);
  assert.equal(prunePreviews(s, at(8)).requests.length, 0, "pending records go after a week");
});

test("target-side budget: at most 8 accepted previews per rolling year, from anyone", () => {
  let s = emptyPreviewState();
  // Nine different requesters (Sybils defeat per-pair limits), one a month.
  for (let i = 0; i < 9; i++) {
    s = ok(requestPreview(s, { id: `r${i}`, requester: `sybil${i}`, target: "tess", now: at(30 * i) }));
    const r = respondToPreview(s, `r${i}`, { by: "tess", accept: true, now: at(30 * i) });
    if (i < 8) {
      s = ok(r);
      assert.equal(s.requests.find((x) => x.id === `r${i}`)!.acceptedAt, Math.floor(at(30 * i).getTime() / 1000));
    } else assert.deepEqual(r, { ok: false, reason: "target-budget" });
  }
  assert.equal(previewBudgetRemaining(s, "tess", at(240)), 0);
  // Declining is always possible and doesn't use budget.
  assert.ok(respondToPreview(s, "r8", { by: "tess", accept: false, now: at(240) }).ok);
  // Pruning keeps the budget records; once the first acceptance is a year old, one frees up.
  s = prunePreviews(s, at(300));
  assert.equal(previewBudgetRemaining(s, "tess", at(300)), 0);
  assert.equal(previewBudgetRemaining(s, "tess", at(366)), 1);
  // A smaller budget can be configured, a larger one can't.
  const strict = { ...DEFAULT_PREVIEW_POLICY, maxAcceptedPerTargetPerYear: 2 };
  assert.equal(previewBudgetRemaining(emptyPreviewState(), "x", NOW, strict), 2);
  assert.throws(() => parsePreviewPolicy({ ...DEFAULT_PREVIEW_POLICY, maxAcceptedPerTargetPerYear: 9 }), ValidationError);
});

test("noised cardinality: discrete Laplace at ε = 0.5 with a floor of 5", () => {
  const rng = seededRng(3);
  const n = 20_000;
  let below = 0;
  let sum = 0;
  let exact = 0;
  for (let i = 0; i < n; i++) {
    const r = noisyPreviewCardinality(12, rng);
    if (r.belowFloor) {
      below++;
      assert.equal(r.value, undefined);
      assert.equal(r.label, "<5");
      continue;
    }
    assert.ok(Number.isInteger(r.value) && r.value! >= 5);
    sum += r.value!;
    if (r.value === 12) exact++;
  }
  // P(noise = 0) = (1 - e^-0.5) / (1 + e^-0.5) ≈ 0.245: most answers are not the true count.
  assert.ok(Math.abs(exact / n - 0.245) < 0.02, `exact ${exact / n}`);
  assert.ok(below / n < 0.05);
  assert.ok(Math.abs(sum / (n - below) - 12) < 0.3);
  // A small true count is mostly reported as "<5".
  let small = 0;
  for (let i = 0; i < 2000; i++) if (noisyPreviewCardinality(1, rng).belowFloor) small++;
  assert.ok(small / 2000 > 0.9);
  // Buckets for display.
  const fixed = (x: number) => () => x;
  assert.equal(noisyPreviewCardinality(7, fixed(0.5)).bucket, "a-few");
  assert.equal(noisyPreviewCardinality(15, fixed(0.5)).bucket, "some");
  assert.equal(noisyPreviewCardinality(40, fixed(0.5)).label, "a lot in common");
  assert.throws(() => noisyPreviewCardinality(-1, rng), RangeError);
});

test("privacy fields: optional on the wire, filled by parse, can only be made stricter", () => {
  const legacy = { v: 1, minSetSize: 20, maxPerPairPerWeek: 1, maxPerRequesterPerWeek: 5, acceptWindowSec: 604800 };
  const p = parsePreviewPolicy(legacy);
  assert.equal(p.epsilon, 0.5);
  assert.equal(p.floor, 5);
  assert.equal(p.maxAcceptedPerTargetPerYear, 8);
  assert.equal(parsePreviewPolicy({ ...legacy, epsilon: 0.25, floor: 8 }).epsilon, 0.25);
  assert.throws(() => parsePreviewPolicy({ ...legacy, epsilon: 1 }), ValidationError);
  assert.throws(() => parsePreviewPolicy({ ...legacy, floor: 4 }), ValidationError);
  assert.deepEqual(PREVIEW_PRIVACY, { maxEpsilon: 0.5, minFloor: 5, maxAcceptedPerTargetPerYear: 8 });
});

test("policy validation keeps the floor of 20", () => {
  assert.throws(() => parsePreviewPolicy({ ...DEFAULT_PREVIEW_POLICY, minSetSize: 5 }), ValidationError);
  assert.throws(() => requestPreview(emptyPreviewState(), { id: "a", requester: "x", target: "y", now: NOW }, { ...DEFAULT_PREVIEW_POLICY, minSetSize: 1 }), ValidationError);
  assert.deepEqual(parsePreviewPolicy(DEFAULT_PREVIEW_POLICY), DEFAULT_PREVIEW_POLICY);
});

test("PsiCardinality interface can be satisfied by a (non-private) test double", async () => {
  // Plaintext stand-in for OpenMined PSI, only to check the interface shape.
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const fake: PsiCardinality = {
    async createRequest(items) {
      return enc.encode(JSON.stringify(items));
    },
    async answerRequest(request, items) {
      const theirs = new Set<string>(JSON.parse(dec.decode(request)));
      const n = items.filter((x) => theirs.has(x)).length;
      return { setup: new Uint8Array(), response: enc.encode(String(n)) };
    },
    async intersectionSize(_setup, response) {
      return Number(dec.decode(response));
    },
  };
  const req = await fake.createRequest(["a", "b", "c"]);
  const { setup, response } = await fake.answerRequest(req, ["b", "c", "d"]);
  assert.equal(await fake.intersectionSize(setup, response), 2);
});
