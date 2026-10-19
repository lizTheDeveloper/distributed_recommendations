# Match Feed: distributed recommendations for federated video

Status: design draft, revision 3 (2026-10-19). Revision 2 checked sources against primary material.
Revision 3 applies the corrected research notes, the simulation results (`docs/SIMULATION_RESULTS.md`)
and the code that now exists (see "Implementation status"). Updated 2026-10-19 for the Circles prototype
(`CIRCLES.md`), on-device moderation and the native app shells.
Mockups: `mockups/match-feed.html`. Research: `reports/Distributed video recommendation prior art.md`.
Companions: `THREAT_MODEL.md`, `PROTOCOL.md` (wire formats), `MATCH.md`, `ANALYTICS.md`, `WEB_APP.md`, `OSS_STACK.md`.

## Problem

Federated video (PeerTube) handles hosting and follows. Discovery is weak.
PeerTube's built-in recommendation list returns up to 5 local videos that share a tag
with the current one, newest first, skipping watched videos for logged-in users; it is
not personalized [P1]. Community efforts are mostly client-side and single-user. The
PeerTube Picks add-on (Firefox) and its Chromium sibling, both by the developer solidheron,
rank by content-based cosine similarity over your own local history and share nothing [P2]. An instance-level recommender plugin was proposed in
2023 without a specified method; the project has since labelled the issue "won't fix" [P3].

Decentralized peer collaborative filtering is not new:
- BuddyCast ran in Tribler. It shared plaintext histories with automatically chosen "taste buddies"; a 2012 account calls Dispersy its successor, and current Tribler no longer mentions it [A1].
- PocketLens, Gossple and WhatsUp are research systems [A2–A4].
- Jeckmans et al., revisited by Tang & Wang, recommend from friends plus random strangers under homomorphic encryption [A5].

Centralized products show demand for consented taste matching: Spotify Blend, YouTube
Music Taste Match and Plex's friends-only watch history [A6]. Nobody we found has
shipped the combination of **user-chosen, mutual, expiring matches + public creator
taste lists + on-device ranking on an open protocol**. The novelty is that consent
model, not the math.

## Principles

1. **Creators and viewers are both first-class.** Every mechanism is checked for its effect on both.
2. **Ranking runs on the viewer's device.** No server decides the feed.
3. **Every recommendation explains itself**, including which relationship produced it.
4. **Relays and hosts hold only public data or ciphertext.**

## Relationship tiers

| Tier | What you share | Visibility | Who it serves most |
|---|---|---|---|
| Follow | nothing | public | creators (audience), viewers (subscriptions) |
| Subscribe to taste | nothing | public, signed list | creators and curators (discovery bridge), viewers (cold start) |
| Match | taste sketch | E2E, mutual, expiring | viewers with peers |
| Circle | pooled picks | E2E group, threshold-revealed | small communities |

Creator taste is public by design: a list read by 1,000 people is effectively published.

### Ship order (evidence-driven)

1. **Follow, Subscribe to taste, and reserved explore slots.** This is what the v1 web client ships.
   - Curated lists and reserved exposure have the strongest measured effects on creator discovery.
   - Spotify playlist placement causally adds streams, including for new artists [C1].
   - Bluesky starter packs accounted for up to 43% of daily follow operations at their peak, and pack members received up to 85% more new follows than matched controls by week 4 after joining [C2].
   - YouTube runs dedicated pipelines and a reserved exploration budget for fresh content [C3].
   - These tiers also help viewer cold start without any private data, though the simulation shows they do not close the gap fully (see "Known cost: newcomers without matches").
2. **Match.**
   - Friend and trust-based recommendation matches or beats global CF accuracy in taste domains [A7][A8]. The simulation agrees: match-only CF came within 4% of centralized CF on precision, with much less concentrated exposure (SIMULATION_RESULTS Exp 1).
   - It is less novel, so it complements the explore slots and does not replace them [A9].
3. **Circles**, once a secure-aggregation protocol is chosen. The output policy below is simulated and implemented; the aggregation itself is not.

## Feed mixing defaults (from the simulation)

All defaults below come from `docs/SIMULATION_RESULTS.md`. Its data is synthetic: it
compares mechanisms against each other and does not predict absolute quality.

| Parameter | Default | Evidence |
|---|---|---|
| Explore share | **5%**; users may set **2–10%**; 0 = off | Exp 2 |
| Explore ranking | **by on-device relevance** (the viewer's tag profile vs. the video's tags); seeded random only when no signal exists | Exp 2 |
| Taste-list weight | **0.15 of the peer signal** (recipe weight 0.9 against match 6) | Exp 1 |
| Per-list cap | **at most 2 items per taste list per feed page** | Exp 5 |
| List strength | from the list's **track record** with this viewer, never its subscriber count | Exp 5 |
| Second degree | decay 0.3, 2 hops, per-node cap 0.05 of the viewer's trust mass, row-normalized | Exp 5 |

### Explore slots

