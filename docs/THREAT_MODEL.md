# Match Feed: threat model and security plan

Status: draft v1, 2026-10-19. Companion to `docs/DESIGN.md`. Source IDs (A12, N1, …)
refer to the Sources list in DESIGN.md.

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
mitigation is **decided**, needs an **option to be chosen**, or still needs **research**.

| # | Threat | Adversary | Sev | Mitigation | Status |
|---|---|---|---|---|---|
| T1 | A feed recipe exfiltrates history over the network | A5 | Critical | Recipes are declarative only (weights, filters); the client evaluates them over candidate lists, never raw history | Decided (D1) |
| T2 | PSI preview used as an oracle ("did you watch X?") | A3 | High | Preview only after the target accepts a preview request; both sets must have ≥20 items; rate-limit per pair and per requester; this is PSI-cardinality, so we never reveal items [A10] | Decided |
| T3 | Circle output reveals individual picks (k too small, subtraction, round-to-round diffs) | A1 | High | k ≥ 8, a pick is shown only above a member threshold, DP noise on counts [A13], fixed membership per round, an epoch delay before membership changes take effect | Research (simulate leakage) |
| T4 | Coerced matching / monitoring by a partner or family member | A2 | High | Silent pause that doesn't change what the peer sees; per-match exclusions; "endorsements only" by default; no read receipts or "last active"; matches expire unless renewed | Decided (D2) |
| T5 | Relay metadata reveals the match graph | A6, A8 | High | NIP-17 gift-wrap hides the sender [N1]; random relay selection; fixed-size padded sketches on a fixed schedule (hides activity level); Oblivious HTTP to relays [S2]; mixnet transport as an option later [S3]. Sealed-sender-style hiding alone falls to timing attacks [S4] | Decided (Tor/mixnet: later) |
| T6 | P2P streaming leaks viewer IPs per video | A7, A8 | High | P2P off by default for viewers; opt-in with a plain warning [P4] | Decided |
| T7 | Sybil accounts push content via second-degree propagation or public taste lists | A4 | High | Second degree only through opted-in matches; decaying personalized trust [A14][A15]; per-source trust learned from feedback (DSybil-style) [A22]; cap any one list's share of a feed; sponsored-flag required on lists | Decided; tune by simulation |
| T8 | Payola: undisclosed paid placement in creator taste lists | A4 | Medium | Machine-readable sponsored flag per entry; show it in the UI; downweight lists caught hiding it | Decided |
| T9 | Device seizure exposes plaintext history | A9 | High | Encrypt at rest with an OS-keystore key; delete anything outside the sharing window; optional history-off mode; fast wipe | Decided |
| T10 | Key theft lets an attacker read future sketches or impersonate | A9, A10 | High | Separate long-term identity key from per-match and per-circle keys; MLS gives circles forward secrecy and post-compromise security [N2]; NIP-44 has no forward secrecy, so rotate 1:1 match keys often [N1] | Decided |
| T11 | Key loss locks a creator out of their identity | — | Medium | Social recovery (threshold guardians) or a hardware-backed key; publish a key-rotation event signed by the old key | Research |
| T12 | Instance seizure exposes account data (cf. Kolektiva 2023) | A7, A8 | Medium | Instances hold the minimum: no watch history, ever. Encrypted backups. Recommend retention limits to instance admins | Decided for our code; advisory for admins |
| T13 | Malicious or compromised client release | A10 | Critical | Reproducible builds; signed releases; F-Droid listing; pinned and reviewed dependencies; two-person release sign-off | Decided |
| T14 | Creator analytics becomes viewer tracking | A7 | Medium | DAP with two non-colluding aggregators [C6]; report only channel totals with minimum batch sizes; creator opt-in; see ANALYTICS.md | Open (D3) |
| T15 | Replay or forged sketches | A6 | Medium | Sign every event; nonces and expiry in each sketch; reject stale epochs | Decided |
| T16 | Public taste lists de-anonymize their owners or feed poisoning attacks | A1, A4 | Medium | Warn curators that lists are public; allow pseudonymous curator keys; don't combine a viewer's private matches with their public list | Decided |
| T17 | App-store removal or network blocking | A8 | Medium | PWA plus F-Droid and sideloading; relay and instance lists can be swapped; no single domain required | Decided |
| T18 | Abuse/illegal content hosted on instances | — | High (legal) | Instance moderation unchanged; subscribe-able labelers applied on-device; hash-matching stays with instance operators | Research |

## Decisions that are yours

**D1. Feed-recipe safety (T1). DECIDED 2026-10-19: declarative recipes only (JSON weights and filters). No code execution.**

| Option | Pros | Cons |
|---|---|---|
| Declarative recipes only (JSON weights + filters) | simplest to audit; no code execution | limits what community recipes can do |
| WASM sandbox, no I/O | expressive; still can't exfiltrate | sandbox escapes are possible; bigger attack surface; harder review |
| Both: declarative by default, WASM behind a warning | flexible | two systems to maintain |

**D2. Coercion handling (T4). DECIDED 2026-10-19: quiet pause plus per-match exclusions (baseline).**

| Option | Pros | Cons |
|---|---|---|
| Silent pause + exclusions (baseline) | simple; plausible | the abuser may notice the sketch stops changing |
| Decoy mode: send a plausible but stale or partial sketch | stronger plausible deniability | if discovered, users are endangered; hard to do well |
| Baseline + safety-planning copy, done with an advocacy org | grounded in real abuse cases | slower; needs partners |

**D3. Second aggregator for creator analytics (T14). IN PROGRESS: creator opt-in; see `docs/ANALYTICS.md`.**

| Option | Pros | Cons |
|---|---|---|
| Use ISRG's Divvi Up as the 2nd aggregator | existing operator | dependency on one US nonprofit |
| A partner org runs it | spreads trust | operational burden on them |
| Skip private analytics in v1 | nothing to build | creators get no reach data |

## Process

1. **Before any code:** review this model with 1–2 outside privacy engineers.
2. **Use audited primitives only:** Marmot/OpenMLS, NIP-44 implementations covered by the Cure53 audit, OpenMined PSI. Never roll our own crypto.
3. **Before Match launches:** an external security audit of the Match and Circle protocols and the client. Cure53, Least Authority and Trail of Bits have audited comparable systems.
4. **Simulate T3, T2 and T7** (circle leakage, preview leakage, Sybil reach) and publish the results.
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
- Relays still see that *some* encrypted traffic flows, and when, unless a mixnet is used.
- A compelled app-store removal will cut off casual users even if sideloading works.
