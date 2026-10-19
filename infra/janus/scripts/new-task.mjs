#!/usr/bin/env node
// Generate one creator's discovery-channel DAP task (docs/ANALYTICS_IMPLEMENTATION.md).
//
//   node infra/janus/scripts/new-task.mjs --name alice --creator alice@videos.example \
//     --leader-url https://dap.videos.example/ --helper-url https://helper.example.org/ \
//     --helper-operator "Example Helper Org"
//
// Writes (under --out, default infra/janus):
//   leader/tasks/<name>.leader.yaml   for the leader's `janus_cli provision-tasks`
//   helper/tasks/<name>.helper.yaml   send to the helper operator over a secure channel, then delete
//   creator/<name>/collector.secret.json   the creator's collector credentials (mode 0600)
//   creator/<name>/collector-credential.json   the same in Janus `collect --collector-credential-file`
//                                     format (only when this script generated the collector key)
//   creator/<name>/task-config.json   the PUBLIC task config the creator publishes (see the
//                                     analytics package, config.ts)
//
// Shared secrets in the two YAML files: the task id (not secret), the VDAF verify key and
// the leader->helper auth token. HPKE keypairs are NOT generated here: `hpke_keys: []`
// plus `--generate-missing-parameters` makes each aggregator create its own keypair in
// its own database, so no private key ever leaves its operator.
//
// No dependencies; Node 22+.

