import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fromNative, fromShareParams, peertubeWatch, startRoute } from "../src/lib/incoming.ts";
import { npubEncode, bech32Encode, hexToBytes } from "../src/lib/bech32.ts";
import { chooseNsfw, effectivePolicy, emptyModState, loadModState, reasonText, sourceMetaFor, storeModState, undoableBlock, blockChoices, block } from "../src/lib/modstate.ts";
import { applyModeration, defaultPolicy } from "../src/lib/moderation/pkg.ts";
import { emptyPicksDraft, endorsedChoices, loadPicksDraft, togglePick, editPick } from "../src/lib/picks.ts";
import { loadVideo } from "../src/lib/videos.ts";
import { loadSettings } from "../src/lib/settings.ts";
import { shouldOnboard } from "../src/ui/onboarding.ts";

const PK = "f".repeat(63) + "1";
const W = "https://tilvids.com/videos/watch/9c9de5e8-0a1e-484a-b099-e80766180a6d";
const vid = (over: Record<string, unknown> = {}) =>
  loadVideo({ id: W, title: "Cob oven build", creator: "hearth@craft.example", creatorName: "Hearth", publishedAt: "2026-10-01T00:00:00Z", tags: ["diy", "ovens"], durationSec: 60, ...over })!;

test("brand: one constant drives index.html, the artifact title and the manifest", () => {
  const brand = JSON.parse(readFileSync(new URL("../src/brand.json", import.meta.url), "utf8"));
  assert.equal(brand.name, "Multiverse Video");
  // apps/mobile/brand.json names the native apps; the two must agree.
  assert.equal(JSON.parse(readFileSync(new URL("../../mobile/brand.json", import.meta.url), "utf8")).displayName, brand.name);
  const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  assert.ok(html.includes("<title>__APP_NAME__</title>"));
  assert.ok(!/Match Feed/.test(html));
  const build = readFileSync(new URL("../scripts/build.mjs", import.meta.url), "utf8");
  assert.ok(build.includes("`<title>${escHtml(brand.name)}</title>`"));
  // Internal identifiers are deliberately unchanged, so existing data keeps working.
  assert.ok(readFileSync(new URL("../src/lib/vault.ts", import.meta.url), "utf8").includes('IDB_NAME = "match-feed"'));
  assert.ok(readFileSync(new URL("../src/lib/storage.ts", import.meta.url), "utf8").includes('PREFIX = "mf.v1."'));
});

test("incoming: native deep links and shares are checked, never trusted", () => {
  assert.deepEqual(fromNative({ kind: "nostr", source: "deeplink", value: npubEncode(PK) }), { kind: "match", pubkey: PK, source: "deeplink" });
  // nprofile: TLV 0 = pubkey, 1 = relay hint.
  const relay = new TextEncoder().encode("wss://r.example");
  const tlv = new Uint8Array([0, 32, ...hexToBytes(PK), 1, relay.length, ...relay]);
  assert.equal((fromNative({ kind: "nostr", source: "share", value: bech32Encode("nprofile", tlv) }) as { pubkey: string }).pubkey, PK);
  assert.equal(fromNative({ kind: "nostr", source: "deeplink", value: "nsec1abc" }), null);
  assert.deepEqual(fromNative({ kind: "peertube-watch", source: "share", value: W + "?t=10", host: "tilvids.com", videoId: "x" }), { kind: "video", url: W, host: "tilvids.com", videoId: "9c9de5e8-0a1e-484a-b099-e80766180a6d", source: "share" });
  assert.equal(peertubeWatch("http://tilvids.com/w/abcdefgh"), null, "https only");
  assert.equal(peertubeWatch("https://u:p@tilvids.com/w/abcdefgh"), null, "no user info");
});

test("PWA share target and shortcuts", () => {
  const a = fromShareParams(new URLSearchParams({ share_text: `Look at this ${W}.` }));
  assert.equal(a?.kind, "video");
  const b = fromShareParams(new URLSearchParams({ share_text: `match me nostr:${npubEncode(PK)}` }));
  assert.deepEqual(b, { kind: "match", pubkey: PK, source: "share" });
  assert.equal(fromShareParams(new URLSearchParams({ share_url: "https://example.org/" })), null);
  assert.deepEqual(startRoute(new URLSearchParams("view=grid&screen=matches"), ["home", "matches"]), { view: "grid", screen: "matches" });
  assert.deepEqual(startRoute(new URLSearchParams("screen=admin"), ["home"]), {});
});

