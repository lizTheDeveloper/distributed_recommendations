// End to end against real Janus 0.7.143: a leader stack and a helper stack (separate
// compose projects, separate Postgres, separate secrets), plus Janus's interop
// collector as the creator. Synthetic viewers record views, plan reports for the
// closed window, upload them through this package's client, the creator collects, and
// the result goes through the threshold.
//
// Runs only with ANALYTICS_E2E=1 (`npm run test:e2e`) and a working Docker daemon;
// otherwise it is skipped with the reason. Pulls images on first run. ~2-3 minutes.
// KEEP_STACKS=1 leaves the containers up for inspection.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import {
  CHANNELS,
  checkTaskConfig,
  divviupClient,
  emptyLedger,
  planReports,
  postprocess,
  publishable,
  recordView,
  runUploads,
  windowEnd,
  windowIndex,
  windowStart,
  centered,
  type ContributionSettings,
  type Ledger,
  type TaskConfig,
  type UploadJob,
} from "../src/index.ts";
import { seededRng } from "../src/core.ts";

const JANUS = fileURLToPath(new URL("../../../infra/janus/", import.meta.url));
const LEADER_PORT = Number(process.env.E2E_LEADER_PORT ?? 19001);
const HELPER_PORT = Number(process.env.E2E_HELPER_PORT ?? 19002);
const COLLECTOR_PORT = Number(process.env.E2E_COLLECTOR_PORT ?? 19003);
const DOCKERHUB = process.env.DOCKERHUB ?? "mirror.gcr.io";

function dockerOk(): string | null {
  if (process.env.ANALYTICS_E2E !== "1") return "set ANALYTICS_E2E=1 (npm run test:e2e) to run against Docker";
  try {
    execFileSync("docker", ["info"], { stdio: "ignore", timeout: 20_000 });
    execFileSync("docker", ["compose", "version"], { stdio: "ignore", timeout: 20_000 });
    return null;
  } catch {
    return "docker (with compose) is not available";
  }
}
const skip = dockerOk();

const work = mkdtempSync(join(tmpdir(), "mf-dap-e2e-"));
const b64key = () => randomBytes(16).toString("base64url");
const envFile = (name: string, vars: Record<string, string>) => {
  const p = join(work, name);
  writeFileSync(p, Object.entries(vars).map(([k, v]) => `${k}=${v}`).join("\n") + "\n", { mode: 0o600 });
  return p;
};
const leaderEnv = () =>
  envFile("leader.env", { PGPASSWORD: randomBytes(12).toString("hex"), DATASTORE_KEYS: b64key(), DOCKERHUB, LEADER_PORT: String(LEADER_PORT), TASKS_DIR: join(work, "leader/tasks") });
const helperEnv = () =>
  envFile("helper.env", { PGPASSWORD: randomBytes(12).toString("hex"), DATASTORE_KEYS: b64key(), DOCKERHUB, HELPER_PORT: String(HELPER_PORT), TASKS_DIR: join(work, "helper/tasks") });

let leaderEnvPath = "";
let helperEnvPath = "";
const compose = (role: "leader" | "helper", args: string[], timeout = 600_000) =>
  execFileSync(
    "docker",
    ["compose", "-p", `mf-e2e-${role}`, "--env-file", role === "leader" ? leaderEnvPath : helperEnvPath, "-f", join(JANUS, role, "compose.yaml"), "-f", join(JANUS, "test", `${role}.e2e.yaml`), ...args],
    { encoding: "utf8", timeout, stdio: ["ignore", "pipe", "pipe"] },
  );
const collectorCompose = (args: string[]) =>
  execFileSync("docker", ["compose", "-f", join(JANUS, "test", "collector.e2e.yaml"), ...args], {
    encoding: "utf8",
    timeout: 300_000,
    env: { ...process.env, COLLECTOR_PORT: String(COLLECTOR_PORT) },
    stdio: ["ignore", "pipe", "pipe"],
  });