- A share of each feed is reserved for creators the viewer has no tie to: new (under 14 days old in the ranker) and not followed or surfaced by any other source. New creators compete only with each other there, the pattern YouTube and Google describe [C3][C7].
- **Default 5%, adjustable 2–10%.** In the simulation, with 0% explore, 56% of new creators got no in-feed view from a non-follower within 6 weeks. 5% put 66% of new creators in front of a stranger in their first week and 98% within 4 weeks, at no measurable viewer cost. 1% still left 6.5% unseen after 6 weeks; 15% bought little over 10% (Exp 2).
- **Rank explore candidates by relevance on the device**, not at random. Random explore cost about 0.7% precision per point of share; relevance-ranked explore cost about nothing up to 10% (Exp 2). The relevance signal never leaves the device.
- **This is larger than YouTube's published budget.** YouTube's Online Matching system runs exploration on about 1–2% of user traffic (it raised it from 1% to 2% as the graph grew), with a 6% traffic slice for a corpus-exploration use case, at a measured engagement cost of about 0.2% [C3]. YouTube has a huge viewer base, so a small share is still a lot of views. In the small-network simulation, 1% was not enough.

### Taste lists

- Signed, portable, subscribable. Each entry gets a machine-readable *sponsored* / *affiliated* flag, shown on the card, per the FTC Endorsement Guides [C8].
- **Low weight and a per-list cap.** A list-heavy mix lost 16% precision and concentrated exposure more (Gini 0.73 vs. 0.66) (Exp 1). Capping each list at 2 items per feed and weighting lists by track record cut the reach of a Sybil-inflated list from 54% of its subscribers to 2%, and raised precision under a list-heavy mix (Exp 5).
- Lists help newcomers more than established viewers: for cold-start viewers with no matches, lists raised precision from 0.147 (follow-only) to 0.169 (Exp 1).
- **Sources of a creator's taste ("Follow taste" in the web client), in order:** a NIP-51 video curation set (kind 30005) signed by the npub the creator publishes, read only from the viewer's own relays; a taste list linked in their channel description; then their public PeerTube playlists minus their own uploads, which exist today on any instance. Playlists are unsigned and carry no sponsored flag, so they get the same cap and track-record weighting as any list. Details: WEB_APP.md, Follow taste.

### Known cost: newcomers without matches

The main quality cost of decentralization lands on new viewers who have no matches yet.
In Exp 1, cold-start viewers with zero matches got P@20 = 0.169 from follows plus lists,
against 0.202 from centralized global CF and 0.147 from follows alone. Warm viewers lose
nothing (match + second degree: 0.300 vs. 0.297 for global CF). Taste lists, explore
slots and an early first match are the levers; none closes the gap in the simulation.

## Match protocol

The 1:1 part (steps 1–5) is implemented as a prototype in `packages/match` (design and threat notes in `MATCH.md`, wire formats in PROTOCOL.md §6). It runs core's policies (sketches, preview budget and noise, similarity) over Nostr: a pure state machine for the lifecycle (`state.ts`), NIP-59 gift wraps with a NIP-40 expiration (`wrap.ts`), per-match keys separate from the identity key, rotated on renewal (`keys.ts`), control messages padded to the 64-bucket sketch size (`messages.ts`), and OpenMined PSI in cardinality-only mode (`psi.ts`). Its rumor kinds, **3470–3478**, are provisional and unregistered. It has no network relay I/O yet (an in-memory relay for tests), is not wired into the web client, and is not audited. Circles (step 6) exist as a separate prototype, `packages/circles` (`CIRCLES.md`; kinds 3480–3482 in PROTOCOL.md §3). Second degree over the network (step 7) is not built.

1. **Preview (PSI-cardinality).**
   - A preview estimates how many videos two users have in common, using PSI-cardinality, not plain PSI, which would reveal the items themselves [A10].
   - **One exact cardinality answers "did you watch X?" with certainty**, so the requester never sees it (Exp 4). The **target** runs the PSI side that learns the count and noises it before anything leaves its device: discrete Laplace with **ε = 0.5**, values under a **floor of 5** reported only as "<5", and the user sees coarse buckets ("a few", "some", "a lot").
   - **Budget: at most 8 accepted previews per target per rolling year, from all requesters together**, counted on the target's device. Per-pair and per-requester rate limits stay, but Sybils defeat them; only the target's budget and explicit acceptance bound the attack. With floor 5 + ε = 0.5 and 8 previews, the prober's AUC stays ≤ 0.83 and nothing is inferred at ≥ 90% confidence, even when the prober already knows 4 of the target's videos (Exp 4).
   - **The minimum set size (20) is not a defense.** The catalog is open, so a prober pads any probe with its own never-watched uploads for free. It stays as hygiene only.
2. **Consent.** Each side chooses:
   - what goes in the sketch: endorsements only (the default), or endorsements plus finished watches
   - the time window (default 60 days)
   - excluded tags, hours and individual videos
   - expiry (90 days unless renewed)
