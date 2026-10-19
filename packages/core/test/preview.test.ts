import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_PREVIEW_POLICY,
  emptyPreviewState,
  parsePreviewPolicy,
  prunePreviews,
  requestPreview,
  respondToPreview,
  startPreviewRun,
} from "../src/preview.ts";
import type { PreviewResult, PreviewState, PsiCardinality } from "../src/preview.ts";
import { ValidationError } from "../src/validate.ts";
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
  assert.equal(prunePreviews(accepted, at(8)).requests.length, 0);
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
