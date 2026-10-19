import assert from "node:assert/strict";
import { test } from "node:test";
import { CHANNEL_INDEX, windowEnd, windowIndex, windowStart } from "../src/channels.ts";
import type { TaskConfig } from "../src/config.ts";
import { seededRng } from "../src/core.ts";
import { emptyLedger, recordView, type Ledger } from "../src/ledger.ts";
import { SCHEDULE, chooseChannel, dueJobs, planReports, reportTime, stillAllowed } from "../src/report.ts";
import { DEFAULT_CONTRIBUTION, type ContributionSettings } from "../src/settings.ts";
import { CREATOR, validConfig } from "./helpers.ts";

const on: ContributionSettings = { ...DEFAULT_CONTRIBUTION, perChannel: {} };
const W = windowIndex(new Date("2026-10-19T12:00:00Z"));
const inPrev = new Date((windowStart(W - 1) + 3600) * 1000);
const justAfter = new Date((windowEnd(W - 1) + 60) * 1000);
const configs = new Map<string, TaskConfig>([[CREATOR, validConfig()]]);

function ledgerWith(views: [string, string, number][], at = inPrev): Ledger {
  let l = emptyLedger();
  for (const [creator, channel, n] of views) for (let i = 0; i < n; i++) l = recordView(l, { creator, channel: channel as never, at }, on);
  return l;
}

test("chooseChannel picks the most-viewed allowed channel", () => {
  const rng = seededRng(1);
  assert.equal(chooseChannel({ follow: 1, taste: 5, match: 2 }, on, rng), "taste");
  assert.equal(chooseChannel({ follow: 1, match: 5 }, { ...on, perChannel: { match: false } }, rng), "follow");
  assert.equal(chooseChannel({ match: 5 }, { ...on, perChannel: { match: false } }, rng), null);
  assert.equal(chooseChannel({}, on, rng), null);
});

test("chooseChannel breaks ties at random, not by channel order", () => {
  const rng = seededRng(3);
  const seen = new Set<string>();
  for (let i = 0; i < 200; i++) seen.add(chooseChannel({ follow: 2, explore: 2 }, on, rng)!);
  assert.deepEqual([...seen].sort(), ["explore", "follow"]);
});

test("one job per creator per closed window; the window's tallies are then deleted", () => {
  const l = ledgerWith([[CREATOR, "taste", 3], [CREATOR, "follow", 1], ["bob@other.example", "follow", 2]]);
  const { ledger, jobs } = planReports(l, [], { now: justAfter, settings: on, configs, rng: seededRng(1) });
  assert.equal(jobs.length, 1, "bob has no config, so no job");
  assert.equal(jobs[0]!.creator, CREATOR);
  assert.equal(jobs[0]!.measurement, CHANNEL_INDEX.taste);
  assert.equal(jobs[0]!.window, W - 1);
  assert.deepEqual(ledger.windows, {}, "tallies for the closed window are gone, including bob's");
  // Planning again adds nothing.
  assert.equal(planReports(ledger, jobs, { now: justAfter, settings: on, configs, rng: seededRng(2) }).jobs.length, 1);
});

test("the open window is never planned", () => {
  const l = ledgerWith([[CREATOR, "taste", 3]], new Date((windowStart(W) + 10) * 1000));
  const r = planReports(l, [], { now: new Date((windowStart(W) + 100) * 1000), settings: on, configs, rng: seededRng(1) });
  assert.equal(r.jobs.length, 0);
  assert.equal(r.ledger, l);
});

test("upload time is jittered per creator within [end+1h, end+73h]; DAP timestamp is the window start", () => {
  const many = new Map<string, TaskConfig>();
  const views: [string, string, number][] = [];
  for (let i = 0; i < 50; i++) {
    const c = `c${i}@videos.example`;
    many.set(c, validConfig({ creator: c }));
    views.push([c, "follow", 1]);
  }
  const { jobs } = planReports(ledgerWith(views), [], { now: justAfter, settings: on, configs: many, rng: seededRng(9) });
  assert.equal(jobs.length, 50);
  const end = windowEnd(W - 1);
  for (const j of jobs) {
    assert.ok(j.notBefore >= end + SCHEDULE.minDelaySeconds && j.notBefore < end + SCHEDULE.minDelaySeconds + SCHEDULE.jitterSeconds);
    assert.equal(reportTime(j).getTime(), windowStart(W - 1) * 1000);
  }
  assert.ok(new Set(jobs.map((j) => j.notBefore)).size > 45, "upload times differ between creators");
});

test("jobs carry no video ids or view times", () => {
  const { jobs } = planReports(ledgerWith([[CREATOR, "match", 2]]), [], { now: justAfter, settings: on, configs, rng: seededRng(1) });
  assert.deepEqual(Object.keys(jobs[0]!).sort(), ["attempts", "creator", "deadline", "id", "measurement", "notBefore", "taskId", "window"]);
});

test("windows past the deadline are dropped without jobs", () => {
  const late = new Date((windowEnd(W - 1) + SCHEDULE.deadlineSeconds + 1) * 1000);
  const r = planReports(ledgerWith([[CREATOR, "taste", 3]]), [], { now: late, settings: on, configs, rng: seededRng(1) });
  assert.equal(r.jobs.length, 0);
  assert.deepEqual(r.ledger.windows, {});
});

test("nothing is planned while contribution is off or private watching is on", () => {
  const l = ledgerWith([[CREATOR, "taste", 3]]);
  for (const s of [{ ...on, contribute: false }, { ...on, privateWatching: true }]) {
    const r = planReports(l, [], { now: justAfter, settings: s, configs, rng: seededRng(1) });
    assert.equal(r.jobs.length, 0);
  }
});

test("switching a channel off after the views stops the report", () => {
  const { jobs } = planReports(ledgerWith([[CREATOR, "match", 2]]), [], { now: justAfter, settings: on, configs, rng: seededRng(1) });
  assert.equal(stillAllowed(jobs[0]!, on), true);
  assert.equal(stillAllowed(jobs[0]!, { ...on, perChannel: { match: false } }), false);
  assert.equal(stillAllowed(jobs[0]!, { ...on, contribute: false }), false);
});

test("per-window report cap", () => {
  const many = new Map<string, TaskConfig>();
  const views: [string, string, number][] = [];
  for (let i = 0; i < SCHEDULE.maxReportsPerWindow + 30; i++) {
    const c = `c${i}@videos.example`;
    many.set(c, validConfig({ creator: c }));
    views.push([c, "follow", 1]);
  }
  const { jobs } = planReports(ledgerWith(views), [], { now: justAfter, settings: on, configs: many, rng: seededRng(9) });
  assert.equal(jobs.length, SCHEDULE.maxReportsPerWindow);
});

test("dueJobs drops expired jobs and returns due ones", () => {
  const { jobs } = planReports(ledgerWith([[CREATOR, "taste", 1]]), [], { now: justAfter, settings: on, configs, rng: seededRng(1) });
  const j = jobs[0]!;
  assert.equal(dueJobs(jobs, new Date((j.notBefore - 1) * 1000)).due.length, 0);
  assert.equal(dueJobs(jobs, new Date(j.notBefore * 1000)).due.length, 1);
  assert.equal(dueJobs(jobs, new Date(j.deadline * 1000)).keep.length, 0);
});
