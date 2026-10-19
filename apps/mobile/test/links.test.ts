import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyLink, classifySharedText, parseNostr, parsePeerTubeWatch, parseShareHandoff } from "../bridge/links.ts";

const NPUB = "npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6";

test("nostr entities", () => {
  assert.equal(parseNostr(`nostr:${NPUB}`), NPUB);
  assert.equal(parseNostr(`nostr://${NPUB}`), NPUB);
  assert.equal(parseNostr(NPUB.toUpperCase()), NPUB);
  assert.equal(parseNostr("nostr:nsec1abcdefgh"), null, "never accept a secret key from a link");
  assert.equal(parseNostr("nostr:note1qqqqqqqqqq"), null);
  assert.equal(parseNostr("npub1bio"), null, "b, i and o are not in the bech32 charset");
});

test("PeerTube watch URLs", () => {
  const short = "https://framatube.org/w/9c9de5e8-0a1e-484a-b099-e80766180a6d";
  assert.deepEqual(parsePeerTubeWatch(short), { value: short, host: "framatube.org", videoId: "9c9de5e8-0a1e-484a-b099-e80766180a6d" });
  const long = parsePeerTubeWatch("https://tilvids.com/videos/watch/kkGMgK9ZtnKfYAgnEtQxbv?start=1m30s#x");
  assert.equal(long?.value, "https://tilvids.com/w/kkGMgK9ZtnKfYAgnEtQxbv?start=1m30s");
  assert.equal(parsePeerTubeWatch("http://tilvids.com/w/kkGMgK9ZtnKfYAgnEtQxbv"), null, "https only");
  assert.equal(parsePeerTubeWatch("https://user:pw@tilvids.com/w/kkGMgK9ZtnKfYAgnEtQxbv"), null);
  assert.equal(parsePeerTubeWatch("https://tilvids.com/w/../../etc"), null);
  assert.equal(parsePeerTubeWatch("https://example.com/watch?v=abc"), null);
  assert.equal(parsePeerTubeWatch("javascript:alert(1)"), null);
});

test("shared text picks the first usable item", () => {
  const hit = classifySharedText("Great talk (https://tilvids.com/w/kkGMgK9ZtnKfYAgnEtQxbv). Watch it!");
  assert.equal(hit?.kind, "peertube-watch");
  assert.equal(hit?.source, "share");
  assert.equal(classifySharedText(`follow me: nostr:${NPUB}`)?.value, NPUB);
  assert.equal(classifySharedText("nothing here"), null);
  assert.equal(classifySharedText("x".repeat(5000)), null);
});

test("deep links", () => {
  assert.equal(classifyLink(`nostr:${NPUB}`, "deeplink")?.kind, "nostr");
  assert.equal(classifyLink("memevideo://share?text=hi", "deeplink"), null);
});

test("share handoff URL", () => {
  assert.deepEqual(parseShareHandoff("memevideo://share?text=a%20b", "memevideo"), { text: "a b" });
  assert.deepEqual(parseShareHandoff("memevideo://share", "memevideo"), { text: null });
  assert.equal(parseShareHandoff("otherapp://share?text=a", "memevideo"), null);
  assert.equal(parseShareHandoff("memevideo://open", "memevideo"), null);
});
