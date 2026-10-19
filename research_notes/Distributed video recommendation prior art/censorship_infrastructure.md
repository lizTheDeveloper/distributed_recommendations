# Censorship Resistance, Metadata Privacy and Distribution Infrastructure for a Decentralized Video + P2P Taste-Sharing App

Scope note: research as of 2026-10-19. Sources marked **[fetched/searched this session]** were checked against search results or the page itself during this research. Sources marked **[canonical, not re-fetched]** are well-known primary documents (RFCs, peer-reviewed papers, statutes) cited from prior knowledge at their stable URLs; the report writer should treat their specific details as reliable but not re-verified here. Claims are labelled as fact vs. claim/opinion where it matters. Revised 2026-10-19: most items previously marked [canonical, not re-fetched] or listed as gaps were re-checked against primary sources and are marked **[verified 2026-10-19]**. See the revision log at the end.

## 1. How have states actually pressured decentralized/federated networks?

### Takeaway
States rarely attack "the protocol". They attack the chokepoints that a decentralized system still has: the people and machines operating servers (seizures, raids, liability laws), app stores (removal on government request), companies and founders (arrest, securities law), and the network layer (DPI blocking of Tor/bridges). Federation spreads the risk across many operators, but each operator is a small, under-resourced target holding plaintext data. Distributed regulation (EU DSA, UK OSA) also falls on that operator's shoulders, and some respond by geoblocking.

