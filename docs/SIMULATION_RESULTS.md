# Match Feed: simulation results

Status: first pass, 2026-10-19. Harness: `sim/` (see `sim/README.md`). Every number below
comes from `python3 -m sim.run --all` (seed 0 base; Python 3.13, numpy 2.5). The full tables
are in `sim/out/*.csv` and `sim/out/ALL_SUMMARIES.md`. This document answers the
"Open questions / to simulate" list in `DESIGN.md` and THREAT_MODEL item 4 (simulate T2, T3, T7).

> **All data here is synthetic.** These results compare mechanisms *against each other*
> under stated assumptions. They don't predict absolute quality, real user behaviour or
> real catalog statistics. Read "Limitations" before quoting any number outside this repo.

## Summary of recommendations

| Parameter | Draft value | Recommended | Evidence |
|---|---|---|---|
| Explore share | 5–15% (untested) | **5% default**; allow 2–10%; never below 2% | Exp 2: 5% finds 66% of new creators in their first week and 98% within 4 weeks, at no measurable viewer cost. 1% leaves 6.5% unseen after 6 weeks. 15% adds little over 10% |
| Explore ranking | unspecified | **rank explore candidates by on-device relevance**, not at random | Exp 2: random explore costs ~0.7% P@20 per 1% of share. Relevance-ranked explore cost ~0 up to 10% |
| Taste-list weight in the mix | unspecified | **low (≈0.15 of the peer signal)**; at most **2 items per list per feed**; weight lists by **track record, not subscriber count** | Exp 1: a list-heavy mix loses 16% P@20 and raises the exposure Gini. Exp 5: the list cap cuts list-subscriber reach from 54% to 2% |
| Second degree | decayed, opt-in | **decay 0.3, 2 hops max, per-node cap 0.05 of the viewer's trust mass, row-normalized walk** | Exp 5: naive 3-hop path counting lets 200 attack edges reach 779 bystanders. The capped walk lets them reach 0–3 |
| Circle size k | k ≥ 8 | **hard floor 8, default 12–30** | Exp 3 |
| Circle reveal threshold t | "a threshold" | **t = 3 for k = 8–15; t = 4 for k = 16–30**; reveal picks only, **never counts** | Exp 3: noisy counts plus one membership change expose 71–94% of a member's endorsements at k ≥ 12 |
| Circle DP | "DP noise" | **ε = 1 per item per epoch**, discrete Laplace, **sticky noise** (same draw for the same item within an epoch) | Exp 3: ε = 1 drops a colluding attacker's ≥90%-confident inferences from 16–39% to 0%. Repeated releases with fresh noise add leakage |
| Circle membership change | epoch delay | **epoch freeze**: after a membership change, never recompute or re-release items from the previous epoch | Exp 3: with sticky noise but no freeze, differencing still exposes 15–22% of the target's endorsements at k = 8–12 |
| PSI preview min set size | ≥ 20 | keep it, but **it gives no protection on its own** | Exp 4: minted decoys pad any probe for free |
| PSI preview output | exact cardinality | **floor 5 + discrete-Laplace ε = 0.5**, shown to users as coarse buckets | Exp 4: one exact preview answers "did they watch X" with certainty. A floor alone fails if the prober knows 4 of the target's items |
| PSI preview rate | 1 / week / pair | keep it, **plus a target-side budget of ≤ 8 accepted previews per rolling year, across all requesters**, enforced on the target's device | Exp 4: after 8 floor5+dp0.5 previews, AUC is 0.68–0.83 and 0% of positives are inferred with ≥90% confidence. Sybils defeat per-pair limits |

## World model (shared by all experiments)

`sim/world.py`; default 3,000 viewers, 1,200 creators, about 7,300 videos, 12 weekly rounds.