async function until<T>(what: string, f: () => Promise<T | undefined>, ms = 180_000): Promise<T> {
  const end = Date.now() + ms;
  let last: unknown;
  while (Date.now() < end) {
    try {
      const v = await f();
      if (v !== undefined) return v;
    } catch (e) {
      last = e;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`timed out waiting for ${what}: ${String(last)}`);
}

const collector = async (path: string, body: unknown) => {
  const r = await fetch(`http://127.0.0.1:${COLLECTOR_PORT}/internal/test/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await r.json()) as Record<string, unknown>;
};

function down() {
  if (process.env.KEEP_STACKS === "1") return;
  for (const role of ["leader", "helper"] as const) {
    try {
      compose(role, ["down", "-v", "--remove-orphans"], 120_000);
    } catch {}
  }
  try {
    collectorCompose(["down"]);
  } catch {}
}

let taskConfig: TaskConfig;
let collectorToken = "";

before(async () => {
  if (skip) return;
  leaderEnvPath = leaderEnv();
  helperEnvPath = helperEnv();
  try {
    execFileSync("docker", ["network", "create", "mf-dap-e2e"], { stdio: "ignore" });
  } catch {} // exists
  down();
  compose("leader", ["up", "-d", "--wait", "--wait-timeout", "240"]);
  compose("helper", ["up", "-d", "--wait", "--wait-timeout", "240"]);
  collectorCompose(["up", "-d"]);
  await until("collector", async () => ((await collector("ready", {})) ? true : undefined));

  // The creator's collector makes its HPKE key for the task; then the operators provision.
  const taskId = randomBytes(32).toString("base64url");
  collectorToken = randomBytes(24).toString("base64url");
  const added = await collector("add_task", {
    task_id: taskId,
    leader: "http://leader-aggregator:8080/",
    vdaf: { type: "Prio3Histogram", length: "8", chunk_length: "3" },
    collector_authentication_token: collectorToken,
    query_type: 1,
  });
  assert.equal(added.status, "success", JSON.stringify(added));
  execFileSync(process.execPath, [
    join(JANUS, "scripts", "new-task.mjs"),
    "--name", "e2e", "--creator", "alice@videos.example", "--task-id", taskId,
    "--leader-url", `http://127.0.0.1:${LEADER_PORT}/`, "--helper-url", `http://127.0.0.1:${HELPER_PORT}/`,
    "--leader-peer-url", "http://leader-aggregator:8080/", "--helper-peer-url", "http://helper-aggregator:8080/",
    "--helper-operator", "Local test helper", "--epsilon", "1",
    "--collector-hpke-config", String(added.collector_hpke_config), "--collector-auth-token", collectorToken,
    "--out", work,
  ], { stdio: "ignore" });
  // The containers run as nobody; the task files are 0600 for the operator.
  for (const role of ["leader", "helper"]) for (const f of readdirSync(join(work, role, "tasks"))) chmodSync(join(work, role, "tasks", f), 0o644);
  compose("leader", ["run", "--rm", "-T", "cli", "provision-tasks", "--generate-missing-parameters", "/tasks/e2e.leader.yaml"]);
  compose("helper", ["run", "--rm", "-T", "cli", "provision-tasks", "--generate-missing-parameters", "/tasks/e2e.helper.yaml"]);
  // The job creator reloads tasks every 5 minutes; restart it to pick this one up now.
  compose("leader", ["restart", "aggregation_job_creator"]);

  const r = checkTaskConfig(JSON.parse(readFileSync(join(work, "creator/e2e/task-config.json"), "utf8")), {
    creator: "alice@videos.example",
    now: new Date(),
    allowedHelpers: [`http://127.0.0.1:${HELPER_PORT}`],
    allowInsecureLocalhost: true,
  });
  assert.ok(r.ok, JSON.stringify(r));
  taskConfig = r.config;
});

after(() => {
  if (!skip) down();
});