import { createHash, generateKeyPairSync, randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

// Must match packages/analytics/src/channels.ts (CHANNELS, WINDOW_SECONDS, CHUNK_LENGTH).
const CHANNELS = ["follow", "taste", "match", "circle", "second", "explore", "search", "other"];
const WINDOW_SECONDS = 28 * 24 * 3600;
const CHUNK_LENGTH = 3;
const VERIFY_KEY_BYTES = 16; // Prio3 with XofTurboShake128 (VDAF-08)

const { values: a } = parseArgs({
  options: {
    name: { type: "string" },
    creator: { type: "string" },
    "leader-url": { type: "string" },
    "helper-url": { type: "string" },
    "leader-peer-url": { type: "string" },
    "helper-peer-url": { type: "string" },
    "helper-operator": { type: "string" },
    epsilon: { type: "string", default: "1" },
    "min-batch-size": { type: "string", default: "20" },
    "collector-hpke-config": { type: "string" },
    "collector-auth-token": { type: "string" },
    "task-id": { type: "string" },
    "expires-days": { type: "string", default: "400" },
    publish: { type: "boolean", default: false },
    out: { type: "string" },
  },
});

function need(k) {
  if (!a[k]) {
    console.error(`missing --${k}`);
    process.exit(2);
  }
  return a[k];
}

const b64u = (buf) => Buffer.from(buf).toString("base64url");
const token = () => b64u(randomBytes(32));
const sha = (s) => b64u(createHash("sha256").update(s, "utf8").digest());

const name = need("name");
if (!/^[a-z0-9][a-z0-9_-]{0,62}$/.test(name)) throw new Error("--name: lowercase letters, digits, - and _");
const creator = need("creator");
const leaderUrl = new URL(need("leader-url")).toString();
const helperUrl = new URL(need("helper-url")).toString();
const leaderPeer = new URL(a["leader-peer-url"] ?? leaderUrl).toString();
const helperPeer = new URL(a["helper-peer-url"] ?? helperUrl).toString();
const helperOperator = need("helper-operator");
if (new URL(leaderUrl).host === new URL(helperUrl).host) throw new Error("leader and helper must be different hosts");

// epsilon as a rational "a" or "a/b" -> Janus PureDpBudget [[numer digits], [denom digits]] (u32 limbs).
function rational(s) {
  const m = /^(\d+)(?:\/(\d+))?$/.exec(s);
  if (!m) throw new Error("--epsilon: integer or a/b");
  const n = BigInt(m[1]);
  const d = BigInt(m[2] ?? "1");
  if (n === 0n || d === 0n) throw new Error("--epsilon must be > 0");
  const limbs = (x) => {
    const out = [];
    do {
      out.push(Number(x & 0xffffffffn));
      x >>= 32n;
    } while (x > 0n);
    return out;
  };
  return `[[${limbs(n).join(", ")}], [${limbs(d).join(", ")}]]`;
}

// The collector's HPKE config: either the encoded HpkeConfig a collector gave us
// (e.g. the interop collector in the e2e test), or a fresh X25519 keypair.
let collectorHpke;
let collectorPrivate;
if (a["collector-hpke-config"]) {
  const b = Buffer.from(a["collector-hpke-config"], "base64url");
  const len = b.readUInt16BE(7);
  if (b.length !== 9 + len) throw new Error("bad --collector-hpke-config");
  const kem = { 0x20: "X25519HkdfSha256", 0x10: "P256HkdfSha256" }[b.readUInt16BE(1)];
  const kdf = { 1: "HkdfSha256", 2: "HkdfSha384", 3: "HkdfSha512" }[b.readUInt16BE(3)];
  const aead = { 1: "Aes128Gcm", 2: "Aes256Gcm", 3: "ChaCha20Poly1305" }[b.readUInt16BE(5)];
  if (!kem || !kdf || !aead) throw new Error("unsupported collector HPKE suite");
  collectorHpke = { id: b[0], kem, kdf, aead, publicKey: b64u(b.subarray(9)) };
} else {
  const { publicKey, privateKey } = generateKeyPairSync("x25519");
  const pub = publicKey.export({ format: "jwk" }).x;
  const priv = privateKey.export({ format: "jwk" }).d;
  collectorHpke = { id: randomBytes(1)[0], kem: "X25519HkdfSha256", kdf: "HkdfSha256", aead: "Aes128Gcm", publicKey: pub };
  collectorPrivate = priv;
}

const taskId = a["task-id"] ?? b64u(randomBytes(32));
if (Buffer.from(taskId, "base64url").length !== 32 || b64u(Buffer.from(taskId, "base64url")) !== taskId) throw new Error("--task-id: 32 bytes, unpadded base64url");
const verifyKey = b64u(randomBytes(VERIFY_KEY_BYTES));
const aggregatorToken = token();
const collectorToken = a["collector-auth-token"] ?? token();
// A collector we generated uses a Bearer token (what Janus's `collect` tool sends with
// --collector-credential-file). An external collector (e.g. the interop collector in
// the e2e test) sends DAP-Auth-Token.
const collectorTokenType = collectorPrivate ? "Bearer" : "DapAuth";
const minBatch = Number(a["min-batch-size"]);
if (!Number.isInteger(minBatch) || minBatch < 20) throw new Error("--min-batch-size must be an integer >= 20");
const now = Math.floor(Date.now() / 1000);
const expires = now + Number(a["expires-days"]) * 86400;
const eps = rational(a.epsilon);

function taskYaml(role) {
  const lines = [
    `# Discovery-channel task for ${creator} (${role}). Generated ${new Date().toISOString()}.`,
    `# Contains shared secrets (verify key, auth token${role === "Helper" ? " hash" : ""}). Do not commit.`,
    `- task_id: "${taskId}"`,
    `  peer_aggregator_endpoint: "${role === "Leader" ? helperPeer : leaderPeer}"`,
    `  query_type: TimeInterval`,
    `  vdaf: !Prio3Histogram`,
    `    length: ${CHANNELS.length}`,
    `    chunk_length: ${CHUNK_LENGTH}`,
    `    # Each aggregator adds discrete Laplace noise (sensitivity 2) to its own aggregate share.`,
    `    dp_strategy:`,
    `      dp_strategy: PureDpDiscreteLaplace`,
    `      budget:`,
    `        epsilon: ${eps}`,
    `  role: ${role}`,
    `  vdaf_verify_key: "${verifyKey}"`,
    `  # One collection per 28-day batch: re-collecting would average the noise away.`,
    `  max_batch_query_count: 1`,
    `  task_expiration: ${expires}`,
    `  report_expiry_age: 7776000`,
    `  min_batch_size: ${minBatch}`,
    `  # Reports carry only their 28-day window, never the time of the view.`,
    `  time_precision: ${WINDOW_SECONDS}`,
    `  tolerable_clock_skew: 300`,
    `  collector_hpke_config:`,
    `    id: ${collectorHpke.id}`,
    `    kem_id: ${collectorHpke.kem}`,
    `    kdf_id: ${collectorHpke.kdf}`,
    `    aead_id: ${collectorHpke.aead}`,
    `    public_key: ${collectorHpke.publicKey}`,
  ];
  if (role === "Leader") {
    lines.push(
      `  aggregator_auth_token:`,
      `    type: Bearer`,
      `    token: "${aggregatorToken}"`,
      `  collector_auth_token_hash:`,
      `    type: ${collectorTokenType}`,
      `    hash: "${sha(collectorToken)}"`,
    );
  } else {
    lines.push(`  aggregator_auth_token_hash:`, `    type: Bearer`, `    hash: "${sha(aggregatorToken)}"`, `  collector_auth_token_hash:`);
  }
  lines.push(`  # Empty: --generate-missing-parameters makes this aggregator create its own HPKE keypair.`, `  hpke_keys: []`, ``);
  return lines.join("\n");
}

const taskConfig = {
  v: 1,
  kind: "discovery-channels",
  creator,
  taskId,
  leader: leaderUrl,
  helper: helperUrl,
  helperOperator,
  dap: "dap-09",
  vdaf: { type: "Prio3Histogram", length: CHANNELS.length, chunkLength: CHUNK_LENGTH },
  channels: CHANNELS,
  windowSeconds: WINDOW_SECONDS,
  minBatchSize: minBatch,
  dp: { mechanism: "discrete-laplace", epsilon: a.epsilon, appliedBy: "each-aggregator" },
  displayThreshold: 20,
  publish: a.publish,
  expires,
};

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(a.out ?? join(here, ".."));
const w = (p, s, mode = 0o600) => {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, s, { mode });
  chmodSync(p, mode);
  return p;
};
const files = [
  w(join(out, "leader/tasks", `${name}.leader.yaml`), taskYaml("Leader")),
  w(join(out, "helper/tasks", `${name}.helper.yaml`), taskYaml("Helper")),
  w(
    join(out, "creator", name, "collector.secret.json"),
    JSON.stringify(
      {
        taskId,
        leader: leaderUrl,
        collectorAuthToken: { type: collectorTokenType, token: collectorToken },
        collectorHpkeConfig: collectorHpke,
        collectorHpkePrivateKey: collectorPrivate ?? null,
        vdaf: taskConfig.vdaf,
        windowSeconds: WINDOW_SECONDS,
      },
      null,
      2,
    ) + "\n",
  ),
  w(join(out, "creator", name, "task-config.json"), JSON.stringify(taskConfig, null, 2) + "\n", 0o644),
];
if (collectorPrivate) {
  // janus_collector::PrivateCollectorCredential (release/0.7, collector/src/credential.rs).
  files.push(
    w(
      join(out, "creator", name, "collector-credential.json"),
      JSON.stringify(
        { aead: "AesGcm128", id: collectorHpke.id, kdf: "Sha256", kem: "X25519HkdfSha256", private_key: collectorPrivate, public_key: collectorHpke.publicKey, token: collectorToken },
        null,
        2,
      ) + "\n",
    ),
  );
}
console.log(JSON.stringify({ taskId, files }, null, 2));