3. **Exchange.**
   - 1:1 sketches go over Nostr NIP-17 private messages, which are NIP-44 encryption plus NIP-59 gift wrap [N1]. NIP-04 is deprecated.
   - NIP-44 lacks forward secrecy (Cure53 finding NOS-01-006, Medium), so sketches stay short-lived (≤ 30 days, default 14) and per-match keys rotate at least every 90 days [N1].
   - Sketches are padded to fixed sizes. **Over NIP-17 a sketch holds at most 128 items** (15,872 bytes, about 33 KB gift-wrapped), because a 256-item sketch would wrap to about 66 KB, over common 64 KiB relay limits. **The 256-item bucket is for MLS (circle) transport only.** Details: PROTOCOL.md §2.
4. **Score locally.**
   - similarity = Jaccard or cosine of the two sketches
   - candidate score = Σ over matches of `sim(you, m) × endorsed(m, video)`
   - This is user-based CF run on-device, as in PocketLens [A2].
5. **Quiet pause (decision D2).** While a match is paused, the client keeps sending on its normal schedule. Each sketch carries **the same real items as the last one sent** (minus any newly excluded videos) **in a fresh envelope**: new epoch, expiry, nonce, padding and shuffle. The peer sees on-schedule sketches whose content has stopped changing; nothing on the wire says "paused". Re-sending the old sketch byte for byte would fail the receiver's epoch check and then expire, which would itself be a tell.
6. **Circles.**
   - Group transport uses MLS [N2], via the Marmot protocol (MLS over Nostr) [N3]. Least Authority reviewed the Marmot protocol (summary report 7 Nov 2025; MIPs 00–04, MIP-05 excluded) and audited the White Noise Rust backend, whitenoise-rs (final report 1 April 2026). Whether the MDK library itself was in scope is unconfirmed, and the TypeScript marmot-ts is alpha and unaudited. The review also notes that Nostr public keys and group tags travel in plaintext, so relays and network observers can track group membership and message timing.
   - NIP-17 advises against groups larger than about 10.
   - Pooled picks follow Canny's model of an encrypted community aggregate [A11]. Canny assumes an honest majority (more than half of users uncorrupted) and threshold decryption.
   - Secure aggregation [A12] hides inputs from the aggregator but **not the output**, and it needs an aggregator role: with clients colluding with the server, the CCS paper requires t ≥ ⌊2n/3⌋+1 surviving members and tolerates at most ⌈n/3⌉−1 colluders. With k = 5, a count of 5 reveals everyone endorsed the video, and members can subtract their own input.
   - **Circle rules** (simulated in Exp 3, implemented in `packages/core/src/circle.ts`):
     - **k ≥ 8 is a hard floor**; the recommended size is **12–30**. k = 5 is bad for privacy and utility alike.
     - **Reveal threshold on the noised count: t = 3 for k = 8–15, t = 4 for k ≥ 16.**
     - **DP noise ε = 1 per item per epoch** (discrete Laplace) [A13]. At ε ≤ 2 colluding members never reach 90% confidence about a member's endorsement; ε = 0.5 costs too much precision at k = 8–12.
     - **Sticky noise:** an item gets the same noise draw for the whole epoch, derived from a secret per-epoch seed, so repeated releases can't be averaged. The seed must stay inside the secure aggregation; a member who knows it can subtract the noise.
     - **Epoch freeze:** a round is bound to one MLS epoch; each epoch is released once and never recomputed after a membership change, and the new epoch pools only new endorsements. With sticky noise but no freeze, differencing before and after someone leaves still exposed 15–22% of their endorsements at k = 8–12.
     - **Picks only, never counts.** Noisy counts plus one membership change exposed 49–94% of a member's endorsements whatever ε was, because the noise cancels in the difference.
     - Members who drop out count as absent; below k present members the round publishes nothing.
     - Utility at k = 12, t = 3, ε = 1: 86% recall and 77% precision of true group picks.
     - ε is per item per epoch. A member's loss per epoch is at most ε × items contributed under basic composition; multi-epoch accounting is not yet simulated.
   - **Prototype: `packages/circles`** (not audited, not for production; design and limits in `CIRCLES.md`):
     - **Transport:** MLS over Nostr via marmot-ts 0.5.1, with ts-mls overridden to 2.0.0-rc.16 because the pinned rc.10 let a member removed by a single-Remove commit read the next epoch (THREAT_MODEL T27). App-level guards (`src/authz.ts`) re-check marmot-ts 0.7.0's authorization fixes until the upgrade, which waits until 0.7.0 has been out two weeks (T28).
     - **Aggregation chosen:** pairwise additive masking (Bonawitz et al. [A12]) with no aggregator (every member sums the masked vectors), over a **public candidate list** of ≤ 256 ids carried in the round-open; hashed buckets were rejected because pure-DP noise on every slot makes false picks grow with the domain (`CIRCLES.md` §3).
     - **Noise inside the aggregation, no seed:** each member adds a Pólya share; the shares sum to discrete Laplace(ε) (T19). The price: ε holds against at most c colluders (default ⌈m/3⌉ − 1), so Exp 3's "everyone but the target colludes" result does not carry over (T3).
     - **Void rule:** any dropout after the key phase, or any inconsistency, voids the epoch permanently; a void consumes the epoch like a release. With 5% per-member dropout a 12-member round completes about 54% of the time.
     - **Metadata:** round messages are padded to one size per round (T30); identity-signed inner events make participation non-repudiable.
     - Not yet: real relay I/O, dropout recovery, input validation against malicious members (T29), an exact noise sampler, the web UI.