test("e2e: synthetic viewers -> DAP upload -> Janus leader+helper -> collect -> threshold + DP", { skip: skip ?? false, timeout: 900_000 }, async () => {
  const rng = seededRng(2026);
  const creator = "alice@videos.example";
  // The window that just closed, as the devices see it: plan at its end + 1 minute.
  const prevWindow = windowIndex(new Date()) - 1;
  const viewAt = new Date((windowStart(prevWindow) + 86400) * 1000);
  const planNow = new Date((windowEnd(prevWindow) + 60) * 1000);
  const sendNow = new Date((windowEnd(prevWindow) + 74 * 3600) * 1000);

  // Weighted dominant channels so some buckets clear 20 and others stay under it.
  const weights: [string, number][] = [["follow", 0.45], ["taste", 0.3], ["explore", 0.1], ["match", 0.05], ["search", 0.05], ["other", 0.05]];
  const pick = () => {
    let x = rng();
    for (const [c, w] of weights) if ((x -= w) < 0) return c;
    return "other";
  };
  const on: ContributionSettings = { contribute: true, perChannel: {}, privateWatching: false };
  const viewers: { ledger: Ledger; settings: ContributionSettings }[] = [];
  for (let i = 0; i < 80; i++) {
    let settings = on;
    if (i % 20 === 0) settings = { ...on, perChannel: { match: false } }; // some never report Match
    if (i === 1) settings = { ...on, privateWatching: true }; // records nothing
    if (i === 2) settings = { ...on, contribute: false }; // records nothing
    let ledger = emptyLedger();
    const main = pick();
    const n = 1 + Math.floor(rng() * 4);
    for (let k = 0; k < n; k++) ledger = recordView(ledger, { creator, channel: main as never, at: viewAt }, settings);
    if (rng() < 0.5) ledger = recordView(ledger, { creator, channel: "explore", at: viewAt }, settings);
    viewers.push({ ledger, settings });
  }

  const configs = new Map([[creator, taskConfig]]);
  const client = divviupClient();
  const truth = Array(CHANNELS.length).fill(0) as number[];
  let sent = 0;
  for (const v of viewers) {
    const planned = planReports(v.ledger, [], { now: planNow, settings: v.settings, configs, rng });
    assert.deepEqual(planned.ledger.windows, {}, "closed window deleted after planning");
    let jobs: UploadJob[] = planned.jobs;
    for (const j of jobs) truth[j.measurement]!++;
    for (let attempt = 0; attempt < 5 && jobs.length > 0; attempt++) {
      const r = await runUploads(jobs, { now: sendNow, settings: v.settings, configs, client, rng, maxPerRun: Infinity });
      sent += r.sent;
      jobs = r.jobs.map((j) => ({ ...j, notBefore: 0 }));
    }
    assert.equal(jobs.length, 0, "every planned report was accepted");
  }
  const expected = truth.reduce((a, b) => a + b, 0);
  assert.equal(sent, expected);
  assert.ok(expected >= 70 && expected <= 78, `${expected} reports (2 viewers contribute nothing)`);
  assert.equal(truth[CHANNELS.indexOf("match")]! <= 5, true);

  // The creator collects the closed window, once aggregation has run.
  const query = { type: 1, batch_interval_start: windowStart(prevWindow), batch_interval_duration: windowEnd(prevWindow) - windowStart(prevWindow) };
  const collect = async () => {
    for (;;) {
      const started = await collector("collection_start", { task_id: taskConfig.taskId, agg_param: "", query });
      assert.equal(started.status, "success", JSON.stringify(started));
      const res = await until("collection", async () => {
        const p = await collector("collection_poll", { handle: started.handle });
        if (p.status === "complete") return p;
        if (p.status === "error") return p;
        return undefined;
      }, 420_000);
      if (res.status === "complete") return res as { report_count: number; result: string[] };
      // The interop collector gives up after a while; the job continues on the leader.
      // Asking again for the same batch is answered from the same stored result.
    }
  };
  const res = await collect();
  assert.equal(res.report_count, expected, "report count is exact");
  const noisy = res.result.map((x) => Number(centered(x)));
  const diffs = noisy.map((n, i) => n - truth[i]!);
  console.log(`  truth  ${JSON.stringify(truth)}\n  noisy  ${JSON.stringify(noisy)}\n  diff   ${JSON.stringify(diffs)}`);
  // Each aggregator adds discrete Laplace noise (eps 1, sensitivity 2): |noise| > 30 is ~1e-5.
  for (const d of diffs) assert.ok(Math.abs(d) <= 30, `noise ${d} out of range`);
  assert.ok(diffs.some((d) => d !== 0), "DP noise was applied by the aggregators");

  // Collecting the same batch again returns the SAME noisy answer, so noise can't be averaged away.
  const again = await collect();
  assert.deepEqual(again.result, res.result);

  const stats = postprocess({ aggregate: res.result, reportCount: res.report_count, window: { start: query.batch_interval_start, durationSeconds: query.batch_interval_duration } });
  assert.equal(stats.suppressed, false);
  for (const c of stats.channels) {
    if (c.count === null) assert.equal(c.display, "<20");
    else assert.ok(c.count >= 20);
  }
  console.log("  studio view:", JSON.stringify(publishable(stats)));
});
