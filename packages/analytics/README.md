# @match-feed/analytics: private "how people found you" stats

Tier 2 creator analytics (`docs/ANALYTICS.md`, decision D3 / THREAT_MODEL T14): the share
of a creator's viewers who found them through Follow, Taste lists, Match, Circles, 2nd
degree, Explore, Search or elsewhere, aggregated with DAP so that no server sees any
viewer's channel. Architecture, operator duties and the web hooks:
[`docs/ANALYTICS_IMPLEMENTATION.md`](../../docs/ANALYTICS_IMPLEMENTATION.md). Aggregators:
[`infra/janus`](../../infra/janus/README.md).

> **Status: prototype, not audited.** Speaks DAP-09 (the newest draft the TypeScript
> client supports), against Janus 0.7.x. Not wired into apps/web yet.

License: Apache-2.0. Runtime dependency: `@divviup/dap` 0.9.1 (MPL-2.0, Divvi Up), which
pulls in `@divviup/*` (MPL-2.0), `hpke-js`/`@hpke/*` 1.8–1.10 (MIT; past the
CVE-2025-64767 fix in 1.7.5), `@noble/hashes`, `jssha`, `buffer`. Pinned by
`package-lock.json`; `.npmrc` disables install scripts.

## Layout

| File | What it does |
|---|---|
| `src/channels.ts` | the 8 channels (wire order), `channelOf(rank primary)`, 28-day epoch-aligned windows |
| `src/settings.ts` | viewer switches: on by default, master and per-channel off, private watching; `fromWebSettings` |
| `src/ledger.ts` | on-device tally per window, creator and channel. **No video ids, titles or times.** `recordView`, `loadLedger` |
| `src/config.ts` | the creator's published task config: strict format, checks (helper allowlist, independence, DP, thresholds), Nostr event and channel-description pointer |
| `src/report.ts` | one report per viewer per creator per closed window (the dominant allowed channel), per-creator jittered schedule, deadlines, caps |
| `src/upload.ts` | `DapClient` interface; `divviupClient` (report generation by `@divviup/dap`, requests through `guardedFetch`); `runUploads` with retry, regenerate-on-key-change and crash-safe persistence |
| `src/collect.ts` | creator side: Field128 decoding of noisy counts, "<20" threshold, shares, `publishable`, Janus `collect` output parser, fallback collector-side noise |
| `src/hooks.ts` | helpers for the app's integration points (`viewFromRankedItem`, `nextRunDelayMs`) |
| `bin/discovery-report.ts` | creator CLI: collection result in, studio table out |

```sh
npm test           # 69 unit tests, no network; the e2e test is skipped
npm run test:e2e   # Docker: Janus leader + helper + collector, ~2 minutes
npm run typecheck
```

## Using it (sketch)

```ts
import { recordView, viewFromRankedItem, fromWebSettings, planReports, runUploads,
         divviupClient, checkTaskConfig, cryptoRng } from "@match-feed/analytics";

// on each watched feed item (not in private watching: recordView checks too)
ledger = recordView(ledger, viewFromRankedItem(item, new Date()), fromWebSettings(settings));

// on a jittered 10-30 minute timer
const plan = planReports(ledger, jobs, { now, settings: s, configs, rng });
ledger = plan.ledger;
const res = await runUploads(plan.jobs, { now, settings: s, configs, client: divviupClient(), rng, persist });
jobs = res.jobs;
```