7. **Second degree.**
   - Picks from matches of matches are discounted and unattributed, and count only when the person in the middle opts in.
   - Propagation uses a personalized, decaying trust walk seeded from you: personalized PageRank [A23][A24], TrustWalker [A14] or MeritRank [A15]. This is not EigenTrust, which computes global trust anchored on pre-trusted peers [A16].
   - **Parameters: decay 0.3, at most 2 hops, row-normalized (a node splits its trust across its outgoing edges), and no node beyond the first hop holds more than 0.05 of the viewer's total trust mass.** Under naive 3-hop path counting, 200 attack edges let Sybil junk reach 779 bystanders; under this walk, 0–3 (Exp 5). Second degree also helped quality slightly: +4.5% precision over match + lists, and the best cold-start score among the decentralized strategies (Exp 1).
   - Because the walk applies the decay, the default recipe weighs `second` equal to `match`.

## Creator side

- **Explore slots** and **taste lists**: see "Feed mixing defaults" above.
- **Exposure fairness on-device:**
  - Collaborative filtering concentrates attention [C4]. In the simulation, centralized CF had an exposure Gini of 0.85; match-based CF 0.67; adding 10% explore brought it to 0.59 (Exp 1).
  - Apply per-creator caps (default 2 per page) or popularity calibration when merging peer picks [C5].
- **Analytics without surveillance** (`ANALYTICS.md`):
  - Host-side stats (Tier 0) and public counts (Tier 1) cost no new privacy.
  - The discovery-channel breakdown (how many views came from Follow, Taste, Match, Circle, Explore) is about *viewers*, so it goes only through DAP (Divvi Up / Janus) [C6], at channel level, over 28-day windows, with counts under 20 shown as "<20".
  - Nobody sees individual watch histories.
- **Portability:** a creator's identity is a key, not an instance account. Videos can be mirrored across instances.

## Decisions

- **D1. Feed recipes are declarative only** (JSON weights and filters), never code. Implemented: `packages/core/src/recipe.ts` (`parseRecipe`, strict keys, 16 KiB limit).
- **D2. Coercion: quiet pause plus per-match exclusions.** The quiet pause sends the same items in a fresh envelope (Match protocol step 5). Implemented in `packages/core/src/sketch.ts` (`buildSketch` with `consent.paused`).
- **D3 / analytics.** Creator opt-in for discovery-channel stats (off by default). **Viewer contribution is on by default, with an off switch for each signal** (ANALYTICS Q1). Discovery stats are **private to the creator by default; the creator may publish them**, with the same thresholds and noise (Q3). Country stats in instance defaults (Q2) are still open. **Before any EU launch,** the ePrivacy Art. 5(3) question (whether opt-out telemetry is allowed even when aggregated with DAP) must be resolved. The v1 web client keeps only a local tally and transmits nothing.

## Privacy facts to design around

- **Hashing video IDs gives no privacy.** The catalog is enumerable. Use encryption to the peer, or PSI.
- **Recommending inherently reveals.** If you recommend X to me, I learn you endorsed X. Only aggregation with thresholds and noise blunts this.
- **Outputs leak.**
  - Calandrino et al. inferred individual transactions from item-to-item recommender outputs, given some auxiliary knowledge of the target plus observation of how outputs change over time [A17].
  - The same applies to Circle members watching group picks change; that is why Circles use epoch freeze and never show counts.
- **Sparse taste data identifies people.** 8 ratings (2 of which may be wrong) with dates off by up to 14 days uniquely identified 99% of Netflix Prize records [A18]. Public taste lists identify their owners and give attackers material to poison recommendations [A19]. Warn curators.
- **Default to endorsements, not passive history.**
  - The US VPPA binds video service *providers*. Its consent exception requires distinct, revocable consent given for at most 2 years [L1].
  - *Salazar v. Paramount Global* (No. 25-459), on who counts as a VPPA "consumer", was argued at the Supreme Court on 14 Oct 2026 and is undecided [L1].
  - Under GDPR, inferences from watch history can be special-category data (Art. 9), and decentralization is no exemption [L2].

## Manipulation and Sybils

