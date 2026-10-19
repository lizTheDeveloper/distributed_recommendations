// Sending reports: DAP-09 upload (draft-ietf-ppm-dap-09, section 4.3).
//
// Report construction (Prio3Histogram sharding, the FLP proof, HPKE sealing of the two
// input shares) is done by Divvi Up's TypeScript client, @divviup/dap 0.9.1 (MPL-2.0,
// DAP-09 + VDAF-08, matches Janus 0.7.x). This file adds only the policy around it:
// - every network request goes through `guardedFetch`: GET hpke_config on the task's
//   two aggregator origins, and PUT of the report to the leader, nothing else;
// - HPKE keys are fetched from each aggregator's own origin; a config's `hpke` hints
//   must match what was fetched;
// - credentials, referrer and caching are off for every request;
// - a generated report is kept on the job, so a retry resends the same bytes (same
//   report id: the leader drops duplicates, so a lost response never double-counts).

import { Task } from "@divviup/dap";
import { CHANNELS } from "./channels.ts";
import type { TaskConfig } from "./config.ts";
import type { Rng } from "./core.ts";
import { dueJobs, reportTime, retryAt, stillAllowed, type UploadJob } from "./report.ts";
import type { ContributionSettings } from "./settings.ts";

export const DAP_MEDIA = Object.freeze({
  report: "application/dap-report",
  hpkeConfigList: "application/dap-hpke-config-list",
});

export type PutOutcome =
  | { kind: "accepted" }
  /** The leader's HPKE key changed: make a new report (new report id) and retry. */
  | { kind: "regenerate"; detail: string }
  /** Transient (network, 5xx, reportTooEarly): retry the same bytes later. */
  | { kind: "retry"; detail: string }
  /** Permanent (unknown task, rejected): drop the job. */
  | { kind: "drop"; detail: string };

/** What the uploader needs from a DAP implementation. Swap it to change DAP drafts. */
export interface DapClient {
  generateReport(config: TaskConfig, measurement: number, timestamp: Date): Promise<Uint8Array>;
  putReport(config: TaskConfig, report: Uint8Array): Promise<PutOutcome>;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const b64u = {
  enc: (b: Uint8Array) => {
    let s = "";
    for (const x of b) s += String.fromCharCode(x);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  },
  dec: (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)),
};
export { b64u as base64url };

/** Split an encoded HpkeConfigList (u16 length, then id u8, kem/kdf/aead u16, key opaque<u16>). */
export function splitHpkeConfigList(bytes: Uint8Array): Uint8Array[] {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 2) throw new Error("hpke config list: short");
  const total = v.getUint16(0);
  if (total !== bytes.length - 2) throw new Error("hpke config list: length");
  const out: Uint8Array[] = [];
  let i = 2;
  while (i < bytes.length) {
    if (i + 9 > bytes.length) throw new Error("hpke config: short");
    const len = v.getUint16(i + 7);
    const end = i + 9 + len;
    if (end > bytes.length) throw new Error("hpke config: key length");
    out.push(bytes.subarray(i, end));
    i = end;
  }
  return out;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/** X25519/HKDF-SHA256 with AES-128-GCM or ChaCha20-Poly1305: what the client can use. */
function firstUsable(configs: Uint8Array[]): Uint8Array | undefined {
  return configs.find((c) => {
    const v = new DataView(c.buffer, c.byteOffset, c.byteLength);
    const kem = v.getUint16(1);
    const kdf = v.getUint16(3);
    const aead = v.getUint16(5);
    return [0x10, 0x20].includes(kem) && [1, 2, 3].includes(kdf) && [1, 2, 3].includes(aead);
  });
}

/**
 * A fetch that only allows the requests a DAP-09 client makes for this task, with no
 * credentials or referrer, and checks HPKE hints.
 */
