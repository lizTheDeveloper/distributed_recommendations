// The creator's published task config: what a viewer's device needs to send a report
// for that creator, and the promises the device checks before it sends anything.
//
// Format (JSON, at most 4 KiB, strict keys), as written by
// infra/janus/scripts/new-task.mjs:
//
//   {
//     "v": 1,
//     "kind": "discovery-channels",
//     "creator": "alice@videos.example",          // the ledger's creator key
//     "taskId": "<32 bytes, unpadded base64url>",
//     "leader": "https://dap.videos.example/",    // creator's instance (Janus leader)
//     "helper": "https://helper.example.org/",    // independent operator (Janus helper)
//     "helperOperator": "Example Helper Org",
//     "dap": "dap-09",
//     "vdaf": {"type": "Prio3Histogram", "length": 8, "chunkLength": 3},
//     "channels": ["follow","taste","match","circle","second","explore","search","other"],
//     "windowSeconds": 2419200,
//     "minBatchSize": 20,
//     "dp": {"mechanism": "discrete-laplace", "epsilon": "1", "appliedBy": "each-aggregator"},
//     "displayThreshold": 20,
//     "publish": false,
//     "expires": 1827009199,
//     "hpke": {"leader": "<HpkeConfigList, base64url>", "helper": "..."}   // optional hints
//   }
//
// Where it is published (either):
// 1. A Nostr addressable event, kind 30078 (NIP-78 app data), tag ["d", CONFIG_D_TAG],
//    content = the JSON above, signed by the creator's key: `taskConfigFromNostrEvent`.
// 2. A line `discovery-stats: https://<creator's instance host>/...json` in the PeerTube
//    channel description, pointing at the JSON on the creator's own instance:
//    `configPointerFromDescription`. TLS to the creator's host authenticates it.
//
// HPKE keys are NOT taken from this config. The device fetches each aggregator's key
// from that aggregator's own origin. A creator who could publish the helper's key could
// publish a key they hold and decrypt both shares. `hpke` entries are optional hints:
// if present, the fetched key must match or nothing is sent.
//
// Independence of the helper cannot be checked from a config. The device only uploads
// to helpers on an allowlist the app ships (`allowedHelpers`).

import { CHANNELS, CHUNK_LENGTH, DISPLAY_THRESHOLD, WINDOW_SECONDS } from "./channels.ts";

export const CONFIG_KIND = 30078;
export const CONFIG_D_TAG = "match-feed/discovery-task/v1";
export const CONFIG_MAX_BYTES = 4096;
/** The device refuses tasks that declare less noise than this (larger epsilon = less noise). */
export const MAX_EPSILON = 2;
export const MIN_BATCH_SIZE = 20;

export interface TaskConfig {
  v: 1;
  kind: "discovery-channels";
  creator: string;
  taskId: string;
  leader: string;
  helper: string;
  helperOperator: string;
  dap: "dap-09";
  vdaf: { type: "Prio3Histogram"; length: number; chunkLength: number };
  channels: string[];
  windowSeconds: number;
  minBatchSize: number;
  dp: { mechanism: "discrete-laplace"; epsilon: string; appliedBy: "each-aggregator" };
  displayThreshold: number;
  publish: boolean;
  expires: number;
  hpke?: { leader?: string; helper?: string };
}

export interface ConfigCheckOptions {
  /** The creator key the config must name (the ledger key for this creator). */
  creator: string;
  now: Date;
  /**
   * Helper origins the app trusts to be independent, e.g. ["https://helper.example.org"].
   * Required: an empty list refuses every task.
   */
  allowedHelpers: readonly string[];
  /** Tests only: allow http:// on localhost / 127.0.0.1. */
  allowInsecureLocalhost?: boolean;
}

export type ConfigResult = { ok: true; config: TaskConfig } | { ok: false; reason: string };

const KEYS = new Set([
  "v", "kind", "creator", "taskId", "leader", "helper", "helperOperator", "dap", "vdaf", "channels",
  "windowSeconds", "minBatchSize", "dp", "displayThreshold", "publish", "expires", "hpke",
]);

