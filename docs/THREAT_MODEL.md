# Match Feed: threat model and security plan

Status: draft v2, 2026-10-19. v2 adds the simulation evidence (`docs/SIMULATION_RESULTS.md`),
marks which mitigations exist in code, and adds threats T19–T23 surfaced while building.
Companion to `docs/DESIGN.md`. Source IDs (A12, N1, …) refer to the Sources list in DESIGN.md.

## What we protect

| Asset | Where it lives | Why it matters |
|---|---|---|
| Watch / endorsement history | user device only | reveals politics, health, sexuality, religion; legally sensitive (VPPA, GDPR Art. 9) |
| Taste sketches | sent to matches, E2E | a subset of the above |
| **Match graph** (who matches whom) | the two endpoints; relays see metadata | maps communities of like-minded people; a dissident list |
| Circle membership | circle members; relays see metadata | same as above, but for groups |
| Identity keys | user device | impersonation, reading future sketches |
| Feed integrity | user device | what people actually see; the whole point of the project |
| Creator content and reach | instances, mirrors | creators' livelihood |
| Creator analytics | aggregation servers | must not become a viewer tracker |

## Adversaries

| Adversary | Capability | Wants |
|---|---|---|
| A1. Curious match | sees your sketch | learn more about you |
| A2. Abusive match (partner, family, employer) | can coerce you to match; may have your unlocked phone | monitor you |
| A3. Prober | sends many PSI previews or match requests | learn if *you* watched video X |
| A4. Sybil / bot operator, payola buyer | many keys, scripted accounts | push content into feeds |
| A5. Malicious feed-recipe author | ships code users run | exfiltrate history; manipulate ranking |
| A6. Malicious relay | stores and forwards events | metadata, censorship, replay |
| A7. Instance admin, voluntary or compelled | runs a PeerTube instance | account data, IPs, takedowns |
| A8. Network observer / state | ISP-level visibility, legal compulsion, app-store pressure | identify viewers and match graphs; block the app |
| A9. Device seizure / forensics | physical access | local plaintext history |
| A10. Supply-chain attacker | compromises our release or a dependency | everything, for every user |

## Threats and decisions

Severity is the impact if exploited, given the current design. Status shows whether a
mitigation is **decided**, needs an **option to be chosen**, or still needs **research**, and
whether it is **implemented** in code. Paths are relative to the repo root; "core" means
`packages/core/src`, "web" means `apps/web/src`.