- **Taste:** 12 communities with Dirichlet-distributed sizes and 16-dimensional latent vectors. A viewer's taste is their community centre plus noise. 30% of viewers also lean toward a second community.
- **Creators:**
  - Popularity is Pareto (shape 1.16; Gini of latent popularity about 0.62).
  - Quality is drawn independently.
  - 70% exist at the start. The rest arrive uniformly over weeks 1–11.
  - About 6 videos each, with topic = creator topic + noise.
  - Videos carry *observed* tags, which are the topic plus heavy noise. This is the only content signal a device has.
- **Ground truth:**
  - `P(endorse) = sigmoid(6·taste·topic + 0.6·quality − 5)`, which averages 5%. The top 20 items for a viewer average 0.59.
  - Fixed Bernoulli labels `Y` ("would endorse if shown") serve as the test set.
- **History:**
  - Each viewer gets a popularity- and relevance-biased exposure history: a lognormal of about 133 views, which yields about 18 endorsements.
  - 10% are cold-start viewers with 3–8 views and about 0.7 endorsements.
  - Endorsements are what the viewer saw *and* would endorse.
- **Relationships:**
  - **Follows:** preferential (popularity × taste), about 14 per viewer.
  - **Matches:** mutual and user-chosen from people who *seem* similar (noisy affinity plus a same-community bonus). k is 3–15 per viewer (mean degree 8.2); cold-start viewers have 0–3. 96% of matches are within the community.
  - **Circles:** 8–30 members, 80% from one community.
  - **Taste lists:** 60 public lists, each holding its owner's 40 most recent endorsements. Viewers subscribe to about 2, chosen by popularity × taste; cold-start viewers get 1–3 "starter packs".
  - **Second-degree opt-in:** 80% of viewers.

## Experiment 1: recommender quality and creator exposure

**Method** (`sim/exp1_quality.py`):
- Static snapshot at the end of the history, 3 world seeds (0–2), mean ± sd across seeds.
- Feeds hold 20 items, are never re-recommended, and are scored against `Y` on unseen items.
- Strategies:
  - (a) global user-kNN CF over everyone's endorsements (the centralized baseline, k = 50)
  - (b) follow-only, newest first
  - (c) CF from the viewer's chosen matches only, weighted by 0.1 + cosine of sketches
  - (d) c + subscribed lists (weight 0.15) + follows (0.1)
  - (d′) d with "taste-heavy" weights (lists 0.6, follows 0.3)
  - (e) d + second degree (opted-in middles, decay 0.3)
  - (f) e + explore slots (10% and 2%)
- d–f use a per-creator cap of 2 items per feed.
- The 0.15/0.1 weights were picked on seed 7, which is not a reported seed.

| strategy | P@20 | R@20 | novelty (bits) | catalog coverage | exposure Gini | long-tail share | cold-start P@20 | cold, 0 matches P@20 |
|---|---|---|---|---|---|---|---|---|
| a global CF (central) | 0.297 ±0.012 | 0.017 | 6.64 | 0.49 | **0.846** | 0.17 | 0.209 | **0.202** |
| b follow, chrono | 0.165 ±0.006 | 0.009 | 7.52 | 0.62 | 0.693 | 0.36 | 0.148 | 0.147 |
| c match | 0.287 ±0.008 | 0.017 | 7.25 | 0.78 | 0.665 | 0.34 | 0.227 | 0.147 |
| d match + lists | 0.287 ±0.008 | 0.017 | 7.27 | 0.77 | 0.662 | 0.35 | 0.233 | 0.169 |
| d′ taste-heavy | 0.242 ±0.011 | 0.014 | 7.12 | 0.69 | 0.730 | 0.31 | 0.216 | 0.168 |
| e d + 2nd degree | **0.300 ±0.007** | 0.018 | 7.31 | 0.76 | 0.653 | 0.36 | **0.246** | 0.169 |
| f e + 2% explore | 0.298 ±0.008 | 0.017 | 7.34 | 0.81 | 0.639 | 0.37 | 0.243 | 0.166 |
| f e + 10% explore | 0.287 ±0.007 | 0.017 | 7.48 | **0.87** | **0.592** | **0.41** | 0.236 | 0.166 |

