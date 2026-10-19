import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { test } from "node:test";
import { CHANNEL_INDEX, windowEnd, windowIndex, windowStart } from "../src/channels.ts";
import type { TaskConfig } from "../src/config.ts";
import { seededRng } from "../src/core.ts";
import type { UploadJob } from "../src/report.ts";
import { DEFAULT_CONTRIBUTION } from "../src/settings.ts";
import {
  base64url,
  classifyPut,
  divviupClient,
  guardedFetch,
  runUploads,
  splitHpkeConfigList,
  type DapClient,
  type PutOutcome,
} from "../src/upload.ts";
import { CREATOR, HELPER, LEADER, validConfig } from "./helpers.ts";

const on = { ...DEFAULT_CONTRIBUTION, perChannel: {} };
const W = windowIndex(new Date("2026-10-19T12:00:00Z")) - 1;
const config = validConfig();
const configs = new Map<string, TaskConfig>([[CREATOR, config]]);

function hpkeConfigList(id: number): Uint8Array {
  const pk = Buffer.from(generateKeyPairSync("x25519").publicKey.export({ format: "jwk" }).x!, "base64url");
  const c = Buffer.concat([Buffer.from([id, 0x00, 0x20, 0x00, 0x01, 0x00, 0x01, 0x00, pk.length]), pk]);
  const len = Buffer.alloc(2);
  len.writeUInt16BE(c.length);
  return new Uint8Array(Buffer.concat([len, c]));
}

function job(over: Partial<UploadJob> = {}): UploadJob {
  return {
    id: "j1",
    creator: CREATOR,
    taskId: config.taskId,
    window: W,
    measurement: CHANNEL_INDEX.taste,
    notBefore: windowEnd(W) + 3600,
    deadline: windowEnd(W) + 6 * 86400,
    attempts: 0,
    ...over,
  };
}
const at = (j: UploadJob) => new Date(j.notBefore * 1000);

function fakeClient(outcomes: PutOutcome[]) {
  const calls: { kind: string; arg: unknown }[] = [];
  let n = 0;
  const client: DapClient = {
    async generateReport(_c, m, ts) {
      calls.push({ kind: "generate", arg: { m, ts: ts.getTime() } });
      return new Uint8Array([++n, 1, 2, 3]);
    },
    async putReport(_c, r) {
      calls.push({ kind: "put", arg: [...r] });
      return outcomes.shift() ?? { kind: "accepted" };
    },
  };
  return { client, calls };
}

test("classifyPut: DAP-09 problem types", () => {
  assert.equal(classifyPut(200, "").kind, "accepted"); // Janus 0.7 answers 200
  assert.equal(classifyPut(201, "").kind, "accepted");
  assert.equal(classifyPut(400, JSON.stringify({ type: "urn:ietf:params:ppm:dap:error:outdatedConfig" })).kind, "regenerate");
  assert.equal(classifyPut(400, JSON.stringify({ type: "urn:ietf:params:ppm:dap:error:reportTooEarly" })).kind, "retry");
  assert.equal(classifyPut(400, JSON.stringify({ type: "urn:ietf:params:ppm:dap:error:unrecognizedTask" })).kind, "drop");
  assert.equal(classifyPut(503, "").kind, "retry");
  assert.equal(classifyPut(404, "not json").kind, "drop");
});

test("runUploads sends one due job per run by default, timestamped at the window start", async () => {
  const { client, calls } = fakeClient([]);
  const jobs = [job(), job({ id: "j2", creator: CREATOR })];
  const r = await runUploads(jobs, { now: at(jobs[0]!), settings: on, configs, client, rng: seededRng(1) });
  assert.equal(r.sent, 1);
  assert.equal(r.jobs.length, 1);
  assert.deepEqual(calls[0], { kind: "generate", arg: { m: CHANNEL_INDEX.taste, ts: windowStart(W) * 1000 } });
});

