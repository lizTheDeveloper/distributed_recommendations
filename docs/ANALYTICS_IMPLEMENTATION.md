# Creator analytics, Tier 2: implementation

Status: prototype, 2026-10-19. Implements the Tier 2 decisions in `docs/ANALYTICS.md`
(THREAT_MODEL T14, decision D3). Not audited, and not wired into apps/web yet (see
"Hooks apps/web must add").

| Piece | Where |
|---|---|
| Client library (viewer device, plus the creator's post-processing) | `packages/analytics` |
| Leader and helper aggregators (Janus), task generator | `infra/janus` |
| End-to-end test (Docker) | `packages/analytics/test/e2e.test.ts`, `npm run test:e2e` |

## 1. Protocol versions: what exists today, and what we picked

Checked 2026-10-19 against the upstream repositories and the IETF datatracker.

| Component | State |
|---|---|
| IETF DAP | Latest is **draft-ietf-ppm-dap-19** (2026-07-06, expires 2027-01-07). |
| Janus `release/0.7` | **DAP-09** + taskprov-03. Status "Supported". Latest **0.7.143**, released the week of 2026-10-14 (rustls update). Uses libprio 0.16.8 (VDAF-08). Known erratum: the leader answers uploads with 200, not 201. |
| Janus `release/0.8` | DAP-15. **Unmaintained since 2025-08-27.** |
| Janus `main` | Tip of the DAP spec repo, between drafts; the README says "draft-18", and that this branch does **not** yet conform. Released only as `0.9.0-prerelease-1`. |
| libprio-rs | 0.16 = VDAF-08 / DAP-09 (supported). 0.18.1 (2026-09-25, `main`) = VDAF-18 / DAP-17. |
| divviup-ts (`@divviup/dap`) | npm **0.9.1** (2024-11-14). The repo's `main` is **also DAP-09 / VDAF-08**: it is active (dependency bumps up to 2026-10-14) but has not moved to a newer draft. The npm package does not lag the repo in protocol, so the note in OSS_STACK.md is stale on that point. Supports Prio3Count, Sum, SumVec and **Histogram**. |
| Divvi Up hosted service | Which Janus line it runs in 2026 is **not verified**. Firefox used it in 2024. |

The only browser-capable client in existence speaks DAP-09, and the only supported Janus
line that speaks DAP-09 is 0.7. So: **DAP-09, Janus 0.7.143, `@divviup/dap` 0.9.1.**
Every Janus test below ran against 0.7.143, and Janus's own CI has a divviup-ts
interop test (`integration_tests/tests/integration/divviup_ts.rs`).

### Alternatives evaluated

| Option | Finding | Verdict |
|---|---|---|
| `@divviup/dap` 0.9.1 (used) | Works. Report generation (Prio3 sharding, the FLP proof, HPKE sealing) is done by Divvi Up's code. Dependencies: `@divviup/*` (MPL-2.0), `hpke-js`/`@hpke/*` (MIT, maintained, last release 2026-03; no third-party audit found; we get 1.9.0, past the CVE-2025-64767 nonce-reuse fix in 1.7.5, and DAP's single-shot seal is outside that bug anyway), `@noble/hashes`, `jssha`, `buffer`. No install scripts besides a no-op `bench:install` in `@noble/hashes`; `.npmrc` disables scripts. | **Use now.** Wrapped behind the `DapClient` interface so it can be swapped. |
| libprio-rs compiled to WASM | **Verified that it builds**: libprio 0.18.1 for `wasm32-unknown-unknown`, with `getrandom` feature `wasm_js`. A probe that only does Prio3Histogram(8, 3) sharding is 105 KB (opt-level z, LTO). Still needed: the DAP message encoding for the chosen draft, HPKE (the Rust `hpke` crate, or `@hpke/core` on the JS side) and wasm-bindgen glue. | **The path to DAP-17+**, when Janus releases a line newer than 0.7 and Divvi Up runs it. Same implementation as the aggregators, so no second Prio3 to trust. |
| A minimal TS client (only the upload path) with `@hpke/core` | HPKE and the upload request are the easy part. The hard part is Prio3 sharding (Field128 arithmetic, the FLP proof, TurboSHAKE XOF), which we would either write ourselves (rolling our own crypto) or take from `@divviup/prio3`, which is VDAF-08 and so only fits DAP-09 anyway. | **Rejected.** No benefit over `@divviup/dap` today. |