- **Sybils can't be ruled out without a central identity authority** [A20]. Recommenders are especially exposed to shilling, where attackers build fake profiles similar to a target's [A21][A25].
- **The first hop is strong but not immune.** Mutual, user-chosen matches close the similarity route, because similarity alone never creates an edge. But a viewer who does match a Sybil that mirrors their sketch sees its picks almost every time (Exp 5). Not yet simulated: per-source trust learned from feedback (DSybil [A22]), a per-match cap on items per feed, attribution and one-tap unmatch.
- **The second hop and public lists are the weak spots.** The capped trust walk confines an attack to the people who chose a Sybil, and the per-list cap with track-record weighting confines list inflation (Exp 5).

## State resistance

**What this does buy:**
- There's no central ranker to coerce.
- There's no central store of histories.

**What it doesn't buy:** real-world pressure has landed on operators, app stores and the network layer, not on protocols [S1]:
- the FBI seized an unencrypted database backup from a Kolektiva.social admin (an instance of about 7,800 members)
- Damus was pulled from China's App Store
- Russia blocks Tor

| Pressure point | What's exposed | Mitigation |
|---|---|---|
| Video host / instance | can remove videos; holds account data | mirror across instances; minimal server-side data; encrypted backups |
| P2P streaming | **viewer IPs, visible to the tracker and other peers.** PeerTube calls this "the main threat to user privacy" [P4] | P2P off by default for viewers; opt-in (v1 web client: `p2p=0` unless enabled) |
| Relays | who exchanges sketches with whom; for Marmot groups, plaintext pubkeys and group tags | many relays; Oblivious HTTP [S2]; batching, padding and delays; secret per-group discovery keys; mixnet transport [S3]. Sealed-sender-style hiding alone falls to timing attacks [S4] |
| Identity | key loss; directory chokepoints (did:plc) | separate identity keys from per-match keys (done for 1:1 Match in `packages/match`); social recovery; key rotation |
| App stores | client distribution | PWA, F-Droid, sideloading |
| User device | history, follows and taste lists on the device; per-match keys and sketches once Match runs there | encryption at rest, short retention, wipe. **Implemented in the web client** (`apps/web/src/lib/vault.ts`): AES-GCM in IndexedDB under a non-extractable device key or an optional passphrase (PBKDF2), retention by the sharing window, crypto-shredding wipe, memory-only when storage is unavailable. Limits: a full copy of the browser profile decrypts device mode (no OS keystore for web pages); no defense against malware or a malicious build (THREAT_MODEL T9, T22). `packages/match` keeps keys and sketches in a `MatchBook` the caller must store encrypted; nothing stores it yet |
| Third-party web assets | viewer IPs to font or script CDNs | self-host; strict CSP (done in the live web build) |
| A match | whatever you shared | none; this is inherent to sharing |

There is no token. A token adds a securities-law target, as LBRY's 2022 loss to the SEC showed [S1].

## Distribution options

| Option | Fit | Main risk |
|---|---|---|
| ActivityPub (PeerTube) | video catalog, follows, interop | admins see everything on their instance; no native E2E |
| Nostr | user-owned keys, swappable relays, NIP-17 DMs, MLS via Marmot, video events in NIP-71: kinds 21/22 (regular) and 34235/34236 (addressable); read all four [N4] | relay metadata; key recovery |
| AT Protocol | custom feeds prove "algorithmic choice" works | repos are public, and the feed generator sees the requester's DID [N5]. Private data is proposal 0016, now "Atproto Spaces", in alpha since Aug 2026; it provides access control, not end-to-end encryption [N5]. Our on-device "feed recipes" borrow the idea; they aren't interoperable with it |
| Custom P2P (iroh / libp2p) | maximum control | NAT traversal, mobile limits, build cost |

**Working hypothesis:**
- PeerTube/ActivityPub for the catalog.
- Nostr keys and relays for public taste lists, 1:1 sketches (NIP-17) and Circles (Marmot/MLS). PeerTube videos can be referenced as signed NIP-71 events through our bridge (`packages/bridge`).
- On-device ranking.

## Building blocks

The full list, with licenses and audit status, is in `docs/OSS_STACK.md`. Main candidates:
- PeerTube REST API and the Sepia Search index
- NDK / nostr-tools (the bridge uses nostr-tools 2.25.2)
- Marmot (MDK, marmot-ts) or OpenMLS
- OpenMined PSI: its README makes no audit or security-model claim, so it needs a review
- Vertex or MeritRank, for suggesting whom to match
- Janus / libprio, for creator analytics
- OpenDP
- Automerge or iroh

On-device CF and ranking turned out small enough to write directly (`packages/core`).

## Implementation status

