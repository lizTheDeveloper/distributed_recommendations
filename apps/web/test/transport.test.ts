// The private relay (packages/transport's OhttpRelay), through apps/web's import path,
// against transport's in-process OHTTP relay + gateway + target + Nostr relay stack.
import { test } from "node:test";
import assert from "node:assert/strict";
import { OhttpRelay } from "../src/lib/transport/pkg.ts";
import { randomPubkey, startStack, wrapLike } from "../../../packages/transport/test/helpers.ts";
import { loadSettings } from "../src/lib/settings.ts";

test("OHTTP relay: Match gift wraps publish and query through the private relay", async () => {
  const s = await startStack();
  const t = new OhttpRelay({ relayUrl: s.relayUrl, fetch: s.fetch, pins: [s.gateway.pin], batchDelayMs: { min: 1, max: 5 } });
  try {
    const p = randomPubkey();
    const e = wrapLike(p, { contentBytes: 2000 });
    assert.equal((await t.publish(e)).ok, true);
    const got = await t.query({ kinds: [1059], "#p": [p] });
    assert.deepEqual(got.map((x) => x.id), [e.id]);
  } finally {
    t.close();
    await s.close();
  }
});

test("OHTTP relay refuses a gateway key that doesn't match the build's pin", async () => {
  const s = await startStack();
  const t = new OhttpRelay({ relayUrl: s.relayUrl, fetch: s.fetch, pins: ["0".repeat(64)], batchDelayMs: { min: 1, max: 5 } });
  try {
    const r = await t.publish(wrapLike(randomPubkey()));
    assert.equal(r.ok, false);
    assert.match(r.message, /not pinned/);
  } finally {
    t.close();
    await s.close();
  }
});

test("transport setting: private by default for new installs, existing relay lists stay direct", () => {
  assert.equal(loadSettings({}).matchTransport, "ohttp");
  assert.equal(loadSettings({ relays: ["wss://relay.example"] }).matchTransport, "direct");
  assert.equal(loadSettings({ relays: ["wss://relay.example"], matchTransport: "ohttp" }).matchTransport, "ohttp");
  assert.equal(loadSettings({ matchTransport: "carrier pigeon" }).matchTransport, "ohttp");
});