Long-tail share = share of impressions going to creators outside the top 20% by followers.
Recall is low for every strategy because each viewer has about 360 relevant unseen items and
only 20 slots.

**Findings**

1. **Match-based CF is as accurate as the centralized baseline and much less concentrated.**
   - c is within 4% of global CF on P@20 (0.287 vs 0.297), and e matches it (0.300).
   - c's exposure Gini is 0.67 vs 0.85, its catalog coverage 0.78 vs 0.49, and its long-tail share 0.34 vs 0.17.
   - This supports the design's "match ≈ CF accuracy" premise [A7][A8]. It's a structural result: on-device CF over a few homophilous peers can't reproduce the global popularity feedback loop [C4].
2. **Second degree helps a little:** +4.5% P@20 over d, slightly lower Gini, and the best cold-start score among the decentralized strategies.
3. **Lists help newcomers, not established viewers.**
   - At low weight they're neutral for warm users.
   - For cold-start viewers with *no* matches, P@20 goes from 0.147 (follow-only fallback) to 0.169 (+15%).
   - Centralized CF is still better for that group (0.202). **The main quality cost of decentralization lands on newcomers without matches.**
4. **Taste-heavy vs match-heavy feeds (DESIGN open question):**
   - The taste-heavy mix concentrates exposure more (Gini 0.73 vs 0.66) and loses 16% P@20.
   - In this world, lists are their owners' popularity-biased histories. Hand-curated lists that favour small creators could reverse the Gini result (see Limitations).
5. **Explore slots trade a little static precision for exposure.**
   - 10% explore lowers the Gini from 0.65 to 0.59 and costs 4% P@20 in this static snapshot.
   - 2% costs nothing measurable. In the dynamic run (Exp 2), the static cost disappears.

## Experiment 2: explore-slot share vs. new-creator discovery

**Method** (`sim/exp2_explore.py`):
- Dynamic run over 12 weekly rounds, with 1,500 viewers, 1,000 creators and 2 seeds.
- History starts with only the initial creators. Each week:
  - New creators arrive.
  - Each viewer gets a strategy-f feed with the given explore share. Explore slot counts are Binomial(20, share) per viewer.
  - Viewers watch each item with p = 0.6, endorse per `Y`, and follow the creator of an endorsed item with p = 0.15.
  - Off-app discovery (search, links) gives each viewer Poisson(0.5) extra popularity-biased views a week.
  - Taste lists update to their owners' latest endorsements.
- **Explore candidates:**
  - videos from creators the viewer has no tie to (not followed, not surfaced by matches or lists)
  - who are new (< 4 weeks) or below median follower count
  - ranked by similarity between the viewer's tag profile and the video's noisy tags
- **TTFV:** weeks from a new creator's first upload to the first in-feed view by a non-follower, where week 1 = the upload week. Computed for creators who arrived in weeks 1–6, so each has a 6-week window.
- Common random numbers across shares.

| explore share | median TTFV | mean TTFV (capped 7) | found ≤1 wk | found ≤4 wk | not found in 6 wk | viewer P@20 (Δ vs 0%) | exposure Gini | new-creator impr. share |
|---|---|---|---|---|---|---|---|---|
| 0% | > 6 wk | 6.02 | 0% | 21% | **56%** | 0.253 | 0.609 | 0.6% |
| 1% | 3 wk | 3.35 | 24% | 70% | 6.5% | 0.254 (+0.4%) | 0.596 | 1.3% |
| 2% | 2 wk | 2.46 | 35% | 89% | 1.5% | 0.255 (+0.6%) | 0.585 | 2.0% |
| **5%** | **1 wk** | **1.57** | **66%** | **98%** | **0.3%** | 0.255 (+0.6%) | 0.557 | 4.0% |
| 10% | 1 wk | 1.24 | 83% | 99.7% | 0% | 0.255 (+0.6%) | 0.516 | 7.0% |
| 15% | 1 wk | 1.14 | 90% | 99.7% | 0% | 0.252 (−0.7%) | 0.485 | 9.1% |
| 5%, random ranking | 1 wk | 1.65 | 56% | 98% | 0% | 0.245 (−3.4%) | 0.577 | 2.3% |
| 10%, random ranking | 1 wk | 1.22 | 80% | 100% | 0% | 0.236 (−6.7%) | 0.546 | 3.9% |