What a move to a newer DAP draft touches: `infra/janus` (image line, config fields),
`src/upload.ts` (a new `DapClient`), `config.ts` (`dap` value). Ledger, planning,
thresholds and the web hooks don't change.

### VDAF: Prio3Histogram(length 8, chunk length 3)

A report is one-hot over the channels
`follow, taste, match, circle, second, explore, search, other` (this order is the wire format).

- **Prio3Histogram**: its validity circuit proves the vector is exactly one-hot, so one
  report can add 1 to one channel and nothing else. Chunk length 3 is about sqrt(8), as the
  VDAF draft suggests.
- **Prio3SumVec** only bounds each entry (0..2^bits-1), so a client could add to every
  channel at once. Rejected.
- **DP**: Janus 0.7 supports `PureDpDiscreteLaplace` for Prio3Histogram natively (checked in
  `core/src/vdaf.rs` and libprio 0.16.8 `flp/types/dp.rs`: sensitivity 2, substitution
  neighbours). **Each aggregator adds the noise to its own aggregate share**, so each one
  alone gives epsilon-DP even if the other skips its noise. The e2e test confirms noise is
  present in the collected result.

## 2. Architecture

```
 viewer device (PWA)                    creator's instance                 independent operator
 ───────────────────                    ──────────────────                 ────────────────────
 rank() item.primary ─┐
 search / other ──────┤
                      v
 ledger (encrypted, per window,
   per creator, per channel counts)
        │ window closes
        v
 planReports: 1 report per creator,
   dominant allowed channel,
   random send time in [end+1h, end+73h]
        │                                  ┌──────────────────┐            ┌──────────────────┐
        │ GET /hpke_config ───────────────>│  Janus LEADER    │            │  Janus HELPER    │
        │ GET /hpke_config ───────────────────────────────────────────────>│                  │
        │ PUT /tasks/{id}/reports ────────>│ (leader share +  │ aggregate  │ (helper share)   │
        │   (both shares, each HPKE-sealed │  sealed helper   │<──────────>│ + DP noise       │
        │    to its aggregator)            │  share) + DP     │  init      │                  │
        │                                  └────────┬─────────┘            └──────────────────┘
        v                                           │ collection (DAP-09, encrypted to the collector)
 nothing kept: ledger window deleted                v
 at planning; job deleted on success        creator's collector (HPKE key only the creator holds)
                                                    │
                                                    v
                                     postprocess: decode, "<20", shares
                                     -> studio, or published (Q3) as is
```

1. **View.** On each watched video, the app calls `recordView(ledger, {creator, channel, at},
   settings)`. The channel is core `rank()`'s `item.primary`, `search` for search results,
   `other` for anything else. Nothing is recorded in private watching, with contribution off,
   or for a switched-off channel. The ledger stores counts per (window, creator, channel):
   no video id, title or time.
2. **Config.** For each creator in the ledger, the app needs that creator's **task config**
   (`config.ts`): a JSON document the creator publishes as a Nostr kind 30078 event
   (`d` = `match-feed/discovery-task/v1`, signed by the creator) or at an https URL on their
   own instance, named in the channel description (`discovery-stats: https://...`). No config
   means the creator has not opted in, and nothing is sent about them.
3. **Plan.** When a 28-day window closes, `planReports` makes one job per creator: the
   channel with the most views among those still allowed (ties at random), a random send time
   1 to 73 hours after the window ends (independent per creator), and a deadline of 6 days.
   Then it **deletes the window's tallies**.
