import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CONFIG_D_TAG,
  checkTaskConfig,
  configFilter,
  configPointerFromDescription,
  parseTaskConfig,
  taskConfigFromNostrEvent,
} from "../src/config.ts";
import { CREATOR, NOW, opts, validConfig } from "./helpers.ts";

test("a valid config passes", () => {
  const r = checkTaskConfig(validConfig(), opts);
  assert.equal(r.ok, true);
});

const bad: [string, Record<string, unknown>, string][] = [
  ["unknown key", { extra: 1 }, "unknown-key"],
  ["wrong creator", { creator: "mallory@videos.example" }, "creator-mismatch"],
  ["short task id", { taskId: "abc" }, "task-id"],
  ["http leader", { leader: "http://dap.videos.example/" }, "endpoint"],
  ["leader with query", { leader: "https://dap.videos.example/?x=1" }, "endpoint"],
  ["leader with credentials", { leader: "https://u:p@dap.videos.example/" }, "endpoint"],
  ["helper == leader host", { helper: "https://dap.videos.example/" }, "helper-not-independent"],
  ["helper on leader's domain", { helper: "https://helper.videos.example/" }, "helper-not-independent"],
  ["helper not on allowlist", { helper: "https://my-own-helper.example.net/" }, "helper-not-allowed"],
  ["no operator", { helperOperator: "" }, "helper-operator"],
  ["other DAP draft", { dap: "dap-18" }, "dap-version"],
  ["other VDAF", { vdaf: { type: "Prio3SumVec", length: 8, chunkLength: 3 } }, "vdaf"],
  ["reordered channels", { channels: ["taste", "follow", "match", "circle", "second", "explore", "search", "other"] }, "channels"],
  ["per-day window", { windowSeconds: 86400 }, "window"],
  ["tiny batches", { minBatchSize: 5 }, "min-batch-size"],
  ["no DP", { dp: undefined }, "dp"],
  ["huge epsilon", { dp: { mechanism: "discrete-laplace", epsilon: "10", appliedBy: "each-aggregator" } }, "dp-epsilon-too-large"],
  ["collector-only noise", { dp: { mechanism: "discrete-laplace", epsilon: "1", appliedBy: "collector" } }, "dp"],
  ["low threshold", { displayThreshold: 5 }, "display-threshold"],
  ["expired", { expires: Math.floor(NOW.getTime() / 1000) - 1 }, "expired"],
  ["bad hpke hint", { hpke: { helper: "!!" } }, "hpke"],
];
for (const [name, over, reason] of bad) {
  test(`config rejected: ${name}`, () => {
    const c = validConfig(over);
    if ("dp" in over && over.dp === undefined) delete (c as Record<string, unknown>).dp;
    const r = checkTaskConfig(c, opts);
    assert.deepEqual(r, { ok: false, reason });
  });
}

test("an empty helper allowlist refuses everything", () => {
  assert.deepEqual(checkTaskConfig(validConfig(), { ...opts, allowedHelpers: [] }), { ok: false, reason: "helper-not-allowed" });
});

test("local http only with allowInsecureLocalhost", () => {
  const c = validConfig({ leader: "http://127.0.0.1:19001/", helper: "http://127.0.0.1:19002/" });
  const o = { ...opts, allowedHelpers: ["http://127.0.0.1:19002"] };
  assert.equal(checkTaskConfig(c, o).ok, false);
  assert.equal(checkTaskConfig(c, { ...o, allowInsecureLocalhost: true }).ok, true);
});

test("parseTaskConfig: size checked before parsing, bad JSON refused", () => {
  assert.deepEqual(parseTaskConfig("x".repeat(5000), opts), { ok: false, reason: "too-large" });
  assert.deepEqual(parseTaskConfig("{", opts), { ok: false, reason: "json" });
  assert.equal(parseTaskConfig(JSON.stringify(validConfig()), opts).ok, true);
});

test("Nostr event: kind, d tag, author and signature are all checked; verify sees a fresh object", () => {
  const pubkey = "a".repeat(64);
  const event = {
    id: "e".repeat(64),
    pubkey,
    created_at: 1,
    kind: 30078,
    tags: [["d", CONFIG_D_TAG]],
    content: JSON.stringify(validConfig()),
    sig: "s".repeat(128),
    [Symbol.for("verified")]: true,
  };
  let seen: unknown;
  const verify = (e: unknown) => {
    seen = e;
    return true;
  };
  assert.equal(taskConfigFromNostrEvent(event, { ...opts, pubkey, verify }).ok, true);
  assert.notEqual(seen, event);
  assert.equal(Object.getOwnPropertySymbols(seen as object).length, 0);
  assert.equal(taskConfigFromNostrEvent({ ...event, kind: 1 }, { ...opts, pubkey, verify }).ok, false);
  assert.equal(taskConfigFromNostrEvent({ ...event, pubkey: "b".repeat(64) }, { ...opts, pubkey, verify }).ok, false);
  assert.equal(taskConfigFromNostrEvent({ ...event, tags: [["d", "other"]] }, { ...opts, pubkey, verify }).ok, false);
  assert.deepEqual(taskConfigFromNostrEvent(event, { ...opts, pubkey, verify: () => false }), { ok: false, reason: "event-signature" });
  assert.deepEqual(configFilter(pubkey), { kinds: [30078], authors: [pubkey], "#d": [CONFIG_D_TAG], limit: 1 });
});

test("channel description pointer must be https on the creator's own host", () => {
  const d = "My channel.\ndiscovery-stats: https://videos.example/static/alice-dap.json\nmore";
  assert.equal(configPointerFromDescription(d, CREATOR)?.toString(), "https://videos.example/static/alice-dap.json");
  assert.equal(configPointerFromDescription("discovery-stats: https://evil.example/x.json", CREATOR), null);
  assert.equal(configPointerFromDescription("discovery-stats: http://videos.example/x.json", CREATOR), null);
  assert.equal(configPointerFromDescription("nothing here", CREATOR), null);
});