test("moderation state: stored encrypted as JSON, defaults blur NSFW, iOS forces hide", () => {
  const m = emptyModState();
  assert.equal(m.policy.settings.nsfw, "blur");
  assert.equal(m.policy.settings.labelers.length, 0, "no labelers by default");
  const back = loadModState(JSON.parse(JSON.stringify(storeModState({ ...m, policy: block(m.policy, "keyword", "crypto") }))));
  assert.deepEqual(back.policy.blocks.keywords, ["crypto"]);
  assert.deepEqual(loadModState({ policy: "{not json" }).policy, defaultPolicy());
  assert.equal(effectivePolicy(m.policy, "ios").settings.nsfw, "hide");
  assert.equal(effectivePolicy(m.policy, "android").settings.nsfw, "blur");
  assert.equal(effectivePolicy(m.policy, undefined), m.policy);
});

test("NSFW 'show' takes two separate actions", () => {
  const s = defaultPolicy().settings;
  assert.equal(chooseNsfw(s, "show", false, 1), "confirm");
  const shown = chooseNsfw(s, "show", true, 1234);
  assert.ok(shown !== "confirm" && shown.nsfw === "show" && shown.adultConfirmedAt === 1234);
  const hidden = chooseNsfw(s, "hide", false, 1);
  assert.ok(hidden !== "confirm" && hidden.nsfw === "hide");
});

test("block, mute and 'N hidden' with reasons; blocking a curator drops their source", () => {
  const v = vid();
  const choices = blockChoices(v);
  assert.deepEqual(choices.map((c) => c.kind), ["creator", "instance", "tag", "tag"]);
  let p = block(defaultPolicy(), "tag", "ovens");
  let r = applyModeration([{ video: v, source: { kind: "explore" } }], p);
  assert.equal(r.hiddenCount, 1);
  assert.equal(reasonText(r.hidden[0].reasons[0]), "Muted tag: #ovens");
  assert.deepEqual(undoableBlock(r.hidden[0].reasons[0]), { kind: "tag", value: "ovens" });
  // A taste list by a blocked curator: its source is dropped; a follow keeps the video.
  p = block(defaultPolicy(), "npub", PK);
  const src = sourceMetaFor(new Map([["Slow craft", { pubkey: PK, list: "Slow craft" }]]), new Map());
  r = applyModeration([{ video: v, source: { kind: "taste", via: "Slow craft" } }], p, { sourceMeta: (s) => src(s) });
  assert.equal(r.hiddenCount, 1);
  assert.match(reasonText(r.hidden[0].reasons[0]), /source you blocked/);
  r = applyModeration([{ video: v, source: { kind: "taste", via: "Slow craft" } }, { video: v, source: { kind: "follow" } }], p, { sourceMeta: (s) => src(s) });
  assert.equal(r.hiddenCount, 0);
  assert.equal(r.allowed.length, 1);
});

test("picks draft: from endorsements, dated when picked, flags, strict validation on load", () => {
  const hist = [
    { videoId: W, at: 2, kind: "endorse" as const, tags: [] },
    { videoId: W, at: 1, kind: "watch" as const, tags: [] },
    { videoId: "https://a.example/videos/watch/11111111-1111-4111-8111-111111111111", at: 3, kind: "endorse" as const, tags: [] },
  ];
  const c = endorsedChoices(hist, (id) => (id === W ? vid() : undefined));
  assert.deepEqual(c.map((x) => x.id), ["https://a.example/videos/watch/11111111-1111-4111-8111-111111111111", W]);
  let set = togglePick(emptyPicksDraft().set, W, 1_800_000_000_000);
  assert.equal(set.items[0].addedAt, 1_800_000_000);
  set = editPick(set, W, { sponsored: true, note: "paid" });
  assert.equal(set.items[0].sponsored, true);
  const d = loadPicksDraft(JSON.parse(JSON.stringify({ set, dryRun: false })));
  assert.equal(d.dryRun, false);
  assert.equal(loadPicksDraft({ set: { d: "", title: "x", items: [] } }).set.items.length, 0, "invalid: starts over");
  assert.equal(loadPicksDraft(null).dryRun, true, "dry run by default");
  set = togglePick(set, W, 0);
  assert.equal(set.items.length, 0);
});

test("onboarding: only for a new viewer; settings carry onboarded and topics", () => {
  assert.equal(shouldOnboard({ follows: [], taste: [], tasteFollows: [], history: [] }), true);
  assert.equal(shouldOnboard({ follows: [{ handle: "a@b.c", addedAt: 0 }], taste: [], tasteFollows: [], history: [] }), false);
  const s = loadSettings({ onboarded: true, topics: ["Science", "bad topic!", "music"] });
  assert.equal(s.onboarded, true);
  assert.deepEqual(s.topics, ["science", "music"]);
  assert.equal(loadSettings({}).onboarded, false);
});

test("service worker: precache list and id come from the build; never caches cross-origin", () => {
  const sw = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");
  assert.ok(sw.includes('"__PRECACHE__"') && sw.includes("__BUILD__"));
  assert.ok(sw.includes("if (url.origin !== self.location.origin) return;"));
  assert.ok(!sw.includes("skipWaiting()") || sw.includes('e.data === "skip-waiting"'), "updates wait for the viewer");
});