Sensitivity check (seed 0) with 4× more off-app discovery (2 views per viewer per week):
- At 0% explore, 18% of new creators are still unseen in-feed after 6 weeks. Median TTFV is 5 weeks.
- At 2% and 5%, the explore results barely change (found ≤4 wk: 93% and 98%).

**Findings**

1. **Without reserved slots, trust-based feeds lock new creators out.** With 0% explore, 56% of new creators get *no* in-feed view from a non-follower within 6 weeks, and they receive 0.6% of impressions. This holds even with 4× more off-app discovery (18% unseen).
2. **The curve flattens quickly.**
   - Going from 0% to 2% removes almost all lock-out.
   - 5% puts two-thirds of new creators in front of a stranger in their first week.
   - Above 10% the gains are marginal: 83% → 90% found in week 1.
   - Exposure Gini falls steadily, from 0.61 at 0% to 0.49 at 15%.
3. **The viewer cost depends on how explore candidates are ranked.**
   - Relevance-ranked explore was free or slightly positive up to 10%. Its picks are relevant, and the endorsements they generate feed back into CF.
   - Random explore cost about 0.7% P@20 per point of share.
   - The real cost will lie between these two and depends on how good tag or content signals are on-device.
4. **On the YouTube comparison.** YouTube's published production exploration is about 1–2% of traffic (Online Matching, RecSys 2023). It runs on a platform with dedicated fresh-content pipelines and a huge viewer base, so a small share is still a lot of views.
   - In this small-network model, 1% still leaves 6.5% of new creators unseen after 6 weeks, and the median wait is 3 weeks.
   - **Recommendation: 5% default, user-adjustable 2–10%.**
   - The draft's 5–15% range is defensible at the low end. 15% buys little.

## Experiment 3: Circle output leakage (T3)

**Method** (`sim/exp3_circles.py`):
- For each k in {5, 8, 12, 20, 30}: 60 circles of exactly k members, 80% from one community.
- 150 candidate items per circle, drawn in proportion to the group's interest. Endorsements are from `Y`, with a base rate of about 15%.
- Output per item: "group pick" iff count + Z ≥ t, where Z is discrete Laplace(ε) and ε = ∞ means no noise. A "count" variant also shows the noisy count.
- **Attacker:** one insider who knows their own input and each item's average endorse rate in the circle. The posterior is computed exactly, so this is the Bayes-optimal attacker.
- **Metrics:**
  - ΔAUC = AUC(posterior) − AUC(prior) for "did target T endorse item x"
  - **conf90:** the share of T's true endorsements the attacker infers with ≥ 90% confidence. This is the Calandrino-style measure of how much is effectively revealed.
- **Scenarios:**
  - `single`: one release
  - `collude`: everyone except the target colludes, i.e. pure subtraction
  - `diff_fresh`: release, then the target leaves, then re-release with fresh noise
  - `diff_sticky`: the same, but reusing the noise draw
  - `repeat10`: 10 releases with fresh noise
- **Utility:** recall and precision of revealed picks against "true group picks" (items endorsed by ≥ max(2, ⌈k/5⌉) members).
- A worst case where the attacker knows everyone's *personal* probabilities is in `sim/out/exp3_summary.md` §4. ΔAUC stays ≤ 0.027 there, and conf90 reaches 5.6% only at k = 5 with no noise.

**ΔAUC / conf90 at t = 3, picks-only output** (excerpt; full grid in `sim/out/exp3_summary.md`):