export function guardedFetch(config: TaskConfig, base: FetchLike): FetchLike {
  const leader = new URL(config.leader);
  const helper = new URL(config.helper);
  return async (input, init) => {
    const url = new URL(typeof input === "string" ? input : String(input));
    const method = (init?.method ?? "GET").toUpperCase();
    const role = url.origin === leader.origin && url.pathname.startsWith(leader.pathname)
      ? "leader"
      : url.origin === helper.origin && url.pathname.startsWith(helper.pathname)
        ? "helper"
        : null;
    if (role === null) throw new Error(`blocked request to ${url.origin}`);
    const base_ = role === "leader" ? leader : helper;
    const isHpke = method === "GET" && url.pathname === `${base_.pathname}hpke_config`;
    const isPut = role === "leader" && method === "PUT" && url.pathname === `${leader.pathname}tasks/${config.taskId}/reports`;
    if (!isHpke && !isPut) throw new Error(`blocked ${method} ${url.pathname}`);
    if (isHpke && url.searchParams.get("task_id") !== config.taskId) throw new Error("blocked hpke_config query");
    const res = await base(url.toString(), {
      ...init,
      credentials: "omit",
      referrerPolicy: "no-referrer",
      cache: "no-store",
      redirect: "error",
      mode: "cors",
    });
    const hint = config.hpke?.[role];
    if (isHpke && res.ok && hint) {
      const body = new Uint8Array(await res.arrayBuffer());
      const fetched = firstUsable(splitHpkeConfigList(body));
      const hinted = splitHpkeConfigList(b64u.dec(hint));
      if (!fetched || !hinted.some((h) => sameBytes(h, fetched))) {
        throw new Error(`${role} HPKE key does not match the published hint`);
      }
      return new Response(body, { status: res.status, headers: res.headers });
    }
    return res;
  };
}

function problemType(body: string): string {
  try {
    const t = (JSON.parse(body) as { type?: unknown }).type;
    return typeof t === "string" ? t.replace(/^urn:ietf:params:ppm:dap:error:/, "") : "";
  } catch {
    return "";
  }
}

/** Classify the leader's answer to a report PUT (DAP-09; Janus 0.7 answers 200, spec says 201). */
export function classifyPut(status: number, body: string): PutOutcome {
  if (status >= 200 && status < 300) return { kind: "accepted" };
  const type = problemType(body);
  if (type === "outdatedConfig") return { kind: "regenerate", detail: type };
  if (type === "reportTooEarly" || status >= 500 || status === 429 || status === 408) {
    return { kind: "retry", detail: type || `http ${status}` };
  }
  return { kind: "drop", detail: type || `http ${status}` };
}

/** The @divviup/dap-backed client. One Task per task id is cached (keeps fetched HPKE keys). */
export function divviupClient(opts: { fetch?: FetchLike } = {}): DapClient {
  const base: FetchLike = opts.fetch ?? ((i, init) => globalThis.fetch(i, init));
  const tasks = new Map<string, Task<{ type: "histogram"; length: number; chunkLength: number }, number>>();
  const taskFor = (config: TaskConfig) => {
    const key = `${config.taskId}|${config.leader}|${config.helper}`;
    let t = tasks.get(key);
    if (!t) {
      t = new Task({
        type: "histogram",
        length: CHANNELS.length,
        chunkLength: config.vdaf.chunkLength,
        id: config.taskId,
        leader: config.leader,
        helper: config.helper,
        timePrecisionSeconds: config.windowSeconds,
      });
      // `fetch` is a documented-as-internal setter in @divviup/dap 0.9.1; it is the
      // only way to route its hpke_config requests through the guard.
      (t as unknown as { fetch: FetchLike }).fetch = guardedFetch(config, base);
      tasks.set(key, t);
    }
    return t;
  };
  return {
    async generateReport(config, measurement, timestamp) {
      if (!Number.isInteger(measurement) || measurement < 0 || measurement >= CHANNELS.length) {
        throw new RangeError("measurement out of range");
      }
      const report = await taskFor(config).generateReport(measurement, { timestamp });
      return new Uint8Array(report.encode());
    },
    async putReport(config, report) {
      const fetch = guardedFetch(config, base);
      let res: Response;
      try {
        res = await fetch(new URL(`tasks/${config.taskId}/reports`, config.leader).toString(), {
          method: "PUT",
          headers: { "Content-Type": DAP_MEDIA.report },
          body: report as BodyInit,
        });
      } catch (e) {
        return { kind: "retry", detail: `network: ${(e as Error).message}` };
      }
      const outcome = classifyPut(res.status, res.ok ? "" : await res.text().catch(() => ""));
      if (outcome.kind === "regenerate") {
        for (const [k] of tasks) if (k.startsWith(`${config.taskId}|`)) tasks.delete(k);
      }
      return outcome;
    },
  };
}