| Part | Path | State |
|---|---|---|
| Core library | `packages/core` | TypeScript, no runtime dependencies, 104 offline tests. Recipes (D1), `rank` with explore slots and per-list cap, explanations, sketches with padding, transport caps, quiet pause (D2) and a strict video-id rule, trust walk, circle output policy with epoch freeze, preview policy with noise, target budget and display buckets (`previewDisplay`), PeerTube client. Defaults follow the simulation. No cryptography: PSI and NIP-17 wrapping live in `packages/match`; MLS and secure aggregation are not started |
| Match (1:1) protocol | `packages/match` | Prototype, not audited. Match lifecycle (request, accept, previews, weekly sketches, quiet pause, 90-day expiry, renew with key rotation, revoke) as a pure state machine; NIP-59 gift wraps; per-match keys; uniform 8,192-byte control messages; OpenMined PSI cardinality previews noised on the target's device; provisional rumor kinds 3470–3478; `MatchClient` glue and an in-memory relay. 34 offline tests. Runtime dependencies `nostr-tools` 2.25.2 and `@openmined/psi.js` 2.0.6, pinned, install scripts disabled. No real relay I/O or OHTTP; not used by the web client yet. See `MATCH.md` |
| PeerTube → NIP-71 bridge | `packages/bridge` | Builds NIP-71 events (addressable 34235/34236 by default, `--regular` for 21/22) from public PeerTube videos; dry run by default; signing via NIP-46 bunker (preferred), creator key or labelled instance key; NIP-09 deletion requests for videos made private/unlisted, blocked or removed (tracked in a local state file); NIP-42 AUTH and relay retries; 58 offline tests |
| Web client v1 | `apps/web` | Follow, taste lists, recipes, explore slots, creator studio Tiers 0–1, over live PeerTube instances. Match, Circle, second degree, previews and Tier 2 analytics are placeholders. History, follows, taste lists and related caches are encrypted at rest in IndexedDB (`src/lib/vault.ts`; optional passphrase), with retention by the sharing window and a crypto-shredding wipe. 30 offline tests. See `WEB_APP.md` |
| Circles | `packages/circles` | Prototype, not audited (`CIRCLES.md`). MLS groups via marmot-ts 0.5.1 + ts-mls 2.0.0-rc.16 (override is a security fix, guarded by a regression test); pairwise-masked secure aggregation; distributed Pólya noise; core's circle policy on the aggregate with epoch freeze, void rule and ledger; app-level authorization guards around marmot-ts (`authz.ts`); fixed-size round-message padding (`padding.ts`); provisional kinds 3480–3482. 43 offline tests, including 12 members over real MLS. In-memory relay only; not in the web client |
| Moderation | `packages/moderation` | On-device moderation library (T18): NIP-56 and PeerTube abuse reports (sent only after confirmation), NIP-32 labels from subscribed labelers, block and NIP-51 mute lists, app-store defaults (NSFW hidden, two-step adult opt-in), `applyModeration` pre-filter before `rank()`. 56 offline tests. Not wired into apps/web yet (hooks in its README); no labeler service runs yet |
| Android and iOS shells | `apps/mobile` | Capacitor 8 wrapping `apps/web/dist` (name and id in `brand.json`: Meme Video, `school.multiverse.memevideo`; naming check pending, `NAMING.md`). `window.MatchFeedNative` bridge: Keystore/Keychain secrets, background fetch, share target, deep links, opt-in notifications. Android debug and unsigned release APKs build; iOS project generated, not built. Native bridge restricted to the app's main frame (T31, T32). 5 offline tests. apps/web does not call the bridge yet. See `SHIPPING.md` |
| Desktop shell | `apps/desktop` | Tauri 2, no plugins; IPC only for three keychain commands (T33); Linux .deb builds and runs; macOS/Windows not built; auto-update off by design |
| CI, release, infra | `.github/`, `infra/` | CI runs every package's tests and typechecks (including circles, moderation, taste and services/labeler), sim tests, a reproducible web-build check, relay config tests, DCO and actionlint; a gated web release with provenance to Pages, Cloudflare Pages and IPFS (`DEPLOY.md`); Dependabot for npm, Actions, Cargo, Gradle, Compose and pip; a self-hostable strfry relay (`infra/relay`) |
| Simulation | `sim` | Python + numpy; five experiments; results in `SIMULATION_RESULTS.md` |
| Mockups | `mockups/match-feed.html` | static |

## Open questions

Answered by simulation (synthetic; see `SIMULATION_RESULTS.md`): explore share vs. new-creator
time to first view; exposure concentration under match-heavy vs. taste-heavy feeds; leakage of
repeated previews; Circle output leakage across k and ε; Sybil reach.

Still open:
- ~~Which secure-aggregation protocol Circles use, and whether the DP noise is added inside it.~~ Chosen for the prototype: pairwise masking with distributed Pólya noise inside the sum, over a public candidate list (`CIRCLES.md`). Still open for Circles: dropout recovery, input validation against malicious members, behaviour beyond c colluders, an exact sampler, and an audit.
- Circle DP accounting across epochs.
- First-hop Sybils: feedback-learned per-source trust, per-match caps.
- Real-world numbers the simulation can't give: how people pick matches, how often strangers accept previews, how curators build lists.
- Moderation: the on-device side exists (`packages/moderation`: labelers, reports, blocks, applied before `rank()`); open are who runs a labeler (staff, appeals, policy), the PeerTube login needed to file reports, and wiring it into the apps.
- Event kinds for recipes and taste lists; a signed taste-list format. Registering (or moving) the provisional Match rumor kinds 3470–3478 before any client ships.