const B64U = /^[A-Za-z0-9_-]+$/;

function isObj(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function onlyKeys(o: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(o).every((k) => keys.includes(k));
}

function isLocal(host: string): boolean {
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
}

/** An aggregator endpoint: https (or local http in tests), no credentials/query/fragment, path ends in "/". */
function endpoint(s: unknown, insecureLocal: boolean): URL | null {
  if (typeof s !== "string" || s.length > 512) return null;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  const okScheme = u.protocol === "https:" || (insecureLocal && u.protocol === "http:" && isLocal(u.hostname));
  if (!okScheme || u.username || u.password || u.search || u.hash || !u.pathname.endsWith("/")) return null;
  if (u.toString() !== s) return null;
  return u;
}

/** Rough "same organisation" check: same host, or the same last two DNS labels. A sanity check only. */
function sameSite(a: URL, b: URL): boolean {
  if (a.host === b.host) return true;
  if (isLocal(a.hostname) && isLocal(b.hostname)) return false; // different ports in tests
  const tail = (h: string) => h.split(".").slice(-2).join(".");
  return tail(a.hostname) === tail(b.hostname);
}

function epsilonValue(s: unknown): number | null {
  if (typeof s !== "string") return null;
  const m = /^(\d{1,6})(?:\/(\d{1,6}))?$/.exec(s);
  if (!m) return null;
  const v = Number(m[1]) / Number(m[2] ?? "1");
  return Number.isFinite(v) && v > 0 ? v : null;
}

function decodedLength(s: string): number {
  return Math.floor((s.length * 3) / 4);
}

/** Validate a parsed config object against the device's rules. */
export function checkTaskConfig(x: unknown, opts: ConfigCheckOptions): ConfigResult {
  const no = (reason: string): ConfigResult => ({ ok: false, reason });
  if (!isObj(x)) return no("not-an-object");
  if (!Object.keys(x).every((k) => KEYS.has(k))) return no("unknown-key");
  if (x.v !== 1 || x.kind !== "discovery-channels") return no("version");
  if (x.creator !== opts.creator) return no("creator-mismatch");
  if (typeof x.taskId !== "string" || x.taskId.length !== 43 || !B64U.test(x.taskId)) return no("task-id");
  const insecure = opts.allowInsecureLocalhost === true;
  const leader = endpoint(x.leader, insecure);
  const helper = endpoint(x.helper, insecure);
  if (!leader || !helper) return no("endpoint");
  if (sameSite(leader, helper)) return no("helper-not-independent");
  if (!opts.allowedHelpers.some((o) => o === helper.origin)) return no("helper-not-allowed");
  if (typeof x.helperOperator !== "string" || x.helperOperator.length === 0 || x.helperOperator.length > 200) {
    return no("helper-operator");
  }
  if (x.dap !== "dap-09") return no("dap-version");
  const vdaf = x.vdaf;
  if (!isObj(vdaf) || !onlyKeys(vdaf, ["type", "length", "chunkLength"])) return no("vdaf");
  if (vdaf.type !== "Prio3Histogram" || vdaf.length !== CHANNELS.length || vdaf.chunkLength !== CHUNK_LENGTH) {
    return no("vdaf");
  }
  if (!Array.isArray(x.channels) || x.channels.length !== CHANNELS.length || x.channels.some((c, i) => c !== CHANNELS[i])) {
    return no("channels");
  }
  if (x.windowSeconds !== WINDOW_SECONDS) return no("window");
  if (typeof x.minBatchSize !== "number" || !Number.isInteger(x.minBatchSize) || x.minBatchSize < MIN_BATCH_SIZE) {
    return no("min-batch-size");
  }
  const dp = x.dp;
  if (!isObj(dp) || !onlyKeys(dp, ["mechanism", "epsilon", "appliedBy"])) return no("dp");
  const eps = epsilonValue(dp.epsilon);
  if (dp.mechanism !== "discrete-laplace" || dp.appliedBy !== "each-aggregator" || eps === null) return no("dp");
  if (eps > MAX_EPSILON) return no("dp-epsilon-too-large");
  if (typeof x.displayThreshold !== "number" || !Number.isInteger(x.displayThreshold) || x.displayThreshold < DISPLAY_THRESHOLD) {
    return no("display-threshold");
  }
  if (typeof x.publish !== "boolean") return no("publish");
  if (typeof x.expires !== "number" || !Number.isInteger(x.expires)) return no("expires");
  if (x.expires * 1000 <= opts.now.getTime()) return no("expired");
  if (x.hpke !== undefined) {
    const h = x.hpke;
    if (!isObj(h) || !onlyKeys(h, ["leader", "helper"])) return no("hpke");
    for (const v of Object.values(h)) {
      if (typeof v !== "string" || !B64U.test(v) || v.length > 1024 || decodedLength(v) < 2) return no("hpke");
    }
  }
  return { ok: true, config: structuredClone(x) as unknown as TaskConfig };
}

/** Parse JSON text (size-checked before parsing) and validate it. */
export function parseTaskConfig(json: string, opts: ConfigCheckOptions): ConfigResult {
  if (typeof json !== "string") return { ok: false, reason: "not-a-string" };
  if (new TextEncoder().encode(json).length > CONFIG_MAX_BYTES) return { ok: false, reason: "too-large" };
  let x: unknown;
  try {
    x = JSON.parse(json);
  } catch {
    return { ok: false, reason: "json" };
  }
  return checkTaskConfig(x, opts);
}

export interface NostrEventLike {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

/**
 * Read a config from a Nostr event. `verify` must check the event signature (e.g.
 * nostr-tools `verifyEvent` on a FRESH object holding only the NIP-01 fields: see
 * THREAT_MODEL T25). `pubkey` is the creator's known Nostr key.
 */
export function taskConfigFromNostrEvent(
  event: NostrEventLike,
  opts: ConfigCheckOptions & { pubkey: string; verify: (e: NostrEventLike) => boolean },
): ConfigResult {
  if (!isObj(event)) return { ok: false, reason: "event" };
  if (event.kind !== CONFIG_KIND) return { ok: false, reason: "event-kind" };
  if (event.pubkey !== opts.pubkey) return { ok: false, reason: "event-pubkey" };
  const d = Array.isArray(event.tags) ? event.tags.find((t) => Array.isArray(t) && t[0] === "d") : undefined;
  if (!d || d[1] !== CONFIG_D_TAG) return { ok: false, reason: "event-d-tag" };
  const fresh: NostrEventLike = {
    id: event.id,
    pubkey: event.pubkey,
    created_at: event.created_at,
    kind: event.kind,
    tags: event.tags,
    content: event.content,
    sig: event.sig,
  };
  if (!opts.verify(fresh)) return { ok: false, reason: "event-signature" };
  return parseTaskConfig(event.content, opts);
}

/** The Nostr filter for one creator's config event. */
export function configFilter(pubkey: string): { kinds: number[]; authors: string[]; "#d": string[]; limit: number } {
  return { kinds: [CONFIG_KIND], authors: [pubkey], "#d": [CONFIG_D_TAG], limit: 1 };
}

/**
 * Find `discovery-stats: <url>` in a PeerTube channel description. The URL must be
 * https on the creator's own host (`name@host`), so TLS to that host authenticates it.
 */
export function configPointerFromDescription(description: string, creatorHandle: string): URL | null {
  if (typeof description !== "string" || typeof creatorHandle !== "string") return null;
  const host = creatorHandle.split("@")[1];
  if (!host) return null;
  const m = /^discovery-stats:[ \t]*(\S+)[ \t]*$/m.exec(description.slice(0, 10_000));
  if (!m) return null;
  try {
    const u = new URL(m[1]!);
    if (u.protocol !== "https:" || u.host !== host.toLowerCase() || u.username || u.password) return null;
    return u;
  } catch {
    return null;
  }
}
