# Creator-Side Discovery and Fairness in Recommender Systems (for a decentralized, peer/trust-based video app)

Notes compiled 2026-10-19. Confidence labels: "verified" means I opened the abstract or landing page in this session. "Snippet" means I confirmed it only from a search-result summary. Exact figures marked "snippet" should be checked against the paper before anyone quotes them. Revised 2026-10-19: many earlier "snippet" items were re-checked against abstracts or full texts. See the revision log at the end.

## 1. Popularity bias, long-tail exposure, and provider fairness: does CF concentrate attention, and do social/trust recommenders spread it differently?

### Takeaway
There is a lot of evidence that standard collaborative filtering (CF) is biased toward popular items and makes attention more concentrated. The field now has formal tools for "fairness of exposure" to creators. Evidence that social or trust-based recommenders spread attention more evenly is thinner and depends on the method. Theory suggests the social graph limits how far popularity-driven distortion can go. Empirically, social signals tend to widen coverage, but they do not reliably reach the long tail.

### Cited Findings
- **Recommenders can reduce aggregate diversity.** Fleder & Hosanagar (Management Science, 2009) combined analytical models with simulations of real recommender implementations. They found that recommenders can push each individual toward new products while pushing similar users toward the *same* products, which reinforces blockbusters. They also found that basic design choices change the outcome. — [UPenn repository](https://repository.upenn.edu/oid_papers/152); [Wharton summary](https://knowledge.wharton.upenn.edu/podcast/knowledge-at-wharton-podcast/reinforcing-the-blockbuster-nature-of-media-the-impact-of-online-recommenders/) (snippet)
- **In music, CF follows popularity; content-based and expert links do not.** Celma & Cano (2008, KDD Large-Scale RecSys/Netflix Prize workshop), "From hits to niches? or how popular artists can bias music recommendation and discovery", used Last.fm playcounts, a Long Tail model and complex-network metrics on similar-artist graphs. They found that "collaborative filtering approach is prone to popularity bias", which hurts the discovery ratio and navigation into the tail. In audio content-based and human-expert graphs, "artists are linked independently of their popularity", so a listener can get from a mainstream artist to a Long Tail artist "in just two or three clicks." — [MTG-UPF](https://mtg.upf.edu/node/1004) (snippet)
- Celma's book *Music Recommendation and Discovery: The Long Tail, Long Fail, and Long Play in the Digital Music Space* (Springer, 2010; DOI 10.1007/978-3-642-13287-2) builds this into network-centric and user-centric evaluation. It favors "non-obvious" recommendations drawn from the long tail. — [Springer](https://link.springer.com/doi/10.1007/978-3-642-13287-2) (snippet)
- **Popularity bias, miscalibration and supplier fairness.** Abdollahpouri, Mansoury, Burke & Mobasher, "The Unfairness of Popularity Bias in Recommendation" (2019 workshop), frames popularity bias as unfair to users whose taste is less mainstream. — [CEUR-WS Vol-2440](https://ceur-ws.org/Vol-2440/paper4.pdf) (snippet)
  - A follow-up study, "The Impact of Popularity Bias on Fairness and Calibration in Recommendation" (Abdollahpouri, Mansoury, Burke & Mobasher, arXiv v2 Oct 2019), found that algorithms that amplify popularity bias more also tend to be more miscalibrated. The paper states that "Users with less interest in popular items are the most affected by popularity bias." — [arXiv 1910.05755](https://arxiv.org/pdf/1910.05755v2) (verified against full text)
  - "Addressing the Multistakeholder Impact of Popularity Bias in Recommendation Through Calibration" (Abdollahpouri, Mansoury, Burke & Mobasher; arXiv 2007.12230, July 2020, preprint with no venue listed) proposes optimizing how closely the popularity mix of recommended items matches each user's history. It reports gains on popularity bias and "a secondary effect of improving supplier fairness". It also argues that existing popularity-bias metrics do not reflect performance from different stakeholders' perspectives. — [arXiv 2007.12230](https://arxiv.org/abs/2007.12230) (verified abstract)
  - A temporal variant of xQuAD (Abdollahpouri & Burke, "Reducing Popularity Bias in Recommendation Over Time", arXiv preprint, June 2019) tracks long-tail coverage at regular intervals and "compensates in the present moment for omissions in the past." — [arXiv 1906.11711](https://arxiv.org/abs/1906.11711) (verified abstract)
- **Fairness of exposure.** Singh & Joachims, "Fairness of Exposure in Rankings" (KDD 2018, DOI 10.1145/3219819.3220088), argues that rankers owe responsibilities to the *items* being ranked, not only to users. It expresses fairness as constraints on how exposure is allocated (demographic parity, disparate treatment, disparate impact) and maximizes user utility subject to those constraints. — [arXiv 1802.07281](https://arxiv.org/pdf/1802.07281) (verified via search listing)
- **Multi-stakeholder and provider fairness.** Burke, "Multisided Fairness for Recommendation" (FAT/ML 2017), separates consumer-side (C-fairness) from provider-side (P-fairness) concerns and proposes a taxonomy and architectures. — [arXiv 1707.00093](https://arxiv.org/pdf/1707.00093)
  - Burke et al., "Balanced Neighborhoods for Multi-sided Fairness" (FAT* 2018, PMLR v81), covers consumer-centered and provider-centered cases. — [PMLR](https://proceedings.mlr.press/v81/burke18a.html)
  - Abdollahpouri & Burke connect multi-stakeholder recommendation to multisided fairness. — [arXiv 1907.13158](https://arxiv.org/pdf/1907.13158)
  - Sonboli, Burke, Ekstrand & Mehrotra, "The Multisided Complexity of Fairness in Recommender Systems" (AI Magazine, 2022). — [AAAI](https://ojs.aaai.org/index.php/aimagazine/article/view/21742)
  - A 2022 survey notes that most fairness work is single-sided. — [arXiv 2205.11127](https://arxiv.org/pdf/2205.11127)
- **Social ties and popularity, theoretically.** Bressan, Leucci, Panconesi, Raghavan & Terolli, "The Limits of Popularity-Based Recommendations, and the Role of Social Ties" (KDD 2016), model recommenders driven by popularity *and* social ties. They derive the market's steady state and find that highly influential users exist, but the social graph prevents "large market distortions." — [arXiv 1607.04263](https://arxiv.org/abs/1607.04263) (verified abstract)
- **Social ties and popularity, empirically.**
  - Cañamares & Castells (RecSys workshop 2015) link the strong performance of popularity-based recommendation to item discovery through social communication. In other words, social spread itself produces popularity. — [CEUR-WS Vol-1271](https://ceur-ws.org/Vol-1271/Paper2.pdf) (snippet)
  - Sacharidis (UMAP 2019), "Diversity and Novelty in Social-Based Collaborative Filtering", tests whether social-regularization recommenders create low-diversity echo chambers. It reports that accuracy can improve without giving up diversity or novelty. — [TU Wien PDF](https://www.ec.tuwien.ac.at/~dimitris/publications/UMAP19a.pdf) (snippet)
  - Sánchez-Moreno et al. (Information, 2020) widen CF neighborhoods using trust and homophily. They report more recommendable items (coverage) with lower error. — [DOI 10.3390/info11090439](https://doi.org/10.3390/info11090439) (snippet)

### Inferences
- A trust/peer recommender that propagates "what my trusted peers liked" is still a popularity mechanism, only local instead of global (Cañamares & Castells). In each neighborhood it will favor whatever is popular *among the viewer's peers*. Bressan et al. suggest this limits global winner-take-all effects. Attention may still pile up within clusters, especially on creators who are well connected in the graph.
- Celma's finding suggests a design lever. Content-based or human-curated edges ("this creator is similar to that one", tag graphs, curator lists) connect head and tail regardless of popularity. Pure co-engagement edges do not. A hybrid of trust edges, content/tag edges and curator edges is likely to spread exposure better than trust-weighted CF alone.
- Formal provider fairness (Singh & Joachims exposure constraints, calibrated popularity, temporal xQuAD) can be applied to the *final ranking step* on the client. In a decentralized app, each viewer's device could enforce an exposure budget, for example at most X% of slots going to the top-N creators in the candidate set. No central coordinator is needed.

### Gaps
- I found no head-to-head empirical study measuring creator-exposure concentration (Gini of impressions per creator) under trust-based versus global CF on a video platform. This is an open research question and a good candidate for this project's own simulation.
- I did not read the full texts of Sacharidis 2019 or Sánchez-Moreno 2020, so their exact diversity and coverage figures are unverified. A retrieval attempt on 2026-10-19 failed: the TU Wien URL returned HTML and MDPI returned 403.

## 2. How new creators get discovered: YouTube/TikTok versus PeerTube, Mastodon and Bluesky

### Takeaway
Centralized platforms run dedicated machinery to give fresh content and new creators exposure. TikTok says follower count is not a direct ranking input. YouTube and Google run separate "fresh content" funnels and bandit-based exploration. Fediverse platforms mostly lack this. They depend on follows, hashtags, local and federated timelines, and optional cross-instance search, and users report that discovery is hard. Bluesky shows that curated social bootstrapping (starter packs) and third-party feeds can shift reach measurably.

### Cited Findings
- **TikTok.** TikTok's official explainer says "neither follower count nor whether the account has had previous high-performing videos are direct factors in the recommendation system." Ranking is based on user interactions, video information and device/account settings, with strong weight on signals such as watching a video to the end. Larger accounts still get more views because they have built an audience. The post calls "whether a user finishes watching a longer video from beginning to end" a strong indicator of interest. — [TikTok Newsroom, 18 June 2020](https://newsroom.tiktok.com/en-us/how-tiktok-recommends-videos-for-you/) (verified page text, 2026-10-19)
  - This is a platform self-description, not an independent audit.
- **YouTube/Google fresh content.**
  - "Fresh Content Needs More Attention: Multi-funnel Fresh Content Recommendation" (J. Wang, H. Lu, … M. Chen; accepted at KDD 2023) describes a *dedicated* fresh-content stack on "a large commercial platform". The abstract does not name the platform. A two-tower model nominates candidates for coverage, and a sequence model updated in near real time on user feedback nominates for relevance. — [arXiv 2306.01720](https://arxiv.org/abs/2306.01720) (verified abstract)
  - "Online Matching: A Real-time Bandit System for Large-scale Recommendations" (Yi et al., Google DeepMind/YouTube, RecSys 2023) is deployed on **YouTube**. It says batch-trained recommenders are limited in finding high-quality fresh videos, and adds a real-time bandit retrieval source for fresh content. It gives the exploration-traffic figures quoted in section 5. — [arXiv 2307.15893](https://arxiv.org/pdf/2307.15893) (verified full text)
  - "Item Level Exploration Traffic Allocation in Large-scale Recommendation Systems" (D. Wang et al., Google; ACM reference format says RecSys 2024; arXiv May 2025) describes "a dedicated exploration system" in which new items "compete only" with each other within reserved traffic. It does not state what share of total traffic is reserved. — [arXiv 2505.09033](https://arxiv.org/pdf/2505.09033) (verified full text)
- **Mastodon structure.** Zignani, Gaito & Rossi, "Follow the 'Mastodon': Structure and Evolution of a Decentralized Online Social Network" (ICWSM 2018, vol. 12, pp. 541–550, dataset paper), mined the follow graph and instance metadata and compared the structure with Twitter. — [AAAI ICWSM](https://ojs.aaai.org/index.php/ICWSM/article/view/14988) (verified abstract). The earlier claim of "a more balanced follower/followee ratio than Twitter" is *not* in the abstract and was not checked against the full text, so treat it as unverified.
  - Zignani, Quadri, Gaito, Cherifi & Rossi, "The Footprints of a 'Mastodon': How a Decentralized Architecture Influences Online Social Relationships" (IEEE INFOCOM WKSHPS 2019, pp. 472–477, DOI 10.1109/INFCOMW.2019.8845221), find that each instance has a specific "footprint" in degree distribution and ego-network clustering. Ego-networks are more clustered *within instance boundaries*, with triangles forming among members of the same instance. — [UNIMI repository](https://air.unimi.it/handle/2434/641563) (verified abstract)
  - Related: La Cava & Tagarelli, "Information Consumption and Boundary Spanning in Decentralized Online Social Networks: the case of Mastodon Users" (Online Social Networks and Media 30:100220, 2022), study within- versus cross-instance ties and boundary-spanning roles. — [arXiv 2203.15752](https://arxiv.org/abs/2203.15752) (verified abstract; this link was previously mislabelled as the Zignani workshop paper)
- **Twitter-to-Mastodon migration.** La Cava, Aiello & Tagarelli (Scientific Reports, Dec 2023) studied about 75,000 migrated users. Migration timing fits a social-influence (epidemic diffusion) model. Communities that migrated more talked a lot about committing to leave and had fewer social connections on Twitter. — [PMC10703911](https://pmc.ncbi.nlm.nih.gov/articles/PMC10703911); [arXiv 2305.19056](https://arxiv.org/pdf/2305.19056) (snippet)
  - Jeong et al. (ICWSM) studied more than 10,000 migrants in the first ten weeks and the behavioral factors behind whether they stayed. — [arXiv 2305.09196](https://arxiv.org/html/2305.09196v4) (snippet)
- **Discovery on Mastodon is acknowledged to be hard.** Carl Colglazier (Northwestern / Community Data Science Collective), "Do Servers Matter on Mastodon? Data-driven Design for Decentralized Social Media", was **published at DeWeb 2024, the 1st International Workshop on Decentralizing the Web, in the Workshop Proceedings of ICWSM 2024** (published 1 June 2024, DOI 10.36190/2024.43). — [ICWSM workshop proceedings abstract](https://workshop-proceedings.icwsm.org/abstract.php?id=2024_43); [PDF](https://workshop-proceedings.icwsm.org/pdf/2024_43.pdf) (verified abstract)
  - The published abstract, which uses trace data from millions of new accounts, says newcomers are less likely to remain active on the network's *largest general-purpose servers* than on others, and that users tend to migrate from larger to smaller servers. It proposes a server recommender built on each server's top hashtags, scored with Okapi BM25, to help newcomers find servers and "neighborhoods" of related servers.
  - The repository draft adds detail not checked against the published PDF. Discovery "has been challenging on Mastodon". Developers and users are "skeptical of algorithmic intrusions". Most servers traditionally supported only hashtag search. The survival analysis uses accounts created in May–June 2023 tracked over 91 days, and covers the 12 largest general instances listed on joinmastodon.org, *including* the flagship, rather than the flagship alone. — [draft (gitea)](https://gitea.communitydata.science/CarlColglazier/junior-sheer/raw/commit/df0cc8e8eccb62543f0d21fa4901670c4e9a5878/article.qmd)
- **Hashtags are the main fediverse discovery advice.** Fedi.tips recommends hashtags and introduction tags such as #Introduction and #NewHere. — [fedi.tips](https://fedi.tips/?p=1014) (practitioner guide)
- **Mastodon is moving toward curated bootstrapping.** It plans Bluesky-style "Packs" (starter packs) and onboarding improvements for Mastodon 4.6. — [TechCrunch, Oct 2025](https://techcrunch.com/2025/10/07/mastodon-is-taking-cues-from-bluesky-with-plans-for-its-own-starter-packs/)
- **PeerTube.** Users report trouble finding channels: search results are full of long-inactive channels or foreign-language TV re-uploads. Commenters say search is instance-local by default, and cross-instance search needs the optional Sepia Search global index. — [Lemmy thread (mirrored)](https://lemmy.4d2.org/post/251955/386164)
  - This is anecdotal user discussion, not measured data. I found no peer-reviewed study of PeerTube creator discovery.
- **Bluesky starter packs.** "Bootstrapping Social Networks: Lessons from Bluesky Starter Packs" by **Balduf, Sokoto** (co-lead authors), Baronchelli, Castro, Król, Tyson, Pavlou, Scheuermann & Ascigil (ICWSM 2025, vol. 19, pp. 178–192, DOI 10.1609/icwsm.v19i1.35810) analyzed 25.05M users, 335.42K starter packs and 1.73M pack members. The earlier citation "Castro, Baronchelli et al." misstated the author order. Figures below were checked against the arXiv v2 full text:
  - Packs were responsible for "up to 43% of daily follow operations at their peak", and over 40% of all follow operations in December 2024.
  - Packs account for 19.95% of all follow edges in the network. The press release describes the period as June 2024 to January 2025.
  - Using propensity-score matching against similar non-member, non-creator accounts, pack members received 39%, 57%, 71% and 85% more new follows in weeks 1–4 after joining a pack. Their post counts rose by 20%, 36%, 50% and 60% over the same weeks. The press release's "up to 85% more followers" and "60% more posts" are the week-4 figures.
  - Sources: [AAAI ICWSM](https://ojs.aaai.org/index.php/ICWSM/article/view/35810); [arXiv 2501.11605](https://arxiv.org/html/2501.11605v2); [Lancaster press release](https://www.lancaster.ac.uk/news/starter-packs-have-played-a-central-role-in-blueskys-rapid-growth-new-study-shows) (verified 2026-10-19)
- **Bluesky custom feeds.** Zhou, Wang & Zhang, "Middleware for Feed Recommendation in Practice: How Feed Creators Build, Maintain, and Sustain Custom Feeds on Bluesky" (arXiv 2609.12958, Sept 2026, preprint), interviewed 26 feed creators and tool developers and analyzed 88,302 custom feeds.
  - Feed creators fall into two orientations: utility-providing and community-building.
  - They lack granular interaction data and feedback, and the technical expertise to act on either.
  - They are unpaid hobbyists with little platform support, divided on whether to monetize beyond covering costs.
  - Source: [arXiv abstract](https://arxiv.org/abs/2609.12958) (verified abstract again 2026-10-19; v1 submitted 11 Sept 2026; preprint, not peer-reviewed)
- **Paper Skygest**, a personalized Bluesky custom feed for science content, reports "over 50,000 weekly uses by over 1,000 daily active users", all acquired organically. — Greenwood & Garg, "Paper Skygest: Personalized Academic Recommendations on Bluesky", [arXiv 2601.04253](https://arxiv.org/abs/2601.04253) (Jan 2026 preprint; verified abstract)

### Inferences
- The key difference is not "algorithm versus no algorithm." Centralized platforms *reserve exposure* for new and fresh content, through separate funnels, bandits and exploration pools where new items compete only with each other. Fediverse platforms have no equivalent reserved channel. A follow/trust graph without one will tend to lock in early movers.
- Instance-clustered follow graphs (Zignani) suggest that in a peer/trust recommender, creators are discovered mostly within their own community cluster. Cross-cluster discovery needs "bridge" mechanisms such as curators, tags and starter packs.
- Bluesky's starter-pack data is the strongest quantitative evidence that *human-curated social bundles* are a powerful discovery channel. They are also a concentrating one: pack members gained up to 85% more new follows than matched controls by week 4. So whoever controls inclusion in packs or curator lists holds gatekeeping power.

### Gaps
- No peer-reviewed measurement of PeerTube creator growth or discovery was found.
- I found no independent audit verifying TikTok's claim that follower count is not a direct ranking factor.
- The 88,302-feed analysis in Zhou et al. probably contains reach and concentration statistics for Bluesky feeds. Only the abstract was read.

## 3. Creator incentives and tools: analytics, audience portability, monetization, privacy-preserving analytics

### Takeaway
Bluesky feed creators explicitly say they lack interaction data and feedback, and that they have no sustainable funding. Decentralized platforms offer portability that centralized ones do not, especially Bluesky's DID-based identity, but they have weak built-in analytics and monetization. Mature privacy-preserving aggregation infrastructure exists and could give creators aggregate reach numbers without tracking viewers: Prio, the IETF DAP protocol, and ISRG's Divvi Up.

### Cited Findings
- **Bluesky feed creators.** They lack granular interaction data and feedback, and work as unpaid hobbyists with little platform support. — [Zhou, Wang & Zhang 2026](https://arxiv.org/abs/2609.12958)
- **Portability.** Bluesky ties an account to a persistent DID, so followers follow the DID rather than a server-bound handle. Mastodon accounts are tied to a specific instance. Neither Bluesky nor Mastodon had mature built-in creator payments or analytics as of 2025.
  - Sources: [Lovable comparison](https://lovable.dev/guides/bluesky-vs-threads); [Flockler](https://flockler.com/blog/bluesky-vs-mastodon)
  - These are vendor and marketing blogs, so treat them as low-quality sources. The DID design itself is documented in AT Protocol specifications, which I did not fetch here.
- **DAP (IETF PPM working group).** The Distributed Aggregation Protocol is a multi-party protocol for computing aggregate statistics without any operator seeing an individual's value. It defines clients, a collector, and two aggregators (a leader and a helper). It has been an Internet-Draft since 2021.
  - Sources: [draft-ietf-ppm-dap-02](https://datatracker.ietf.org/doc/draft-ietf-ppm-dap/02/); [Divvi Up glossary](https://docs.divviup.org/glossary); [LWN](https://lwn.net/Articles/983843)
  - DAP builds on Prio (Corrigan-Gibbs & Boneh). A companion VDAF draft covers different aggregation functions. — [LWN](https://lwn.net/Articles/983843)
- **Divvi Up (ISRG, the nonprofit behind Let's Encrypt).** Each measurement is split into two encrypted shares sent to non-colluding servers, and only the combined aggregate can be recovered. — [Divvi Up About](https://divviup.org/about/)
  - Its open-source implementation is Janus. Mozilla piloted it for Firefox telemetry (planned 2023), and Divvi Up added Oblivious HTTP support in July 2024. — [Divvi Up Firefox post](https://divviup.org/blog/divvi-up-in-firefox/); [Divvi Up blog](https://divviup.org/blog)

### Inferences
- A natural design is for viewers' clients to submit DAP/Prio reports to a pair of non-colluding aggregators, for example a creator-collective server plus an independent helper such as Divvi Up. Reports would be things like "watched creator C's video V, bucketed watch-time, came via channel {follow, peer-rec, tag-feed, curator-list}". Creators then see per-video totals, retention histograms and discovery-channel breakdowns, while nobody sees individual viewing histories. Adding differential-privacy noise to the aggregates and setting minimum batch sizes would protect small creators' tiny audiences from re-identification.
- The discovery-channel breakdown matters most for fairness. It would show creators, and the protocol, whether peer recommendations or curator lists actually bring new viewers to new creators. That is the signal Bluesky feed creators say they lack.
- Portability: identity should be DID-like, so a creator's audience survives a change of host. Discovery metadata such as curator-list memberships and tags should be attached to that portable identity, not to a host.

### Gaps
- I found no rigorous 2024–2026 creator survey comparing reach and monetization across Mastodon, Bluesky, Threads and PeerTube. The only sources were vendor blogs.
- I did not verify PeerTube's current built-in per-video analytics, or the details of Mastodon's account-migration feature (which moves followers but not posts).
- I did not research Plausible-style cookieless analytics in this session. It is lower assurance than DAP: the server still sees raw hits, it just does not store identifiers.

## 4. Creator taste as curation: does curator-led recommendation drive discovery, and what are the payola and disclosure risks?

### Takeaway
There is causal evidence that curated playlist placement greatly increases streams and helps new artists. Spotify's New Music Friday raises the chance of success, including for new artists. Expert and curated links also connect head and tail regardless of popularity (Celma). The same power makes curator lists natural targets for paid placement. US FTC Endorsement Guides (revised June 2023) require clear disclosure of material connections, and they reach tags and likes as well.

### Cited Findings
- **Spotify playlists.** Aguiar & Waldfogel, "Platforms, Promotion, and Product Discovery: Evidence from Spotify Playlists" (NBER w24713, 2018), used before/after playlist additions and removals, regression discontinuity around algorithmic Top-50 lists, cross-country New Music Friday differences, and IV methods.
  - Being added to Today's Top Hits, "a list with 18.5 million followers during the sample period", raises a song's streams by almost 20 million, worth between $116,000 and $163,000 (NBER abstract). The earlier note that the figure "is reported differently across versions" was not substantiated; the NBER abstract gives this single range.
  - New Music Friday inclusion "substantially raises the probability of song success, including for new artists."
  - The authors warn that concentration may justify scrutiny of how platforms use their promotion power. This point comes from the earlier summary and was not re-checked in the abstract.
  - Sources: [NBER w24713](https://www.nber.org/papers/w24713) (verified abstract 2026-10-19); [VoxEU column](https://cepr.org/voxeu/columns/platforms-promotion-and-product-discovery-evidence-spotify-playlists)
- **Expert curation reaches the tail.** Human-expert and content-based similarity graphs link artists regardless of popularity, so the tail is two or three clicks from the head. CF graphs do not do this. — [Celma & Cano 2008](https://mtg.upf.edu/node/1004)
- **Curated bundles.** Bluesky starter packs (curated follow bundles) drove up to 43% of daily follows at peak. Pack members gained up to 85% more new follows than matched controls by week 4. — [Balduf et al., ICWSM 2025](https://arxiv.org/html/2501.11605v2)
- **Feed curators.** Bluesky feed curators are community-building or utility-providing hobbyists, unpaid and divided on monetization. — [Zhou et al. 2026](https://arxiv.org/abs/2609.12958)
- **FTC Endorsement Guides (16 CFR Part 255).** The FTC announced the revised Guides on June 29, 2023. They were published in the Federal Register on July 26, 2023 at 88 FR 48092.
  - Disclosures must be "clear and conspicuous". § 255.0(f) defines this as "difficult to miss (i.e., easily noticeable) and easily understandable", and on social media or the internet "the disclosure should be unavoidable". A guide example says a disclosure visible only after clicking a link is "not unavoidable and thus is not clear and conspicuous". The FTC's FAQ says required disclosures should be visible "without having to click 'more'". The press release adds that a platform's built-in disclosure tool may not be adequate.
  - "Endorsement" explicitly includes "tags in social media posts" (§ 255.0(b)), and fake positive reviews are endorsements. Per the FTC FAQ, a "like" *can* be an endorsement, and "Tagging a brand is an endorsement". The endorser may "be or appear to be an individual, group, or institution", and the FTC's announcement says the definition covers virtual influencers. **Correction:** the earlier statement that "bots" count as endorsers is not in the Guides' text or the announcement and has been removed.
  - Fake social influence: the Guides (Example 13) treat buying fake followers as "not itself an endorsement issue" but deceptive when used to misrepresent influence. The FTC FAQ says buyers *and* sellers of fake "likes" could face enforcement. Separately, the **binding** Consumer Reviews and Testimonials Rule (16 CFR Part 465, published Aug 22, 2024, effective Oct 21, 2024) prohibits selling or buying fake indicators of social media influence, and violations can carry civil penalties.
  - Intermediaries such as ad agencies and review brokers "may be liable for their roles in creating or disseminating endorsements" (§ 255.1(f)).
  - The Guides "represent administrative interpretations" and "provide the basis for voluntary compliance" (§ 255.0(a)). They are not binding rules in themselves; the FTC must still prove a Section 5 violation.
  - Sources: [FTC press release, 29 June 2023](https://www.ftc.gov/news-events/news/press-releases/2023/06/federal-trade-commission-announces-updated-advertising-guides-combat-deceptive-reviews-endorsements); [16 CFR 255.0 (LII)](https://www.law.cornell.edu/cfr/text/16/255.0); [16 CFR 255.1 (LII)](https://www.law.cornell.edu/cfr/text/16/255.1); [FTC Endorsement Guides FAQ](https://www.ftc.gov/business-guidance/resources/ftcs-endorsement-guides); [Part 465 final rule, 89 FR (Aug 22, 2024)](https://www.govinfo.gov/content/pkg/FR-2024-08-22/html/2024-18519.htm) (all verified 2026-10-19 except the Part 465 notice, which was confirmed from search results and law-firm summaries); earlier law-firm summaries: [Venable](https://www.venable.com/insights/blogs/2023/07/ftc-finalizes-updated-endorsement-and-testimonial), [Davis Wright Tremaine](https://www.dwt.com/insights/2023/07/ftc-advertising-endorsement-and-testimonial-guides)

### Inferences
- In a peer/trust system, a creator's "taste list" (the creators and videos they endorse) is likely the single best cross-cluster discovery bridge. It is a strong signal in its own right, and it links by judgment rather than by popularity.
- Payola risk is real, because placement has large causal value (Aguiar & Waldfogel). Design responses:
  - A machine-readable "material connection" flag on list entries, displayed inline rather than behind a "more" link, in line with the FTC standard.
  - A protocol-level norm or requirement that paid or affiliated entries are labeled.
  - Client-side ability to down-weight or filter lists that contain undisclosed sponsorships.
  - Reputation penalties when an undisclosed connection is reported.
  - Because the FTC treats tags (in the Guides) and likes (in its FAQ) as possible endorsements, "boosts" or "recommends" in the trust graph could themselves count as endorsements if they are compensated. Paying for fake boosts would also fall under the binding 2024 rule against fake social-influence indicators.
- Curator concentration risk: like starter packs, a few popular curators could become new gatekeepers. Curator lists can be subjected to the same exposure-fairness and rotation mechanisms as items.

### Gaps
- I found no peer-reviewed study on Letterboxd lists or Are.na channels as discovery drivers.
- I did not obtain a clean comparison of Spotify editorial versus algorithmic playlist effects on *new* artists beyond the NMF result. Aguiar & Waldfogel's Top-50 analysis covers algorithmic lists but was not extracted in detail.
- I did not research empirical studies of payola in playlist ecosystems (e.g., third-party "playlist pitching" services).

## 5. Cold start for creators in a follow/match graph: how does a brand-new creator get found?

### Takeaway
Industry practice and research agree on one point: new items need **reserved exposure**. That means separate candidate funnels, bandit and exploration traffic where new items compete with each other, and calibration or temporal-coverage constraints that make up for past under-exposure. In social and decentralized settings, the proven bootstrapping tools are curated bundles (starter packs), topic/tag feeds, and community curators. Without these, follow graphs favor early movers and stay inside instance clusters.

### Cited Findings
- **Reserved exploration pools.** In "Item Level Exploration Traffic Allocation" (Google; RecSys 2024 per its ACM reference; arXiv 2025), new items compete only with each other for a dedicated exploration traffic budget. — [arXiv 2505.09033](https://arxiv.org/pdf/2505.09033) (verified)
- **Published exploration-traffic shares (YouTube).** Yi et al., "Online Matching" (RecSys 2023), the only primary source found that gives numbers:
  - Online exploration is typically run "within a limited budget such as 1% of randomly shuffled daily user traffic".
  - The fresh-content deployment used "a small size of frequently shuffled user traffic (≤ 2%)", with an "exploitation" agent on "the rest of traffic (98-99%)". It had to raise exploration "from 1% to 2%" as the graph grew.
  - Exploration items are shown "at a fixed position in the UI" and bypass the ranking layer to get unbiased feedback.
  - The measured cost was "-0.16% and -0.19% satisfied user engagement loss from the 1% and 2% exploration slots".
  - A corpus-exploration use case used a slice with 6% of user traffic.
  - Source: [arXiv 2307.15893](https://arxiv.org/pdf/2307.15893) (verified full text)
- **Separate funnels and real-time feedback.**
  - A multi-funnel fresh-content stack nominates new content separately and updates on early feedback in near real time. — [arXiv 2306.01720](https://arxiv.org/abs/2306.01720) (verified abstract)
  - A real-time bandit adds a retrieval source for fresh videos because batch models miss them. — [arXiv 2307.15893](https://arxiv.org/pdf/2307.15893) (verified)
- **Compensating for past under-exposure.** Temporal xQuAD checks long-tail coverage at intervals and makes up for past omissions. — [arXiv 1906.11711](https://arxiv.org/abs/1906.11711) (verified abstract)
- **Explore/exploit at Spotify.** McInerney, Lacker, Hansen, Higley, Bouchard, Gruson & Mehrotra, "Explore, Exploit, and Explain: Personalizing Explainable Recommendations with Bandits" (RecSys 2018, pp. 31–39), present a bandit method that jointly learns which explanations each user responds to and which content to recommend, balancing exploration and exploitation. Tests on historical logs and live traffic "in a large-scale music recommendation service" improved engagement. — [RecSys 2018 session listing](https://recsys.acm.org/?p=13916) (verified abstract)
  - The listing does not name Spotify. The Spotify attribution and the system name "BaRT" come from Spotify-assigned patents ([US11301513B2](https://patents.google.com/patent/US11301513)) and secondary explainers, and were not confirmed against the paper PDF. The paper gives no exploration-traffic share in the material seen.
- **Exposure constraints.** Exposure can be allocated subject to a fairness constraint while maximizing utility. — [Singh & Joachims 2018](https://arxiv.org/pdf/1802.07281)
- **Not starting from follower count.** TikTok's stated design does not use follower count as a direct factor, so a first video can be shown to a test audience based on its content and early engagement. — [TikTok Newsroom](https://newsroom.tiktok.com/en-us/how-tiktok-recommends-videos-for-you/) (platform claim)
- **Curated bundles in a follow graph.** Bluesky starter packs account for 19.95% of all follow edges, which the press release dates to June 2024–January 2025. Pack members gained up to 85% more new follows than matched controls by week 4. — [Balduf et al., ICWSM 2025](https://ojs.aaai.org/index.php/ICWSM/article/view/35810)
- **Topic feeds.** Bluesky custom feeds that select posts by topic or rule act as discovery channels, for example Paper Skygest with more than 1,000 DAUs. — [Zhou et al. 2026](https://arxiv.org/abs/2609.12958); [Greenwood & Garg, arXiv 2601.04253](https://arxiv.org/abs/2601.04253)
- **Tags and server neighborhoods.** On Mastodon, hashtags and intro tags are the main discovery route. A proposed design publishes servers' top hashtags (scored with BM25) to help newcomers find "neighborhoods" of servers. — [fedi.tips](https://fedi.tips/?p=1014); [Colglazier, DeWeb@ICWSM 2024](https://workshop-proceedings.icwsm.org/abstract.php?id=2024_43)
- **Social-influence cascades.** On Mastodon, migration spread by social influence (an epidemic-like pattern) within communities. — [La Cava et al. 2023](https://pmc.ncbi.nlm.nih.gov/articles/PMC10703911)

### Inferences (design implications for a peer/trust video recommender)
1. **Explore slots on the client.** Reserve a fixed share of each feed for creators below a follower or impression threshold. The 5–15% range used here remains **a tunable design assumption, not drawn from a source**. The only published production figure found is YouTube's Online Matching: 1–2% of user traffic for fresh-content exploration and a 6% traffic slice for corpus exploration, at a measured engagement cost of about 0.2% (Yi et al., RecSys 2023). So 5–15% is several times larger than YouTube's documented budget. That may suit a small network with few established creators, but the cost should be measured, for example by A/B testing slot share against watch-completion. YouTube also places exploration items at a fixed UI position, bypassing ranking, to get unbiased feedback; a client-side explore slot can copy this. Candidates come from tag/topic feeds and curator lists, and new creators compete only with each other. Use a bandit such as Thompson sampling over early per-video watch-completion signals, with aggregates delivered through DAP so the bandit's learning stays private.
2. **Randomized exposure gives unbiased signal.** A small amount of uniformly random exposure within a topic produces unbiased estimates of quality for new creators. This addresses the feedback loop Fleder & Hosanagar describe and the popularity bias Abdollahpouri et al. describe.
3. **Trust-graph propagation with a tail bonus.** When peers' likes are propagated, apply popularity calibration (Abdollahpouri) or an exposure constraint (Singh & Joachims) so already-popular creators do not dominate peer recommendations.
4. **Curators as first-class bridges.** Creator and curator taste lists act like starter packs and New Music Friday. Make them portable, subscribable and disclosed (FTC-style material-connection flags). Rotate or cap how much any one list contributes, so curators do not become the new gatekeepers.
5. **Tag/topic feeds that do not depend on follows**, plus optional cross-node search, for example a Sepia-Search-like index. These address the PeerTube and Mastodon complaints that discovery is limited to the local instance.
6. **Measure creator-side outcomes** with privacy-preserving aggregates. Track the Gini of impressions per creator, the time until a new creator gets their first N non-follower viewers, and the share of new-creator views coming from each discovery channel. Publish these in a protocol "transparency report."

### Gaps
- No empirical study was found that measures how long brand-new creators take to reach an audience on PeerTube or Mastodon versus TikTok or YouTube.
- Exploration-traffic shares: the only published production figures found are YouTube's (1–2%, and 6% for corpus exploration; Online Matching, RecSys 2023). No figures were found for TikTok, Spotify, Pinterest or Kuaishou; a Pinterest exploration paper, arXiv 2607.22518 "PinEqualizer", surfaced in search but was not read. The 5–15% figure above is still an untested design assumption.
- McInerney et al. (RecSys 2018) is now cited above from its RecSys abstract. Its exploration rate and the explicit Spotify attribution were not confirmed from the paper's full text.

## Revision log (2026-10-19)
Second pass to verify claims against primary sources (abstract pages or full-text PDFs) wherever possible.

**Corrections**
- Bluesky starter-pack paper: the first authors are Balduf and Sokoto, not "Castro, Baronchelli et al." The ICWSM 2025 volume, pages and DOI were added. All percentages were checked against the arXiv full text and the comparison method (propensity-score matching, weeks 1–4) was added. The press-release figures "85% more followers" and "60% more posts" are week-4 values.
- Zignani entry: arXiv 2203.15752 is La Cava & Tagarelli (OSNEM 2022), not Zignani et al.'s INFOCOM 2019 workshop paper. The correct workshop citation was added (DOI 10.1109/INFCOMW.2019.8845221). The "more balanced follower/followee ratio than Twitter" claim is now marked unverified.
- Colglazier: the venue is now confirmed as DeWeb 2024 in the ICWSM 2024 Workshop Proceedings (DOI 10.36190/2024.43). The retention finding concerns the largest general-purpose servers, including the flagship, not the flagship alone.
- FTC Endorsement Guides:
  - The claim that "bots count as endorsers" was removed; it is not in the Guides or the FTC announcement.
  - "Likes" are sourced to the FTC FAQ, not the Guides' text. Tags are in the Guides.
  - The Federal Register citation (88 FR 48092, July 26, 2023) was added.
  - The binding 2024 Consumer Reviews and Testimonials Rule (16 CFR Part 465) was added; it covers fake social-influence indicators.
- Aguiar & Waldfogel: the note that the dollar value "is reported differently across versions" was removed. The NBER abstract gives $116,000–$163,000 and "almost 20 million" streams for Today's Top Hits (18.5M followers).
- Paper Skygest: the scour.ing relay link was replaced with arXiv 2601.04253, and authors were added (Greenwood & Garg).

**Newly verified (formerly snippet or unverified)**
- Abdollahpouri et al. arXiv 1910.05755, 2007.12230 and 1906.11711.
- TikTok newsroom post (dated 18 June 2020).
- arXiv 2306.01720 (KDD 2023).
- Online Matching: RecSys 2023, deployed on YouTube.
- arXiv 2505.09033 (Google; RecSys 2024).
- Zhou/Wang/Zhang arXiv 2609.12958 (re-checked: 26 interviews, 88,302 feeds, v1 submitted 11 Sept 2026).
- McInerney et al. RecSys 2018 (abstract only).

**Exploration traffic share**
- Published YouTube figures were added: 1–2% exploration traffic, a 6% corpus-exploration slice, and about 0.2% engagement cost (Yi et al., RecSys 2023).
- The 5–15% explore-slot figure stays labelled as a design assumption. It is now explicitly compared with the YouTube numbers.

**Still unresolved**
- Sacharidis 2019 and Sánchez-Moreno 2020: the full texts were not retrievable (the TU Wien URL returned HTML and MDPI returned 403), so their figures remain unverified.
- Fleder & Hosanagar, Celma & Cano, the Celma book, and the CEUR-WS items keep their earlier "snippet" labels and were not re-checked this pass.
- Spotify affiliation and exploration rate for McInerney et al. were not confirmed from the full text.
- Zignani 2018: the follower/followee-ratio claim is unverified.
- Colglazier: the draft-only details (the 91-day window, quotes) were not checked against the published PDF.
- No exploration-share data was found for platforms other than YouTube.