| k | ε | single | collude | diff_fresh | diff_sticky | repeat10 | pick recall | pick precision |
|---|---|---|---|---|---|---|---|---|
| 5 | ∞ | 0.025 / 0% | 0.061 / 19.8% | 0.027 / 19.8% | 0.027 / 19.8% | 0.025 / 0% | 0.29 | 1.00 |
| 8 | ∞ | 0.032 / 0% | 0.080 / 27.3% | 0.044 / 27.3% | 0.044 / 27.3% | 0.032 / 0% | 0.47 | 1.00 |
| 8 | 1 | 0.016 / 0% | 0.027 / 0% | 0.018 / 0% | 0.037 / 21.8% | 0.047 / 0% | 0.54 | 0.78 |
| 12 | ∞ | 0.027 / 0% | 0.078 / 22.1% | 0.056 / 22.1% | 0.056 / 22.1% | 0.027 / 0% | 1.00 | 1.00 |
| **12** | **1** | 0.017 / 0% | 0.027 / 0% | 0.018 / 0% | 0.046 / 17.8% | 0.042 / 0% | **0.86** | **0.77** |
| 12 | 0.5 | 0.011 / 0% | 0.012 / 0% | 0.010 / 0% | 0.035 / 14.1% | 0.038 / 0% | 0.74 | 0.59 |
| 20 | ∞ | 0.009 / 0% | 0.043 / 9.6% | 0.034 / 9.6% | 0.034 / 9.6% | 0.009 / 0% | 1.00 | 0.79 |
| 20 | 1 | 0.006 / 0% | 0.011 / 0% | 0.010 / 0% | 0.030 / 9.6% | 0.021 / 0% | 0.96 | 0.72 |
| 30 | 1 | 0.005 / 0% | 0.006 / 0% | 0.005 / 0% | 0.023 / 4.9% | 0.012 / 0% | 1.00 | 0.60 |

At **t = 4**, k = 20, ε = 1: single 0.009 / 0%, collude 0.019 / 0%, pick recall 0.90 and precision 0.87.
At t = 2 with no noise, collusion reveals 39% (k = 5), 29% (k = 8) and 16% (k = 12) of the target's endorsements.

**Showing noisy counts** (t = 3, conf90 under `diff_sticky`): k = 8: 49%; k = 12: 67–75%; k = 20: 81–88%;
k = 30: 89–94%, at every ε tested. The noise cancels in the difference of two counts, so ε doesn't help.

**Findings**

1. **A single release to a lone insider leaks little,** even at k = 5 (conf90 ≈ 0%). Group outputs aren't a problem in isolation. The danger is the three amplifiers the threat model names.
2. **Subtraction (collusion) is the main single-round risk.**
   - Without noise, colluders reveal 3–39% of a member's endorsements, and more at small k or low t.
   - DP is what removes it. At ε ≤ 2, colluders never reach 90% confidence (conf90 ≤ 0.1%), because ε caps the likelihood ratio at e^ε.
   - Thresholds alone don't stop subtraction.
3. **Membership-change differencing is the biggest risk, and sticky noise doesn't fix it.**
   - Reusing the noise draw defeats averaging, but it cancels exactly when comparing before and after someone leaves (`diff_sticky`: 14–22% at k = 8–12 even at ε = 0.5–1).
   - Fresh noise fixes differencing but enables averaging (`repeat10` ΔAUC roughly 2–3.5× `single`).
   - The fix that works for both is **epoch freeze**: items released in an epoch are never recomputed after a membership change, and the new epoch pools only new endorsements. Then `diff_*` and `repeat*` reduce to `single` by construction.
4. **Never show counts.** Counts plus a membership change expose most of a member's endorsements (up to 94% at k = 30), whatever the noise.
5. **Utility:**
   - k = 12, t = 3, ε = 1 keeps 86% recall and 77% precision of true group picks.
   - At k = 20–30, t = 4, ε = 1 gives ≥ 90% recall at 0.71–0.87 precision.
   - ε = 0.5 costs a lot of precision at k = 8–12 (0.50–0.59), so ε = 1 is the better operating point.
   - k = 5 with t ≥ 3 has poor recall (≤ 0.48), so it's bad for utility as well as privacy.