4. **Upload.** `runUploads` (called on a 10 to 30 minute random timer, one report per call)
   re-checks the switches, generates the report (`@divviup/dap`), saves it on the job (so a
   retry resends the same bytes and the leader de-duplicates), and PUTs it to the leader. The
   DAP timestamp is the window start, rounded to the 28-day time precision.
5. **Aggregate.** Janus verifies each report's proof jointly between leader and helper and
   adds valid ones to the batch for that window. Both add DP noise to their aggregate shares.
6. **Collect.** At least 7 days after the window closes, the creator collects it (Janus
   `collect`, see `infra/janus/README.md`). Janus refuses batches under `min_batch_size` = 20.
   `postprocess` maps negative noisy values back from the field, shows any count under 20 as
   "<20", and computes shares. Collecting the same batch again returns the same noisy result
   (`max_batch_query_count: 1`; checked in the e2e test).
7. **Publish (optional, Q3).** `publishable(stats)`: only the displayed values, with the same
   thresholds and noise. Never re-collect for publishing.

### What a report counts: viewers, not views

ANALYTICS.md speaks of the "share of views". This implementation counts **viewers**: each
device sends at most one report per creator per window, carrying its dominant channel. That
is deliberate:
- DP needs bounded contribution. With one report per viewer, changing one viewer moves at
  most two buckets by 1 (sensitivity 2), and the noise is calibrated to that.
- The number of uploads would otherwise reveal how much someone watched.
- A viewer who arrives through Follow and also through Explore counts once, for the channel
  that brought them most.
The studio should say "share of viewers who found you through...".

## 3. Privacy rules and where they are enforced

| Rule (ANALYTICS.md / THREAT_MODEL T14) | Enforced by |
|---|---|
| Viewer contribution on by default, easy off switch (Q1) | `DEFAULT_CONTRIBUTION`, `fromWebSettings`; checked at record, plan and send time |
| Per-signal off switches (e.g. never report Match or Circle) | `perChannel`; a channel switched off after the views is not reported (`stillAllowed`) |
| Private watching | `recordView` records nothing; `planReports` and `runUploads` do nothing while it is on |
| Creator opt-in, off by default | no published config = no reports; the config must name the creator (`creator-mismatch`) |
| Channel-level only, never per video | the task is per creator; the ledger and reports hold no video ids (tests: `no video id ... is ever stored`, `jobs carry no video ids`) |
| 28-day windows | `WINDOW_SECONDS`; the task's `time_precision` = 28 days, so batches can't be cut finer and a report reveals only its window |
| Counts under 20 shown as "<20" | `min_batch_size` >= 20 at the aggregators (config check `min-batch-size`); `postprocess` threshold >= 20 (cannot be lowered) |
| DP noise on the totals | Janus `dp_strategy: PureDpDiscreteLaplace` on both aggregators; the device refuses configs without it or with epsilon > 2 (`MAX_EPSILON`) |
| Private to the creator unless published (Q3) | the collector key is the creator's only; `publishable` |
| Independent helper | helper allowlist shipped with the app (`allowedHelpers`, required); leader and helper must differ in host and registrable domain |
| Upload timing reveals nothing | per-creator random delay of 1 to 73 h after the window; one upload per timer tick; timestamps rounded to the window |
| HPKE keys can't be swapped by the creator | keys are fetched from each aggregator's own origin; published `hpke` hints must match or nothing is sent |
| Requests go nowhere else | `guardedFetch`: only `GET hpke_config?task_id=<task>` on the two aggregators and `PUT tasks/<task>/reports` on the leader; no credentials, no referrer, no redirects |

