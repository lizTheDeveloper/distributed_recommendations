import { test } from "node:test";
import assert from "node:assert/strict";
import { findNpub, npubEncode, nsecEncode, parseNpub, parseNsec, shortNpub } from "../src/lib/bech32.ts";
import { generateIdentity, importIdentity, loadIdentity } from "../src/lib/match/identity.ts";
import { MatchService, loadBook, loadMeta } from "../src/lib/match/service.ts";
import type { MatchBook } from "../src/lib/match/pkg.ts";
import { DEFAULT_CONSENT, INSECURE_plaintextPsiForTests, InMemoryRelay } from "../src/lib/match/pkg.ts";
import { DEMO_NAME, DemoPeer, loadDemoSaved, pickDemoItems } from "../src/lib/match/demo.ts";
import { lazyPsi, psiStatus, resetPsiForTests } from "../src/lib/match/psi.ts";
import { installBufferShim } from "../src/lib/match/buffer.ts";
import { testPsi } from "./psi-helper.ts";
import type { HistoryEntry, Video } from "../src/lib/core.ts";
import { DEFAULT_RECIPE, rank, seededRng } from "../src/lib/core.ts";

test("NIP-19 vectors: npub and nsec round-trip", () => {
  const pub = "7e7e9c42a91bfef19fa929e5fda1b72e0ebc1a4c1141673e2794234d86addf4e";
  const npub = "npub10elfcs4fr0l0r8af98jlmgdh9c8tcxjvz9qkw038js35mp4dma8qzvjptg";
  const sec = "67dea2ed018072d675f5415ecfaed7d2597555e202d85b3d65ea4e58d2d92ffa";
  const nsec = "nsec1vl029mgpspedva04g90vltkh6fvh240zqtv9k0t9af8935ke9laqsnlfe5";
  assert.equal(npubEncode(pub), npub);
  assert.equal(nsecEncode(sec), nsec);
  assert.equal(parseNpub(npub), pub);
  assert.equal(parseNpub("nostr:" + npub), pub);
  assert.equal(parseNpub(pub), pub, "hex accepted");
  assert.equal(parseNsec(nsec), sec);
  assert.equal(parseNpub(nsec), null, "wrong prefix");
  assert.equal(parseNpub(npub.slice(0, -1) + "q"), null, "bad checksum");
  assert.equal(parseNpub("hello"), null);
  assert.equal(findNpub(`Support me! Match Feed: nostr:${npub} thanks`), pub);
  assert.equal(findNpub("no key here"), null);
  assert.match(shortNpub(pub), /^npub10elf…ptg|^npub10elfc…jptg$/);
});