### Cited Findings
**Server/operator seizure (fediverse)**
- In mid-May 2023 the FBI raided the home of a Kolektiva.social (Mastodon) admin and seized all of their electronics. Kolektiva says it was "neither a subject nor target" of the investigation and that the admin was charged over alleged participation in a protest; EFF describes the charges as "unrelated". Agents seized an **unencrypted** database backup from the first week of May 2023, which the admin was using for troubleshooting. Per Kolektiva and EFF, it held:
  - email addresses and hashed passwords;
  - IP addresses of users who had logged in within three days before the backup;
  - posts (including followers-only), direct messages, and follow relationships.
  Because of federation, this also implicates posts and messages from users on other instances. CyberInsider reported that the instance had about **7,800 members**; the earlier "about 8,000 active users" overstated what is known. Users were notified on **30 June 2023**, which EFF calls "quite a long delay". [verified 2026-10-19] — [EFF, 25 July 2023](https://www.eff.org/deeplinks/2023/07/fbi-seizure-mastodon-server-wakeup-call-fediverse-users-and-hosts-protect-their); [CyberInsider, 5 July 2023](https://cyberinsider.com/fbi-seized-the-database-of-a-social-media-anarchist-collective/) — [Business & Human Rights Resource Centre](https://www.business-humanrights.org/fr/derni%C3%A8res-actualit%C3%A9s/usa-fbi-seizes-a-mastodon-server-cso-warns-about-privacy-concerns/); [Linux Today / "Why Kolektiva.social Is a Warning"](https://www.linuxtoday.com/news/why-kolektiva-social-is-a-warning-for-activists-using-mastodon); the "unencrypted backup" detail comes from Kolektiva's own statement as quoted on [Lemmy](https://old.lemmy.dbzer0.com/post/1180157) (secondary relay of a primary statement)
- EFF's view (opinion): "this raid put the thousands of users this instance served into a terrible situation", and hosts should "limit the data your server collects and stores". — [EFF](https://www.eff.org/deeplinks/2023/07/fbi-seizure-mastodon-server-wakeup-call-fediverse-users-and-hosts-protect-their) [verified 2026-10-19]

**App store removal**
- Apple removed Damus, a Nostr client, from the China App Store around 2–3 Feb 2023, about two days after its global launch. The removal followed a demand from the Cyberspace Administration of China, which said the app violated rules on security assessments for services with "public opinion or social mobilization attributes". The app stayed available elsewhere. Damus announced the removal on 2 February 2023, quoting Apple's notice that the app "includes content that is illegal in China". [searched again 2026-10-19; consistent across RFA, iMore and Gigazine] — [RFA](https://rfa.org/english/news/china/app-store-02032023190706.html); [iMore](https://www.imore.com/apps/social-apps/apple-yanks-twitter-like-app-from-the-app-store-citing-chinese-demands); [Gigazine](https://gigazine.net/gsc_news/en/20230206-twitter-like-nostr-damus-pulled-china)
- This is a precedent. Apple removed VPN apps from the China App Store in 2017 [canonical, not re-fetched] — [NYT 2017](https://www.nytimes.com/2017/07/29/technology/china-apple-censorhip.html). Apple **and Google** removed the Navalny "Smart Voting" app from their Russian stores on **17 September 2021**, the first day of parliamentary voting. This followed Roskomnadzor demands and threats of fines or prosecution; Apple told the developer the app included content "illegal in Russia". [verified 2026-10-19 via AP-syndicated and trade reports] — [AppleInsider](https://appleinsider.com/articles/21/09/17/apple-google-drop-russian-opposition-app-ahead-of-election); [Fortune](https://www.fortune.com/2021/09/17/apple-google-removal-russian-opposition-voting-app)

**Founder/company liability (Telegram)**
- Pavel Durov was arrested at Paris–Le Bourget on 24 August 2024. On 28 August 2024 he was placed under formal investigation (*mise en examen*) on twelve counts, including complicity in distributing CSAM and drug trafficking, and money laundering. Sources also cite refusing to assist lawful interception. He was released under judicial supervision with €5M bail, a ban on leaving France and twice-weekly police reporting. The travel conditions were relaxed in March and July 2025 and reportedly fully lifted in November 2025. **Status as of 2026-10-19:** no trial order or conviction has been reported; the investigation passed the two-year mark in August 2026 with further questioning reported in July 2026. These status details come from Wikipedia and secondary reporting; no official French prosecutor statement was found. — [Wikipedia: Arrest and indictment of Pavel Durov](https://en.wikipedia.org/wiki/Arrest_and_indictment_of_Pavel_Durov); [TechCrunch, 29 Aug 2024](https://techcrunch.com/2024/08/29/france-formally-charges-telegram-founder-pavel-durov-over-organized-crime-on-app); [Security Boulevard](https://securityboulevard.com/2024/09/ceo-durov-says-telegram-will-provide-more-data-to-governments/)
- In late September 2024 Telegram changed its terms and privacy policy worldwide. It may now disclose a user's IP address and phone number on a "valid order from the relevant judicial authorities" naming the user as a suspect in criminal activity that violates Telegram's Terms of Service. Disclosures are to appear in a quarterly transparency report. Previously, per 404 Media's reading of the old policy, data would be shared only in cases of "confirmed terror-related suspicions" following a court order. **Correction:** the trigger is a judicial order, not merely "valid legal requests". [verified 2026-10-19] — [Security Affairs, 24 Sept 2024](https://securityaffairs.com/168803/laws-and-regulations/telegram-will-provide-user-data-to-law-enforcement.html); [Gulf News](https://gulfnews.com/technology/media/telegram-to-share-more-data-with-authorities-tighten-illegal-content-controls-says-ceo-pavel-durov-1.1727146898815); [Gigazine](https://gigazine.net/gsc_news/en/20240924-telegram-provide-more-data)
- Lesson (fact pattern): a centralized operator with logs and a reachable executive can be compelled. Telegram's default chats are not end-to-end encrypted, so it holds the data.

**Securities law against a decentralized video platform (LBRY)**
- On 7 Nov 2022 the D.N.H. court (Judge Barbadoro) granted the SEC summary judgment that LBRY's LBC token was offered as an unregistered security. It was the first SEC action against a token that was not sold through an ICO. — [Skadden](https://www.skadden.com/insights/publications/2022/11/court-rules-in-favor-of-sec); [Morrison Foerster](https://mofo.com/resources/insights/221110-court-rules-lbry-token)
- LBRY had filed a notice of appeal in September 2023. In a statement dated 19 October 2023, it announced it was shutting down. It owed "several million dollars" to its legal team, private creditors and the SEC, and its assets, *including Odysee*, were being placed into receivership. Its executives, employees and board resigned, and the appeal was halted. LBRY said the open-source blockchain could keep running if people use it, warning "Decentralization isn't magic". [verified 2026-10-19] — [CryptoSlate, 20 Oct 2023](https://cryptoslate.com/lbry-concedes-to-total-shutdown-citing-loss-to-sec-and-millions-in-debt/); [Blockworks](https://blockworks.co/news/lbry-shutter-sec-debt) (page returned 403 on re-fetch; consistent per search summary)
- **Odysee** was acquired in June 2024 by Forward Research, the main contributor to the Arweave protocol, alongside Solarplex; terms were not disclosed. Forward Research claimed over 7 million monthly active users (a company claim). Odysee was described as moving to Arweave/AO, and Wikipedia lists its status as "Active". No later change of ownership was found as of 2026-10-19. — [The Block, 6 June 2024](https://www.theblock.co/amp/post/298888/decentralized-youtube-alternative-odysee-acquired-by-forward-research-despite-content-concerns); [Wikipedia: Odysee](https://en.wikipedia.org/wiki/Odysee)
- Lesson: a token-funded company's securities-law loss took down the company and put its flagship app through receivership and a sale. The content and app survived only because a buyer stepped in.

**Network-level blocking (Tor)**
- Several Russian ISPs started blocking Tor on 1 Dec 2021, according to OONI measurements. Russia was then Tor's second-largest user base, with more than 300,000 daily users (about 15%). Default bridges, including Snowflake and Moat-distributed obfs4, were blocked in some places. The Tor Project asked volunteers to run more obfs4 bridges. — [OONI](https://ooni.org/post/2021-russia-blocks-tor/); [Tor Project forum](https://forum.torproject.org/t/responding-to-tor-censorship-in-russia/1057)

**Platform regulation landing on small operators (EU DSA, UK OSA)**
- The EU DSA applies to fediverse services, and each instance can count as an "online platform". Micro and small enterprises are exempt from the extra platform obligations, but baseline hosting duties remain, such as notice-and-action reporting and acting on authority orders "without undue delay". Federation makes it hard to count active users toward thresholds. — [CEPS DSA-fediverse explainer (PDF mirror)](https://astrid-online.it/static/upload/2025/2025-02_dsa_fediverse-explainer_final-1.pdf); [AlgorithmWatch](https://algorithmwatch.org/en/fediverse-growing-power-imbalances-stay/); [IFTAS publications](https://about.iftas.org/library/iftas-publications/)
- UK Online Safety Act: when the illegal-harms duties took effect in early 2025, some small sites shut down or geoblocked the UK. Lemmy.zip, hosted in Finland, blocked UK users rather than add age verification or disable NSFW content. Small forums, including a hamster forum and a cycling forum, closed or restricted service. Ofcom would not give a numeric "significant number of UK users" threshold, according to a fediverse operator's account. These are operator statements, press and advocacy, not Ofcom documents. — [Free Speech Union, relaying the Telegraph](https://freespeechunion.org/hamster-forum-and-local-residents-websites-shut-down-by-new-internet-laws/); [decoded.legal (Neil Brown)](https://decoded.legal/blog/2025/03/it-is-time-to-make-the-online-safety-act-2023-fit-for-purpose/); [rblind/lemmy.zip cross-post](https://rblind.com/post/3775236)

**BitTorrent trackers / DHT**
- Background: tracker sites (The Pirate Bay raid in 2006, and others) have been seized repeatedly, yet the swarms survived through DHT and magnet links. Monitoring the DHT also lets anyone enumerate who is sharing what. See Wolchok & Halderman, "Crawling BitTorrent DHTs for Fun and Profit" (WOOT 2010), and Le Blond et al., "Spying the World from your Laptop" (LEET 2010). [canonical, not re-fetched] — [USENIX WOOT'10](https://www.usenix.org/conference/woot10/crawling-bittorrent-dhts-fun-and-profit); [USENIX LEET'10](https://www.usenix.org/conference/leet-10/spying-world-your-laptop-identifying-and-profiling-content-providers-and-big)

### Inferences
- Federation turns one big seizure target into many small ones. Each small instance tends to have weaker operational security (unencrypted backups, logs) and less legal support, so a single seizure exposes everyone on it, as Kolektiva shows. Censorship resistance depends on **what the server holds**, not on how many servers there are.
- For a taste-sharing app, the design rule is: servers and relays should hold only ciphertext and the minimum routing metadata, with no plaintext social graph or watch history. If seized, they should yield nothing useful.
- App stores are the most reliable chokepoint states have used (Damus, VPNs). Mitigations include sideloading/F-Droid, PWAs, and building in the fact that a protocol stays alive when one client is removed.
- Compliance regimes (DSA/OSA) push small operators toward geoblocking, which in practice is self-censorship. A design where relays have no content-moderation surface for private taste data (only ciphertext) reduces the regulatory burden. Public video hosting still carries DSA/OSA duties.
- Tokens add a securities-law attack surface (LBRY). Avoid a token unless it is essential.

### Gaps
- ~~LBRY wind-down / Odysee ownership~~: resolved above (October 2023 shutdown and receivership; Odysee sold to Forward Research in June 2024).
- PeerTube: I searched again on 2026-10-19 and still found no reported case of a state seizing, or ordering the takedown of, a PeerTube instance. Results returned only unrelated cases (The Pirate Bay 2014, German police raids on Tor-supporting Zwiebelfreunde, India's Sahyog portal). This is still absence of evidence from web search, not proof.
- Nostr relays: on 2026-10-19 I found **no documented case** of a government order or hosting-provider termination against a Nostr relay. Only speculative forum discussion turned up, for example about UK Online Safety Act exposure for UK-hosted relays and possible ISP-level relay blocking in Brazil, plus unsourced claims of relay attrition for economic reasons. Treat relay deplatforming as a plausible but undocumented risk.
- Durov case: status updated above. No trial order was found as of 2026-10-19, and the latest reporting found dates from August 2026.
- I did not check whether the European Commission issued DSA guidance specific to the fediverse after 2025. The EDPB does not issue DSA guidance; its blockchain guidelines are covered in section 7.

## 2. Metadata privacy: what relays/servers learn, and the tools to limit it

### Takeaway
End-to-end encryption hides content but not who talks to whom, when, or how much. In a taste-sharing network the social graph and fetch patterns are themselves sensitive, because they reveal interests. Deployable mitigations, from cheap to expensive: sealed-sender style sender hiding (weak against timing correlation), Oblivious HTTP (splits IP from request with two non-colluding parties), Tor onion services (low latency, vulnerable to global adversaries and blocking), mixnets (Loopix/Nym: resist global passive adversaries at a latency and cover-traffic cost), and PIR for fetching content without revealing which item (now deployed at scale by Apple).

### Cited Findings
- **Relay visibility (Nostr):** NIP-17 private DMs use NIP-44 encryption and NIP-59 sealing (kind 13) and gift-wrapping (kind 1059). Each gift wrap is signed by "a new keypair, generated randomly anew for each message", and clients SHOULD randomize `created_at` up to two days in the past, so relays do not learn the sender. The recipient pubkey is still visible to the relay in the gift wrap's `p` tag. The spec says relays SHOULD serve kind-1059 events only to the tagged recipient, using NIP-42 AUTH. NIP-17 is still marked `draft`. The spec does not discuss IP addresses; relays seeing client IPs is an inference from how WebSocket connections work. [verified 2026-10-19] — [NIP-17](https://github.com/nostr-protocol/nips/blob/master/17.md)
- **Signal sealed sender:** this removes the sender identity from the envelope the server sees. Martiny, Kaptchuk, Aviv, Roche & Wustrow, "Improving Signal's Sealed Sender" (NDSS 2021), show a statistical disclosure attack (SDA). Delivery receipts, on by default, make it "particularly effective", and they estimate Signal could link sealed-sender users "in as few as 5 messages". Their proposed fixes are a provably secure solution that reuses existing sealed-sender mechanisms, and a more sophisticated one estimated at under $40/month in extra cost for millions of users. The earlier summary's "ephemeral identities" wording was not confirmed from the landing page. [verified abstract 2026-10-19] — [Signal blog](https://signal.org/blog/sealed-sender/); [NDSS 2021](https://www.ndss-symposium.org/ndss-paper/improving-signals-sealed-sender/)
- **Oblivious HTTP (RFC 9458, Thomson & Wood, January 2024, Proposed Standard):** a client encrypts a request to a gateway using HPKE and sends it through a relay. The relay sees the client IP but not the request, and the gateway sees the request but not the IP. Relay and gateway must be run by different entities (non-collusion). The RFC does not provide unlinkability for requests that carry state such as cookies or authentication. [verified 2026-10-19] — [RFC 9458](https://www.rfc-editor.org/rfc/rfc9458)
  - **Production deployment:** since March 2024, Chrome's real-time Safe Browsing checks send encrypted hash prefixes through an OHTTP relay operated by Fastly. Google says Safe Browsing "does not see your IP address" and that checks are mixed with other users' checks. — [Google Security Blog, 14 Mar 2024](https://security.googleblog.com/2024/03/blog-post.html); [Fastly](https://fastly.com/blog/fastly-and-google-partner-to-enhance-your-privacy-while-protecting-chrome) [verified 2026-10-19]
- **Mixnets:** Loopix (Piotrowska, Hayes, Elahi, Meiser & Danezis, USENIX Security 2017) uses Poisson mix nodes in a stratified topology with self-injected "loop" cover traffic. It provides bidirectional sender/receiver anonymity and unobservability, and aims at traffic-analysis resistance including against "a global network adversary". Message latency is "on the order of seconds", and mix nodes handled "upwards of 300 messages per second" on EC2. [verified abstract 2026-10-19] — [USENIX Security '17 Loopix](https://www.usenix.org/conference/usenixsecurity17/technical-sessions/presentation/piotrowska)
  - **Nym (status 2026):** Nym descends from Loopix and has incentivized mix nodes ([Nym whitepaper](https://nymtech.net/nym-whitepaper.pdf), not re-fetched). It runs as the commercial NymVPN with two modes: an "Anonymous" mixnet mode, and a "Fast" two-hop WireGuard dVPN mode per reviews. Nym's own 2026 roadmap (13 Mar 2026) says the mixnet is "simply too slow for everyday usage" and often slower than Tor. Planned work includes a new cover-traffic scheme developed with EPFL, faster connection setup and user-tunable mixnet parameters. NymVPN v2026.11 shipped in July 2026. Third-party reviews give inconsistent node counts (500–600+), which are unverified. [verified roadmap 2026-10-19] — [Nym roadmap 2026](https://nym.com/blog/nym-roadmap-2026); [NymVPN v2026.11](https://nym.com/blog/nymvpn-v2026.11)
- **Tor onion services:** these hide both server and client IP behind circuits and give self-authenticating addresses. As shown in section 1, Tor can be blocked at the network level and depends on pluggable transports/bridges in censored countries. [canonical, not re-fetched] — [Tor onion services overview](https://community.torproject.org/onion-services/overview/); blocking: [OONI](https://ooni.org/post/2021-russia-blocks-tor/)
- **PIR / homomorphic encryption at scale:** Apple uses BFV homomorphic encryption for PIR-style keyword lookups (iOS 18 Live Caller ID Lookup, which keeps third-party caller ID servers from seeing the number). Enhanced Visual Search uses private nearest-neighbour search: HE plus differential privacy, an anonymization network, and fake queries. The client sends the coarse cluster ID in the clear and the embedding encrypted. Apple open-sourced swift-homomorphic-encryption. — [Apple ML Research](https://machinelearning.apple.com/research/homomorphic-encryption); caveat that Apple itself may still see call info (opinion of a practitioner): [Jeremy Kun](https://jeremykun.com/fhe-in-production)
- **Consent backlash (claim):** Enhanced Visual Search was enabled by default and drew public criticism around January 2025. This comes from a secondary, opinion-leaning source. — [Wavect blog](https://wavect.io/blog/fully-homomorphic-encryption-practical-2026.md)

### Inferences
- The private-nearest-neighbour design in Enhanced Visual Search (cluster ID in the clear, embedding encrypted) is a directly reusable pattern for "find similar taste profiles" or "fetch recommendations for my taste vector" without revealing the vector. It leaks coarse cluster membership, so the cluster granularity has to be chosen on purpose.
- For fetching video manifests or metadata without revealing interest, OHTTP is the cheapest realistic layer, but it needs two independent operators. PIR over a catalogue index is feasible for keyword-style lookups. PIR over video bytes is not practical at video sizes; use PIR for the index, then fetch through OHTTP, Tor or a mixnet.
- Sealed sender alone is insufficient against a relay that also observes timing. Taste-sketch exchanges should be batched, padded and delayed (asynchronous, not chatty) to make statistical disclosure harder. Taste sharing tolerates latency, which makes mixnets viable.

### Gaps
- I did not find a published deployment of PIR or mixnets specifically for video recommendation.
- **Google PIR (partly resolved):** Google's 9 Sept 2021 post "Introducing Android's Private Compute Services" says PCS uses privacy technologies "including Federated Learning, Federated Analytics, and Private information retrieval". Secondary summaries of the open-source PCS code describe homomorphic-encryption-based PIR for downloading dataset slices without the server learning which slice. A Google researcher's talk listing (Kevin Yeo, Nov 2023) mentions a PIR use case "deployed today" without naming it. Password Checkup and Private Set Membership are PSI/PSM-style deployments, not PIR. I found **no** primary source naming a specific Chrome or Android feature that uses PIR. Chrome's privacy-preserving Safe Browsing lookups use OHTTP, not PIR. — [Google Security Blog, 2021](https://security.googleblog.com/2021/09/introducing-androids-private-compute.html); [CrySP talk listing](https://crysp.uwaterloo.ca/speakers/20231123-Yeo)
- **Nym:** resolved above. It is operating in 2026 as NymVPN, but per Nym itself the mixnet is too slow for everyday use. No official node-count or latency figures were found.

## 3. PeerTube infrastructure (federation, redundancy, P2P, IP exposure)

### Takeaway
PeerTube federates over ActivityPub, lets instances mirror each other's videos ("redundancy"), and offloads bandwidth to viewers' browsers via WebRTC P2P (p2p-media-loader over HLS). P2P **does** expose viewer IPs to the instance tracker and to other peers watching the same video. PeerTube's own docs call this "the main threat to user privacy" when P2P is on.

### Cited Findings
- From PeerTube's admin privacy guide (verbatim quotes): the software "doesn't send personal data to any third party if P2P and remote redundancy are disabled"; with P2P on, data goes to "Other peers that are watching the video, and so potentially with remote peers outside the European Union"; "the IP address is stored in the platform's BitTorrent/WebTorrent tracker" while the user is "downloading or watching the video", which it calls "the main threat to user privacy"; "Peers in a web browser send a signal containing the IP address to the tracker", which forwards it to other peers; "someone with enough technical skills could create a script that tracks which IP is downloads which video", though the guide argues this is hard in practice; "P2P can be disabled by the PeerTube admin or directly in users settings." — [PeerTube privacy guide](https://docs.joinpeertube.org/admin/privacy-guide)
- The mitigations PeerTube lists are a cap on peers per tracker response, rate limits on tracker requests, and the option to disable P2P or WebRTC. PeerTube says disabling P2P does not by itself give anonymity, and recommends a VPN or Tor Browser. — [PeerTube instance "about" text, as summarized in search results (page fetch returned a browser-compatibility error)](https://peertube.f-si.org/about/peertube)
- P2P is implemented with p2p-media-loader (WebRTC between browsers, segmenting HLS). [canonical, not re-fetched] — [Novage/p2p-media-loader](https://github.com/Novage/p2p-media-loader)

### Inferences
- If an observer joins a PeerTube swarm, it can map viewer IPs to videos. This is the same class of attack as BitTorrent DHT/swarm monitoring. For a privacy-focused app, P2P video delivery should be off by default, or limited to trusted peers or relays (for example, peers routed through a TURN relay so IPs aren't exposed).
- Redundancy between instances spreads takedown risk, but the mirrored files sit on servers that are each subject to their own jurisdiction's notice-and-takedown.

### Gaps
- I did not verify PeerTube's current live-streaming P2P behaviour or latency, or recent versions' changes as of 2026.
- I found no empirical study measuring de-anonymization of PeerTube viewers.

## 4. Content-addressed / P2P video distribution (IPFS, BitTorrent/WebTorrent, Iroh, Hypercore)

### Takeaway
Content addressing makes content easy to re-host after takedown, because any copy with the same hash is valid. It does not make content stay online: data persists only while someone pins or seeds it. Public DHTs and request broadcasts leak who requests what. Monitoring studies of IPFS and BitTorrent show this is practical at network scale.

### Cited Findings
- Balduf, Henningsen, Florian, Rust & Scheuermann, "Monitoring Data Requests in Decentralized Data Storage Systems: A Case Study of IPFS" (ICDCS 2022), passively monitored IPFS for fifteen months "using two spatially diverse monitoring nodes, yielding traces of 2.78 · 10^10 data request entries". They identified and surveilled the nodes behind public IPFS/HTTP gateways. The leak comes from IPFS broadcasting Bitswap `want_list` entries to connected peers, in addition to DHT routing. [verified full text 2026-10-19] — [arXiv 2104.09202](https://arxiv.org/pdf/2104.09202)
- Henningsen et al. (IFIP Networking 2020) counted "an average of 44474 nodes at every given time" per crawl and noted that a node connected to every other node could monitor nearly all data requests. [node count verified 2026-10-19] — [arXiv 2002.07747](https://arxiv.org/pdf/2002.07747)
- Wu et al. (IFIP Networking 2024), "Secrets are forever", found sensitive files exposed on IPFS. Possessing a CID grants access, and content is hard to delete once replicated. — [PDF](https://www.securitee.org/files/ipfs_ifipnet2024.pdf)
- BitTorrent DHT crawling and swarm monitoring (cited in section 1) make large-scale profiling of content providers feasible. — [USENIX LEET'10](https://www.usenix.org/conference/leet-10/spying-world-your-laptop-identifying-and-profiling-content-providers-and-big)
- Iroh (n0) is a Rust QUIC-based P2P stack. It dials by public key, uses relay servers for NAT traversal, and transfers content-addressed blobs with BLAKE3 verified streaming. Hypercore (Holepunch) is a signed append-only log, discovered via the Hyperswarm DHT by topic hash. [canonical, not re-fetched] — [Iroh docs](https://www.iroh.computer/docs); [holepunchto/hypercore](https://github.com/holepunchto/hypercore)
  - On exposure (documentation and opinion, not measurement): a Hypercore FAQ states that "Hyperswarm announces IP and Port of the peer" and that because the DHT holds this, "any observer could simply collect this information", along with the advertised topic. It frames encrypting DHT data as a possible future improvement. An open HyperDHT issue discusses privacy-preserving lookups. [fetched 2026-10-19] — [tradle/why-hypercore FAQ](https://github.com/tradle/why-hypercore/blob/master/FAQ.md); [holepunchto/hyperdht#50](https://github.com/holepunchto/hyperdht/issues/50)

### Inferences
- Iroh and Hypercore both use key- or topic-based discovery. The discovery key, or a hash of it, is what an observer of the DHT or relay sees. If taste groups are discovered by a topic hash, anyone who knows the topic can enumerate members' IPs. Discovery keys should be secret and per-group.
- For takedown resistance, combine content addressing (verifiable re-hosting) with several independent pinners or seeders. For privacy, do not use a public DHT for interest-revealing lookups; use private relays plus OHTTP/Tor, or PIR, as in section 2.

### Gaps
- I found no peer-reviewed privacy measurement of Iroh or Hypercore/Hyperswarm (re-searched 2026-10-19). Only project docs, GitHub issues, blog posts and a qualitative comparison turned up: "IPFS and Friends", [arXiv 2102.12737](https://arxiv.org/pdf/2102.12737), not read in full.
- I did not verify current IPFS mitigations, such as double-hashed DHT lookups, this session.

## 5. Identity and keys (Nostr keypairs, AT Protocol DIDs, recovery)

### Takeaway
Nostr gives full self-sovereignty: identity is a secp256k1 keypair. There is no rotation or recovery in the base protocol, so losing or leaking the key loses or compromises the identity. AT Protocol's did:plc supports rotation keys and account migration, but it relies on a single directory. Bluesky has spun that directory out into a Swiss association, which changes who runs the chokepoint but does not remove it.

### Cited Findings
- did:plc was built in-house by Bluesky and relies on a global directory service that Bluesky has operated. — [atprotocol.dev](https://atprotocol.dev/bluesky-and-did-plc/)
- In September 2025 Bluesky announced it would spin out the PLC directory into an independent Swiss association, chosen as a "credibly neutral and stable" home. Later reports say the association is formally registered. — [manton.org](https://www.manton.org/2025/09/19/bluesky-is-spinning-out-the.html); [Bluesky announcement mirror](https://hackers.pub/@boltless/019961db-e167-71d2-9d4d-2dffb7689acc)
- Community critique (opinion, from informal posts) holds that the directory is still a central ledger. — [Lemmy thread](https://lemmy.imagisphe.re/post/1353212/3864704)
- NIP-44 Cure53 audit finding **NOS-01-007, "Lack of key separation in signing and encryption" (Low)**, points to a risk in reusing the same key for signing and encryption, which bears on single-key identity designs (see section 6). **Correction:** this was previously attributed to NOS-01-001, which is actually "Potential twist attacks in secp256k1 implementations" (Info). [verified against report 2026-10-19] — [Cure53 report](https://cure53.de/audit-report_nip44-implementations.pdf)

### Inferences
- For a taste-sharing app, separate long-term identity keys from per-group encryption keys. Support rotation, for example through signed key-succession or delegation records. Offer social recovery (Shamir shares to trusted contacts) or passkey/secure-enclave backups. Nostr's base model has no recovery, and that is a known UX failure mode.
- A did:plc-style directory is a soft chokepoint. A Swiss-jurisdiction operator could still be compelled to censor or freeze updates.

### Gaps
- I did not find details of the PLC association's board, funding, or rules for transparency logs and write access.
- I did not verify Nostr key-rotation proposals (for example, NIP-26 delegation, which is deprecated, or newer NIPs).

## 6. Encrypted group/peer messaging for exchanging taste sketches (MLS, NIP-17/44, Signal; CRDT sync)

### Takeaway
MLS (RFC 9420) is the standard for efficient group key agreement with forward secrecy and post-compromise security, and is the best fit for "taste circles". Nostr NIP-44 is audited but, by design, has **no forward secrecy**. Signal's Double Ratchet suits pairwise exchange. Local-first CRDTs (Automerge) can carry the shared taste state inside encrypted envelopes, but CRDT sync metadata (operation counts, timing) still leaks to relays.

### Cited Findings
- Cure53 audited NIP-44 and the JS/TS, Go and Rust implementations from late November to early December 2023. It found 10 issues (NOS-01-001 to NOS-01-010), described as "ten general weaknesses", and Cure53 found no exploitable vulnerabilities. The medium-severity issues were missing range checks (NOS-01-005) and **lack of forward secrecy (NOS-01-006)**. The low-severity issues were HMAC timing differences (NOS-01-004) and lack of signing/encryption key separation (NOS-01-007). NOS-01-001 is an informational concern: secp256k1 twist attacks with uncompressed, unverified keys could leak a private key, but the current implementation "was not found to be vulnerable". [verified against report 2026-10-19] Only the JS implementation was audited in its final form, per its maintainer. — [Cure53 audit report](https://cure53.de/audit-report_nip44-implementations.pdf); [paulmillr/nip44](https://github.com/paulmillr/nip44)
- A Nostr newsletter claims the issues were addressed before the spec was finalized. This is unverified against the primary report. — [Nostr Compass](https://buttondown.com/nostrcompass/archive/nostr-compass-4/)
- MLS, RFC 9420 (Barnes, Beurdouche, Robert, Millican, Omara & Cohn-Gordon; July 2023; Proposed Standard): efficient asynchronous group key establishment with forward secrecy and post-compromise security, for groups ranging from two members to thousands. It uses a ratchet tree; the log-scale cost of adds, removes and updates is the RFC's design goal but was not re-read here. [abstract and date verified 2026-10-19] — [RFC 9420](https://www.rfc-editor.org/rfc/rfc9420)
- **MLS over Nostr (Marmot):** Marmot combines MLS with Nostr relays for group messaging, and Least Authority calls it "the successor to NIP-EE", the first MLS-over-Nostr proposal. Its reference app is White Noise, built on the Rust MDK library. [verified 2026-10-19]
  - Least Authority's Marmot protocol review summary (7 Nov 2025) found no existing threat model and recommended defining one, along with careful use and separation of the MLS extractor key (used for NIP-44 encryption) and key compartmentalization. MIP-05 was excluded as incomplete.
  - The review notes that Nostr public keys and group tags travel in plaintext Nostr events. A network observer could therefore track group membership and message timing and volume, and an honest-but-curious relay could correlate a user's ephemeral identities with their IP address.
  - Least Authority completed a final audit of the White Noise Rust backend (whitenoise-rs) on 1 April 2026.
  - The marmot-protocol repository now marks the spec "Status: adopted" and says the older MIP-era documents describe a deprecated version.
  - A reported switch from NIP-44 to ChaCha20-Poly1305 for Marmot payloads was seen only in an undated search snippet and is unverified.
  - Sources: [Least Authority review summary (PDF)](https://leastauthority.com/white-noise-marmot-protocol-review-summary-report/); [Least Authority whitenoise-rs audit post, 7 Apr 2026](https://leastauthority.com/blog/audit-of-white-noise-whitenoise-rs/); [parres-hq/marmot](https://github.com/parres-hq/marmot)
- Local-first software and Automerge: CRDT documents that sync peer-to-peer and merge without a server. [canonical, not re-fetched] — [Ink & Switch, "Local-first software"](https://www.inkandswitch.com/local-first/); [Automerge](https://automerge.org)

### Inferences
- Recommended layering: MLS groups for taste circles. Each epoch's application message carries an encrypted, possibly differentially private, taste sketch or a CRDT delta. Delivery goes through relays that see only ciphertext and are reached via OHTTP, Tor or a mixnet. Pad and batch messages to blunt metadata leakage.
- If you build on Nostr, NIP-17/NIP-44 is acceptable for low-stakes data but lacks forward secrecy. A key compromise exposes all past taste exchanges stored on relays.

### Gaps
- ~~MLS-over-Nostr status~~: resolved above. Marmot succeeded NIP-EE and was audited in 2025–26. Its metadata exposure to relays (pubkeys, group tags, IPs) is the main residual risk for taste circles built on it.
- I did not find audits of MLS implementations such as OpenMLS this session.

## 7. Legal: US VPPA, GDPR, and developer controller obligations

### Takeaway
Watch history is regulated personal data in both the US (VPPA) and the EU (GDPR), and inferences from it can become GDPR special-category data. Who counts as a VPPA "consumer" is before the US Supreme Court (Salazar v. Paramount Global, cert. granted 26 Jan 2026, argued 14 Oct 2026, undecided as of 19 Oct 2026). Under GDPR, decentralization does not remove controller duties. EDPB says parties are assessed on their factual influence, and a developer who only ships software and never processes data has a stronger argument that it is not a controller than one that runs default relays, indexes or recommendation servers.

### Cited Findings
- VPPA (18 U.S.C. § 2710) bars "video tape service providers" from knowingly disclosing personally identifiable information that identifies a consumer as having requested specific video materials. Damages are $2,500 per violation. [canonical, not re-fetched] — [18 U.S.C. § 2710](https://www.law.cornell.edu/uscode/text/18/2710)
- The Supreme Court granted cert in Salazar v. Paramount Global (No. 25-459) on 26 Jan 2026. The question is whether the VPPA "consumer" definition (renter, purchaser or subscriber of "goods or services") covers all of a video tape service provider's offerings or only its audiovisual ones. Salazar subscribed to a 247Sports newsletter and alleges a Meta pixel disclosed his video viewing. The circuit split [verified 2026-10-19]:
  - Narrow reading: Sixth Circuit (*Salazar v. Paramount Global*, 133 F.4th 642 (2025)) and D.C. Circuit (*Pileggi v. Washington Newspaper Publishing Co.*, 146 F.4th 1219 (2025)).
  - Broad reading: Second Circuit (*Salazar v. NBA*, 118 F.4th 533 (2024); cert. denied Dec 2025) and Seventh Circuit (*Gardner v. Me-TV*, 132 F.4th 1022 (2025)).
- **Status as of 2026-10-19:** the case was **argued on 14 October 2026** and **no decision has issued**. A decision is expected by the end of the October 2026 Term, i.e. by about June 2027.
  - SCOTUSblog's read is that the Court "seemed likely to let" the suit proceed, i.e. to adopt the broader reading of "consumer". Several justices doubted whether Paramount is a "video tape service provider" at all, which was not the question presented. Justice Barrett raised standing, and Justices Kavanaugh and Kagan suggested companies can avoid liability by obtaining consent.
  - Press accounts of the argument differ in emphasis.
  - Sources: [SCOTUSblog, 14 Oct 2026](https://www.scotusblog.com/2026/10/court-appears-likely-to-allow-internet-suit-based-on-decades-old-video-privacy-law-to-go-forward/); [Cornell LII case page](https://www.law.cornell.edu/supct/cert/25-459); [Paul Weiss memo](https://www.paulweiss.com/insights/client-memos/supreme-court-to-resolve-circuit-split-concerning-definition-of-consumer-under-vppa); [Baker Botts](https://ourtake.bakerbotts.com/post/102med0/supreme-court-to-take-on-definition-of-consumer-under-vppa); [cert petition](https://www.supremecourt.gov/DocketPDF/25/25-459/379417/20251010164519322_25-%20_______Petition%20for%20Writ.pdf); [TCPAWorld](https://tcpaworld.com/2026/01/26/breaking-video-privacy-set-to-be-latest-battleground-as-supreme-court-considers-definition-of-consumer-under-vppa/)
- EDPB Guidelines 02/2025 on blockchain. Version 1.1 was adopted on 8 April 2025 for consultation, which ran to 9 June 2025. The **final version 2.0 was adopted on 7 July 2026 after public consultation**, announced on 8 July 2026 alongside a consultation-outcome report and a track-changes version. [verified 2026-10-19]
  - Roles are assessed factually per processing activity, and governance is key.
  - The final text keeps: "technical impossibility cannot be invoked to justify non-compliance with GDPR requirements".
  - On governance it says: "The decentralised governance model used by blockchain leads to a multiplicity of actors… However, neither this fact nor the selection of a particular technical infrastructure can be used as a reason not to comply with the GDPR."
  - Per Bird & Bird, v2.0's changes are modest. They include a stronger necessity and proportionality assessment, a preference for permissioned blockchains, and more detailed DPIA expectations. These change details are from the law-firm summary and were not diffed by me.
  - Sources: [EDPB final guidelines v2.0 (PDF)](https://www.edpb.europa.eu/system/files/2026-07/edpb_guidelines_202502_blockchain_v2_en.pdf); [EDPB news, 8 July 2026](https://www.edpb.europa.eu/news/edpb-sheds-light-on-anonymisation-and-web-scraping-for-generative-ai-and-adopts-final-version_en); [Bird & Bird](https://www.twobirds.com/en/insights/2026/netherlands/edpb-adopts-final-guidelines-on-blockchain-and-personal-data-a-practical-guide-for-organisations); earlier draft: [EDPB v1 PDF](https://www.edpb.europa.eu/system/files/documents/2025-06/edpb-guidelines-on-processing-of-personal-data-through-blockchain-9-june-2025.pdf), [Clifford Chance](https://www.cliffordchance.com/insights/resources/blogs/talking-tech/en/articles/2025/06/edpb-draft-guidelines-on-personal-data-processing-through-blockc.html)
- Industry pushback (claim, made on the 2025 draft): nodes in permissionless systems do not determine purposes or means and should not count as controllers. — [A&O Shearman summary](https://www.aoshearman.com/en/insights/ao-shearman-on-data/edpb-publishes-draft-guidelines-on-personal-data-in-blockchain)
- CJEU case law on joint controllership and special categories:
  - Wirtschaftsakademie (C-210/16) and Fashion ID (C-40/17): joint controllership arises from influencing purposes and means, even without access to the data. [canonical, not re-fetched]
  - **OT v Vyriausioji tarnybinės etikos komisija (C-184/20, Grand Chamber, 1 August 2022)** [verified 2026-10-19 via the OJ notice and law-firm commentary; judgment text not retrievable]:
    - Publishing personal data "indirectly disclosing the sexual orientation of a natural person" counts as processing special-category data under Art. 9(1) GDPR. The case concerned officials' declarations of private interests published online under Lithuanian anti-corruption law. The detail that the data was the name of a spouse or partner is from prior knowledge and was not re-verified.
    - The Court did not adopt the Advocate General's narrower "intellectual exercise involving deduction" distinction.
  - **Meta Platforms v Bundeskartellamt (C-252/21, Grand Chamber, 4 July 2023, ECLI:EU:C:2023:537)** [verified 2026-10-19 via the FRA case-law summary]:
    - Suppose a user visits websites or apps relating to an Art. 9(1) category, or enters information into them. When a social-network operator collects that data via integrated interfaces, cookies or similar technologies, links it to the user's account and uses it, this is processing of special-category data. It is prohibited unless an Art. 9(2) derogation applies, wherever the processing "allows information falling within one of those categories to be revealed", and "irrespective of whether that information concerns a user of that network or any other natural person".
    - The Court also held that merely visiting such sites does not make the data "manifestly made public" (Art. 9(2)(e)). Clicking "Like"/"Share" counts only if the user has explicitly chosen beforehand to make it public to an unlimited number of persons.
  - Links: [CURIA C-40/17](https://curia.europa.eu/juris/liste.jsf?num=C-40/17); [CURIA C-184/20](https://curia.europa.eu/juris/liste.jsf?num=C-184/20); [Ganado Advocates on C-184/20](https://ganado.com/cjeu-widens-the-scope-of-sensitive-personal-data-under-the-gdpr/); [CURIA C-252/21](https://curia.europa.eu/juris/liste.jsf?num=C-252/21); [FRA summary of C-252/21](https://fra.europa.eu/en/node/44533)

### Inferences
- Video watch history can reveal sexual orientation, religion, health and politics. Under C-184/20 and C-252/21 reasoning, recommendation inferences built from it may be Article 9 data, which needs explicit consent or another Art. 9(2) derogation. C-252/21 says this applies where processing "allows" such information to be revealed. It also says viewing alone does not make the data "manifestly public", so public "likes" or taste lists count only with an explicit prior choice to publish. Keeping taste vectors on-device and E2E-encrypting any exchange keeps the developer out of the processing loop.
- Controller exposure grows with the infrastructure the developer runs: default relays, bootstrap servers, analytics, recommendation services. Shipping client software alone is the weakest basis for controllership, though EDPB's factual-influence test means design choices, such as hardcoded defaults, could still count.
- VPPA risk attaches to a provider that discloses which videos a person watched. A P2P design where peers learn others' viewing (PeerTube-style swarms) or where taste sketches are shared could create disclosure arguments if the app operator is a "video tape service provider". Salazar's outcome will shape that.

### Gaps
- ~~EDPB 02/2025 final status~~: resolved. v2.0 was adopted on 7 July 2026; the detailed diff of changes was not reviewed directly.
- I found no case law applying VPPA or GDPR controllership to a fully decentralized P2P video app or its developer.
- ~~Salazar status~~: resolved. It was argued on 14 Oct 2026 and is undecided as of 2026-10-19, with a decision expected by about June 2027. **Correction:** the earlier note assumed argument in the October 2025 Term and a decision by June 2026; that was wrong, because the January 2026 grant was set for the October 2026 Term.

## Revision log (2026-10-19)
Second pass to verify unverified items, gaps and "[canonical, not re-fetched]" items against primary sources where they were reachable.

**Corrections**
- **Cure53 / NIP-44:** the signing/encryption key-reuse risk is **NOS-01-007 (Low)**, not NOS-01-001. NOS-01-001 is the informational twist-attack issue. Ten findings were confirmed (NOS-01-001 to NOS-01-010).
- **Kolektiva:**
  - The instance had about 7,800 members (CyberInsider), not "about 8,000 active users".
  - IP addresses were held only for users who had logged in within the three days before the backup.
  - The backup also included posts and DMs.
  - Users were notified on 30 June 2023.
  - Sources are now EFF directly and CyberInsider.
- **Telegram (Sept 2024):** disclosure requires a "valid order from the relevant judicial authorities", not merely "valid legal requests".
- **Salazar v. Paramount:** the gap note wrongly assumed an October 2025 Term argument. The case was argued on 14 Oct 2026 and is undecided; the circuit-split cases are now fully cited.
- **Signal / Martiny:** the "ephemeral identities" description was replaced with the paper's own summary (SDA; as few as 5 messages; two proposed solutions).

**Newly verified or updated**
- Damus China removal (2 Feb 2023).
- Navalny Smart Voting removal by Apple and Google (17 Sept 2021).
- Durov case timeline and status: under investigation, no trial order reported, travel ban reportedly lifted Nov 2025.
- LBRY shutdown and receivership (Oct 2023) and Odysee's sale to Forward Research (June 2024).
- NIP-17 details (draft status, `p` tag visible, NIP-42 AUTH).
- RFC 9458 (Jan 2024) and RFC 9420 (July 2023).
- Loopix abstract.
- Nym 2026 status from Nym's own roadmap.
- Balduf et al. figures (two monitors, 15 months, 2.78·10^10 entries) and Henningsen's node count.
- EDPB Guidelines 02/2025 v2.0 adopted 7 July 2026, with quotes re-checked in the final text.
- CJEU C-184/20 and C-252/21 holdings.

**Added**
- Chrome Safe Browsing's OHTTP deployment via Fastly (2024).
- Android Private Compute Services' stated use of PIR (2021).
- Marmot / MLS-over-Nostr status and Least Authority audit findings.
- Hyperswarm IP-exposure documentation.

**Still unresolved / caveats**
- **PeerTube:** no state seizure or takedown found (absence of evidence).
- **Nostr relays:** no documented government or host pressure found; only speculative discussion.
- **Google PIR:** no named Chrome or Android feature confirmed to use PIR.
- **Iroh/Hypercore:** no peer-reviewed privacy measurement exists that I could find.
- **Nym:** node counts and latency figures are unverified.
- **CJEU:** C-184/20's fact pattern and full judgment text were not retrieved (EUR-Lex and CURIA did not return content), and C-210/16 and C-40/17 were not re-fetched.
- **Durov:** status relies on Wikipedia and secondary reports.
- **Marmot:** the NIP-44 to ChaCha20-Poly1305 change is unverified.
- **Not re-checked this pass:**
  - OONI/Russia Tor figures;
  - DSA/OSA items;
  - PeerTube privacy guide quotes;
  - Apple HE/PIR items;
  - did:plc / PLC directory items;
  - the Nostr Compass claim;
  - Wu et al. 2024;
  - IPFS double-hashing.