| # | Threat | Adversary | Sev | Mitigation | Status |
|---|---|---|---|---|---|
| T1 | A feed recipe exfiltrates history over the network | A5 | Critical | Recipes are declarative only (weights, filters); the client evaluates them over candidate lists, never raw history. Unknown keys rejected; 16 KiB limit checked before parsing | Decided (D1). **Implemented:** core `recipe.ts` (`parseRecipe`, `parseRecipeJson`), core `validate.ts`; web recipe import goes through `parseRecipeJson` |
| T2 | PSI preview used as an oracle ("did you watch X?") | A3 | High | **Changed after simulation (Exp 4).** The target learns the PSI-cardinality and releases only a **noised value: discrete Laplace ε = 0.5, floor 5** ("<5" below it), shown as coarse buckets. **At most 8 accepted previews per target per rolling year, from all requesters**, counted on the target's device. The target must accept every preview; per-pair (1/week) and per-requester (5/week) limits stay. The ≥ 20-item minimum set size stays as hygiene only: **it is not a defense**, because a prober pads probes with its own never-watched uploads. Evidence: one exact preview answers the question with certainty; a floor or buckets alone fail once the prober knows 4 of the target's items; per-pair limits don't stop Sybils (50 Sybils at 10% acceptance need 1 week). With floor 5 + ε = 0.5 and 8 previews, prober AUC ≤ 0.83 and 0% of positives inferred at ≥ 90% confidence, even with 4 known items [A10] | Decided. **Policy implemented:** core `preview.ts` (`noisyPreviewCardinality`, `previewBudgetRemaining`, `respondToPreview` refusing with `target-budget`; ε, floor and budget can't be loosened). **Not implemented:** the PSI crypto (OpenMined PSI behind the `PsiCardinality` interface) and the request/response wire format |
| T3 | Circle output reveals individual picks (k too small, subtraction, round-to-round diffs) | A1 | High | **k ≥ 8 hard floor, 12–30 recommended**; reveal threshold on the *noised* count, **t = 3 for k = 8–15, t = 4 for k ≥ 16**; **ε = 1** discrete-Laplace noise per item per epoch [A13]; **sticky noise** (same draw per item per epoch); **epoch freeze** (each MLS epoch released once, never recomputed after a membership change); **picks only, never counts**. Evidence (Exp 3): a single release to one insider leaks little even at k = 5; colluders subtracting their inputs reveal 3–39% of a member's endorsements without noise and none at ≥ 90% confidence with ε ≤ 2; sticky noise without a freeze still lets membership differencing expose 15–22% at k = 8–12; showing noisy counts exposes 49–94% whatever ε is. k = 12, t = 3, ε = 1 keeps 86% recall / 77% precision of group picks | Decided. **Output policy implemented:** core `circle.ts` (`CIRCLE_MIN_MEMBERS`, `revealThresholdFor`, `releaseCircleEpoch`, `circlePicks`; `noisedCount` deprecated and never populated). **Not implemented:** secure aggregation (protocol not chosen) and MLS transport. **Research:** multi-epoch DP accounting; dropout handling |
| T4 | Coerced matching / monitoring by a partner or family member | A2 | High | Quiet pause: the client keeps its send schedule and re-sends the same real items in a fresh envelope (new epoch, expiry, nonce, padding, shuffle), so nothing on the wire says "paused"; per-match exclusions; "endorsements only" by default; no read receipts or "last active"; matches expire unless renewed | Decided (D2). **Implemented in the sketch builder:** core `sketch.ts` (`buildSketch` with `consent.paused`, `excludedVideos`, `excludedTags`, `excludedHours`, `includeFinished: false`). No Match UI yet |
| T5 | Relay metadata reveals the match graph | A6, A8 | High | NIP-17 gift-wrap hides the sender [N1]; random relay selection; fixed-size padded sketches (8,192 / 15,872 bytes; 31,232 over MLS only) on a fixed schedule; Oblivious HTTP to relays [S2]; mixnet transport as an option later [S3]. Sealed-sender-style hiding alone falls to timing attacks [S4]. Marmot (MLS over Nostr) sends Nostr pubkeys and group tags in plaintext, so relays and observers can track circle membership, timing and volume (Least Authority review, Nov 2025) [N3] | Decided (Tor/mixnet: later). **Padding implemented:** core `sketch.ts` (buckets, item and byte padding). Transport, schedule and OHTTP not implemented |
| T6 | P2P streaming leaks viewer IPs per video | A7, A8 | High | P2P off by default for viewers; opt-in with a plain warning [P4] | Decided. **Implemented:** web `lib/settings.ts` (`p2p: false`), `ui/watch.ts` (embed with `p2p=0` unless enabled, warning text). Bridge: `magnet` off by default (`packages/bridge`) |
| T7 | Sybil accounts push content via second-degree propagation or public taste lists | A4 | High | Second degree only through opted-in matches; **row-normalized personalized trust walk, decay 0.3, 2 hops, per-node cap 0.05 of the viewer's trust mass** [A14][A15][A23]; **each taste list contributes at most 2 items per feed**; **list weight from track record, not subscriber count**; sponsored flag on list entries. Evidence (Exp 5): naive 3-hop path counting let 200 attack edges reach 779 bystanders (34.8% of viewers); the capped walk reached 0–3 bystanders and reach did not grow with the number of Sybils; the per-list cap plus track-record weighting cut lured-subscriber reach under a list-heavy mix from 54% to 2%. **Residual:** a viewer who matches a mirroring Sybil sees its picks almost every time. Not simulated: per-source trust learned from feedback (DSybil [A22]), a per-match item cap, attribution, one-tap unmatch | Decided; parameters set by simulation. **Implemented:** core `trust.ts` (`TRUST_WALK_DEFAULTS`, `trustWalk`, `tasteListStrength`), core `rank.ts` (`maxPerTasteList`, default 2), web `lib/trackrecord.ts`. **Research:** first-hop Sybils |
| T8 | Payola: undisclosed paid placement in creator taste lists | A4 | Medium | Machine-readable sponsored / affiliated flag per entry; show it in the UI; downweight lists caught hiding it | Decided. **Flags and labels implemented:** web `lib/tastelist.ts` (provisional format), feed cards. Downweighting for hidden sponsorship not implemented; lists are unsigned |
| T9 | Device seizure exposes plaintext history | A9 | High | Encrypt at rest with an OS-keystore key; delete anything outside the sharing window; optional history-off mode; fast wipe | Decided. **Not implemented for encryption:** the web client stores history in plain `localStorage` (web `lib/storage.ts`, `lib/history.ts`). Implemented: private watching (no history written) and "Wipe local history" |
| T10 | Key theft lets an attacker read future sketches or impersonate | A9, A10 | High | Separate long-term identity key from per-match and per-circle keys; MLS gives circles forward secrecy and post-compromise security [N2]; NIP-44 has no forward secrecy (Cure53 NOS-01-006, Medium), so rotate 1:1 match keys at least every 90 days and on revocation [N1]. Cure53 NOS-01-007 (Low) flags missing key separation between signing and encryption, which supports separate keys | Decided. Not implemented (no key management yet) |
| T11 | Key loss locks a creator out of their identity | — | Medium | Social recovery (threshold guardians) or a hardware-backed key; publish a key-rotation event signed by the old key | Research |
| T12 | Instance seizure exposes account data (cf. Kolektiva 2023: an unencrypted backup of an instance of about 7,800 members, holding emails, hashed passwords, recent login IPs, posts and DMs) [S1] | A7, A8 | Medium | Instances hold the minimum: no watch history, ever. Encrypted backups. Recommend retention limits to instance admins | Decided for our code (the web client sends history nowhere); advisory for admins |
| T13 | Malicious or compromised client release | A10 | Critical | Reproducible builds; signed releases; F-Droid listing; pinned and reviewed dependencies; two-person release sign-off | Decided. **Partly implemented:** core has no runtime dependencies; the bridge pins `nostr-tools` 2.25.2; the web app pins `esbuild` 0.28.2 and `typescript` 5.9.3 with lockfiles. Builds are not yet reproducible or signed |
| T14 | Creator analytics becomes viewer tracking | A7 | Medium | DAP with two non-colluding aggregators [C6]; channel-level totals only, 28-day windows, counts under 20 shown as "<20"; creator opt-in; viewer contribution on by default with per-signal off switches; private to the creator unless the creator publishes. ePrivacy Art. 5(3) must be resolved before EU launch; see ANALYTICS.md | Decided except Q2 (country stats) and the second-aggregator operator (D3). **v1 transmits nothing:** web `lib/analytics.ts` keeps a local tally that honours the switches and private watching |
| T15 | Replay or forged sketches | A6 | Medium | Sign every event; nonces and expiry in each sketch; reject stale epochs | Decided. **Validation implemented:** core `sketch.ts` (`validateSketch`, `decodeSketch`: strict keys, size before parse, expiry ≤ 30 days, epoch must increase). Signing not implemented |
| T16 | Public taste lists de-anonymize their owners or feed poisoning attacks | A1, A4 | Medium | Warn curators that lists are public; allow pseudonymous curator keys; don't combine a viewer's private matches with their public list | Decided. Not implemented (no list publishing yet) |
| T17 | App-store removal or network blocking | A8 | Medium | PWA plus F-Droid and sideloading; relay and instance lists can be swapped; no single domain required | Decided. **PWA implemented:** web `public/manifest.webmanifest`, `public/sw.js`; the instance list is user-editable |
| T18 | Abuse/illegal content hosted on instances | — | High (legal) | Instance moderation unchanged; subscribe-able labelers applied on-device; hash-matching stays with instance operators | Research |
| T19 | **The circle's per-epoch noise seed reaches a member**, who recomputes the sticky noise and subtracts it, undoing the DP protection of T3 | A1 | High | The seed is generated and used only inside the secure aggregation; no member and no server ever holds it. Prefer adding noise inside the aggregation. `circle.ts` is the post-aggregation policy layer: simulations call it on raw sets, deployments must not | Decided as a requirement. **Not implementable until the aggregation protocol is chosen.** Core `circle.ts` takes the seed as `noiseSeed` and documents the rule |
| T20 | **`keyedRng` is a reference construction, not an audited PRF.** It is SHA-256 in counter mode over `key ‖ 0 ‖ label ‖ 0 ‖ counter`, using a hand-written SHA-256, and drives sticky circle noise | A1 | Medium | Before Circles ship, replace it with an audited PRF (HMAC-SHA-256 from an audited library) and an audited noise sampler, as the code comment says; keep the current one for tests and simulation. This is the one place the core library departs from "never roll our own crypto" | Open. Core `rng.ts` (`keyedRng`, `sha256`). Production randomness elsewhere uses `cryptoRng` (`crypto.getRandomValues`) |
| T21 | **Third-party web assets leak viewer IPs** (e.g. Google Fonts requests on every page load) | A8 | Low | Self-host fonts; CSP that allows fonts, scripts and styles only from `'self'` | **Fixed in the live build:** `apps/web/public/fonts/` (OFL), `public/index.html` CSP `font-src 'self'`. The offline artifact build (`dist-artifact/index.html`) still links Google Fonts; it is a demo with no real data |
| T22 | **Local history in the web app is unencrypted** (the T9 risk, realized in v1) | A9, A2 | High | See T9. Until encryption at rest exists: private watching, wipe, and endorsements-only sketches; tell users plainly | **Open.** Web `lib/storage.ts` (`localStorage` under `mf.v1.*`), `lib/history.ts` (capped at 2,000 entries) |
| T23 | **Bridge signing policy: who signs NIP-71 events.** An instance key could sign as if it were the creator; a leaked bridge key could publish false metadata; events outlive videos later made private or deleted | A4, A7, A10 | Medium | Best case the creator signs with their own key (NIP-07 / NIP-46). An instance-run bridge signs with its own key and names the creator with a `p` tag; it must never pose as the creator. The secret key is read only from the environment, never argv; dry run is the default; only Public, published, non-live videos are bridged. The signer vouches for metadata, not bytes (PeerTube exposes no whole-file hash for `x`). Deletions: publish NIP-09 deletion events when a video goes private or is removed | Decided. **Implemented:** `packages/bridge/src/cli.ts` (`NOSTR_SECRET_KEY` env only, `--creator-pubkey`), `src/mapping.ts` (`checkBridgeable`), `src/event.ts` (`signWith` re-checks id, pubkey and signature). **Not implemented:** NIP-09 deletions; consent checks for bridging other people's channels |