6. **Privacy accounting caveat.** ε here is per item per epoch. A member who endorses L items in an epoch has total (vector-level) loss L·ε under basic composition. The guarantee simulated is for inferring *one specific* endorsement, which is the T3 threat.

## Experiment 4: PSI-cardinality preview leakage (T2)

**Method** (`sim/exp4_psi.py`):
- 3,000 (target, video X) pairs. Targets have ≥ 20 endorsements; X has population rate ≥ 2%, giving a base rate of 5.4%.
- The prober's prior is the population rate.
- **Probe:** X + j items the prober already knows are in T's set + j popular "filler" items from T's community (redrawn per query) + **minted decoys**. Decoys are the prober's own never-watched uploads and pad the probe to 20 at zero cost.
- The best strategy on a grid is chosen per mechanism and query count. The posterior is exact under the prober's model.
- **Metrics:**
  - AUC
  - bits learned: reduction in log-loss; the ceiling is 0.31 bits
  - conf90: share of true positives inferred with ≥ 90% confidence

Results are AUC / conf90 after n accepted previews. "aux" is the number of T's items the prober already knows.

| mechanism | aux | n = 1 | n = 4 | n = 8 | n = 16 | n = 32 |
|---|---|---|---|---|---|---|
| exact cardinality (draft) | 0 | **1.00 / 100%** | 1.00 / 100% | 1.00 / 100% | 1.00 / 100% | 1.00 / 100% |
| floor 5 | 0 | 0.59 / 0% | 0.58 / 0% | 0.57 / 0% | 0.58 / 2% | 0.57 / 1% |
| floor 5 | 4 | **1.00 / 100%** | 1.00 / 100% | 1.00 / 100% | 1.00 / 100% | 1.00 / 100% |
| buckets 0–4/5–9/10–19/20+ | 4 | 1.00 / 100% | 1.00 / 100% | 1.00 / 100% | 1.00 / 100% | 1.00 / 100% |
| DP ε = 2 | 0 | 0.91 / 0% | 1.00 / 61% | 1.00 / 96% | 1.00 / 100% | 1.00 / 100% |
| DP ε = 1 | 0 | 0.76 / 0% | 0.90 / 0% | 0.99 / 31% | 0.99 / 71% | 1.00 / 97% |
| DP ε = 0.5 | 0 | 0.68 / 0% | 0.75 / 0% | 0.84 / 0% | 0.90 / 4% | 0.98 / 35% |
| floor 5 + DP ε = 1 | 4 | 0.74 / 0% | 0.90 / 0% | 0.97 / 26% | 1.00 / 76% | 1.00 / 95% |
| **floor 5 + DP ε = 0.5** | 0 | 0.62 / 0% | 0.61 / 0% | 0.68 / 0% | 0.74 / 0% | 0.77 / 0% |
| **floor 5 + DP ε = 0.5** | 4 | 0.68 / 0% | 0.77 / 0% | **0.83 / 0%** | 0.92 / 3% | 0.97 / 26% |

For profiling the target's whole set, one exact preview of 20 typical community items reveals 1.70 bits. DP ε = 1 reveals 0.32 bits and ε = 0.5 reveals 0.08 bits.

**Wall-clock under the draft policy** (1 preview/week/pair, target must accept, exact output):
- A single accepted preview answers the question.
- One prober the target trusts needs 1 week.
- A stranger with a 10% acceptance rate needs about 10 weeks.
- 50 Sybil accounts at 10% acceptance need 1 week.
- With **no policy**, one query of the singleton {X} is exact.

**Findings**