**DP accounting.** epsilon = 1 by default, per aggregator, per creator, per window,
substitution neighbours. A viewer who contributes to the same creator in every window spends
epsilon = 1 per window; over a year (13 windows) basic composition gives epsilon = 13 for that
creator's view of that viewer's channel history. The report count (number of viewers) is exact:
DAP does not noise it, and substitution DP does not protect it. It is at least 20 and close to
what the host already knows.

## 4. What each party learns

| Party | Learns | Does not learn |
|---|---|---|
| **Viewer's device** | everything about its own viewing (as today) | anything about other viewers |
| **Leader** (creator's instance) | per upload: the device's IP address, the task (so: "this address watched this creator at some point in that 28-day window"), the upload time (randomized), one secret share (looks random). The batch's exact report count. Its aggregate share (noised) and the final result only if it is also the collector's operator | any viewer's channel, unless it colludes with the helper |
| **Helper** (independent) | the device's IP and the task id **when the device fetches the helper's HPKE config** (once per task per app session, cached by the client); from the leader: report ids, window timestamps and its shares, with no IP addresses | any viewer's channel, unless it colludes with the leader |
| **Creator** (collector) | the noisy per-channel counts for each 28-day window with at least 20 viewers, and the exact number of contributing viewers | which viewer came through which channel; small channels (shown "<20") |
| **The public** (if the creator publishes) | the same as the creator, after the threshold | anything more |
| **Nostr relays** | that a device asked for a creator's config event (if configs are fetched from relays) | report contents |
| **Network observers** | that a device talks to the creator's DAP endpoint and the helper | contents (TLS + HPKE) |

Notes:
- The leader learning "this IP watched this creator" is usually not new (the creator's
  instance serves the video), but it is new when the video came from a mirror, another
  instance, an embed, or P2P. **Mitigation, not implemented:** send uploads and HPKE fetches
  through an OHTTP relay (`ohttp-ts`, OSS_STACK section 11) so neither aggregator sees IPs.
- The helper learning "this IP fetched the HPKE config for this creator's task" is new
  information for an outside party. **Mitigation, not implemented:** Janus global HPKE keys
  (`janus_cli generate-global-hpke-key`) let a client fetch `hpke_config` without a task id;
  `@divviup/dap` 0.9.1 always adds `task_id`, so this needs a client change, or OHTTP.

## 5. Operator obligations

### Helper operator (must be independent)

- Be a different legal entity from the leader's operator, with different administrators,
  hosting account and database, and no access to the leader's systems (and vice versa).
  Running both, or sharing infrastructure with the leader, defeats the design.
- Publish who you are; the app's allowlist names you, and each task config carries
  `helperOperator`.
- Before provisioning a task, check that it has `dp_strategy: PureDpDiscreteLaplace` with
  epsilon <= 2, `min_batch_size` >= 20, `time_precision` = 2,419,200, `max_batch_query_count`
  = 1, VDAF Prio3Histogram(8, 3). Refuse it otherwise. **The helper's noise is what protects
  viewers from the creator**, since the leader is the creator's instance.
- Generate your own HPKE key (`hpke_keys: []` + `--generate-missing-parameters`); never accept
  one from the leader. Delete the task file after provisioning (it holds the shared verify key).
- Keep no IP logs for `hpke_config` or aggregation requests (the Caddyfile keeps none).
- Agree in writing with the leader's operator: no collusion, no sharing of shares, retention
  (Janus GC: 90 days), incident notification.

### Leader operator (the creator's instance)

- Don't run, host or administer the helper. Don't log uploader IPs at the proxy.
- Keep the collector credential with the creator only; the instance must not collect on the
  creator's behalf unless the creator chose that.
- Don't provision more than one task per creator: clients use one config per creator, and
  parallel tasks would only split batches.
- The leader can mount an **n-1 attack**: inject 19 fake reports with known values next to one
  real one. Prio cannot detect fake-but-valid reports. The aggregator noise (epsilon 1) is the only
  protection; that is the reason the helper's noise is mandatory.

### App maintainers

- Curate the helper allowlist (`allowedHelpers`): only operators who have signed the
  agreement above. An empty list disables Tier 2.
- Ship the allowlist with the app (not fetched from the creator), and review it in releases.

## 6. Failure modes

| Failure | Effect | Handling |
|---|---|---|
| Helper down | leader can't aggregate; uploads still succeed (leader stores reports) | Janus retries aggregation jobs; reports expire after 90 days |
| Leader down | uploads fail | `runUploads` retries with backoff (15 min doubling to 12 h, jittered) until the 6-day deadline, then drops the job |
| HPKE key rotated | leader answers `outdatedConfig` | the job's report is discarded and regenerated with the new key (new report id) |
| Published HPKE hint does not match | possible key substitution | nothing is sent; retried until the deadline; `lastError` records it |
| Response to a PUT lost | double count? | no: the retry sends the same bytes (same report id) and the leader drops duplicates |
| App closed when the window ends | late upload | jobs persist; sent at the next run before the 6-day deadline |
| Device clock wrong | reports in the wrong window, or rejected (`reportTooEarly`, more than 5 min in the future) | the DAP timestamp is the window start, so only a clock off by days matters; retried, then dropped |
| Collect before uploads finish | missing reports | collect at least 7 days after the window ends (deadline 6 days); a report arriving after collection is rejected by the leader |
| Fewer than 20 viewers | Janus refuses to collect | studio shows "<20" |
| Creator re-collects to average noise | | same batch, same stored result (`max_batch_query_count: 1`; verified) |
| Sybils (one person, many devices or fake clients) | inflates or skews counts | **not prevented**: DAP has no client authentication. Possible later: Privacy Pass tokens issued per account. Prio3 at least bounds each report to one vote |
| Malicious creator config (own helper, huge epsilon, low threshold) | | refused on the device: helper allowlist, independence check, `MAX_EPSILON`, `min-batch-size`, `display-threshold` |
| Janus moves past DAP-09 / Divvi Up drops DAP-09 | client and aggregators disagree | stay on `release/0.7` (supported) and plan the libprio-WASM client (section 1) |

## 7. Legal: EU ePrivacy

ANALYTICS.md records that opt-out collection may not satisfy ePrivacy Art. 5(3) even with
DAP. This code doesn't decide it. The default lives in the app's settings: the app can ship
`contribute: false` for EU users until legal advice says otherwise. `fromWebSettings` passes
it through, and nothing is recorded while it is off.

## 8. Hooks apps/web must add

The web app currently keeps a local tally (`apps/web/src/lib/analytics.ts`, `s.tally`) and
transmits nothing. To switch to this package:

1. **Dependency.** Add `@match-feed/analytics` (path import, like core) and `@divviup/dap`
   0.9.1, exact pin, with install scripts off. Check that the Vite build bundles
   `@divviup/dap` (it ships `./browser`; it needs `buffer` and WebCrypto).
2. **Storage.** Add two keys to `SENSITIVE_KEYS` in `apps/web/src/lib/localdata.ts`:
   `analyticsLedger` (a `Ledger`, load with `loadLedger`) and `analyticsJobs` (`UploadJob[]`).
   Drop the old `tally` key: it is not per creator, so it can't be migrated. Add a third,
   `analyticsConfigs` (creator to `TaskConfig` plus fetched-at), for the config cache.
3. **View hook.** In `apps/web/src/app.ts`, `noteWatch(v, via)` (about line 1155), replace
   `s.tally = countView(s.tally, via, s.settings)` with
   `s.analyticsLedger = recordView(s.analyticsLedger, { creator: v.creator, channel: channelOf(via), at: new Date() }, fromWebSettings(s.settings))`,
   then persist. `via` is the ranked item's `primary`. Where a video is opened from search
   results, pass `"search"`; with no context (shared link, direct URL), leave `via` undefined
   (`other`). Do not pass the video.
4. **Settings.** `settings.analytics.perKind` already covers the six rank sources; add
   `search` and `other` switches if wanted (they follow the master switch until then).
   When `contribute` is turned off: `clearLedger()` and drop all jobs. When one channel is
   turned off, jobs for it are dropped at send time anyway.
5. **Config discovery.** For each creator in the ledger, before the window closes:
   - Nostr: query the user's relays with `configFilter(pubkey)` for creators whose Nostr key
     is known; verify with nostr-tools `verifyEvent` on a fresh object
     (`taskConfigFromNostrEvent` passes one; THREAT_MODEL T25). Ask for many creators in one
     REQ (several `authors`) and cache, so the relay doesn't see one lookup per watched creator.
   - PeerTube: `configPointerFromDescription(channel.description, creator)`, then fetch that
     https URL on the creator's own host and `parseTaskConfig`.
   - Validate with `checkTaskConfig(..., { allowedHelpers: HELPER_ALLOWLIST, now, creator })`.
     Cache for at most a day; re-check `expires`.
6. **Scheduler.** A timer: first run a few minutes after start, then `setTimeout` with
   `nextRunDelayMs(cryptoRng())`. On each tick, if online: `planReports(ledger, jobs, {now,
   settings, configs, rng: cryptoRng()})`, persist the ledger, then `runUploads(jobs, {now,
   settings, configs, client: divviupClient(), rng, persist})` with the default
   `maxPerRun: 1`, and persist the jobs. Skip while private watching is on (the functions
   check too).
7. **Wipe.** `wipeHistory` (app.ts, about line 1277) must also reset `analyticsLedger`,
   `analyticsJobs` and `analyticsConfigs`.
8. **CSP.** `connect-src` in `apps/web/public/index.html` already allows `https:`. If it is
   ever narrowed, the allowlisted helpers and creators' leader origins must stay reachable.
9. **Settings copy.** Say what is sent (one encrypted, noised "how I found this creator" per
   creator per 28 days), to whom (the creator's server and the named helper operator, from
   the config), what each learns (section 4), and link to this document.
10. **Creator studio (later).** Opt-in switch; asking the instance to provision a task;
    publishing the config event (signed through NIP-07/NIP-46); showing `postprocess`
    output; a "publish these numbers" toggle that uses `publishable`. Provisioning needs an
    instance-side API that does not exist yet.

## 9. Tests

| Suite | Count | What |
|---|---|---|
| `channels.test.ts` | 4 | channel mapping and order, windows, consistency with `new-task.mjs` |
| `ledger.test.ts` | 10 | default-on, switches, private watching, no video ids or times stored, limits, robust loading |
| `config.test.ts` | 27 | valid config; 21 rejection cases (helper allowlist and independence, DP, thresholds, window, versions); Nostr event checks; channel-description pointer |
| `report.test.ts` | 11 | dominant channel and random ties, one job per creator per closed window, tallies deleted, jitter bounds, deadlines, caps, switch re-check |
| `upload.test.ts` | 10 | DAP-09 problem types, one upload per run, same-bytes retry, regenerate on key change, drops, private watching, request guard, real `@divviup/dap` report generation against fake aggregators, HPKE hint mismatch |
| `collect.test.ts` | 7 | Field128 decoding, "<20" threshold, whole-batch suppression, publishable subset, `collect` output parsing, fallback noise scale |
| `e2e.test.ts` | 1 (Docker) | separate leader and helper stacks, 80 synthetic viewers (one in private watching, one opted out, four with Match off), uploads through `runUploads`, collection, noise present and bounded, identical re-collection, thresholds |

Last e2e run (2026-10-19, Janus 0.7.143): 78 reports; true `[32,14,2,0,0,15,6,9]`, collected
`[33,17,4,0,-3,17,6,8]`; only `follow` cleared the threshold (33 viewers, 39% after noise
and clamping). That is the small-creator cost ANALYTICS.md describes.
