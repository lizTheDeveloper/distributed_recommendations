# Source verification for docs/DESIGN.md (Match Feed: distributed recommendations for federated video)

Scope: each source cited in `/home/user/distributed_recommendations/docs/DESIGN.md` (numbered [1]–[10] plus the uncited VPPA reference). For each one: the exact citation, what the source actually says, and a verdict on every DESIGN.md claim that relies on it (ACCURATE / OVERSTATED / WRONG / MISCITED). Retrieved 2026-10-19.

Summary of verdicts:

| Ref | Claim in DESIGN.md | Verdict |
|---|---|---|
| [5] Calandrino et al. 2011 | individual transactions can be inferred from outputs of item-to-item recommenders | ACCURATE (needs the caveats: auxiliary info plus outputs observed over time) |
| [6] Narayanan & Shmatikov 2008 | Netflix Prize "anonymous" ratings were re-identified | ACCURATE |
| [7] Bonawitz et al. 2017 | lets a circle of k ≥ 5 pool endorsements so picks "can't be attributed to any one person" | OVERSTATED: SecAgg hides individual inputs from the aggregator, but the sum itself can attribute picks when k is small. With n = 5 the CCS paper's parameters tolerate at most 1 colluding member (t ≥ 4) |
| [8] Douceur 2002 | "Bot farms and Sybil accounts are what break open recommenders" | MISCITED / OVERSTATED: Douceur is about P2P identity and redundancy, not recommenders. Lam & Riedl, WWW 2004 (verified) is a recommender-specific replacement |
| [9] Kamvar et al. 2003 | trust metric "seeded from your own node, in the style of EigenTrust" | PARTLY ACCURATE: EigenTrust computes global trust anchored on pre-trusted peers; seeding it from your own node makes it personalized PageRank (Page et al. 1998/1999 §6; Haveliwala 2002; Jeh & Widom 2003, all verified) |
| [10] Canny 2002 | cited inline for "personalized PageRank" | WRONG (citation mismatch). Its Sources-list description ("early decentralized, privacy-preserving CF") is ACCURATE (now checked against the full text) |
| [3] NIP-71 | "video events exist (NIP-71)"; "kind numbers differ across sources" | ACCURATE. Current spec defines kinds 21/22 and also 34235/34236; the pre-2025 spec used only 34235/34236 (verified from historical file versions) |
| [3] Nostr encrypted DMs | "encrypted DMs" | ACCURATE if this means NIP-17 + NIP-44. NIP-04 is deprecated |
| [4] AT Protocol feeds | feed generators are servers that see requests; repos are public | ACCURATE |
| [1][2] PeerTube community efforts | Picks = cosine similarity over local history; a proposed instance-level plugin; none use other people's taste | MOSTLY ACCURATE (one internal inconsistency, and [2] mislabels a Lemmy post as a "discussion") |
| PeerTube built-ins | "no official personalized recommender"; P2P delivery; mirroring | ACCURATE |
| VPPA | passive history is treated specially by 18 U.S.C. § 2710 | ACCURATE as to the statute. Whether it applies to this app is unclear (see section) |

---

## Q1. Calandrino, Kilzer, Narayanan, Felten, Shmatikov — "You Might Also Like" [5]

### Takeaway
The claim is accurate. The paper shows that individual users' transactions can be inferred from the public outputs of item-to-item collaborative filtering. The attacker needs two things: a moderate amount of auxiliary knowledge about the target, and a view of how the related-items outputs *change over time*. DESIGN.md should mention both conditions.