1. **The minimum set size buys nothing.** The catalog is open, so a prober can upload 19 videos nobody has watched and use them as decoys.
2. **Rate limits slow the attack but don't bound it.**
   - Exact cardinality needs only *one* accepted preview.
   - Per-pair limits don't stop Sybils. Only the target's acceptance does, and acceptance is a social control, not a technical one.
3. **Floors and buckets help only against probers who know nothing about the target.** Knowing 4 of the target's videos is enough to sit on the boundary. That's realistic: public taste lists, a shared Circle, or a past match would supply them.
4. **Calibrated noise plus a target-side budget does bound it.**
   - With floor 5 + ε = 0.5 and at most 8 accepted previews per target per year (from anyone), the prober's AUC stays ≤ 0.83 and nothing is inferred at ≥ 90% confidence, even with auxiliary knowledge.
   - The budget must be counted **on the target's device**, because requesters are cheap to create.
   - For the user-facing preview, show coarse buckets of the noisy value ("a few / some / a lot in common"). Coarsening after noise is free post-processing.

## Experiment 5: Sybil reach (T7)

**Method** (`sim/exp5_sybil.py`):
- Setting: 3,000 honest viewers, and an attacker with S sybils and 10 junk videos (endorse probability 2%), each video from a different sybil creator so per-creator caps don't bind.
- **What the sybils do:**
  - Each matches about 14 other sybils, the UX cap.
  - All of them endorse the junk plus 50 popular videos as camouflage.
  - All opt in to forwarding.
  - All subscribe to the attacker's public list, which holds the junk plus 30 popular videos.
