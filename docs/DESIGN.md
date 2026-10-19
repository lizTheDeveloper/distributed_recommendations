# Match Feed: distributed recommendations for federated video

Status: early design draft, revision 2 (sources checked against primary material).
Mockups: `mockups/match-feed.html`. Research: `reports/Distributed video recommendation prior art.md`.

## Problem

Federated video (PeerTube) handles hosting and follows. Discovery is weak.
PeerTube's built-in recommendation list returns up to 5 local videos that share a tag
with the current one, newest first, skipping watched videos for logged-in users; it is
not personalized [P1]. Community efforts are mostly client-side and single-user. The
PeerTube Picks extension computes cosine similarity over your own local history and
shares nothing [P2]. An instance-level recommender plugin has been proposed without a
specified method [P3].

Decentralized peer collaborative filtering is not new:
- BuddyCast ran in Tribler. It shared plaintext histories with automatically chosen "taste buddies" and was later removed [A1].
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

1. **Follow, Subscribe to taste, and reserved explore slots.**
   - Curated lists and reserved exposure have the strongest measured effects on creator discovery.
   - Spotify playlist placement causally adds streams, including for new artists [C1].
   - Bluesky starter packs drove up to 43% of follows at peak [C2].
   - YouTube runs dedicated pipelines for fresh content [C3].
   - These tiers also solve viewer cold start without any private data.
2. **Match.**
   - Friend and trust-based recommendation matches or beats global CF accuracy in taste domains [A7][A8].
   - It is less novel, so it complements the explore slots and does not replace them [A9].
3. **Circles**, once the aggregation design below is validated.

## Match protocol

1. **Preview (PSI-cardinality).**
   - Two users learn only how many videos they have in common [A10].
   - Repeated queries leak membership, so we rate-limit previews per pair and require a minimum set size.
2. **Consent.** Each side chooses:
   - what goes in the sketch: endorsements only (the default), or endorsements plus finished watches
   - the time window
   - excluded tags and hours
   - expiry (90 days unless renewed)
3. **Exchange.**
   - 1:1 sketches go over Nostr NIP-17 private messages, which are NIP-44 encryption plus NIP-59 gift wrap [N1].
   - NIP-04 is deprecated.
   - NIP-44 lacks forward secrecy, so sketches stay short-lived and keys rotate.
4. **Score locally.**
   - similarity = Jaccard or cosine of the two sketches
   - candidate score = Σ over matches of `sim(you, m) × endorsed(m, video)`
   - This is user-based CF run on-device, as in PocketLens [A2].
5. **Circles.**
   - Group transport uses MLS [N2], e.g. the Marmot protocol (MLS over Nostr, audited 2026) [N3].
   - NIP-17 advises against groups larger than about 10.
   - Pooled counts follow Canny's model of an encrypted community aggregate [A11].
   - Secure aggregation [A12] hides inputs from the aggregator but **not the output**. With k = 5, a count of 5 reveals everyone endorsed the video, and members can subtract their own input.
   - Required mitigations:
     - minimum reveal threshold
     - DP noise on counts [A13]
     - fixed membership per round
     - k well above 5
     - a plan for members who drop out
6. **Second degree.**
   - Picks from matches of matches are discounted and unattributed, and count only when the person in the middle opts in.
   - Propagation uses a personalized, decaying trust walk seeded from you: personalized PageRank, TrustWalker [A14] or MeritRank [A15].
   - This is not EigenTrust, which computes global trust anchored on pre-trusted peers [A16].

## Creator side

- **Explore slots:** a fixed share of each feed is reserved for creators the viewer has no tie to. New creators compete only with each other there. The share (5–15%) is an untested assumption and needs simulating.
- **Exposure fairness on-device:**
  - Collaborative filtering concentrates attention [C4].
  - Apply per-creator exposure caps or popularity calibration when merging peer picks [C5].
- **Taste lists as bridges:** signed, portable, subscribable. Each entry gets a machine-readable *sponsored / affiliated* flag, per the FTC Endorsement Guides. Weight lists by their track record so one list can't dominate.
- **Analytics without surveillance:**
  - Creators get aggregate reach and discovery-channel counts through DAP (Divvi Up / Janus) [C6].
  - That includes how many views came from Follow, Taste, Match and Explore.
  - Nobody sees individual watch histories.
- **Portability:** a creator's identity is a key, not an instance account. Videos can be mirrored across instances.

## Privacy facts to design around

- **Hashing video IDs gives no privacy.** The catalog is enumerable. Use encryption to the peer, or PSI.
- **Recommending inherently reveals.** If you recommend X to me, I learn you endorsed X. Only aggregation with thresholds and noise blunts this.
- **Outputs leak.**
  - Calandrino et al. inferred individual transactions from item-to-item recommender outputs, given some auxiliary knowledge of the target plus observation of how outputs change over time [A17].
  - The same applies to Circle members watching group picks change.