test("a retry resends the same report bytes; persist runs before the PUT", async () => {
  const { client, calls } = fakeClient([{ kind: "retry", detail: "http 503" }]);
  const persisted: UploadJob[][] = [];
  const r1 = await runUploads([job()], {
    now: at(job()), settings: on, configs, client, rng: seededRng(1),
    persist: (j) => void persisted.push(structuredClone(j)),
  });
  assert.equal(r1.sent, 0);
  assert.equal(persisted.length, 1);
  assert.ok(persisted[0]![0]!.report, "report saved before sending");
  const j = r1.jobs[0]!;
  assert.equal(j.attempts, 1);
  assert.ok(j.notBefore > job().notBefore);
  const r2 = await runUploads(r1.jobs, { now: new Date(j.notBefore * 1000), settings: on, configs, client, rng: seededRng(2) });
  assert.equal(r2.sent, 1);
  const puts = calls.filter((c) => c.kind === "put").map((c) => JSON.stringify(c.arg));
  assert.equal(puts.length, 2);
  assert.equal(puts[0], puts[1]);
  assert.equal(calls.filter((c) => c.kind === "generate").length, 1);
});

test("outdatedConfig makes a new report", async () => {
  const { client, calls } = fakeClient([{ kind: "regenerate", detail: "outdatedConfig" }]);
  const r1 = await runUploads([job()], { now: at(job()), settings: on, configs, client, rng: seededRng(1) });
  assert.equal(r1.jobs[0]!.report, undefined);
  await runUploads(r1.jobs, { now: new Date(r1.jobs[0]!.notBefore * 1000), settings: on, configs, client, rng: seededRng(1) });
  assert.equal(calls.filter((c) => c.kind === "generate").length, 2);
});

test("permanent errors, switched-off channels, missing configs and deadlines drop jobs", async () => {
  const { client, calls } = fakeClient([{ kind: "drop", detail: "unrecognizedTask" }]);
  let r = await runUploads([job()], { now: at(job()), settings: on, configs, client, rng: seededRng(1) });
  assert.deepEqual([r.jobs.length, r.dropped[0]?.reason], [0, "unrecognizedTask"]);
  r = await runUploads([job()], { now: at(job()), settings: { ...on, perChannel: { taste: false } }, configs, client, rng: seededRng(1) });
  assert.deepEqual([r.jobs.length, r.dropped[0]?.reason], [0, "switched-off"]);
  r = await runUploads([job()], { now: at(job()), settings: on, configs: new Map(), client, rng: seededRng(1) });
  assert.deepEqual([r.jobs.length, r.dropped[0]?.reason], [0, "no-config"]);
  r = await runUploads([job()], { now: new Date(job().deadline * 1000), settings: on, configs, client, rng: seededRng(1) });
  assert.deepEqual([r.jobs.length, r.dropped[0]?.reason], [0, "deadline"]);
  assert.equal(calls.filter((c) => c.kind === "put").length, 1);
});

test("nothing is sent during private watching (jobs are kept)", async () => {
  const { client, calls } = fakeClient([]);
  const r = await runUploads([job()], { now: at(job()), settings: { ...on, privateWatching: true }, configs, client, rng: seededRng(1) });
  assert.equal(r.jobs.length, 1);
  assert.equal(calls.length, 0);
});

test("guardedFetch allows only hpke_config on the two aggregators and the report PUT on the leader", async () => {
  const seen: { url: string; init?: RequestInit }[] = [];
  const base = async (url: string, init?: RequestInit) => {
    seen.push({ url, init });
    return new Response("", { status: 200 });
  };
  const f = guardedFetch(config, base);
  await f(`${LEADER}hpke_config?task_id=${config.taskId}`);
  await f(`${HELPER}hpke_config?task_id=${config.taskId}`);
  await f(`${LEADER}tasks/${config.taskId}/reports`, { method: "PUT" });
  for (const s of seen) {
    assert.equal(s.init?.credentials, "omit");
    assert.equal(s.init?.referrerPolicy, "no-referrer");
    assert.equal(s.init?.redirect, "error");
  }
  await assert.rejects(f("https://tracker.example/x"));
  await assert.rejects(f(`${HELPER}tasks/${config.taskId}/reports`, { method: "PUT" }), /blocked/);
  await assert.rejects(f(`${LEADER}hpke_config?task_id=other`), /blocked/);
  await assert.rejects(f(`${LEADER}tasks/${config.taskId}/collection_jobs/x`, { method: "PUT" }), /blocked/);
  assert.equal(seen.length, 3);
});