export interface RunOptions {
  now: Date;
  settings: ContributionSettings;
  configs: ReadonlyMap<string, TaskConfig>;
  client: DapClient;
  rng: Rng;
  /**
   * Most uploads per call. Default 1: the app calls `runUploads` on a jittered timer
   * (see docs), so a device coming back online does not send a burst of reports for
   * several creators from one address at one moment.
   */
  maxPerRun?: number;
  /** Persist jobs after a report is generated and before it is sent (crash safety). */
  persist?: (jobs: UploadJob[]) => Promise<void> | void;
}

export interface RunResult {
  jobs: UploadJob[];
  sent: number;
  dropped: { id: string; reason: string }[];
}

/** Send due jobs. Returns the jobs still pending. Never throws for one bad job. */
export async function runUploads(jobs: readonly UploadJob[], opts: RunOptions): Promise<RunResult> {
  const { now, settings, configs, client, rng } = opts;
  const { due, keep } = dueJobs(jobs, now);
  const dropped: RunResult["dropped"] = jobs
    .filter((j) => !keep.includes(j))
    .map((j) => ({ id: j.id, reason: "deadline" }));
  let pending = [...keep];
  let sent = 0;
  if (settings.privateWatching) return { jobs: pending, sent, dropped };
  const max = opts.maxPerRun ?? 1;
  for (const job of due.slice(0, max)) {
    const replace = (j: UploadJob | null) => {
      pending = pending.flatMap((p) => (p.id === job.id ? (j ? [j] : []) : [p]));
    };
    const config = configs.get(job.creator);
    if (!stillAllowed(job, settings)) {
      replace(null);
      dropped.push({ id: job.id, reason: "switched-off" });
      continue;
    }
    if (!config || config.taskId !== job.taskId) {
      replace(null);
      dropped.push({ id: job.id, reason: "no-config" });
      continue;
    }
    let current: UploadJob = job;
    try {
      if (!current.report) {
        const bytes = await client.generateReport(config, current.measurement, reportTime(current));
        current = { ...current, report: b64u.enc(bytes) };
        replace(current);
        await opts.persist?.(pending);
      }
      const outcome = await client.putReport(config, b64u.dec(current.report!));
      if (outcome.kind === "accepted") {
        replace(null);
        sent++;
      } else if (outcome.kind === "drop") {
        replace(null);
        dropped.push({ id: job.id, reason: outcome.detail });
      } else {
        const next: UploadJob = {
          ...current,
          attempts: current.attempts + 1,
          notBefore: retryAt(current, now, rng),
          lastError: outcome.detail,
        };
        if (outcome.kind === "regenerate") delete next.report;
        replace(next);
      }
    } catch (e) {
      // HPKE fetch failed, a hint did not match, or a blocked request: retry later
      // (the deadline bounds it) and keep the reason for the app's diagnostics.
      const next: UploadJob = {
        ...current,
        attempts: current.attempts + 1,
        notBefore: retryAt(current, now, rng),
        lastError: String((e as Error)?.message ?? e).slice(0, 200),
      };
      replace(next);
    }
  }
  return { jobs: pending, sent, dropped };
}