## Sources

Full annotated bibliography in `reports/Distributed video recommendation prior art.md`; verification
notes in `research_notes/Distributed video recommendation prior art/`.

**PeerTube**
- P1. PeerTube recommendation service source: https://github.com/Chocobozzz/PeerTube/blob/develop/client/src/app/%2Bvideo-watch/shared/recommendations/video-recommendation.service.ts
- P2. PeerTube Picks / solidheron extension (content-based cosine over the user's own history): https://github.com/solidheron/peertube_recomendation_algorythm ; Firefox add-on: https://addons.mozilla.org/en-US/firefox/addon/peertube-picks/ ; announcement posts (Lemmy, same author) https://piefed.jeena.net/post/169216 and https://piefed.jeena.net/post/158506 ; proposal https://github.com/Chocobozzz/PeerTube/issues/6978
- P3. fairkom recommender proposal (opened 2023-06-11, labelled "won't fix"): https://git.fairkom.net/emb/displ.eu/recommender/-/issues/7
- P4. PeerTube privacy guide: https://docs.joinpeertube.org/admin/privacy-guide

**Protocols**
- N1. NIP-17: https://github.com/nostr-protocol/nips/blob/master/17.md ; NIP-44: https://github.com/nostr-protocol/nips/blob/master/44.md ; Cure53 NIP-44 audit (Nov–Dec 2023; findings NOS-01-001 to -010, including NOS-01-006 no forward secrecy, Medium): https://cure53.de/audit-report_nip44-implementations.pdf
- N2. RFC 9420, Messaging Layer Security (July 2023): https://www.rfc-editor.org/rfc/rfc9420
- N3. Marmot protocol: https://github.com/marmot-protocol ; Least Authority protocol review summary (7 Nov 2025): https://leastauthority.com/white-noise-marmot-protocol-review-summary-report/ ; whitenoise-rs audit (final report 1 Apr 2026): https://leastauthority.com/blog/audit-of-white-noise-whitenoise-rs/
- N4. NIP-71: https://github.com/nostr-protocol/nips/blob/master/71.md
- N5. AT Protocol feeds guide: https://atproto.com/guides/feeds ; feed-generator: https://github.com/bluesky-social/feed-generator ; Spring 2026 roadmap (permissioned data): https://atproto.com/blog/2026-spring-roadmap ; Atproto Spaces status in `research_notes/…/prior_art_products.md`

**Recommender systems and privacy**
- A1. Tribler BuddyCast: https://tribler.org/DecentralizedRecommendation ; SIGMM Records open-source column, 19 Jul 2012 ("Dispersy is the successor of BuddyCast"): https://sigmm.hosting.acm.org/2012/07/19/open-source-column-tribler-p2p-search-share-and-stream/
- A2. Miller, Konstan & Riedl. "PocketLens: Toward a personal recommender system." ACM TOIS 22(3), 2004. doi:10.1145/1010614.1010618
- A3. Bertier et al. "The Gossple Anonymous Social Network." Middleware 2010. doi:10.1007/978-3-642-16955-7_10
- A4. Boutet et al. "WhatsUp: A Decentralized Instant News Recommender." IPDPS 2013. doi:10.1109/IPDPS.2013.47
- A5. Tang & Wang, IACR ePrint 2015/364 and 2015/1152 (revisiting Jeckmans, Peter & Hartel, ESORICS 2013).
- A6. Spotify Blend (TechCrunch 2021): https://techcrunch.com/?p=2196189 ; YouTube Music Taste Match (Android Central): https://www.androidcentral.com/apps-software/how-to-taste-match-your-youtube-music-playlist-with-a-friend ; Plex Discover Together (The Register, 2023-11-28): https://www.theregister.com/2023/11/28/plex_privacy/
- A7. Groh & Ehmig. "Recommendations in Taste Related Domains: Collaborative Filtering vs. Social Filtering." GROUP 2007. doi:10.1145/1316624.1316643
- A8. Massa & Avesani. "Trust-aware Recommender Systems." RecSys 2007.
- A9. Sinha & Swearingen. "Comparing Recommendations Made by Online Systems and Friends." DELOS-NSF Workshop 2001.
- A10. "Message in a Sealed Bottle: Privacy Preserving Friending in Social Networks": https://arxiv.org/abs/1207.7199
- A11. Canny. "Collaborative Filtering with Privacy." IEEE S&P 2002, pp. 45–57. doi:10.1109/SECPRI.2002.1004361 ; author PDF: https://people.eecs.berkeley.edu/~jfc/papers/02/IEEESP02.pdf
- A12. Bonawitz et al. "Practical Secure Aggregation for Privacy-Preserving Machine Learning." ACM CCS 2017, pp. 1175–1191. doi:10.1145/3133956.3133982 ; https://acmccs.github.io/papers/p1175-bonawitzA.pdf
- A13. McSherry & Mironov. "Differentially Private Recommender Systems." KDD 2009. doi:10.1145/1557019.1557090
- A14. Jamali & Ester. "TrustWalker." KDD 2009. doi:10.1145/1557019.1557067
- A15. MeritRank: https://arxiv.org/abs/2207.09950 (preprint); Web3Recommend (an MSc thesis on arXiv): https://arxiv.org/abs/2307.01411
- A16. Kamvar, Schlosser, Garcia-Molina. "The EigenTrust Algorithm for Reputation Management in P2P Networks." WWW 2003. doi:10.1145/775152.775242
- A17. Calandrino et al. "You Might Also Like: Privacy Risks of Collaborative Filtering." IEEE S&P 2011. doi:10.1109/SP.2011.40
- A18. Narayanan & Shmatikov. "Robust De-anonymization of Large Sparse Datasets." IEEE S&P 2008. doi:10.1109/SP.2008.33
- A19. Rong et al. "FedRecAttack." ICDE 2022: https://arxiv.org/abs/2204.01499
- A20. Douceur. "The Sybil Attack." IPTPS 2002, LNCS 2429. doi:10.1007/3-540-45748-8_24
- A21. Gunes et al. "Shilling Attacks against Recommender Systems: A Comprehensive Survey." Artificial Intelligence Review 42(4), 2014. doi:10.1007/s10462-012-9364-9
- A22. Yu et al. "DSybil: Optimal Sybil-Resistance for Recommendation Systems." IEEE S&P 2009.
- A23. Page, Brin, Motwani & Winograd. "The PageRank Citation Ranking: Bringing Order to the Web." Stanford InfoLab TR 1999-66, §6 "Personalized PageRank".
- A24. Jeh & Widom. "Scaling Personalized Web Search." WWW 2003. doi:10.1145/775152.775191
- A25. Lam & Riedl. "Shilling Recommender Systems for Fun and Profit." WWW 2004. doi:10.1145/988672.988726

**Creator discovery**
- C1. Aguiar & Waldfogel. "Platforms, Promotion, and Product Discovery: Evidence from Spotify Playlists." NBER w24713: https://www.nber.org/papers/w24713
- C2. Balduf, Sokoto (co-lead authors), Baronchelli, Castro, Król, Tyson, Pavlou, Scheuermann & Ascigil. "Bootstrapping Social Networks: Lessons from Bluesky Starter Packs." ICWSM 2025, vol. 19, pp. 178–192. doi:10.1609/icwsm.v19i1.35810 ; https://ojs.aaai.org/index.php/ICWSM/article/view/35810 ; arXiv 2501.11605
- C3. YouTube fresh-content papers: https://arxiv.org/abs/2306.01720 (KDD 2023) ; Yi et al. "Online Matching: A Real-time Bandit System for Large-scale Recommendations," RecSys 2023: https://arxiv.org/abs/2307.15893 (exploration-traffic figures)
- C4. Fleder & Hosanagar. "Blockbuster Culture's Next Rise or Fall." Management Science 2009.
- C5. Singh & Joachims. "Fairness of Exposure in Rankings." KDD 2018.
- C6. IETF DAP: https://datatracker.ietf.org/doc/draft-ietf-ppm-dap/ ; Divvi Up: https://divviup.org/about/
- C7. Wang et al. "Item Level Exploration Traffic Allocation in Large-scale Recommendation Systems" (Google; RecSys 2024): https://arxiv.org/abs/2505.09033
- C8. FTC Endorsement Guides, 16 CFR Part 255, 88 FR 48092 (26 July 2023).

**Law**
- L1. 18 U.S.C. § 2710: https://www.law.cornell.edu/uscode/text/18/2710 ; *Salazar v. Paramount Global*, No. 25-459, docket: https://www.supremecourt.gov/search.aspx?filename=/docket/docketfiles/html/public/25-459.html
- L2. EDPB Guidelines 02/2025 on blockchain, final v2.0 adopted 7 July 2026: https://www.edpb.europa.eu/system/files/2026-07/edpb_guidelines_202502_blockchain_v2_en.pdf ; CJEU C-184/20 and C-252/21.

**State pressure and network privacy**
- S1. State-pressure cases (Kolektiva, Damus, Tor, LBRY) in the research report; Kolektiva: EFF, 25 July 2023: https://www.eff.org/deeplinks/2023/07/fbi-seizure-mastodon-server-wakeup-call-fediverse-users-and-hosts-protect-their ; CyberInsider, 5 July 2023: https://cyberinsider.com/fbi-seized-the-database-of-a-social-media-anarchist-collective/
- S2. RFC 9458, Oblivious HTTP: https://www.rfc-editor.org/rfc/rfc9458
- S3. Piotrowska et al. "The Loopix Anonymity System." USENIX Security 2017.
- S4. Martiny et al. "Improving Signal's Sealed Sender." NDSS 2021.
