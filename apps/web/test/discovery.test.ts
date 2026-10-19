import { test } from "node:test";
import assert from "node:assert/strict";
import { channelTotals, configsDue, emptyDiscovery, helperAllowlist, loadConfigs, noteView, validConfigs } from "../src/lib/discovery.ts";
import { defaultSettings } from "../src/lib/settings.ts";
// The analytics package's own fixture: a config its checks accept.
import { CREATOR, NOW, validConfig } from "../../../packages/analytics/test/helpers.ts";

const HELPER = new URL((validConfig() as { helper: string }).helper).origin;

test("view hook: creator and channel only, never the video; switches and private watching apply", () => {
  const s = defaultSettings();
  let d = emptyDiscovery();
  d = noteView(d, "Alice@Videos.Example", "taste", NOW, s);
  d = noteView(d, "alice@videos.example", undefined, NOW, s);
  const json = JSON.stringify(d);
  assert.ok(!json.includes("watch"), "no video URL stored");
  const t = channelTotals(d.ledger);
  assert.equal(t.taste, 1);
  assert.equal(t.other, 1, "no context counts as other");
  s.privateWatching = true;
  assert.equal(noteView(d, "alice@videos.example", "follow", NOW, s), d);
  s.privateWatching = false;
  s.analytics.perKind.match = false;
  assert.equal(noteView(d, "alice@videos.example", "match", NOW, s), d);
  s.analytics.contribute = false;
  assert.equal(noteView(d, "alice@videos.example", "follow", NOW, s), d);
});

test("helper allowlist from the build: https origins only; empty means off", () => {
  assert.deepEqual(helperAllowlist(""), []);
  assert.deepEqual(helperAllowlist(undefined), []);
  assert.deepEqual(helperAllowlist("https://h.example.org/, http://x.example/ https://y.example.org/dap/ nonsense"), ["https://h.example.org", "https://y.example.org"]);
});

test("configs: re-checked on load against the build's allowlist; lookups due daily", () => {
  const stored = { [CREATOR]: { config: validConfig(), checkedAt: NOW.getTime() }, "bob@x.example": { config: null, checkedAt: 0, reason: "none" } };
  const ok = loadConfigs(stored, [HELPER], NOW);
  assert.ok(ok[CREATOR].config);
  assert.equal(validConfigs({ ...emptyDiscovery(), configs: ok }).size, 1);
  const off = loadConfigs(stored, [], NOW);
  assert.equal(off[CREATOR], undefined, "no allowlist: dropped");
  let d = noteView(emptyDiscovery(), CREATOR, "follow", NOW, defaultSettings());
  d = noteView(d, "bob@x.example", "follow", NOW, defaultSettings());
  d = { ...d, configs: ok };
  assert.deepEqual(configsDue(d, NOW.getTime()), ["bob@x.example"]);
});