function fakeAggregators(lists: { leader: Uint8Array; helper: Uint8Array }) {
  const requests: { method: string; url: string; body?: Uint8Array; type?: string }[] = [];
  const fetch = async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const body = init?.body ? new Uint8Array(init.body as ArrayBuffer) : undefined;
    requests.push({ method, url, body, type: (init?.headers as Record<string, string> | undefined)?.["Content-Type"] });
    if (url.includes("hpke_config")) {
      const list = url.startsWith(LEADER) ? lists.leader : lists.helper;
      return new Response(list as BodyInit, { status: 200, headers: { "content-type": "application/dap-hpke-config-list" } });
    }
    return new Response(null, { status: 201 });
  };
  return { fetch, requests };
}

test("divviupClient builds a sealed DAP-09 report and uploads it to the leader only", async () => {
  const lists = { leader: hpkeConfigList(7), helper: hpkeConfigList(9) };
  const { fetch, requests } = fakeAggregators(lists);
  const client = divviupClient({ fetch });
  const bytes = await client.generateReport(config, CHANNEL_INDEX.match, new Date(windowStart(W) * 1000));
  assert.ok(bytes.length > 500, `report is ${bytes.length} bytes`);
  // DAP-09 Report: ReportMetadata = report_id (16) || time (u64, seconds)
  const time = new DataView(bytes.buffer, bytes.byteOffset).getBigUint64(16);
  assert.equal(Number(time), windowStart(W));
  const out = await client.putReport(config, bytes);
  assert.deepEqual(out, { kind: "accepted" });
  assert.deepEqual(
    requests.map((r) => `${r.method} ${r.url}`),
    [
      `GET ${LEADER}hpke_config?task_id=${config.taskId}`,
      `GET ${HELPER}hpke_config?task_id=${config.taskId}`,
      `PUT ${LEADER}tasks/${config.taskId}/reports`,
    ],
  );
  assert.equal(requests[2]!.type, "application/dap-report");
  // A second report reuses the fetched keys (no new hpke_config requests) and has a new id.
  const b2 = await client.generateReport(config, CHANNEL_INDEX.match, new Date(windowStart(W) * 1000));
  assert.equal(requests.length, 3);
  assert.notDeepEqual(b2.subarray(0, 16), bytes.subarray(0, 16));
  // Neither plaintext measurement nor creator appears in the report.
  assert.ok(!Buffer.from(bytes).toString("latin1").includes(CREATOR));
});

test("divviupClient refuses when a published HPKE hint does not match the aggregator's key", async () => {
  const lists = { leader: hpkeConfigList(7), helper: hpkeConfigList(9) };
  const { fetch } = fakeAggregators(lists);
  const hinted = validConfig({ hpke: { helper: base64url.enc(hpkeConfigList(9)) } }); // same id, different key
  await assert.rejects(divviupClient({ fetch }).generateReport(hinted, 0, new Date(windowStart(W) * 1000)), /does not match/);
  const good = validConfig({ hpke: { helper: base64url.enc(lists.helper), leader: base64url.enc(lists.leader) } });
  const bytes = await divviupClient({ fetch }).generateReport(good, 0, new Date(windowStart(W) * 1000));
  assert.ok(bytes.length > 500);
});

test("splitHpkeConfigList parses and rejects truncation", () => {
  const l = hpkeConfigList(3);
  assert.equal(splitHpkeConfigList(l).length, 1);
  assert.throws(() => splitHpkeConfigList(l.subarray(0, l.length - 1)));
});