- **Sparse taste data identifies people.** 8 ratings with noisy dates uniquely identified 99% of Netflix Prize records [A18]. Public taste lists identify their owners and give attackers material to poison recommendations [A19]. Warn curators.
- **Default to endorsements, not passive history.**
  - The US VPPA binds video service *providers*. It requires distinct, revocable consent lasting at most 2 years [L1].
  - *Salazar v. Paramount Global* (No. 25-459) is pending at the Supreme Court.
  - Under GDPR, inferences from watch history can be special-category data (Art. 9), and decentralization is no exemption [L2].

## Manipulation and Sybils

- **Sybils can't be ruled out without a central identity authority** [A20]. Recommenders are especially exposed to shilling, where attackers build fake profiles similar to a target's [A21].
- **The first hop is strong.** Mutual, user-chosen matches close that route, because similarity alone never creates an edge.
- **The second hop and public lists are the weak spots.** Use decaying personalized trust (above), plus per-source trust learned from feedback, as in DSybil [A22].

## State resistance

**What this does buy:**
- There's no central ranker to coerce.
- There's no central store of histories.

**What it doesn't buy:** real-world pressure has landed on operators, app stores and the network layer, not on protocols [S1]:
- the FBI seized the Kolektiva.social database backup
- Damus was pulled from China's App Store
- Russia blocks Tor

| Pressure point | What's exposed | Mitigation |
|---|---|---|
| Video host / instance | can remove videos; holds account data | mirror across instances; minimal server-side data; encrypted backups |
| P2P streaming | **viewer IPs, visible to the tracker and other peers.** PeerTube calls this "the main threat to user privacy" [P4] | P2P off by default for viewers; opt-in |
| Relays | who exchanges sketches with whom | many relays; Oblivious HTTP [S2]; batching, padding and delays; secret per-group discovery keys; mixnet transport [S3]. Sealed-sender-style hiding alone falls to timing attacks [S4] |
| Identity | key loss; directory chokepoints (did:plc) | separate identity keys from per-match keys; social recovery; key rotation |
| App stores | client distribution | PWA, F-Droid, sideloading |
| User device | plaintext history | encryption at rest, short retention, wipe |
| A match | whatever you shared | none; this is inherent to sharing |

There is no token. A token adds a securities-law target, as LBRY's 2022 loss to the SEC showed [S1].

## Distribution options

| Option | Fit | Main risk |
|---|---|---|
| ActivityPub (PeerTube) | video catalog, follows, interop | admins see everything on their instance; no native E2E |
| Nostr | user-owned keys, swappable relays, NIP-17 DMs, MLS via Marmot, video events in NIP-71: kinds 21/22 (regular) and 34235/34236 (addressable); read all four [N4] | relay metadata; key recovery |
| AT Protocol | custom feeds prove "algorithmic choice" works | repos are public, and the feed generator sees the requester's DID [N5]. Private "permissioned data" is still proposal 0016. Our on-device "feed recipes" borrow the idea; they aren't interoperable with it |
| Custom P2P (iroh / libp2p) | maximum control | NAT traversal, mobile limits, build cost |

**Working hypothesis:**
- PeerTube/ActivityPub for the catalog.
- Nostr keys and relays for public taste lists, 1:1 sketches (NIP-17) and Circles (Marmot/MLS).
- On-device ranking.

## Building blocks to evaluate

The full list, with licenses, is in the research report. Main candidates:
- PeerTube REST API and the Sepia Search index
- NDK / nostr-tools
- Marmot (MDK, marmot-ts) or OpenMLS
- OpenMined PSI
- Vertex or MeritRank, for suggesting whom to match
- Janus / libprio, for creator analytics
- OpenDP
- Automerge or iroh
- a small on-device CF library

## Open questions / to simulate

- Explore-slot share vs. new-creator time-to-first-non-follower-view.
- Creator exposure concentration (Gini) under Match-heavy vs. Taste-heavy feeds.
- Leakage of repeated PSI-cardinality previews, and Circle output leakage at various k and noise levels.
- Moderation: subscribe-able labelers (Bluesky-style), applied on-device.

## Sources

Full annotated bibliography in `reports/Distributed video recommendation prior art.md`.

**PeerTube**
- P1. PeerTube recommendation service source: https://github.com/Chocobozzz/PeerTube/blob/develop/client/src/app/%2Bvideo-watch/shared/recommendations/video-recommendation.service.ts
- P2. PeerTube Picks / solidheron extension: https://github.com/solidheron/peertube_recomendation_algorythm ; announcement posts https://piefed.jeena.net/post/169216 ; proposal https://github.com/Chocobozzz/PeerTube/issues/6978
- P3. fairkom recommender proposal: https://git.fairkom.net/emb/displ.eu/recommender/-/issues/7
- P4. PeerTube privacy guide: https://docs.joinpeertube.org/admin/privacy-guide