- **Attack edges:** g honest viewers, newcomers included, match a sybil. That sybil drops its camouflage and mirrors the victim's sketch to maximize similarity.
- **List lure:** a different set of g honest viewers subscribe to the attacker's list.
- **Policies:**
  - **P0 naive:** similarity-weighted path counts over 1–3 hops with equal weight and no normalization; lists weighted by subscriber count.
  - **P1:** row-normalized personalized trust walk, 1st degree + 0.3 × 2nd degree, per-node 2nd-degree trust capped at 0.05; lists as P0.
  - **P2:** P1 + each list contributes at most 2 items per feed, and list weight comes from track record (subscribers' observed endorse rate), not subscriber count.
- Reported under default mix weights and taste-heavy weights. "Others" = honest viewers who neither matched a sybil nor subscribed to the attacker's list.

Default weights, share of honest viewers with ≥ 1 attack video in their top 20:

| S | g | P0 reach (others reached) | P1 reach (others) | P2 reach (others) | P0 / P1 / P2 honest P@20 |
|---|---|---|---|---|---|
| 10 | 10 | 1.3% (28) | 0.3% (0) | 0.3% (0) | 0.313 / 0.294 / 0.294 |
| 100 | 50 | 10.3% (255) | 1.7% (0) | 1.7% (0) | 0.297 / 0.292 / 0.291 |
| 100 | 200 | 25.3% (505) | 4.6% (0) | 4.6% (1) | 0.274 / 0.288 / 0.288 |
| 1000 | 50 | 8.5% (198) | 1.7% (0) | 1.7% (0) | 0.297 / 0.292 / 0.292 |
| 1000 | 200 | **34.8% (779)** | 7.0% (1) | 6.9% (3) | 0.241 / 0.283 / 0.283 |

Reach among the attacker's list subscribers:

| weights | P0 | P1 | P2 |
|---|---|---|---|
| default, S = 1000, g = 200 | 32% | 4.5% | 2% |
| taste-heavy, S = 1000, g = 200 | 85% | 54% | **2%** |

With no attack edges (g = 0), reach is 0 in every configuration.

**Findings**

1. **Naive propagation amplifies.** Each attack edge reaches about 4 bystanders under P0. With 200 edges, a third of all honest users see junk, and honest P@20 falls 24%.
2. **A decaying, normalized, capped trust walk confines the attack to the people who chose a sybil.**
   - Under P1 and P2, bystander reach is 0–3 users in every configuration.
   - Reach is then roughly g/N, plus a few list subscribers, and **doesn't grow with S**. That matches the design's reasoning that the first hop is consented and the second hop is the weak spot.
3. **The list channel needs its own cap.**
   - Weighting lists by subscriber count lets Sybils inflate a list. Under a taste-heavy mix, 54% of lured subscribers still see junk under P1.
   - Capping each list at 2 items per feed and weighting by track record brings this to 2%.
   - It also *raised* honest P@20 under taste-heavy weights (0.236 → 0.279), because it stops any single list from crowding a feed.
4. **Residual risk: the first hop.**
   - A viewer who matches a mirroring sybil sees its picks almost every time (reach among victims is about 100% when the sybil is dedicated to one victim).
   - Mitigations not simulated here: per-source trust learned from feedback (DSybil [A22]), a per-match cap on items per feed, "why am I seeing this" attribution, and one-tap unmatch.
5. **Cost of the defence.**
   - With no attack, P1 is about 6% below P0 on honest P@20 (0.295 vs 0.315), because the naive path count rewards popular items.
   - Under any non-trivial attack, P1 is better.

## Limitations: what synthetic results can and cannot show

**What they can show:**
- The *direction* and rough *size* of trade-offs between mechanisms on the same world: match vs global CF concentration, explore share vs lock-out, which Circle and PSI attacks matter, and what amplifies Sybils.
- The privacy experiments compute exact Bayes posteriors for well-defined attackers. For those attackers and mechanisms, the leakage numbers are properties of the mechanism more than of the world.

**What they cannot show:**
- **Absolute numbers.**
  - P@20 ≈ 0.3 reflects a made-up endorsement model (6·taste·topic − 5).
  - Real endorsement rates, catalog sizes, community structure, popularity skew and list curation will shift every quality number.
- **Real user behaviour.**
  - How people pick matches: we assume strong homophily, with 96% of matches in the same community.
  - How often strangers accept preview requests.
  - Whether people opt in to second degree.
  - How curators build lists: ours are popularity-biased histories, not hand-picked, which likely understates how much lists could help small creators.
- **Static vs dynamic.**
  - Exp 1 is a snapshot.
  - Exp 2 is dynamic but short (12 weeks), small (1,500 viewers), with a simple watch/follow model and an assumed off-app discovery rate. The sensitivity check shows the 0% baseline depends strongly on that rate, while the 2–5% results don't.
- **Explore cost bracket.** Relevance-ranked explore cost nothing here partly because tags carry real (if noisy) topic signal. Random explore gives the pessimistic bound. Real content signals on-device could be weaker.
- **Circle attacker knowledge.**
  - We modelled an attacker who knows the group's per-item endorse rates, and in §4 one who knows everyone's personal probabilities.
  - Real attackers with *side knowledge of specific endorsements* (Calandrino's setting) could do better.
  - In our world, items endorsed by almost everyone are rare. Tighter-knit real circles, where consensus picks are common, would leak more at small k.
- **PSI model.**
  - Sets are endorsement sketches. Only 30–40% of synthetic viewers reach the 20-item minimum, so real eligibility rules need checking.
  - The prober's prior is a population rate. Better-informed priors would make every row worse.
- **Sybil model.**
  - One attacker strategy family (mirror + camouflage + list inflation).
  - No adaptive attacker that learns from feedback, no colluding honest-looking curators, no feedback-learned trust on our side.
  - The attack edges g are an input. How many users would match a stranger is an empirical question.
- **Not simulated:** relay metadata (T5), moderation and labelers, multi-epoch DP accounting for Circles, dropout handling in secure aggregation, and actual cryptography.

## Reproduce

```sh
python3 -m sim.run --all                      # ~7.5 min on 4 cores; writes sim/out/
python3 -m unittest discover -s sim/tests -t .
```
Per-experiment runtimes in the reference run: Exp 1 49 s, Exp 2 138 s, Exp 3 48 s, Exp 4 92 s, Exp 5 121 s.