## Decisions that are yours

**D1. Feed-recipe safety (T1). DECIDED 2026-10-19: declarative recipes only (JSON weights and filters). No code execution.** Implemented in `packages/core/src/recipe.ts`.

| Option | Pros | Cons |
|---|---|---|
| Declarative recipes only (JSON weights + filters) | simplest to audit; no code execution | limits what community recipes can do |
| WASM sandbox, no I/O | expressive; still can't exfiltrate | sandbox escapes are possible; bigger attack surface; harder review |
| Both: declarative by default, WASM behind a warning | flexible | two systems to maintain |

**D2. Coercion handling (T4). DECIDED 2026-10-19: quiet pause plus per-match exclusions (baseline).** The pause re-sends the same items in a fresh envelope, so the sketch keeps arriving on schedule; the remaining tell is only that its content stops changing. Implemented in `packages/core/src/sketch.ts`.

| Option | Pros | Cons |
|---|---|---|
| Silent pause + exclusions (baseline) | simple; plausible | the abuser may notice the sketch stops changing |
| Decoy mode: send a plausible but stale or partial sketch | stronger plausible deniability | if discovered, users are endangered; hard to do well |
| Baseline + safety-planning copy, done with an advocacy org | grounded in real abuse cases | slower; needs partners |

**D3. Second aggregator for creator analytics (T14). IN PROGRESS.** Decided: creator opt-in; viewer contribution on by default with per-signal off switches (Q1); private to the creator unless published (Q3). Open: Q2 (country stats), the helper operator, and the EU ePrivacy question. See `docs/ANALYTICS.md`.