**Protocols**
- N1. NIP-17: https://github.com/nostr-protocol/nips/blob/master/17.md ; NIP-44: https://github.com/nostr-protocol/nips/blob/master/44.md ; Cure53 NIP-44 audit (2023): https://cure53.de/audit-report_nip44-implementations.pdf
- N2. RFC 9420, Messaging Layer Security: https://www.rfc-editor.org/rfc/rfc9420
- N3. Marmot protocol: https://github.com/marmot-protocol
- N4. NIP-71: https://github.com/nostr-protocol/nips/blob/master/71.md
- N5. AT Protocol feeds guide: https://atproto.com/guides/feeds ; feed-generator: https://github.com/bluesky-social/feed-generator

**Recommender systems and privacy**
- A1. Tribler BuddyCast: https://tribler.org/DecentralizedRecommendation
- A2. Miller et al. "PocketLens." ACM TOIS 2004.
- A3. Bertier et al. "The Gossple Anonymous Social Network." Middleware 2010.
- A4. Boutet et al. "WhatsUp." IPDPS 2013.
- A5. Tang & Wang, IACR ePrint 2015/364 and 2015/1152 (revisiting Jeckmans et al., ESORICS 2013).
- A6. Spotify Blend (TechCrunch 2021); Plex Discover Together (The Register, 2023-11-28).
- A7. Groh & Ehmig. "Recommendations in Taste Related Domains." GROUP 2007.
- A8. Massa & Avesani. "Trust-aware Recommender Systems." RecSys 2007.
- A9. Sinha & Swearingen. "Comparing Recommendations Made by Online Systems and Friends." DELOS 2001.
- A10. "Message in a Sealed Bottle: Privacy Preserving Friending in Social Networks": https://arxiv.org/abs/1207.7199
- A11. Canny. "Collaborative Filtering with Privacy." IEEE S&P 2002. doi:10.1109/SECPRI.2002.1004361
- A12. Bonawitz et al. "Practical Secure Aggregation for Privacy-Preserving Machine Learning." ACM CCS 2017. doi:10.1145/3133956.3133982
- A13. McSherry & Mironov. "Differentially Private Recommender Systems." KDD 2009.
- A14. Jamali & Ester. "TrustWalker." KDD 2009.
- A15. MeritRank: https://arxiv.org/abs/2207.09950 ; Web3Recommend: https://arxiv.org/abs/2307.01411 (preprints)
- A16. Kamvar, Schlosser, Garcia-Molina. "The EigenTrust Algorithm." WWW 2003. doi:10.1145/775152.775242
- A17. Calandrino et al. "You Might Also Like: Privacy Risks of Collaborative Filtering." IEEE S&P 2011. doi:10.1109/SP.2011.40
- A18. Narayanan & Shmatikov. "Robust De-anonymization of Large Sparse Datasets." IEEE S&P 2008. doi:10.1109/SP.2008.33
- A19. Rong et al. "FedRecAttack." ICDE 2022: https://arxiv.org/abs/2204.01499
- A20. Douceur. "The Sybil Attack." IPTPS 2002.
- A21. Gunes et al. "Shilling Attacks against Recommender Systems: A Comprehensive Survey." AI Review 2014.
- A22. Yu et al. "DSybil." IEEE S&P 2009.

**Creator discovery**
- C1. Aguiar & Waldfogel. "Platforms, Promotion, and Product Discovery." NBER w24713.
- C2. Castro et al. Bluesky starter packs. ICWSM 2025: https://ojs.aaai.org/index.php/ICWSM/article/view/35810
- C3. YouTube fresh-content papers: https://arxiv.org/abs/2306.01720 ; https://arxiv.org/abs/2307.15893
- C4. Fleder & Hosanagar. "Blockbuster Culture's Next Rise or Fall." Management Science 2009.
- C5. Singh & Joachims. "Fairness of Exposure in Rankings." KDD 2018.
- C6. IETF DAP: https://datatracker.ietf.org/doc/draft-ietf-ppm-dap/ ; Divvi Up: https://divviup.org/about/

**Law**
- L1. 18 U.S.C. § 2710: https://www.law.cornell.edu/uscode/text/18/2710
- L2. EDPB Guidelines 02/2025 (blockchain, draft); CJEU C-184/20 and C-252/21.

**State pressure and network privacy**
- S1. State-pressure cases (Kolektiva, Damus, Tor, LBRY) in the research report.
- S2. RFC 9458, Oblivious HTTP: https://www.rfc-editor.org/rfc/rfc9458
- S3. Piotrowska et al. "The Loopix Anonymity System." USENIX Security 2017.
- S4. Martiny et al. "Improving Signal's Sealed Sender." NDSS 2021.
