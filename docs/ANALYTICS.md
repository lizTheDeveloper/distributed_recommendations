# Creator analytics

Status: draft, 2026-10-19. Decision D3 in `docs/THREAT_MODEL.md`.
Tier 2 option A has a prototype: `packages/analytics` and `infra/janus`, described in
**`docs/ANALYTICS_IMPLEMENTATION.md`** (protocol versions, what each party learns,
operator obligations, open issues). Not wired into apps/web yet.

## The core point

Most creator metrics carry **no new privacy cost**, because the instance serving
the video already sees the requests. Only one metric is new and sensitive: **how a
viewer found the video**. That reveals whether the viewer has matches or circles,
and which taste lists they read. Only that metric needs private aggregation.

## Three tiers of metrics

| Tier | Metrics | Source | Privacy cost | Status |
|---|---|---|---|---|
| 0. Host-side | views, watch time, retention, peak viewers; countries only if the admin enables them | PeerTube's built-in video stats, which combine local, remote-instance and embed views (since v4.2, June 2022) [1][2] | none new: the host already serves these requests | exists today |
| 1. Public signals | followers, taste-list subscribers, endorsement counts, appearances in public taste lists | public events | none: already public | build: just counting |
| 2. Discovery channel | share of views from Follow / Taste / Match / Circle / Explore / 2nd degree (implemented as share of **viewers**; see below) | viewer devices | **high per viewer**: reveals someone's private network | prototype: `packages/analytics` + `infra/janus` (DAP); not in the app yet |

## Consent: it takes two sides

The creator **enabling** analytics doesn't make it OK. The data in Tier 2 is about
*viewers*. So:
- **Creator switch:** "Collect discovery-channel stats for my channel." Off by default.
- **Viewer switch:** "Contribute anonymous discovery stats." Its default is open decision Q1 below.

## Mechanism options for Tier 2

| Option | How | Pros | Cons |
|---|---|---|---|
| A. DAP, two aggregators | the viewer device splits a one-hot "channel" report into two secret shares; the creator's instance runs Janus as leader, an independent party runs the helper [3][4] | exact totals; neither server sees an individual report; IETF track | needs a second, non-colluding operator; more infrastructure |
| B. Local DP to one collector | the device reports its channel through randomized response, straight to the creator's instance | one server; simple | noisy; useful only past roughly a few thousand views, so small creators get mush |
| C. Skip Tier 2 in v1 | ship Tiers 0 and 1 only | zero risk; nothing to build | creators can't see whether Match or taste lists help them |

**Small-creator problem (applies to A and B):** you can't privately report a
breakdown of 12 views; any split of 12 views is close to identifying. Mitigations:
- report per channel across all videos, never per video
- use 28-day windows
- show any count under 20 as "<20"

Small creators will see little Tier 2 detail. That's the honest cost.

**Deviation in the implementation: viewers, not views.** The prototype counts each
viewer once per creator per 28-day window, for the channel that brought them most
(one Prio3Histogram report per device), not every view. That bounds each viewer's
contribution, which the DP noise needs (sensitivity 2), and stops the number of
uploads from revealing how much someone watched. The studio should say "share of
viewers who found you through…". Details: `docs/ANALYTICS_IMPLEMENTATION.md`,
"What a report counts".

## Who runs the second aggregator (option A)

| Option | Notes |
|---|---|
| ISRG Divvi Up | existing nonprofit DAP service; used for Firefox metrics as of late 2024 [5][6]. Its 2026 status is unverified |
| A partner organization (another fediverse nonprofit) | spreads trust; operating burden on them |
| Instance pairs: two unrelated instances act as each other's helper | no outside party; collusion is easier to arrange; needs a pairing registry |

## Proposed default (subject to Q1–Q3)

1. **v1:** Tiers 0 and 1. These are free and private today.
2. **v1.1:** Tier 2 via option A (prototype built; `docs/ANALYTICS_IMPLEMENTATION.md`).
   - creator opt-in
   - the creator's home instance runs the leader; Divvi Up or a partner runs the helper
   - channel-level only, 28-day window, threshold of 20
   - DP noise on the totals
3. **Fallback if no helper operator is found:** option B, labeled "estimates" in the studio.

## Decisions (2026-10-19)

- **Q1: on by default for viewers, with an easy off switch.**
  - Every Tier 2 signal can be turned off on its own: channel stats overall, and per channel (e.g. "never report Match or Circle").
  - **Legal risk to resolve before EU launch:** ePrivacy Art. 5(3) generally requires consent before reading or sending information from a user's device unless it's strictly necessary. Opt-out telemetry may not satisfy it, even when it's aggregated with DAP. Options: default-on outside the EU and opt-in inside it, or get legal advice on whether DAP output counts as anonymous.
- **Q3: private to the creator by default; the creator can choose to publish it.** Published numbers carry the same thresholds and noise.
- **Q2: still open** (country stats in our default instance settings).

## Original open decisions

- **Q1. Viewer default for Tier 2.**
  - *Off:* most respectful, but few viewers contribute, so Tier 2 is mostly "<20".
  - *On with a clear notice:* useful data, but it is opt-out collection, which conflicts with the "nothing leaves your device unless you chose it" promise.
- **Q2. Countries in Tier 0.** PeerTube makes this the admin's choice. Should our instance defaults keep it off?
- **Q3. Show Tier 2 to the creator only, or publicly?** Public numbers help people judge taste lists, but they invite gaming.

## Sources

1. PeerTube 4.2 release notes: https://joinpeertube.org/news/release-4.2
2. PeerTube video stats docs: https://docs.joinpeertube.org/use/video-stats
3. IETF DAP draft: https://datatracker.ietf.org/doc/draft-ietf-ppm-dap/
4. Divvi Up / Janus (ISRG): https://divviup.org/about/
5. Divvi Up in Firefox: https://divviup.org/blog/divvi-up-in-firefox/
6. Internet Society Foundation, Dec 2024: https://www.isocfoundation.org/2024/12/digital-privacy-researchers-develop-a-tool-that-enables-apps-collect-less-user-data/