| Option | Pros | Cons |
|---|---|---|
| Use ISRG's Divvi Up as the 2nd aggregator | existing operator | dependency on one US nonprofit; 2026 status unverified |
| A partner org runs it | spreads trust | operational burden on them |
| Skip private analytics in v1 | nothing to build | creators get no reach data |

## Process

1. **Outside review.** Review this model with 1–2 outside privacy engineers. Not done yet. Code now exists for the v1 tiers and for the Match/Circle policy layers, so this should happen before any Match or Circle networking code is written.
2. **Prefer audited primitives; never roll our own crypto.** Audit status as of 2026-10-19 (see `docs/OSS_STACK.md` and the research notes):
   - **Marmot / MLS over Nostr:** Least Authority reviewed the Marmot protocol (summary report 7 Nov 2025; MIPs 00–04, MIP-05 excluded as incomplete). It found no existing threat model and recommended one, plus careful separation of the MLS extractor key used for NIP-44 encryption, and noted plaintext pubkeys and group tags (T5). Least Authority also audited whitenoise-rs (final report 1 April 2026). Whether MDK itself was in scope is unconfirmed. marmot-ts is alpha and unaudited, so use it for the prototype only.
   - **NIP-44:** Cure53 audited the NIP-44 spec and the paulmillr/nip44 JS/TS, Go and Rust implementations (Nov–Dec 2023): 10 findings, NOS-01-001 to NOS-01-010, none exploitable. Medium: missing range checks (NOS-01-005) and no forward secrecy (NOS-01-006). Low: HMAC timing (NOS-01-004) and no signing/encryption key separation (NOS-01-007). NOS-01-001 (twist attacks) is informational. Per its maintainer, only the JS implementation was audited in its final form. Confirm that nostr-tools ships the same code.
   - **OpenMined PSI: no audit**, and its README states no security model. Commission one, or budget for it in the pre-launch audit.
   - **Our own code:** `keyedRng` and its SHA-256 (T20) must be replaced by audited code before Circles ship.