### Cited Findings
- Exact citation: Joseph A. Calandrino, Ann Kilzer, Arvind Narayanan, Edward W. Felten, Vitaly Shmatikov. "'You Might Also Like:' Privacy Risks of Collaborative Filtering." 2011 IEEE Symposium on Security and Privacy, pp. 231–246, May 2011. DOI 10.1109/SP.2011.40 — [Crossref](https://api.crossref.org/works/10.1109/SP.2011.40); full text read from [gwern.net mirror of the authors' UT PDF](https://gwern.net/doc/www/www.cs.utexas.edu/b8215c7143f80e1e0b7b26c451a5492ce900384d.pdf). The authors' own URL (https://www.cs.utexas.edu/~shmat/shmat_oak11ymal.pdf) returned 404, and ieee-security.org reset the connection.
- Abstract: the algorithms "take a moderate amount of auxiliary information about a customer and infer this customer's transactions from temporal changes in the public outputs of a recommender system. Our inference attacks are passive and can be carried out by any Internet user." Evaluated on Hunch, Last.fm, LibraryThing, and Amazon — [paper](https://gwern.net/doc/www/www.cs.utexas.edu/b8215c7143f80e1e0b7b26c451a5492ce900384d.pdf)
- The paper explicitly targets item-to-item CF: "We focus on item-to-item collaborative filtering … Our key insight is to exploit the dynamics of public recommendations in order to make the leap from aggregate to individual data." Access is passive and black-box. The attacker "need not create fake customers or enter purchases or ratings." The authors say this differs from re-identifying anonymized records — [paper](https://gwern.net/doc/www/www.cs.utexas.edu/b8215c7143f80e1e0b7b26c451a5492ce900384d.pdf)
- Numbers: Hunch, optimized for accuracy, inferred "a third of the test users' secret answers … with no error". LibraryThing ranged from 58 inferences/user at 50% accuracy to 6 inferences/user at 90% accuracy. A simulated Amazon-like item-to-item engine run on the Netflix Prize data inferred "4.5% of transactions of sufficiently active users with an accuracy of 90%" — [paper](https://gwern.net/doc/www/www.cs.utexas.edu/b8215c7143f80e1e0b7b26c451a5492ce900384d.pdf)
- The paper discusses mitigations, including differential privacy, and notes that each mitigation has limitations — [paper](https://gwern.net/doc/www/www.cs.utexas.edu/b8215c7143f80e1e0b7b26c451a5492ce900384d.pdf)

### Inferences
- The DESIGN.md wording ("individual transactions can be inferred from the outputs of item-to-item recommenders") is faithful. A more precise version: "…from temporal changes in public item-to-item outputs combined with auxiliary knowledge of some of the target's transactions."
- This applies directly to Circles and second-degree picks. A circle member who knows some of a peer's endorsements, and who watches the group picks change from round to round, is in exactly the attacker position this paper describes. That is one more reason why secure aggregation alone is not enough (see Q3).

### Gaps
- I did not read the IEEE Xplore version, only the author-hosted preprint mirror. Page numbers come from Crossref.

---

## Q2. Narayanan & Shmatikov — "Robust De-anonymization of Large Sparse Datasets" [6]

### Takeaway
The claim is accurate, and the citation details are correct. A few ratings plus approximate dates are enough to uniquely identify almost all records in the Netflix Prize dataset. Using public IMDb ratings, the authors matched real users to their Netflix records.

### Cited Findings
- Exact citation: Arvind Narayanan, Vitaly Shmatikov. "Robust De-anonymization of Large Sparse Datasets." 2008 IEEE Symposium on Security and Privacy (SP 2008), pp. 111–125, May 2008. DOI 10.1109/SP.2008.33 — [Crossref](https://api.crossref.org/works/10.1109/SP.2008.33)
- The arXiv preprint has a different title: "Robust De-anonymization of Large Datasets (How to Break Anonymity of the Netflix Prize Dataset)", arXiv:cs/0610105v2 (22 Nov 2007). I read this version — [arXiv](https://arxiv.org/pdf/cs/0610105)
- The dataset contains "anonymous movie ratings of 500,000 subscribers of Netflix". Using IMDb as background knowledge, "we successfully identified the Netflix records of known users, uncovering their apparent political preferences and other potentially sensitive information." — [arXiv](https://arxiv.org/pdf/cs/0610105)
- Key numbers: "With 8 movie ratings (of which 2 may be completely wrong) and dates that may have a 14-day error, 99% of records [can] be uniquely identified." If the known movies are outside the top 500, "84% of subscribers can be uniquely identified if the adversary knows 6 out of 8" — [arXiv](https://arxiv.org/pdf/cs/0610105)
- The IMDb validation used only "a very small sample of a few dozen IMDb users" (because of IMDb's terms of service), so the paper makes no claim about what percentage of IMDb users can be identified — [arXiv](https://arxiv.org/pdf/cs/0610105)

### Inferences
- This directly supports the DESIGN.md line "assume that sketches and scores are identifying". A taste sketch of endorsements and finished watches is the same kind of sparse, high-dimensional micro-data.

### Gaps
- I did not read the IEEE camera-ready version, only the arXiv v2. The numbers above come from arXiv and may differ slightly from the published version.

---

## Q3. Bonawitz et al. — "Practical Secure Aggregation for Privacy-Preserving Machine Learning" [7]

### Takeaway
The claim is overstated. Secure aggregation (SecAgg) lets a *server* learn only the sum of user vectors, and it tolerates users dropping out. It does not make the sum itself unattributable. In a circle of k = 5, the published sum can still reveal individual endorsements: a count of 5 means everyone endorsed the item, members know their own inputs, colluders can subtract their own contributions, and changes in membership allow differencing. The protocol was also designed for a server-mediated setting with hundreds to thousands of users. Calling it "usable" for P2P circles is reasonable. Calling the results "can't be attributed to any one person" is not. The CCS paper's own parameter table makes the small-k problem concrete: with n = 5, protection against a server colluding with members requires t ≥ 4, which tolerates only 1 colluding member and 1 dropout.

### Cited Findings
- Exact citation: Keith Bonawitz, Vladimir Ivanov, Ben Kreuter, Antonio Marcedone, H. Brendan McMahan, Sarvar Patel, Daniel Ramage, Aaron Segal, Karn Seth. "Practical Secure Aggregation for Privacy-Preserving Machine Learning." Proceedings of the 2017 ACM SIGSAC Conference on Computer and Communications Security (CCS '17), pp. 1175–1191, 30 Oct 2017. DOI 10.1145/3133956.3133982 — [Crossref](https://api.crossref.org/works/10.1145/3133956.3133982); also IACR ePrint 2017/281 — [ePrint](https://eprint.iacr.org/2017/281)
- Abstract (paraphrased from the ePrint page): a communication-efficient, failure-robust protocol that lets "a server to compute the sum of large, user-held data vectors" without learning individual contributions. Security is proven in the honest-but-curious and malicious settings, and holds even if an arbitrarily chosen subset of users drops out. Communication expansion is 1.73× for 2^10 users with 2^20-dimensional vectors, and 1.98× for 2^14 users with 2^24-dimensional vectors (16-bit inputs) — [ePrint](https://eprint.iacr.org/2017/281)
- The 2016 workshop precursor ("Practical Secure Aggregation for Federated Learning on User-Held Data", arXiv:1611.04482) describes a model with "a single server S and a collection of n users". The server learns the sum for a surviving subset |Ū| ≥ n/2, in a "server-mediated, unauthenticated network model". All threat models in that version assume users follow the protocol, and the server is honest-but-curious, lies about dropouts, or reads a limited number of users' memory — [arXiv 1611.04482](https://arxiv.org/pdf/1611.04482)
- The workshop version also states: "We can now guarantee security in Threat Model T1 for t > n/2 … in Threat Models T2 and T3 the thresholds must be raised to 2n/3 and 4n/5 correspondingly" — [arXiv 1611.04482](https://arxiv.org/pdf/1611.04482)
- **CCS full text (read 2026-10-19 from the conference's own mirror, [acmccs.github.io/papers/p1175-bonawitzA.pdf](https://acmccs.github.io/papers/p1175-bonawitzA.pdf)):**
  - Setting: "The protocol is run (in a synchronous network) between a server and a set of n users … the server will be able to produce a correct output as long as t of them survive until the last round." Shares of each user's mask seed and self-mask are Shamir t-out-of-n shares. Security against active adversaries additionally assumes a PKI ("all clients receive as input (from a trusted third party) public signing keys for all other clients").
  - Rounds: the text says the protocol "consists of four rounds"; Figure 4 numbers Round 0 (AdvertiseKeys), Round 1 (ShareKeys), Round 2 (MaskedInputCollection), Round 3 (ConsistencyCheck) and Round 4 (Unmasking). ConsistencyCheck is used only in the active-adversary variant ("we can avoid the use of signatures and the need for a PKI (which, most notably, allows us to avoid the ConsistencyCheck round entirely)"), so the honest-but-curious variant has four rounds and the active variant one more.
  - Theorem 6.3 (honest-but-curious server colluding with clients) requires |C \ {S}| < t: "the view to be simulated must contain fewer than t honest-but-curious clients, or else we cannot guarantee security." Theorem 6.5 (active adversaries including the server) requires 2t > n + n_C.
  - Figure 5 parameterization (minimum t): client-only adversary 1; server-only adversary ⌊n/2⌋+1; clients–server collusion ⌊2n/3⌋+1. §6.3.2: with no corrupt clients, t ≥ ⌊n/2⌋+1 lets the protocol "deal with up to ⌈n/2⌉−1 dropouts". §6.3.3: the server may collude with "up to n_C = ⌈n/3⌉−1 users … if we set t ≥ ⌊2n/3⌋+1", the sum then contains at least n/3 clients' values, and "the protocol is robust to up to ⌈n/3⌉−1 users dropping out."
  - Incidentally, the paper's introduction motivates the work with the 1988 Bork video-rental disclosure and the law passed in response (the VPPA, see Q10).
- (Earlier note: an SNU seminar deck on the paper was found via search but could not be downloaded, proxy 502. It is no longer needed now that the CCS full text has been read.)

### Inferences
- **Needs an aggregator role.** A circle has to elect or rotate a member, or use a relay, to act as "the server". Applying the CCS Figure 5 parameters to n = 5 (my arithmetic): against the aggregator alone, t = 3, so 3 of 5 members must stay online through the last round (at most 2 dropouts). If the aggregator might collude with members, t = 4, which tolerates only 1 colluding member and 1 dropout. Both are hard on mobile. The aggregator colluding with two or more other members is outside the guarantee; in a circle the aggregator is itself a member, so that is three of five members. (Separately, the output-leakage point below means even in-scope parties learn a lot from the sum when k is small.)
- **Output leakage is out of scope for SecAgg.** SecAgg protects the inputs, not the output. With binary endorsements and k = 5, any item with count 5, or count k−1 combined with knowledge of one member's input, attributes the endorsement. Two members can recover a third's input by subtracting their own. Calandrino-style differencing across rounds (Q1) also applies. Mitigations to add to the design: a minimum count threshold before an item is revealed, differential-privacy noise on the sum, fixed membership per round, and a k well above 5.
- Canny 2002 [10] (Q6) is a closer precedent for Circles than Bonawitz. It is a community-computed aggregate for CF, using homomorphic encryption, with verification, explicitly peer-to-peer.

### Gaps
- Resolved 2026-10-19: the CCS thresholds and round count above are now verified from the CCS camera-ready PDF on acmccs.github.io (ePrint and ACM DL still serve Cloudflare challenge pages). The paper defers the full active-security proofs to "the full version", which I did not read.

---

## Q4. Douceur — "The Sybil Attack" [8]

### Takeaway
Miscited and overstated. Douceur does not discuss recommenders at all. The paper proves that in a distributed system without a logically centralized identity authority, one entity can always present many identities, except under unrealistic assumptions. That actually supports DESIGN.md's match-only, trust-from-your-own-node approach better than the sentence it is attached to. The claim "Sybil accounts are what break open recommenders" needs a recommender-specific source.

### Cited Findings
- Exact citation: John R. Douceur. "The Sybil Attack." In Peer-to-Peer Systems (IPTPS 2002), Lecture Notes in Computer Science vol. 2429, Springer, 2002, pp. 251–260. DOI 10.1007/3-540-45748-8_24 — [Crossref](https://api.crossref.org/works/10.1007/3-540-45748-8_24); full text from [Microsoft Research PDF](https://www.microsoft.com/en-us/research/wp-content/uploads/2002/01/IPTPS2002.pdf)
- Abstract: "if a single faulty entity can present multiple identities, it can control a substantial fraction of the system, thereby undermining this redundancy … without a logically centralized authority, Sybil attacks are always possible except under extreme and unrealistic assumptions of resource parity and coordination among entities." — [MSR PDF](https://www.microsoft.com/en-us/research/wp-content/uploads/2002/01/IPTPS2002.pdf)
- Vouching (a web of trust in the PGP style) does not fix this: "a Sybil attack can severely compromise the initial generation of identities, thereby undermining the chain of vouchers." Lemma 1 bounds the damage: an entity with ρ times the resources of a minimally capable entity can present ρ identities — [MSR PDF](https://www.microsoft.com/en-us/research/wp-content/uploads/2002/01/IPTPS2002.pdf)

### Inferences
- Suggested rewrite: "In open systems without a central identity authority, Sybil identities cannot be ruled out [8]. Recommenders are especially exposed to fake-profile ('shilling') attacks [Lam & Riedl 2004]."
- Recommender-specific source, verified 2026-10-19: Shyong K. Lam, John Riedl. "Shilling Recommender Systems for Fun and Profit." Proceedings of the 13th International Conference on World Wide Web (WWW 2004), pp. 393–402. DOI 10.1145/988672.988726 — [Crossref](https://api.crossref.org/works/10.1145/988672.988726). Abstract (via [OpenAlex](https://api.openalex.org/works/doi:10.1145/988672.988726)): "Unscrupulous producers … may find it profitable to shill recommender systems by lying to the systems in order to have their products recommended more often than those of their competitors." The paper studies experimentally, on a large movie-ratings dataset, how the recommender algorithm, recommendation vs. prediction output, detectability, and item properties affect shilling. Full text is closed access; I read only the abstract. A broader survey is Gunes et al., *Artificial Intelligence Review* 2014 (see the companion note `academic_decentralized_recsys.md` §3).
- Douceur's result about vouching chains is a caution for "second degree" propagation. If a match vouches for Sybils, their picks flow in. This argues for the bounded, personalized trust metric already in DESIGN.md.

### Gaps
- Resolved 2026-10-19: Lam & Riedl 2004 verified via Crossref and OpenAlex (abstract only; full text closed).

---

## Q5. Kamvar, Schlosser, Garcia-Molina — EigenTrust [9]

### Takeaway
Partly accurate. EigenTrust is a distributed power-iteration *global* trust computation anchored on a set of pre-trusted peers. It is not seeded from "your own node". If you replace the pre-trusted distribution with your own node, the computation becomes personalized PageRank, which DESIGN.md also mentions but sources wrongly (see Q6).

### Cited Findings
- Exact citation: Sepandar D. Kamvar, Mario T. Schlosser, Hector Garcia-Molina. "The EigenTrust Algorithm for Reputation Management in P2P Networks." Proceedings of the 12th International World Wide Web Conference (WWW '03), Budapest, 2003, p. 640ff. Crossref lists only the start page; commonly cited as pp. 640–651. DOI 10.1145/775152.775242 — [Crossref](https://api.crossref.org/works/10.1145/775152.775242); full text from [Stanford NLP PDF](https://nlp.stanford.edu/pubs/eigentrust.pdf)
- The algorithm "assigns each peer a unique global trust value, based on the peer's history of uploads … a distributed and secure method to compute global trust values, based on Power iteration" — [PDF](https://nlp.stanford.edu/pubs/eigentrust.pdf)
- Pre-trusted peers are central: "the pre-trusted peers are essential" for breaking up malicious collectives, and "it is important that no pre-trusted peer be a member of a malicious collective." The trust vector is computed against a distribution p over pre-trusted peers — [PDF](https://nlp.stanford.edu/pubs/eigentrust.pdf)
- In simulation it significantly decreases inauthentic downloads "even when up to 70% of the peers in the network form a malicious collective" — [PDF](https://nlp.stanford.edu/pubs/eigentrust.pdf)
- Its stated design goals include "self-policing", anonymity (opaque identifiers), and robustness to malicious collectives — [PDF](https://nlp.stanford.edu/pubs/eigentrust.pdf)

### Inferences
- "In the style of EigenTrust or personalized PageRank" is defensible as a family resemblance. The accurate framing is: EigenTrust with p = {your own node} is a personalized (rooted) trust computation. That also removes EigenTrust's weak point, the global choice of pre-trusted peers.
- The 70% figure comes from file-sharing simulations and should not be quoted as a guarantee for taste networks.

### Gaps
- Resolved 2026-10-19. DESIGN.md attributes personalized PageRank to [10], which is wrong. Verified replacements:
  - Lawrence Page, Sergey Brin, Rajeev Motwani, Terry Winograd. "The PageRank Citation Ranking: Bringing Order to the Web." Stanford InfoLab Technical Report 1999-66 (draft dated January 29, 1998). Section 6, "Personalized PageRank": E is "a vector over the Web pages which is used as a source of rank … Intuitively the E vector corresponds to the distribution of web pages that a random surfer periodically jumps to … it can be used to give broad general views of the Web or views which are focussed and personalized to a particular individual." They test "E consist[ing] entirely of a single web page" (the Netscape home page and John McCarthy's home page). That is exactly "seeded from your own node". §6.1 also claims such personalized ranks are "virtually immune to manipulation by commercial interests". Read from a [university-hosted copy of the 1998 draft](https://www.informatik.uni-leipzig.de/~jtiepmar/lehre/ads/ss19/literature/Page%20et.al.%201998.pdf); the official Stanford record (http://ilpubs.stanford.edu:8090/422/) refused connections from this environment, so the TR number comes from bibliographic records, not the Stanford page.
  - Taher H. Haveliwala. "Topic-sensitive PageRank." WWW 2002, pp. 517–526. DOI 10.1145/511446.511513 — [Crossref](https://api.crossref.org/works/10.1145/511446.511513). Abstract: "we propose computing a set of PageRank vectors, biased using a set of representative topics" — [OpenAlex](https://api.openalex.org/works/doi:10.1145/511446.511513). (Topic-biased, not per-user.)
  - Glen Jeh, Jennifer Widom. "Scaling Personalized Web Search." WWW 2003, pp. 271–279. DOI 10.1145/775152.775191 — [Crossref](https://api.crossref.org/works/10.1145/775152.775191) (start page only; page range from [webis anthology](https://ir.webis.de/anthology/2003.wwwconf_conference-2003.29/)). Abstract: "importance scores can be biased according to a user-specified set of initially-interesting pages" — [OpenAlex](https://api.openalex.org/works/doi:10.1145/775152.775191). Same proceedings as EigenTrust.
  - Recommended citation for the DESIGN.md sentence: Page et al. §6 for the idea, plus Jeh & Widom 2003 for efficient per-user computation.

---

## Q6. Canny — "Collaborative Filtering with Privacy" [10]

### Takeaway
The Sources-list description ("an early decentralized, privacy-preserving CF design and a direct precedent") is accurate. The in-text use is wrong: "[9][10]" is attached to "EigenTrust or personalized PageRank", and Canny's paper has nothing to do with trust metrics or PageRank. Canny is the right citation for the **Circles** step (community aggregate under homomorphic encryption) and the overall "users control their data" premise.

### Cited Findings
- Exact citation: John Canny. "Collaborative Filtering with Privacy." Proceedings 2002 IEEE Symposium on Security and Privacy, Oakland, CA, May 2002, pp. 45–57. DOI 10.1109/SECPRI.2002.1004361 — [Crossref](https://api.crossref.org/works/10.1109/SECPRI.2002.1004361)
- Abstract: "We propose an alternative model in which users control all of their log data. We describe an algorithm whereby a community of users can compute a public 'aggregate' of their data that does not expose individual users' data. The aggregate allows personalized recommendations to be computed by members of the community, or by outsiders … reduces the collaborative filtering task to an iterative calculation of the aggregate requiring only addition of vectors of user data. Then we use homomorphic encryption to allow sums of encrypted vectors to be computed and decrypted without exposing individual data. We give verification schemes for all parties in the computation. Our system can be implemented with untrusted servers, or with additional infrastructure, as a fully peer-to-peer (P2P) system." — [OpenAlex record (abstract)](https://api.openalex.org/works/doi:10.1109/SECPRI.2002.1004361)
- A separate companion paper exists: Canny, "Collaborative filtering with privacy via factor analysis," SIGIR 2002, pp. 238–245, DOI 10.1145/564376.564419 — [webis anthology](https://ir.webis.de/anthology/2002.sigirconf_conference-2002.32/)
- **Full text read 2026-10-19** from the author's own copy, linked from his [privacy page](https://people.eecs.berkeley.edu/~jfc/privacy/): [IEEESP02.pdf](https://people.eecs.berkeley.edu/~jfc/papers/02/IEEESP02.pdf). Its abstract matches the OpenAlex text verbatim. It is a 6-page two-column PDF; I did not compare its page layout with the IEEE pp. 45–57 version. Details:
  - Model: the aggregate is a partial SVD of the user-ratings matrix, computed by an iterative conjugate-gradient method so that each step only needs sums of user vectors. The user-specific factor U is deliberately never computed ("U contains information about specific users … We do not store information that would allow U to be recovered").
  - Crypto: ElGamal-based homomorphic encryption with threshold decryption, zero-knowledge proofs that each user's contribution is well-formed, and a shared "blackboard" that all parties can read and write. "Talliers" do the summing; the paper says "our scheme could be implemented as a pure peer-to-peer system where clients and talliers are the same."
  - Threat model: "We assume that a fraction α > 1/2 of the users' machines are uncorrupted", with a static adversary per round. The decryption threshold is set above the number of untrusted users, (1 − α)n; with α = 0.8, t = 0.2n, which "allows the scheme to work correctly even when a significant fraction of trusted clients are offline."
  - Results (EachMovie): MAE 0.96, equal to the best scheme in the comparison Canny cites. Generating a recommendation took 0.05 s. The paper's own cost estimate for ZKP checking in its example is "about 50k seconds, or 15 hours".

### Inferences
- Canny's model is a community-wide model-based aggregate (a partial SVD in the S&P paper; the SIGIR companion uses factor analysis), not pairwise user-based CF. It is a precedent for Circles and second-degree pooling more than for the pairwise Match tier.
- Canny's honest-majority assumption (α > 1/2) and threshold decryption, like Bonawitz's, presuppose a large community. For a circle of 5, "more than half honest" means at most 2 bad members, and the published aggregate still has the small-k output leakage described in Q3.
- Canny also makes the aggregate *public*, which DESIGN.md does not intend. The Q1 and Q3 leakage concerns still apply to that aggregate.

### Gaps
- Resolved 2026-10-19: OpenAlex and Semantic Scholar still report the paper as closed access, but the author-hosted PDF linked from his Berkeley privacy page downloads correctly (the URLs tried earlier were wrong). The threat model and verification scheme are summarized above. Still not done: a line-by-line comparison with the IEEE Xplore version.

---

## Q7. Nostr — NIP-71 kinds; NIP-17 / NIP-44 encrypted messaging [3]

### Takeaway
As of 2026-10-19, NIP-71 is `draft` `optional` and defines **four** kinds:
- **regular events: kind 21** (normal video) and **kind 22** (short video)
- **addressable events: kind 34235** (normal) and **kind 34236** (short)

"Kind numbers differ across sources" is true historically: the spec moved from 34235/34236 to 21/22 in Jan 2025, then re-added 34235/34236 as addressable variants in Jan 2026. For encrypted DMs, use NIP-17 (NIP-44 encryption plus NIP-59 gift wrap). NIP-04 is deprecated.

### Cited Findings
- NIP-71 header: "`draft` `optional`". "The format uses a _regular event_ kind `21` for _normal_ videos and `22` for _short_ videos." It also defines "Kind `34235` for _addressable normal videos_ / Kind `34236` for _addressable short videos_", which require a `d` tag and can be updated (metadata fixes, URL migrations) — [NIP-71 raw](https://raw.githubusercontent.com/nostr-protocol/nips/master/71.md)
- The NIPs README kind table lists `21` Video Event, `22` Short-form Portrait Video Event, `34235` Addressable Video Event, and `34236` Addressable Short Video Event, all pointing to NIP-71 — [README](https://raw.githubusercontent.com/nostr-protocol/nips/master/README.md)
- NIP-71 commit history (re-read 2026-10-19, 23 commits): the file was created 2023-12-09 ("Update and rename 44.md to 71.md", 7afd104). Key later commits: "rename 'parameterized replaceable event' to 'addressable event' (#1418)" 2024-08-20; "nip71: make video events regular (#1704)" 2025-01-31 (6a4b125); "Add `duration` & `bitrate` to NIP-71 (#1723)" 2025-10-15; "NIP-71: Add addressable video events (kinds 34235, 34236) (#2072)" 2026-01-07 (f34e98c); "NIP-71 feat: video multiple audio tracks (#2255)" 2026-05-28. Most recent edit: 2026-06-13 ("```jsonc -> ```yaml everywhere", 999f9bf) — [GitHub commits for 71.md](https://github.com/nostr-protocol/nips/commits/master/71.md)
- Historical text, read directly from raw files at specific commits:
  - At 7afd104 (2023-12-09): "The format uses a parameterized replaceable event kind `34235` for horizontal videos and `34236` for vertical videos." That version also defined a kind `34237` event for recording that a video was viewed — [71.md @ 7afd104](https://raw.githubusercontent.com/nostr-protocol/nips/7afd104/71.md)
  - At 1e2f198 (2024-10-15): "The format uses an _addressable event_ kind `34235` for horizontal videos and `34236` for vertical videos." The kind 34237 view event is gone — [71.md @ 1e2f198](https://raw.githubusercontent.com/nostr-protocol/nips/1e2f198/71.md)
  - At 6a4b125 (2025-01-31): "The format uses a _regular event_ kind `21` for _normal_ videos and `22` for _short_ videos." — [71.md @ 6a4b125](https://raw.githubusercontent.com/nostr-protocol/nips/6a4b125/71.md)
- NIP-04 (kind 4 encrypted DM) is marked "`final` `unrecommended`" with the banner "deprecated in favor of NIP-17" — [NIP-04](https://raw.githubusercontent.com/nostr-protocol/nips/master/04.md)
- NIP-17 "Private Direct Messages" is `draft` `optional`. It "uses NIP-44 encryption and NIP-59 gift-wrapping" with a fresh random keypair per gift wrap. It claims participant identities, real timestamps, and kinds are "hidden from the public". It recommends that relays serve kind:1059 only to the p-tagged recipient (NIP-42 AUTH). It says "Group chats with more than 10 participants should find a more suitable messaging scheme." — [NIP-17](https://raw.githubusercontent.com/nostr-protocol/nips/master/17.md)
- NIP-44 (versioned encrypted payloads, v2) lists its own shortcomings: no deniability, no forward secrecy, no post-compromise security, no post-quantum security, "IP address leak: user IP may be seen by relays", `created_at` date leak, and only partial length hiding. v2 was "audited by Cure53 in December 2023" — [NIP-44](https://raw.githubusercontent.com/nostr-protocol/nips/master/44.md)

### Inferences
- That the spec used 34235/34236 before Jan 2025 is now verified from the historical file versions above, not just inferred from the commit title. The meaning also shifted: before 2025 the two kinds meant horizontal vs. vertical, and since 2025 they mean normal vs. short. Clients written in 2024 likely emit 34235/34236, and newer clients emit 21/22 (and, since Jan 2026, possibly 34235/34236 again as addressable variants). A video client should read all four kinds. Which kinds particular clients actually emit is an inference; I did not check client code.
- For Match sketches, NIP-17 fits the "Exchange" step for 1:1 matches. Its own limit of about 10 participants argues against using it for Circles. The NIP-44 caveats (no forward secrecy, IP visible to relays) back up the DESIGN.md "relay metadata" risk and the Tor/mixnet mitigation.

### Gaps
- Resolved 2026-10-19: the GitHub API is still unavailable (session scoping), but the commits page and raw files at specific commits load directly, so the pre-2025 kind numbers are verified. I read the file at three commits, not every diff.

---

## Q8. AT Protocol custom feeds and repo visibility [4]

### Takeaway
The DESIGN.md claims are accurate.
- A feed generator returns a *skeleton* (a list of post URIs with optional metadata). The AppView hydrates it. In older docs the PDS did the hydrating.
- The request carries a JWT whose `iss` is the requesting user's DID, so the feed generator learns who asked and when.
- The spec says repository contents are "entirely public".

### Cited Findings
- Current flow: "A user requests a feed from the AppView using the at-uri of the declared feed … The AppView sends a getFeedSkeleton request to the service endpoint declared in the Feed Generator's DID doc. This request is authenticated by a JWT signed by the user's repo signing key. The Feed Generator returns a skeleton of the feed to the AppView. The AppView hydrates the feed (user info, post contents, aggregates, etc.)" — [atproto.com/guides/feeds](https://atproto.com/guides/feeds) (also in the [site source](https://raw.githubusercontent.com/bluesky-social/atproto-website/main/src/app/%5Blocale%5D/guides/feeds/en.mdx))
- Older starter-template description: the user's PDS calls the feed generator and hydrates the feed itself, with the note "In the future, the PDS will hydrate the feed with the help of an App View, but for now, the PDS handles hydration itself." So the two primary sources **disagree on PDS vs AppView**, and the atproto.com guide is the newer one — [bluesky-social/feed-generator README](https://raw.githubusercontent.com/bluesky-social/feed-generator/main/README.md)
- Requester identity: the JWT payload includes "`iss: "did:example:alice", // (issuer) the requesting user's DID`" and "`aud`" set to the feed generator's DID — [feed-generator README](https://raw.githubusercontent.com/bluesky-social/feed-generator/main/README.md)
- Skeleton: "in its simplest form, a list of post URIs", optionally with a `reason` (e.g., repost) — [feed-generator README](https://raw.githubusercontent.com/bluesky-social/feed-generator/main/README.md)
- Service proxying: a PDS forwards requests to other services named in the `atproto-proxy` header — [XRPC spec source](https://raw.githubusercontent.com/bluesky-social/atproto-website/main/src/app/%5Blocale%5D/specs/xrpc/en.mdx)
- Repo publicity: "Each atproto account has a repository … which stores all of their public data records. Repository contents are entirely public and verifiable ('self-certifying')." — [Repository spec source](https://raw.githubusercontent.com/bluesky-social/atproto-website/main/src/app/%5Blocale%5D/specs/repository/en.mdx)
- The docs.bsky.app starter-templates URL now redirects (308) to bsky.network/docs/…, which returned an empty page to the fetcher — [docs.bsky.app link](https://docs.bsky.app/docs/starter-templates/custom-feeds)

### Inferences
- In practice the client most likely calls its PDS, which proxies via `atproto-proxy` to the AppView, which calls the feed generator. I assembled this from the XRPC spec and the feeds guide; neither page states the full chain on its own.
- Because the request carries the user's DID, a feed generator can build per-user request logs. That is a hard mismatch with private Match, as DESIGN.md says. "AT-Protocol-style feed recipes executed on-device" is a departure from atproto, where feeds always run on servers. It should be presented as borrowing the idea, not as interop.

### Gaps
- Not verified: whether the current AppView forwards the user JWT unchanged or mints its own service-auth token, and where private state (preferences, mutes, DMs) lives outside the repo.

---

## Q9. PeerTube: community recommenders [1][2] and built-in features

### Takeaway
- "No official personalized recommender" is accurate. PeerTube's built-in "recommended videos" list is tag-overlap plus recency, with no personalization beyond hiding videos the logged-in user has already watched.
- PeerTube Picks and the solidheron extension are client-side, cosine-similarity, own-data-only tools, as described.
- The fairkom issue proposes an instance-side plugin and does not say which recommendation method it would use.
- P2P (p2p-media-loader over WebRTC) and inter-instance redundancy are real built-in features.

### Cited Findings
**Built-in recommendations (source code, `develop` branch at commit 1e499b13, 2026-10-16)**
- `client/src/app/+video-watch/shared/recommendations/video-recommendation.service.ts` returns at most 5 videos. It searches with `tagsOneOf: currentVideo.tags`, `sort: '-publishedAt'`, `searchTarget: 'local'`, and `excludeAlreadyWatched` for logged-in users. If the search returns ≤ 1 result, or local search is disabled in favour of a search index, it falls back to the most recently published videos — [PeerTube GitHub](https://github.com/Chocobozzz/PeerTube/blob/develop/client/src/app/%2Bvideo-watch/shared/recommendations/video-recommendation.service.ts)
- The user docs mention autoplay continuing to "the next suggested video" without explaining how it is chosen — [docs.joinpeertube.org/use/watch-video](https://docs.joinpeertube.org/use/watch-video)

**P2P**
- The client depends on `p2p-media-loader-core` and `p2p-media-loader-hlsjs` (^4.0.0) and `hls.js` — [client/package.json](https://raw.githubusercontent.com/Chocobozzz/PeerTube/develop/client/package.json)
- The production config says: "If you disable the tracker, you disable the P2P on your PeerTube instance". It also mentions WebTorrent trackers (e.g., aquatic_ws) and STUN servers "used by the player to establish P2P connections". "Small latency live streams cannot use P2P" — [production.yaml.example](https://raw.githubusercontent.com/Chocobozzz/PeerTube/develop/config/production.yaml.example)
- The player shows "P2P statistics (if enabled; if not you see HTTP instead)" — [watch-video docs](https://docs.joinpeertube.org/use/watch-video)

**Redundancy/mirroring**
- Config strategies are `most-views`, `trending`, and `recently-added` (with `min_views`). A `remote_redundancy` setting controls who may mirror your videos — [production.yaml.example](https://raw.githubusercontent.com/Chocobozzz/PeerTube/develop/config/production.yaml.example)
- Admin docs: "If your PeerTube platform should act as a complete mirror for another platform, use the `recently-added` strategy". With mirroring, the "web browser will randomly download segments of this video on the origin PeerTube platform and on your platform" — [admin/following-instances](https://docs.joinpeertube.org/admin/following-instances)

**Community efforts**
- [1] fairkom/Display Europe issue #7, "PeerTube recommender": "We should have a plugin, that is creating a sorted listed of recommended videos", ranking "all local and federated videos available on a PeerTube instance". It proposes sequential ("episode 1, episode 2") ordering instead of what it calls PeerTube's current *random* next-video choice. Personalization "can be enhanced by personal preferences #6". No CF or content-based method is specified, and the author, date, and status were not visible — [git.fairkom.net issue 7](https://git.fairkom.net/emb/displ.eu/recommender/-/issues/7)
- [2a] PeerTube Picks is a Firefox add-on. "This add-on provides video recommendations using a cosine similarity algorithm based on videos you've watched and liked." Data stays in the browser (watch time, likes/dislikes), with export, import, and delete options. Per the author, it uses no other users' data and makes network calls only for video metadata. Posted by Cattail@lemmy.world about a year before capture (exact date not shown) — [piefed post 169216](https://piefed.jeena.net/post/169216)
- [2b] The alpha recommender is a Chromium/Brave extension (code at github.com/solidheron/peertube_recomendation_algorythm). It is "scoped to _one person only_ (no data sharing yet)" and stores data in IndexedDB. Inputs are watch time, likes, and English words from titles, descriptions, and tags. It uses cosine similarity, de-ranks seen videos ×0.5, and caps at 5 per channel. The author says AI helped write it. Also posted by Cattail@lemmy.world — [piefed post 158506](https://piefed.jeena.net/post/158506)

### Inferences
- The fairkom issue's "random" description of next-video selection conflicts with the current source code, which uses tag overlap and recency. The issue probably predates the current code, or describes the result loosely.
- DESIGN.md says "Community efforts so far are client-side" and then lists an instance-level plugin. That is a small internal inconsistency; suggest "mostly client-side".
- [2] describes PeerTube Picks as a "discussion", but it is a Lemmy announcement post. The add-on's own Firefox Add-ons page would be a better primary link.
- Both piefed posts are by the same poster, and the extensions look related; possibly the same author. Treat them as one effort, not two independent ones (unconfirmed).
- "None of them use other people's taste" holds for [2a] and [2b]. For [1] it is unknown, because the method is unspecified.

### Gaps
- I did not open the PeerTube Picks Firefox Add-ons listing or the solidheron GitHub repo. Issue #6 ("personal preferences") on fairkom was not read. "Content addressing" as a PeerTube property was not verified.

---

## Q10. US Video Privacy Protection Act, 18 U.S.C. § 2710

### Takeaway
The DESIGN.md statement that passive viewing history gets special treatment under the VPPA is accurate. The statute protects information identifying a person "as having requested or obtained specific video materials or services". It binds only a "video tape service provider", meaning someone *engaged in the business* of renting, selling, or delivering prerecorded video or "similar audio visual materials". Whether a non-commercial client, a volunteer PeerTube instance, or individual users sharing their own sketches fall under it is uncertain. Who counts as a "consumer" is currently before the Supreme Court.

### Cited Findings
- Definitions (§ 2710(a)), quoted from [Cornell LII](https://www.law.cornell.edu/uscode/text/18/2710):
  - "Consumer": "any renter, purchaser, or subscriber of goods or services from a video tape service provider".
  - "Personally identifiable information": "includes information which identifies a person as having requested or obtained specific video materials or services".
  - "Video tape service provider": any person "engaged in the business, in or affecting interstate or foreign commerce, of rental, sale, or delivery of prerecorded video cassette tapes or similar audio visual materials".
  - "Ordinary course of business": "only debt collection activities, order fulfillment, request processing, and the transfer of ownership".
- § 2710(b)(1): a provider that "knowingly discloses, to any person, personally identifiable information concerning any consumer" is liable — [Cornell LII](https://www.law.cornell.edu/uscode/text/18/2710)
- § 2710(b)(2) exceptions — [Cornell LII](https://www.law.cornell.edu/uscode/text/18/2710):
  - disclosure to the consumer;
  - informed written consent, including electronic consent, in a separate form, given per request or for a set period of at most 2 years, and revocable;
  - law enforcement with a warrant, grand jury subpoena, or court order;
  - names and addresses only, with an opt-out, if no titles or subject matter are revealed;
  - the ordinary course of business;
  - a civil court order with notice.
- § 2710(c): actual damages "but not less than liquidated damages in an amount of $2,500", plus punitive damages and attorney's fees; 2-year limitations period. § 2710(e): destroy PII no later than one year after it is no longer needed — [Cornell LII](https://www.law.cornell.edu/uscode/text/18/2710)
- On 2026-01-26 the Supreme Court granted cert in *Salazar v. Paramount Global*, No. 25-459. The question is whether a "consumer" must subscribe to *audiovisual* goods or services (D.C. and 6th Circuits) or to any goods or services of a video tape service provider (2nd Circuit in Salazar v. NBA; 7th Circuit in Gardner v. Me-TV) — [WilmerHale](https://www.wilmerhale.com/en/insights/blogs/wilmerhale-privacy-and-cybersecurity-law/20260130-us-supreme-court-to-define-who-can-sue-under-the-video-privacy-protection-act); [Duane Morris](https://www.duanemorris.com/alerts/us_supreme_court_decide_who_qualifies_consumer_under_video_privacy_protection_act_0126.html)

### Inferences (not legal advice)
- The VPPA regulates *providers'* disclosures. In the Match design, users disclose their own history to peers of their own choosing, which the statute does not appear to reach. The risk falls on any operator that delivers video in a business capacity and handles history: PeerTube instances, or any hosted aggregator or relay that runs as a business. An open-source, on-device client that never receives history is a weak fit for "video tape service provider". This is an inference, not settled law.
- The design's own norms line up with the statute's safe harbours: separate, revocable, time-limited consent (the ≤ 2-year rule mirrors "Matches expire unless renewed"), plus short retention and destruction. The § 2710(b)(2)(C) law-enforcement exception supports the DESIGN.md point that "no central store to subpoena" is the real protection.
- "US law treats it specially" is accurate, but it is narrow: one sector-specific statute with a private right of action. It is not a general rule that viewing history is sensitive data.

### Gaps
- I found no Supreme Court merits decision in *Salazar v. Paramount Global* as of 2026-10-19; search results covered only the cert grant. The outcome, or whether argument has happened yet, is unknown. Check the Court's docket for No. 25-459.
- Not researched: case law on whether non-commercial or open-source video platforms qualify as "video tape service providers", and state analogues (e.g., Michigan, California).
