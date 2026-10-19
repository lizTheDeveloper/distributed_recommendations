# Academic Prior Art: Decentralized, P2P and Privacy-Preserving Recommender Systems

Target design under evaluation: each user's device computes recommendations from a small set of chosen peers ("matches") who exchange encrypted taste sketches, plus public "taste lists", circles with pooled picks, and discounted second-degree propagation.

Verification note: every citation below was confirmed to exist via a publisher, DOI, DBLP, arXiv, or institutional repository page found during this research. The original draft flagged Shin et al. 2018, Jeckmans et al. 2013 and Tveit 2001 as unconfirmed; all three were confirmed on 2026-10-19 via Crossref (see the Revision log). Most findings come from abstracts and repository summaries, not full-text reads. Full texts read on 2026-10-19 were Canny 2002, Massa & Avesani 2007, Kermarrec et al. 2010, Web3Recommend, and Jamali's arXiv 1011.2245. Specific numeric results are given only where a source stated them. Where only the citation, and not the content, could be confirmed, this is flagged.

## 1. Gossip-based / P2P collaborative filtering: what worked, at what scale, what failed?

### Takeaway
Fully decentralized user-based CF on implicit "taste-buddy" neighborhoods is well established. Gossple, WhatsUp, Tribler/BuddyCast and PocketLens all showed that a node can find a small set of similar peers by gossip and get useful recommendations from them, with accuracy close to centralized CF. Evaluations reached thousands of simulated nodes and hundreds of PlanetLab hosts. Tribler was the one real deployment. Recurring problems were privacy leakage (profiles gossiped in the clear), churn, and Sybil/poisoning exposure. Gossip-learned matrix factorization later matched federated learning without needing a server.

### Cited Findings (annotated bibliography)