3. **Before Match launches:** an external security audit of the Match and Circle protocols and the client. Cure53, Least Authority and Trail of Bits have audited comparable systems.
4. **Simulate T3, T2 and T7. DONE (first pass, 2026-10-19):** `docs/SIMULATION_RESULTS.md`, harness in `sim/`. Synthetic data; it sets parameters and compares mechanisms, not absolute risk. Not simulated: relay metadata (T5), multi-epoch Circle accounting, secure-aggregation dropouts, adaptive Sybils, real cryptography.
5. **Ongoing:**
   - security.txt and a disclosure policy
   - a bug bounty after launch
   - a public changelog of protocol changes
   - telemetry only through private aggregation (no other analytics SDKs)
6. **Incident response:** a key-revocation broadcast, forced sketch-epoch rotation, and a user notice template.

## Known residual risks

These can't be engineered away. Say them plainly in the UI.

- A match can keep and leak whatever you sent them.
- Anyone recommended a video "because of" a match learns that the match endorsed it.
- A match who is a Sybil reaches you directly; the trust walk only stops it spreading further.
- Even with noise and a budget, previews leak a little: after 8 accepted previews a well-informed prober's AUC can reach about 0.83.
- Relays still see that *some* encrypted traffic flows, and when, unless a mixnet is used.
- A compelled app-store removal will cut off casual users even if sideloading works.
