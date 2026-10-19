import { CHANNELS } from "../src/channels.ts";
import type { TaskConfig } from "../src/config.ts";

export const HELPER = "https://helper.example.org/";
export const LEADER = "https://dap.videos.example/";
export const ALLOWED = ["https://helper.example.org"];
export const CREATOR = "alice@videos.example";
export const NOW = new Date("2026-10-19T12:00:00Z");

export function validConfig(over: Record<string, unknown> = {}): TaskConfig & Record<string, unknown> {
  return {
    v: 1,
    kind: "discovery-channels",
    creator: CREATOR,
    taskId: "czKbK15GBV__7fixSnd38GuHLSEk2QPhHgm4MsoIBOM",
    leader: LEADER,
    helper: HELPER,
    helperOperator: "Example Helper Org",
    dap: "dap-09",
    vdaf: { type: "Prio3Histogram", length: 8, chunkLength: 3 },
    channels: [...CHANNELS],
    windowSeconds: 2419200,
    minBatchSize: 20,
    dp: { mechanism: "discrete-laplace", epsilon: "1", appliedBy: "each-aggregator" },
    displayThreshold: 20,
    publish: false,
    expires: Math.floor(NOW.getTime() / 1000) + 86400 * 300,
    ...over,
  } as TaskConfig & Record<string, unknown>;
}

export const opts = { creator: CREATOR, now: NOW, allowedHelpers: ALLOWED };