**Miller, Konstan & Riedl. "PocketLens: Toward a personal recommender system." ACM TOIS 22(3):437–476, 2004. DOI 10.1145/1010614.1010618**
- Built: an item-based CF algorithm plus five P2P architectures for finding neighbors. Motivation: centralized recommenders are not portable and require users to trust the operator with their preference data. — [UMN Experts](https://experts.umn.edu/en/publications/pocketlens-toward-a-personal-recommender-system/); [DOI](https://www.doi.org/10.1145/1010614.1010618)
- Result: offline experiments showed it runs on always-connected servers, usually-connected workstations, or occasionally connected portable devices, with accuracy "as good as the best published algorithms to date". Data stays on the device or is shared encrypted. — [UMN Experts](https://experts.umn.edu/en/publications/pocketlens-toward-a-personal-recommender-system/)
- Implication: this is the closest classic ancestor of on-device recommendation from peer data. It is strong evidence that occasionally connected devices exchanging profiles with peers need not lose accuracy.

**Bertier, Frey, Guerraoui, Kermarrec & Leroy. "The Gossple Anonymous Social Network." ACM/IFIP/USENIX Middleware 2010, LNCS 6452, pp. 191–211. DOI 10.1007/978-3-642-16955-7_10**
- Built: a network of *anonymous acquaintances*, meaning implicit links between people with shared interests who do not know each other. Nodes gossip digests of their profiles, estimate similarity, and keep a small set of the most similar peers, used to improve navigation and recommendation in apps like LastFM and Delicious. — [IFIP DL / HAL inria-00515693](https://dl.ifip.org/IFIP-LNCS-6452/inria-00515693); [HAL](https://hal.archives-ouvertes.fr/hal-01055283)
- Privacy and efficiency: each node picks a random proxy that gossips its profile on its behalf. The profile reaches the proxy encrypted, through an intermediary that cannot read it, so profiles are not linked to identities. Nodes exchange Bloom-filter digests rather than full profiles to save bandwidth. — [IFIP DL](https://dl.ifip.org/IFIP-LNCS-6452/inria-00515693)
- Scale: evaluated on real Web 2.0 traces with hundreds of PlanetLab hosts and thousands of simulated nodes. Low bandwidth and storage, fast convergence. — [IFIP DL](https://dl.ifip.org/IFIP-LNCS-6452/inria-00515693)
- Implication: this is the most direct precedent for "matches", meaning a small personal neighborhood of taste-similar peers. Its two techniques map directly onto encrypted taste sketches: Bloom-filter sketches cut bandwidth, and proxying breaks the link between profile and identity. It differs from the target design in one key way: Gossple neighbors are anonymous and chosen automatically, not opt-in or chosen by the user.

**Boutet, Frey, Guerraoui, Jégou & Kermarrec. "WhatsUp: A Decentralized Instant News Recommender." IEEE IPDPS 2013, pp. 741–752. DOI 10.1109/IPDPS.2013.47**
- Built: a P2P news recommender. Like/dislike feedback builds an implicit social network of similar users, and a heterogeneous gossip protocol (BEEP) favors similar peers while amplifying popular items more widely. — [EPFL Infoscience](https://infoscience.epfl.ch/record/199106)
- Result: evaluated by simulation, ModelNet cluster emulation and PlanetLab on real datasets. Outperforms alternatives on accuracy and completeness of delivering relevant items. — [EPFL Infoscience](https://infoscience.epfl.ch/record/199106)
- Implication: supports "circles with pooled picks" and discounted second-degree propagation. WhatsUp forwards items through the similarity graph with orientation and amplification controls, which is effectively multi-hop propagation with discounting. Its explore/exploit split is a useful pattern for avoiding filter bubbles.

**Boutet, Frey, Guerraoui, Jégou & Kermarrec. "Privacy-Preserving Distributed Collaborative Filtering." NETYS 2014; journal version in *Computing* 98(8):827–846, 2016. DOI 10.1007/s00607-015-0451-z**
- Built: a profile-obfuscation scheme plus a randomized dissemination protocol for decentralized CF. The authors characterize the conditions under which dissemination is differentially private. — [HAL](https://hal.archives-ouvertes.fr/hal-00975137); [EPFL Infoscience](https://infoscience.epfl.ch/record/208043)
- Result: obfuscated profiles remained useful for recommendation. Evaluation used a user-survey dataset, simulation and PlanetLab, and reported a reasonable privacy/accuracy trade-off, modest overhead, and resilience to a censorship attack. — [EPFL Infoscience](https://infoscience.epfl.ch/record/208043)
- Implication: shows that the sketches exchanged between matches can be deliberately coarsened or obfuscated, for example by sharing only popular or less-sensitive items, with little accuracy loss.

**Pouwelse et al., Tribler / BuddyCast. "BuddyCast: an Operational Peer-to-Peer Epidemic Protocol Stack" (2008); Yang et al., "An epidemic-based P2P recommender system" (2007), TU Delft**
- Built: Tribler, a social P2P file-sharing client compatible with BitTorrent. BuddyCast spreads peer and content information by gossip and lets users find "taste buddies". It implements decentralized user-based CF on download histories. — [Tribler wiki](https://tribler.org/DecentralizedRecommendation); [TU Delft BuddyCast](https://research.tudelft.nl/en/publications/buddycast-an-operational-peer-to-peer-epidemic-protocol-stack); [TU Delft epidemic recommender](https://research.tudelft.nl/en/publications/an-epidemic-based-p2p-recommender-system)
- Mechanism: each peer keeps (1) its top-N most similar peers with their download histories and (2) a list of random peers. It periodically contacts either a taste buddy (exploit) or a random peer (explore). — [Tribler wiki](https://tribler.org/DecentralizedRecommendation)
- What failed: the Tribler team's retrospective "The fifteen year struggle of decentralizing privacy-enhancing technology" (Jagerman, Sabée, Versluis, de Vos & Pouwelse, arXiv 1404.4818, 2014; author list checked via the arXiv API) covers lessons from deployment, and Tribler does not provide anonymity by default. Taste-buddy gossip exposes download histories to peers. — [arXiv 1404.4818](https://arxiv.org/pdf/1404.4818)
- Implication: this is the only long-running real-world deployment of gossip CF. The top-N plus random-exploration structure maps directly onto "matches plus discovery". Its plaintext history exchange is the privacy anti-pattern that encrypted sketches are meant to fix.

**Madhwal & Pouwelse. "Web3Recommend: Decentralised recommendations with trust and relevance." arXiv 2307.01411, 2023 (the PDF is headed "— MSc. Thesis —"; no peer-reviewed venue listed)**
- Built: an on-device (Android) decentralized social recommender for the MusicDAO music platform. It is based on Twitter's GraphJet and uses MeritRank decay parameters in personalized SALSA random walks. The abstract says "we can provide theoretical guarantees against Sybil Attacks" and "we provide the first Sybil-resistant Social Recommender System". Memory stays bounded by using only recent interactions. — [arXiv 2307.01411](https://arxiv.org/abs/2307.01411)
- What the Sybil claim rests on (full text read 2026-10-19): the thesis states no theorem of its own. The resistance comes from MeritRank's tunable "Alpha and Beta decays", each "used to limit the gains of a Sybil Attack". It describes MeritRank as aiming "to bound the benefits of Sybil attacks instead of preventing them altogether", i.e. Sybil *tolerance*. The cited source is Nasrulin, Ishmaev & Pouwelse, "MeritRank: Sybil tolerant reputation for merit-based tokenomics," BRAINS 2022, pp. 95–102 (citation as given in the thesis's reference list; not independently checked). — [arXiv PDF](https://arxiv.org/pdf/2307.01411v1)
- Results: the Sybil experiments run on a test network built from the taste-profile subset of the Million Song Dataset, against several adversarial strategies. No headline metrics are stated in the abstract. — [arXiv 2307.01411](https://arxiv.org/abs/2307.01411)
- Implication: a recent, very close analogue for on-device social recommendation with decay-based propagation, which corresponds to discounted second-degree propagation. MeritRank-style decay is a ready-made model for how to discount hop 2.

**Hegedűs, Danner & Jelasity. "Decentralized Recommendation Based on Matrix Factorization: A Comparison of Gossip and Federated Learning." ECML PKDD 2019 Workshops, Springer 2020, pp. 317–332; extended as "Decentralized learning works…", JPDC 148 (2021)**
- Built and showed: low-rank MF trained by gossip learning on private activity logs, with no central server. Comparable to federated learning in accuracy and communication, with the gap closing in larger networks, including under real mobile-phone churn traces. — [U. Szeged](https://rgai.inf.u-szeged.hu/node/382); [JPDC bib](https://www.inf.u-szeged.hu/~ihegedus/publ/jpdc20.bib)
- Implication: if the design ever adds a global latent model alongside peer-neighborhood CF, it can be gossip-trained without a server at little cost.

**Kermarrec, Leroy, Moin & Thraves. "Application of Random Walks to Decentralized Recommender Systems." OPODIS 2010 (Principles of Distributed Systems), Springer LNCS, pp. 48–63. DOI 10.1007/978-3-642-17653-1_4**
- Citation verified via [Crossref](https://api.crossref.org/works/10.1007/978-3-642-17653-1_4). Full text read from [HAL inria-00520214](https://inria.hal.science/inria-00520214/file/opodis10_HAL.pdf) (author version).
- Built: each peer forms a view of c similar peers with a gossip clustering protocol. Its neighborhood is then defined as "the peers directly connected and the peers connected within a distance of two hops", which can reach c² + c peers, because "Gathering information from only c peers is not enough to achieve good precision and high coverage due to data sparsity." A personalized random walk over this 2-hop neighborhood re-estimates similarities. They compare it with decentralized user- and item-based CF, Tribler and PocketLens. — [HAL PDF](https://inria.hal.science/inria-00520214/file/opodis10_HAL.pdf)
- Results (MovieLens 10M simulation): the random walk (P-RW) beats the other decentralized schemes on RMSE over a wide sparsity range. "Decentralized user-based approaches perform better than their item-based counterparts." Coverage with view = 30 and 5% of each profile used for training is 0.84 for P-RW vs. 0.70 for plain user-based CF and 0.75 for Tribler, rising to about 0.93–0.99 by 15–20% training profile. "Increasing the view size over 30 does not yield any significant improvement." — [HAL PDF](https://inria.hal.science/inria-00520214/file/opodis10_HAL.pdf)
- A random-walk survey credits Kermarrec et al. with gossip-based estimation of unseen neighbors. — [arXiv 1711.04101](https://arxiv.org/pdf/1711.04101)
- Implication: direct precedent for second-degree propagation. Its measured answer to "is hop 1 enough?" is no for sparse data: they deliberately add hop 2 to restore coverage, and the random walk over that 2-hop graph is what gains accuracy.

**Tveit. "Peer-to-peer based recommendations for mobile commerce." Proc. 1st Int. Workshop on Mobile Commerce (WMC '01, co-located with MobiCom 2001), pp. 26–29, 2001. DOI 10.1145/381461.381466**
- Describes "a Peer-to-Peer (P2P) based collaborative filtering architecture for the support of product and service recommendations for mobile customers", where software agents act as peers. — [DOI](https://doi.org/10.1145%2f381461.381466)
- Author (Amund Tveit), year and venue confirmed via [Crossref](https://api.crossref.org/works/10.1145/381461.381466) on 2026-10-19.

### Inferences
- The algorithmic core of the target design (a small similar-peer neighborhood, local computation, gossip exchange) has been validated repeatedly from 2004 to 2016. Its novelty must come from user-chosen peers, encrypted sketches, and the public-list and circle features, not from P2P CF itself.
- None of the classic systems relies on explicit, user-chosen peers as the neighborhood. They all discover neighbors automatically by similarity.

### Gaps
- Exact accuracy numbers (precision/recall vs. centralized) for Gossple, WhatsUp and PocketLens were not retrieved. The full texts are open access at the HAL, EPFL and ACM links above.
- No published post-mortem numbers on Tribler's recommender quality at production scale were found.

## 2. Privacy techniques for similarity and recommendation, and attacks on federated recommenders

### Takeaway
Every building block exists: PSI and PSI-cardinality for profile matching, homomorphic-encryption CF (Canny 2002), central-DP recommenders (McSherry & Mironov 2009), local-DP matrix factorization, and federated CF (Ammad-ud-din 2019). A design that exchanges "taste sketches" must assume rating vectors are highly identifying (Narayanan & Shmatikov). Federated and decentralized recommenders are demonstrably vulnerable to model-poisoning by a few malicious clients.

### Cited Findings (annotated bibliography)

**Narayanan & Shmatikov. "Robust De-anonymization of Large Sparse Datasets." IEEE S&P 2008 (arXiv cs/0610105)**
- Showed that statistical de-anonymization of sparse rating data works even with errors in the data. With 8 movie ratings (2 of which may be wrong) and dates within ±2 weeks, 99% of Netflix Prize records could be uniquely identified. IMDb cross-referencing exposed apparent political preferences. — [arXiv](https://arxiv.org/pdf/cs/0610105); [Schneier](https://www.schneier.com/?p=1974)
- Implication: plaintext taste lists or sketches are effectively identifiers. Public "taste lists" deanonymize their owner's other activity, and sketches sent to matches should be encrypted, aggregated, or noised.

**Canny. "Collaborative filtering with privacy." IEEE S&P (Oakland) 2002, pp. 45–57; companion "Collaborative filtering with privacy via factor analysis," SIGIR 2002**
- Built: a community aggregate model computed under homomorphic encryption. The public model protects individual data, and the protocol is peer-to-peer. — [Canny privacy page](https://people.eecs.berkeley.edu/~jfc/privacy/); [SIGIR 2002 anthology](https://ir.webis.de/anthology/2002.sigirconf_conference-2002.32/)
- Implication: the canonical precedent for "users compute an aggregate over encrypted data without a trusted server". It applies to circles with pooled picks, where a circle aggregate can be computed homomorphically so no member's individual picks are revealed.

**McSherry & Mironov. "Differentially Private Recommender Systems: Building Privacy into the Netflix Prize Contenders." KDD 2009, pp. 627–636. DOI 10.1145/1557019.1557090**
- Built: DP versions of leading Netflix Prize algorithms, with the learning of item-item correlations made DP and per-user recommendation done afterwards from those correlations. — [Microsoft Research](https://microsoft.com/en-us/research/?p=157447); [BibSonomy](https://www.bibsonomy.org/bibtex/b6a64d87ad51f6cbb15abec1e96b7471)
- Result: the private versions kept most of their accuracy and still beat Netflix's Cinematch baseline. — [Microsoft Research](https://microsoft.com/en-us/research/?p=157447)
- Implication: the global/local split matches the target design. Aggregate statistics such as item co-occurrence across public taste lists can be published with DP, while per-user ranking stays on the device.

**Local DP matrix factorization**
- Hua, Xia & Zhong, "Differentially Private Matrix Factorization," IJCAI 2015: keeps user computation local so the recommender never learns individual ratings. — [IJCAI](https://www.ijcai.org/Abstract/15/251)
- Friedman, Berkovsky & Kaafar (2016): compared DP perturbation points in MF and found input perturbation gave the best accuracy while protecting individual ratings. — [Macquarie](https://researchers.mq.edu.au/en/publications/a-differential-privacy-framework-for-matrix-factorization-recomme/)
- Neera et al., IEEE TKDE 2023: LDP-based MF with a bounded Laplace mechanism. They note that "LDP … causes a substantial decline in recommendation accuracy", and they recover some of it at the server with a Gaussian mixture model. — [Northumbria](https://researchportal.northumbria.ac.uk/en/publications/private-and-utility-enhanced-recommendations-with-local-different/)
- (Shin et al., "Privacy Enhanced Matrix Factorization for Recommendation with Local Differential Privacy," IEEE TKDE 2018, is widely cited but its record was not surfaced in this search; see Gaps.)
- Implication: per-sketch LDP noise costs accuracy, and with only k peers there is no large population to average the noise away. For small match sets, encryption or PSI-style computation is a better fit than LDP.

**Ammad-ud-din et al. "Federated Collaborative Filtering for Privacy-Preserving Personalized Recommendation System." arXiv 1901.09888, 2019**
- Built: the first federated implementation of CF, an implicit-feedback MF where item factors are updated centrally from client gradients and user factors never leave the device. — [arXiv](https://web3.arxiv.org/abs/1901.09888)
- Result: tested on MovieLens and an in-house dataset with no accuracy loss vs. the standard implementation. An OpenMined summary reports differences under 0.5% on MAP, F1, precision and recall, and flags shipping the full item inventory to devices as an engineering problem. — [ar5iv](https://ar5iv.labs.arxiv.org/html/1901.09888); [OpenMined](https://openmined.org/?p=2433)
- Implication: the main contrasting architecture, which still needs a central aggregator. The target design avoids that aggregator, consistent with the FedRS survey's call for peer-to-peer FedRS (below).

**Federated recommendation survey: "A Survey on Federated Recommendation Systems," arXiv 2301.00767 (2023)**
- Notes that most FedRS are client-server, with single-point-of-failure and privacy issues, and names peer-to-peer communication (citing Hegedűs et al. gossip MF) as a direction for fully decentralized federated recommendation. — [arXiv 2301.00767](https://arxiv.org/pdf/2301.00767)

**Attacks on federated recommenders**
- PipAttack (Zhang et al., arXiv 2110.10926, 2021): malicious clients upload crafted gradients that make an unpopular target item look popular in embedding space, increasing its exposure. It needs popularity knowledge and is reported to require about 10% malicious users. — [ar5iv](https://ar5iv.labs.arxiv.org/html/2110.10926); [UQ](https://eecs.uq.edu.au/node/6773); critique in [FedRecAttack](https://arxiv.org/pdf/2204.01499)
- FedRecAttack (Rong et al., arXiv 2204.01499, ICDE 2022): uses public interactions such as likes and follows to approximate user embeddings, then poisons with few malicious clients and minimal side effects. — [arXiv 2204.01499](https://arxiv.org/abs/2204.01499v2)
- Surveys: these attacks lose much of their effectiveness without prior knowledge. — [FedRS survey](https://arxiv.org/pdf/2301.00767). Broader coverage: "Poisoning Attacks and Defenses in Recommender Systems: A Survey" (arXiv 2406.01022) and Spattack, subgroup poisoning of FedRS (arXiv 2507.06258). — [arXiv 2406.01022](https://arxiv.org/pdf/2406.01022); [arXiv 2507.06258](https://arxiv.org/pdf/2507.06258)
- Implication: FedRecAttack shows that **public interaction data, such as public taste lists, can be used as attack side-information**. Public lists make targeted promotion attacks easier.

**Private set intersection / PSI-cardinality for profile matching**
- Private friend matching in mobile social networks has two main lines. One treats profiles as attribute sets and uses PSI or PCSI (private cardinality of set intersection). The other treats them as vectors and uses private dot products. PSI reveals the actual intersection regardless of similarity. PSI-CA is coarse-grained. Public-key and homomorphic schemes are costly or need a trusted third party. — ["Message in a Sealed Bottle," arXiv 1207.7199](https://arxiv.org/pdf/1207.7199)
- FindU (Li et al., INFOCOM 2011): privacy-preserving personal profile matching in mobile social networks. — [FindU PDF](https://www.cnsr.ictas.vt.edu/publication/INFOCOM11_Li_FindU.pdf)
- Critiques: intersection and cardinality schemes "can still reveal users' privacy". — [arXiv 1207.7199](https://arxiv.org/pdf/1207.7199)
- Implication: PSI-CA, or a private Jaccard estimate over MinHash or Bloom sketches, is the established way to score candidate matches before revealing anything. Repeated PSI-CA queries with crafted sets leak membership, so the design needs rate limits or query auditing.

### Inferences
- A plausible privacy stack: PSI-CA or private-dot-product to score candidate matches; encrypted sketches (Bloom or MinHash, as in Gossple) exchanged only with accepted matches; homomorphic or secure aggregation for circle-pooled picks (as in Canny); and DP only on global aggregates (as in McSherry & Mironov), not per-peer.
- Public taste lists are both a de-anonymization risk (Narayanan & Shmatikov) and poisoning side-information (FedRecAttack).

### Gaps
- The Shin et al. 2018 TKDE LDP-MF paper was not confirmed in search results. Verify via DBLP before citing.
- No paper was found that quantifies leakage from repeated PSI-CA similarity queries specifically in recommender matching.

## 3. Sybil and shilling resistance

### Takeaway
Classic CF is highly vulnerable to profile-injection (shilling). Social-graph Sybil defenses (SybilGuard, SybilLimit) and DSybil give provable bounds by exploiting trust edges or the heavy-tailed behavior of honest voters. Trust-propagation recommenders and decay-based random walks (MeritRank, Web3Recommend) are the decentralized analogues. A design where each user only listens to explicitly chosen peers inherits strong Sybil resistance for hop 1. The risk concentrates in second-degree propagation and public lists.

### Cited Findings (annotated bibliography)

**Gunes, Kaleli, Bilge & Polat. "Shilling attacks against recommender systems: a comprehensive survey." Artificial Intelligence Review 42(4):767–799, 2014 (online 2012). DOI 10.1007/s10462-012-9364-9**
- Surveys profile-injection (push/nuke) attacks on CF, attack taxonomies, detection, and robust algorithms. Fake profiles injected into the user-item matrix shift predictions. — [Akdeniz](https://avesis.akdeniz.edu.tr/yayin/35ef12f6-86fb-4fa0-b5e4-9faf9a318931/shilling-attacks-against-recommender-systems-a-comprehensive-survey); [Anadolu](https://earsiv.anadolu.edu.tr/xmlui/handle/11421/19873)
- Implication: similarity-based automatic neighbor selection, as in Gossple and WhatsUp, is exactly what shilling exploits. An attacker builds a profile similar to the target's to become their neighbor. User-chosen matches remove this vector unless match suggestion itself is similarity-driven.

**Yu, Kaminsky, Gibbons & Flaxman. "SybilGuard: Defending Against Sybil Attacks via Social Networks." ACM SIGCOMM 2006 (journal version IEEE/ACM ToN 2008)**
- Uses the social trust graph, where edges are real human trust relationships, to bound the Sybil nodes accepted, without a central identity authority. — [SIGCOMM PDF](https://www.comp.nus.edu.sg/~yuhf/sybilguard-sigcomm06.pdf); [ToN PDF](https://www.comp.nus.edu.sg/~yuhf/sybilguard-ton08.pdf)
- SybilLimit (Yu, Gibbons, Kaminsky & Xiao, IEEE S&P 2008) tightened SybilGuard's bound, because SybilGuard could accept a large number of Sybil nodes. — [SybilLimit PDF](https://www.comp.nus.edu.sg/~yuhf/yuh-sybillimit.pdf)
- Implication: a graph of opt-in matches is a trust graph. Few attack edges (honest users accepting Sybil matches) limit the reach of Sybils, provided propagation follows graph structure, for example with random-walk-length limits and decay.

**Yu, Shi, Kaminsky, Gibbons & Xiao. "DSybil: Optimal Sybil-Resistance for Recommendation Systems." IEEE S&P 2009, pp. 283–298**
- Proved worst-case-optimal bounds on Sybil influence in recommendation, using the heavy-tailed voting behavior of honest users and adaptive trust weighting of voters. Course notes summarize the loss bound as O(D log M), with D under 10 for Digg. — [Tech report](https://www.comp.nus.edu.sg/~yuhf/09yuoaklandtr.pdf); [DBLP](https://dblp1.uni-trier.de/rec/conf/sp/YuSKGX09.html); [Yale course notes](https://zoo.cs.yale.edu/classes/cs722/2011/Ennan-DSybil.pdf)
- Result: high-quality recommendations remained even against a million-node botnet using an optimal strategy. — [Tech report](https://www.comp.nus.edu.sg/~yuhf/09yuoaklandtr.pdf)
- Implication: DSybil's per-user trust learning (weighting a source up when its past recommendations were good) can be applied directly to peers and to taste lists. Each device can learn per-match weights from feedback.

**Trust-based recommenders as shilling defenses**
- Massa & Avesani, "Trust-aware Recommender Systems," RecSys 2007: replace similarity with propagated trust (see §4). — [gnuband PDF](https://www.gnuband.org/files/papers/trustaware_recommender_systems_paolo_massa.pdf)
- Web3Recommend / MeritRank: decay-parameterized personalized SALSA, which the authors claim gives Sybil-resistance guarantees (see §1). — [arXiv 2307.01411](https://arxiv.org/abs/2307.01411)

### Inferences
- Discounted second-degree propagation should use decay that caps the total influence any single first-degree peer can channel, in the style of MeritRank or personalized PageRank with restart. Otherwise one compromised or Sybil-befriending match becomes an amplifier.
- Pooled circle picks are a voting system, so DSybil-style weighting of members by track record applies.

### Gaps
- No peer-reviewed empirical study was found of shilling against opt-in friend-only P2P recommenders specifically.
- Web3Recommend's Sybil-resistance claim comes from an arXiv preprint. Its peer-review status is unknown.

## 4. Do trust- or friend-based recommendations perform comparably to global CF? Cold-start and coverage with small neighborhoods

### Takeaway
Yes, in taste domains such as movies, books and music, with caveats. Friends gave better recommendations than online systems in a 2001 user study. Social filtering beat CF in a taste domain (Groh & Ehmig 2007). Trust propagation improved accuracy and coverage for cold-start users on Epinions (Massa & Avesani; TrustWalker). The consistent weaknesses: friend-only recommendations are less novel, and coverage depends heavily on propagation beyond direct contacts. This supports adding second-degree propagation and public lists.

### Cited Findings (annotated bibliography)

**Sinha & Swearingen. "Comparing Recommendations Made by Online Systems and Friends." DELOS-NSF Workshop on Personalization and Recommender Systems in Digital Libraries, Dublin, 2001**
- User study of 3 book recommenders (Amazon, RatingZone, Sleeper) and 3 movie recommenders (Amazon, MovieCritic, Reel.com). Friends consistently gave better recommendations, while systems gave more new and unexpected items. Friends mostly reminded users of things they already liked. — [ERCIM PDF](https://www.ercim.eu/publication/ws-proceedings/DelNoe02/RashmiSinha.pdf)
- Caveat: the compared systems differed on many dimensions. — [RecSysWiki](https://recsyswiki.com/wiki/Beyond_Algorithms:_An_HCI_Perspective_on_Recommender_Systems)
- Implication: match-based recommendations should be accurate but low-novelty. Public taste lists and circles should be the discovery channel.

**Groh & Ehmig. "Recommendations in taste related domains: collaborative filtering vs. social filtering." ACM GROUP 2007, pp. 127–136. DOI 10.1145/1316624.1316643**
- Replaced CF's rating-similarity neighborhoods with subgraphs of each user's social network. Social filtering outperformed CF in all variants of the experiment (rating clubs, a taste domain). A later chapter says the approach "works very well in taste related domains" but performs less well in factual domains with sparse social data. — [BibSonomy](https://www.bibsonomy.org/bibtex/bfb1b4759b0e34f6d878aa394a6d3436?lang=en); [Springer chapter](https://link.springer.com/doi/10.1007/978-3-642-25694-3_1)
- Implication: **the strongest direct evidence** that recommending from a user's own social neighborhood can beat global CF for taste content such as video, music and books.

**Massa & Avesani. "Trust-aware Recommender Systems." ACM RecSys 2007, Minneapolis**
- Replaced the similarity step of CF with a trust metric propagated over the explicit trust network. On Epinions (~49k users with explicit trust webs), trust-based recommenders were most effective in accuracy "while preserving a good coverage … especially evident on users who provided few ratings". Earlier work found that asking a new user for a few trust statements is a very effective cold-start bootstrap. — [gnuband PDF](https://www.gnuband.org/files/papers/trustaware_recommender_systems_paolo_massa.pdf); [FBK](https://cris.fbk.eu/handle/11582/45185); [Springer 2004](https://www.springerprofessional.de/en/trust-aware-collaborative-filtering-for-recommender-systems/14260580)
- Implication: directly supports "choose a few matches" as the cold-start mechanism. A handful of explicit peer links beats rating-similarity for new users. Their work also shows that propagating trust beyond depth 1 is what restores coverage, which justifies discounted second-degree propagation.

**Golbeck. TidalTrust / FilmTrust (2005 dissertation, "Computing and Applying Trust in Web-based Social Networks," UMD; FilmTrust papers 2006)**
- Trust-inferred ratings were more accurate than a simple average and correlation-based CF, chiefly for users whose opinions diverge from the average. — [UMD DRUM](https://drum.lib.umd.edu/items/28ef1e3b-eb79-4586-83f1-e18b10694750/full); [DOI 10.1007/11755593_8](https://www.doi.org/10.1007/11755593_8)
- Caveat: a later analysis notes that low errors partly reflect users rating near the average, and reports an average recall of 19.36% for TidalTrust. — [arXiv 1011.2245](https://arxiv.org/pdf/1011.2245)
- Implication: the gains from peer-based recommendation are concentrated among users with distinctive taste, which is the core audience for opt-in taste matching.

**Jamali & Ester. "TrustWalker: a random walk model for combining trust-based and item-based recommendation." KDD 2009, pp. 397–406. DOI 10.1145/1557019.1557067; also "Using a trust network to improve top-N recommendation," RecSys 2009**
- A random walk over the trust network from the target user, which can switch to similar items. Aimed at cold-start users with few ratings, it returns a confidence score per prediction. Evaluated on Epinions. The RecSys 2009 companion paper improves top-N recall for cold-start users. — [BibSonomy](https://www.bibsonomy.org/bibtex/63af456edb3a10b51e523e3cc167f49d); [arXiv 2407.00062 summary](https://arxiv.org/html/2407.00062v2); [Liner review](https://liner.com/review/using-trust-network-to-improve-topn-recommendation)
- Implication: a template for second-degree propagation. Walk from self to matches to their matches with a stopping probability (the discount), and fall back to item similarity when the trust walk runs dry.

**Victor et al. (distrust in trust-based recommendation)**
- Adding explicit distrust to Golbeck's trust-weighted mean improves on trust-only recommendation on Epinions. — [Victor et al. PDF](https://faculty.washington.edu/mdecock/papers/pvictor2013z.pdf)
- Implication: consider a "mute" or anti-match signal.

### Inferences
- With k small (5–20 matches), hop-1 coverage will be limited. The literature consistently shows that trust propagation (depth 2–3) and item-similarity fallback are needed to restore coverage, which supports the design's second-degree propagation and public lists.
- Peer-based recommendation is likely more accurate for niche-taste users and less novel overall.

### Gaps
- No source retrieved gives specific coverage percentages versus k, the neighborhood size, for friend-only recommendation. Full texts of Massa & Avesani 2007 and Jamali & Ester 2009 contain coverage-by-trust-depth tables and should be consulted.
- No large-scale industrial A/B result comparing friend-only and global CF was found.

## 5. Prior research proposing almost exactly this design (opt-in peer taste sharing)

### Takeaway
STRONG FLAG: "friendship-based" privacy-preserving recommenders (Jeckmans et al., ESORICS 2013; revisited by Tang & Wang 2015) compute a user's recommendations from **their friends plus a few random strangers**, using homomorphic encryption. This is very close to "matches exchanging encrypted taste sketches". Gossple (anonymous taste neighbors with encrypted, Bloom-filtered profiles), PocketLens (on-device P2P CF), Web3Recommend (on-device social recommendation with decay-based Sybil resistance) and Groh & Ehmig (social-network neighborhoods instead of CF) cover most other components. No paper was found that combines all elements: user-chosen matches, encrypted sketches, public taste lists, circles with pooled picks, and discounted hop-2 propagation.

### Cited Findings
- **Tang & Wang, "Privacy-preserving friendship-based recommender systems," IACR ePrint 2015/1152** (published in IEEE TDSC per author records; venue not verified here): revisits Jeckmans et al.'s friendship-based recommender and says it works well because it uses only a small subset of users, friends plus some random strangers. Provides corrected, cryptographically secure protocols. — [ePrint 2015/1152](https://eprint.iacr.org/2015/1152)
- **Tang & Wang, ePrint 2015/364**: revisits the protocols of Jeckmans et al. (ESORICS 2013), finds security and usability problems, and proposes two protocols that predict ratings from friends plus randomly chosen strangers. — [ePrint 2015/364](https://eprint.iacr.org/2015/364)
- Jeckmans, Peter, Hartel (ESORICS 2013), "Efficient privacy-enhanced familiarity-based recommender system": the original paper itself was not retrieved. Its existence and venue are confirmed only through the Tang & Wang references above.
- Restricting preference exposure to social contacts in a P2P recommender, so preferences are not exposed system-wide (TU Darmstadt KOM, 2009). — [TU Darmstadt PDF](https://www.kom.tu-darmstadt.de/papers/PKFS09_567.pdf)
- Hybrid P2P recommender keeping each user's preferences on their own device, with limited, anonymized disclosure between peers (SCITEPRESS 2015). — [SCITEPRESS](https://www.scitepress.org/Papers/2015/53769/53769.pdf)
- Community-based P2P online social network with broadcast encryption and a recommendation mechanism (arXiv 1706.01324). — [arXiv 1706.01324](https://arxiv.org/pdf/1706.01324)
- Gossple, PocketLens, Web3Recommend, Groh & Ehmig: see §1 and §4.

### Inferences
- The "friends plus random strangers" pattern in the friendship-based recommender literature is the closest match to "matches plus discovery". It suggests that adding a few random or stranger sketches improves both accuracy and privacy (plausible deniability).
- Any patent or novelty claim should be scoped to the combination (public taste lists, circles with pooled picks, discounted hop-2 under encryption, and user-chosen matches), since each part has precedent.

### Gaps
- The full text of Jeckmans et al. ESORICS 2013 and Tang & Wang's TDSC version were not retrieved, so their accuracy and cost numbers are not given here.
- No dedicated 2020–2026 survey of P2P (as opposed to federated or distributed) recommenders was found. The closest surveys are: Cai et al., "Distributed recommendation systems: Survey and research directions," ACM TOIS 2024 ([EdUHK](https://repository.eduhk.hk/en/publications/distributed-recommendation-systems-survey-and-research-directions/)); "On-Device Recommender Systems: A Comprehensive Survey" (arXiv 2401.11441) ([arXiv](https://arxiv.org/pdf/2401.11441)); the FedRS survey arXiv 2301.00767 ([arXiv](https://arxiv.org/pdf/2301.00767)); and the DESERE 2024 workshop on decentralised search and recommendation ([arXiv 2403.07732](https://arxiv.org/pdf/2403.07732)).