test("identity: generate, import nsec, validate stored", async () => {
  const g = generateIdentity(1);
  assert.equal(g.kind, "local");
  assert.deepEqual(loadIdentity(g), g);
  const imported = await importIdentity("nsec1vl029mgpspedva04g90vltkh6fvh240zqtv9k0t9af8935ke9laqsnlfe5");
  assert.equal(imported.pubkey, "7e7e9c42a91bfef19fa929e5fda1b72e0ebc1a4c1141673e2794234d86addf4e");
  await assert.rejects(importIdentity("npub10elfcs4fr0l0r8af98jlmgdh9c8tcxjvz9qkw038js35mp4dma8qzvjptg"), /isn't an nsec/);
  assert.equal(loadIdentity({ kind: "local", secret: "zz", pubkey: "x" }), null);
  assert.equal(loadIdentity({ kind: "nip07", pubkey: g.pubkey })?.kind, "nip07");
});

test("buffer shim does base64 the way psi.ts uses it", () => {
  const g = globalThis as { Buffer?: unknown };
  const saved = g.Buffer;
  g.Buffer = undefined;
  try {
    installBufferShim();
    const B = g.Buffer as { from(x: unknown, e?: string): Uint8Array & { toString(e?: string): string } };
    const bytes = new Uint8Array([0, 1, 2, 250, 255, 128]);
    const text = B.from(bytes).toString("base64");
    assert.equal(text, "AAEC+v+A");
    assert.deepEqual([...new Uint8Array(B.from(text, "base64"))], [...bytes]);
  } finally {
    g.Buffer = saved;
  }
});

const now = () => new Date();
function hist(ids: string[]): HistoryEntry[] {
  return ids.map((videoId, i) => ({ videoId, at: new Date(Date.now() - (i + 1) * 60_000), kind: "endorse" as const }));
}
const ids = Array.from({ length: 60 }, (_, i) => `https://v.example/videos/watch/vid-${String(i).padStart(3, "0")}`);
function video(id: string): Video {
  return { id, title: id.slice(-7), creator: "c@v.example", durationSec: 60, publishedAt: new Date(Date.now() - 86_400_000), tags: [] };
}

// The INSECURE test PSI sends whole sets, which overflow an 8,192-byte control
// message at 128 URL-sized items, so these flows use the real WASM PSI.
const realPsi = testPsi();
async function setup(psiIn?: ReturnType<typeof lazyPsi>) {
  const psi = psiIn ?? (await realPsi);
  const relay = new InMemoryRelay();
  const mine = ids.slice(0, 26); // 15 overlap with the demo peer (even indexes 0..28 of the sorted list)
  let saved: { book: MatchBook | null } = { book: null };
  const events: string[] = [];
  const svc = new MatchService({
    now,
    psi,
    history: () => hist(mine),
    persist: (book) => (saved = { book }),
    onChange: () => {},
    onEvent: (_e, text) => events.push(text),
  });
  const id = generateIdentity();
  await svc.start(id, relay, "in-memory demo relay", null);
  const demo = await DemoPeer.create({ relay, psi, now, items: pickDemoItems(ids) });
  svc.driver = demo;
  svc.setName(demo.pubkey, { name: DEMO_NAME, source: "demo" });
  return { svc, demo, id, events, saved: () => saved, mine };
}

test("match service + simulated demo peer: request → preview → accept → sketch → Match chip", async () => {
  const { svc, demo, events, saved, mine } = await setup();
  assert.equal(svc.ready, true);
  await svc.requestMatch(demo.pubkey, DEFAULT_CONSENT, true);
  const rec = svc.records()[0];
  assert.equal(rec.status, "active", "demo peer accepted after the preview");
  assert.equal(rec.preview?.stage, "done");
  const result = rec.preview?.result;
  assert.ok(result, "requester got a noised result");
  assert.ok(result.belowFloor ? result.value === undefined : typeof result.value === "number");
  assert.ok(events.some((t) => t.startsWith(`Preview with ${DEMO_NAME}:`)));
  assert.ok(events.some((t) => t === `You and ${DEMO_NAME} are matched`));
  assert.ok(rec.peerSketch, "the demo peer's sketch arrived");
  assert.equal(demo.client.book.matches[rec.matchId].peerSketch !== undefined, true, "ours reached the peer");
  // Persisted after every step, and restorable.
  assert.equal(loadBook(JSON.parse(JSON.stringify(saved().book)))?.self, svc.book!.self);
  // Candidates for core rank with the Match chip and a named why-line.
  const sims = svc.similarities(mine);
  assert.equal(sims.length, 1);
  assert.ok(sims[0].similarity > 0);
  const cands = svc.candidates(mine, video);
  assert.ok(cands.length > 0);
  assert.ok(cands.every((c) => c.source.kind === "match" && c.source.via === DEMO_NAME));
  const feed = rank(cands, DEFAULT_RECIPE, { now: new Date(), limit: 10, rng: seededRng(1) });
  assert.equal(feed[0].primary, "match");
  assert.match(feed[0].why[0], new RegExp(`^${DEMO_NAME.replace(/[()]/g, "\\$&")} endorsed it \\(overlap 0\\.\\d\\d\\)$`));
});

test("target side: the demo peer asks, the viewer accepts the preview (budget drops) and the match", async () => {
  const { svc, demo } = await setup();
  assert.equal(svc.previewBudget(), 8);
  await demo.requestViewer(svc.book!.self, true);
  await svc.sync();
  const rec = svc.records()[0];
  assert.equal(rec.status, "incoming");
  assert.equal(rec.preview?.stage, "requested");
  await svc.respondToPreview(rec.matchId, true);
  assert.equal(svc.previewBudget(), 7, "one of 8 used");
  assert.equal(svc.record(rec.matchId)?.preview?.stage, "done");
  const peerRec = demo.client.book.matches[rec.matchId];
  assert.ok(peerRec.preview?.result, "the requester (demo peer) learned only the noised value");
  await svc.accept(rec.matchId, { ...DEFAULT_CONSENT, includeFinished: true, windowDays: 30 });
  assert.equal(svc.record(rec.matchId)?.status, "active");
  assert.equal(svc.record(rec.matchId)?.consent.windowDays, 30);
  await svc.setPaused(rec.matchId, true);
  assert.equal(svc.record(rec.matchId)?.consent.paused, true);
  await svc.revoke(rec.matchId);
  assert.equal(svc.record(rec.matchId)?.status, "revoked");
  await svc.pump();
  assert.equal(demo.client.book.matches[rec.matchId].status, "revoked");
});

test("actions need a relay; meta and demo state validate on load", async () => {
  const svc = new MatchService({ now, psi: INSECURE_plaintextPsiForTests(), history: () => [], persist: () => {}, onChange: () => {} });
  await svc.start(generateIdentity(), null, "no relays", null);
  await assert.rejects(svc.requestMatch("a".repeat(64), DEFAULT_CONSENT, false), /add a relay first/);
  assert.equal(svc.records().length, 0, "nothing half-sent");
  assert.deepEqual(loadMeta({ names: { ["b".repeat(64)]: { name: "Ines", source: "creator" }, bad: { name: "x" } }, log: [{ at: 1, text: "t" }, 5] }), {
    names: { ["b".repeat(64)]: { name: "Ines", source: "creator", ref: undefined } },
    log: [{ at: 1, text: "t" }],
  });
  assert.equal(loadDemoSaved({ secret: "nothex", items: [] }), null);
  assert.deepEqual(pickDemoItems(["c", "a", "b", "a"], 5), ["a", "c"]);
});

test("real OpenMined PSI loads lazily and runs a preview end to end", async () => {
  resetPsiForTests();
  const psi = lazyPsi(() => testPsi());
  assert.equal(psiStatus().state, "idle", "nothing loaded until a preview runs");
  const { svc, demo } = await setup(psi);
  await svc.requestMatch(demo.pubkey, DEFAULT_CONSENT, true);
  assert.equal(psiStatus().state, "ready");
  const r = svc.records()[0].preview?.result;
  assert.ok(r);
  assert.ok(["fewer-than-floor", "a-few", "some", "a-lot"].includes(r.bucket));

  resetPsiForTests();
  const broken = lazyPsi(() => Promise.reject(new WebAssembly.CompileError("blocked by CSP")));
  const s2 = await setup(broken);
  await s2.demo.requestViewer(s2.svc.book!.self, true);
  await s2.svc.sync();
  const rec = s2.svc.records()[0];
  await assert.rejects(s2.svc.respondToPreview(rec.matchId, true), /preview unavailable/);
  assert.equal(psiStatus().state, "unavailable");
  await s2.svc.accept(rec.matchId, DEFAULT_CONSENT);
  assert.equal(s2.svc.record(rec.matchId)?.status, "active", "the rest of Match still works");
  resetPsiForTests();
});
