# Censorship Resistance, Metadata Privacy and Distribution Infrastructure for a Decentralized Video + P2P Taste-Sharing App

Scope note: research as of 2026-10-19. Sources marked **[fetched/searched this session]** were checked against search results or the page itself during this research. Sources marked **[canonical, not re-fetched]** are well-known primary documents (RFCs, peer-reviewed papers, statutes) cited from prior knowledge at their stable URLs; the report writer should treat their specific details as reliable but not re-verified here. Claims are labelled as fact vs. claim/opinion where it matters.

## 1. How have states actually pressured decentralized/federated networks?

### Takeaway
States rarely attack "the protocol". They attack the chokepoints that a decentralized system still has: the people and machines operating servers (seizures, raids, liability laws), app stores (removal on government request), companies and founders (arrest, securities law), and the network layer (DPI blocking of Tor/bridges). Federation spreads the risk across many operators, but each operator is a small, under-resourced target holding plaintext data. Distributed regulation (EU DSA, UK OSA) also falls on that operator's shoulders, and some respond by geoblocking.

### Cited Findings
**Server/operator seizure (fediverse)**
- In May 2023 the FBI raided the home of a Kolektiva.social (Mastodon) admin in a protest-related investigation that Kolektiva says it was not the subject of. Agents seized an **unencrypted** database backup the admin was using for troubleshooting. It held user account data including email addresses, possibly IP addresses, and hashed passwords for an instance of about 8,000 active users. Kolektiva disclosed this about six weeks later. [fetched/searched this session] — [Business & Human Rights Resource Centre](https://www.business-humanrights.org/fr/derni%C3%A8res-actualit%C3%A9s/usa-fbi-seizes-a-mastodon-server-cso-warns-about-privacy-concerns/); [Linux Today / "Why Kolektiva.social Is a Warning"](https://www.linuxtoday.com/news/why-kolektiva-social-is-a-warning-for-activists-using-mastodon); the "unencrypted backup" detail comes from Kolektiva's own statement as quoted on [Lemmy](https://old.lemmy.dbzer0.com/post/1180157) (secondary relay of a primary statement)
- EFF's view (opinion): the raid "put the thousands of users this instance served into a terrible situation", and Mastodon operators should collect as little data as possible. — summarized via [Business & Human Rights Resource Centre](https://www.business-humanrights.org/fr/derni%C3%A8res-actualit%C3%A9s/usa-fbi-seizes-a-mastodon-server-cso-warns-about-privacy-concerns/)

**App store removal**
- Apple removed Damus, a Nostr client, from the China App Store around 2–3 Feb 2023, about two days after its global launch. The removal followed a demand from the Cyberspace Administration of China, which said the app violated rules on security assessments for services with "public opinion or social mobilization attributes". The app stayed available elsewhere. [searched this session] — [RFA](https://rfa.org/english/news/china/app-store-02032023190706.html); [iMore](https://www.imore.com/apps/social-apps/apple-yanks-twitter-like-app-from-the-app-store-citing-chinese-demands)
- This is a precedent: Apple removed VPN apps from the China App Store in 2017, and removed the Navalny "Smart Voting" app in Russia in 2021 under government pressure. [canonical, not re-fetched] — [NYT 2017](https://www.nytimes.com/2017/07/29/technology/china-apple-censorhip.html). I did not re-verify the Russia 2021 removal this session; treat it as background.

**Founder/company liability (Telegram)**
- Pavel Durov was arrested in France in August 2024 and released on €5M bail. Sources describe the charges in different ways: complicity in CSAM distribution, failure to curb illegal content, and refusing to help with lawful interception. [searched this session] — [Security Boulevard](https://securityboulevard.com/2024/09/ceo-durov-says-telegram-will-provide-more-data-to-governments/)
- In September 2024 Telegram changed its privacy policy. It now discloses IP addresses and phone numbers in response to "valid legal requests" about criminal suspects. Previously it did so only for terrorism suspects with a court order. — [Gulf News](https://gulfnews.com/technology/media/telegram-to-share-more-data-with-authorities-tighten-illegal-content-controls-says-ceo-pavel-durov-1.1727146898815); [Gigazine](https://www.gigazine.net/gsc_news/en/20240924-telegram-provide-more-data)
- Lesson (fact pattern): a centralized operator with logs and a reachable executive can be compelled. Telegram's default chats are not end-to-end encrypted, so it holds the data.

**Securities law against a decentralized video platform (LBRY)**
- On 7 Nov 2022 the D.N.H. court (Judge Barbadoro) granted the SEC summary judgment that LBRY's LBC token was offered as an unregistered security. It was the first SEC action against a token that was not sold through an ICO. — [Skadden](https://www.skadden.com/insights/publications/2022/11/court-rules-in-favor-of-sec); [Morrison Foerster](https://mofo.com/resources/insights/221110-court-rules-lbry-token)
- LBRY Inc. later wound down. I did not verify the details of the wind-down or Odysee's current status this session (see Gaps).

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
- I did not verify the final status of LBRY's wind-down or Odysee's ownership this session.
- I found no case of a state seizing or ordering takedown of a PeerTube instance specifically. That is absence of evidence from limited searching.
- I did not research hosting-provider pressure on Nostr relays (relay deplatforming), or the current status of the Durov case in 2026.
- I did not check whether the EDPB or the Commission issued DSA guidance specific to the fediverse after 2025.

## 2. Metadata privacy: what relays/servers learn, and the tools to limit it

### Takeaway
End-to-end encryption hides content but not who talks to whom, when, or how much. In a taste-sharing network the social graph and fetch patterns are themselves sensitive, because they reveal interests. Deployable mitigations, from cheap to expensive: sealed-sender style sender hiding (weak against timing correlation), Oblivious HTTP (splits IP from request with two non-colluding parties), Tor onion services (low latency, vulnerable to global adversaries and blocking), mixnets (Loopix/Nym: resist global passive adversaries at a latency and cover-traffic cost), and PIR for fetching content without revealing which item (now deployed at scale by Apple).

### Cited Findings
- **Relay visibility (Nostr):** NIP-17 private DMs wrap NIP-44-encrypted messages in "gift wrap" events signed by ephemeral keys with randomized timestamps, so relays do not learn the sender. The recipient pubkey is still visible to the relay, and relays still see the client's IP. [canonical, not re-fetched] — [NIP-17](https://github.com/nostr-protocol/nips/blob/master/17.md)
- **Signal sealed sender:** this removes the sender identity from the envelope the server sees. Martiny et al. (NDSS 2021) showed that a server can de-anonymize sealed-sender conversations through statistical disclosure attacks on timing, using delivery receipts. They proposed fixes based on ephemeral identities. [canonical, not re-fetched] — [Signal blog](https://signal.org/blog/sealed-sender/); [NDSS 2021 "Improving Signal's Sealed Sender"](https://www.ndss-symposium.org/ndss-paper/improving-signals-sealed-sender/)
- **Oblivious HTTP (RFC 9458, Jan 2024):** a client encrypts a request to a gateway using HPKE and sends it through a relay. The relay sees the client IP but not the request, and the gateway sees the request but not the IP. Privacy depends on the relay and gateway not colluding, and the RFC is not meant for linked sessions. [canonical, not re-fetched] — [RFC 9458](https://www.rfc-editor.org/rfc/rfc9458)
- **Mixnets:** Loopix (Piotrowska et al., USENIX Security 2017) uses Poisson mixing, cover ("loop") traffic and stratified topology to resist global passive adversaries, with seconds-level latency. Nym is a deployed descendant with incentivized mix nodes. [canonical, not re-fetched] — [USENIX Security '17 Loopix](https://www.usenix.org/conference/usenixsecurity17/technical-sessions/presentation/piotrowska); [Nym whitepaper](https://nymtech.net/nym-whitepaper.pdf)
- **Tor onion services:** these hide both server and client IP behind circuits and give self-authenticating addresses. As shown in section 1, Tor can be blocked at the network level and depends on pluggable transports/bridges in censored countries. [canonical, not re-fetched] — [Tor onion services overview](https://community.torproject.org/onion-services/overview/); blocking: [OONI](https://ooni.org/post/2021-russia-blocks-tor/)
- **PIR / homomorphic encryption at scale:** Apple uses BFV homomorphic encryption for PIR-style keyword lookups (iOS 18 Live Caller ID Lookup, which keeps third-party caller ID servers from seeing the number). Enhanced Visual Search uses private nearest-neighbour search: HE plus differential privacy, an anonymization network, and fake queries. The client sends the coarse cluster ID in the clear and the embedding encrypted. Apple open-sourced swift-homomorphic-encryption. — [Apple ML Research](https://machinelearning.apple.com/research/homomorphic-encryption); caveat that Apple itself may still see call info (opinion of a practitioner): [Jeremy Kun](https://jeremykun.com/fhe-in-production)
- **Consent backlash (claim):** Enhanced Visual Search was enabled by default and drew public criticism around January 2025. This comes from a secondary, opinion-leaning source. — [Wavect blog](https://wavect.io/blog/fully-homomorphic-encryption-practical-2026.md)

### Inferences
- The private-nearest-neighbour design in Enhanced Visual Search (cluster ID in the clear, embedding encrypted) is a directly reusable pattern for "find similar taste profiles" or "fetch recommendations for my taste vector" without revealing the vector. It leaks coarse cluster membership, so the cluster granularity has to be chosen on purpose.
- For fetching video manifests or metadata without revealing interest, OHTTP is the cheapest realistic layer, but it needs two independent operators. PIR over a catalogue index is feasible for keyword-style lookups. PIR over video bytes is not practical at video sizes; use PIR for the index, then fetch through OHTTP, Tor or a mixnet.
- Sealed sender alone is insufficient against a relay that also observes timing. Taste-sketch exchanges should be batched, padded and delayed (asynchronous, not chatty) to make statistical disclosure harder. Taste sharing tolerates latency, which makes mixnets viable.

### Gaps
- I did not find a published deployment of PIR or mixnets specifically for video recommendation.
- I did not verify Google's PIR deployments this session (for example, Chrome's or Android's private lookups).
- I did not verify Nym's current mainnet status or performance figures as of 2026.

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
- Balduf et al. (ICDCS 2022) passively monitored IPFS data requests for 15 months from two nodes, collecting about 2.78×10^10 request entries. They showed that public gateways could be identified and surveilled. The leak comes from IPFS broadcasting Bitswap want-lists to connected peers in addition to DHT routing. — [arXiv 2104.09202](https://arxiv.org/pdf/2104.09202)
- Henningsen et al. (IFIP Networking 2020) counted about 44,474 IPFS nodes on average and noted that a node connected to every other node could monitor nearly all data requests. — [arXiv 2002.07747](https://arxiv.org/pdf/2002.07747)
- Wu et al. (IFIP Networking 2024), "Secrets are forever", found sensitive files exposed on IPFS. Possessing a CID grants access, and content is hard to delete once replicated. — [PDF](https://www.securitee.org/files/ipfs_ifipnet2024.pdf)
- BitTorrent DHT crawling and swarm monitoring (cited in section 1) make large-scale profiling of content providers feasible. — [USENIX LEET'10](https://www.usenix.org/conference/leet-10/spying-world-your-laptop-identifying-and-profiling-content-providers-and-big)
- Iroh (n0) is a Rust QUIC-based P2P stack. It dials by public key, uses relay servers for NAT traversal, and transfers content-addressed blobs with BLAKE3 verified streaming. Hypercore (Holepunch) is a signed append-only log, discovered via the Hyperswarm DHT by topic hash. [canonical, not re-fetched] — [Iroh docs](https://www.iroh.computer/docs); [holepunchto/hypercore](https://github.com/holepunchto/hypercore)

### Inferences
- Iroh and Hypercore both use key- or topic-based discovery. The discovery key, or a hash of it, is what an observer of the DHT or relay sees. If taste groups are discovered by a topic hash, anyone who knows the topic can enumerate members' IPs. Discovery keys should be secret and per-group.
- For takedown resistance, combine content addressing (verifiable re-hosting) with several independent pinners or seeders. For privacy, do not use a public DHT for interest-revealing lookups; use private relays plus OHTTP/Tor, or PIR, as in section 2.

### Gaps
- I found no peer-reviewed privacy measurement of Iroh or Hypercore/Hyperswarm.
- I did not verify current IPFS mitigations, such as double-hashed DHT lookups, this session.

## 5. Identity and keys (Nostr keypairs, AT Protocol DIDs, recovery)

### Takeaway
Nostr gives full self-sovereignty: identity is a secp256k1 keypair. There is no rotation or recovery in the base protocol, so losing or leaking the key loses or compromises the identity. AT Protocol's did:plc supports rotation keys and account migration, but it relies on a single directory. Bluesky has spun that directory out into a Swiss association, which changes who runs the chokepoint but does not remove it.

### Cited Findings
- did:plc was built in-house by Bluesky and relies on a global directory service that Bluesky has operated. — [atprotocol.dev](https://atprotocol.dev/bluesky-and-did-plc/)
- In September 2025 Bluesky announced it would spin out the PLC directory into an independent Swiss association, chosen as a "credibly neutral and stable" home. Later reports say the association is formally registered. — [manton.org](https://www.manton.org/2025/09/19/bluesky-is-spinning-out-the.html); [Bluesky announcement mirror](https://hackers.pub/@boltless/019961db-e167-71d2-9d4d-2dffb7689acc)
- Community critique (opinion, from informal posts) holds that the directory is still a central ledger. — [Lemmy thread](https://lemmy.imagisphe.re/post/1353212/3864704)
- NIP-44 Cure53 audit finding NOS-01-001 points to a risk in reusing keys between signing and encryption, which bears on single-key identity designs (see section 6). — [Cure53 report](https://cure53.de/audit-report_nip44-implementations.pdf)

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
- Cure53 audited NIP-44 and the JS/TS, Go and Rust implementations from late November to early December 2023. It found 10 issues, all "general weaknesses" with limited exploitation potential. The medium-severity issues were missing range checks (NOS-01-005) and **lack of forward secrecy (NOS-01-006)**. NOS-01-001 is an informational secp256k1 twist-attack concern with uncompressed keys that could leak a private key. Only the JS implementation was audited in its final form, per its maintainer. — [Cure53 audit report](https://cure53.de/audit-report_nip44-implementations.pdf); [paulmillr/nip44](https://github.com/paulmillr/nip44)
- A Nostr newsletter claims the issues were addressed before the spec was finalized. This is unverified against the primary report. — [Nostr Compass](https://buttondown.com/nostrcompass/archive/nostr-compass-4/)
- MLS, RFC 9420 (July 2023): asynchronous group key agreement using a ratchet tree, with log-scale cost for adds, removes and updates, forward secrecy and post-compromise security. [canonical, not re-fetched] — [RFC 9420](https://www.rfc-editor.org/rfc/rfc9420)
- Local-first software and Automerge: CRDT documents that sync peer-to-peer and merge without a server. [canonical, not re-fetched] — [Ink & Switch, "Local-first software"](https://www.inkandswitch.com/local-first/); [Automerge](https://automerge.org)

### Inferences
- Recommended layering: MLS groups for taste circles. Each epoch's application message carries an encrypted, possibly differentially private, taste sketch or a CRDT delta. Delivery goes through relays that see only ciphertext and are reached via OHTTP, Tor or a mixnet. Pad and batch messages to blunt metadata leakage.
- If you build on Nostr, NIP-17/NIP-44 is acceptable for low-stakes data but lacks forward secrecy. A key compromise exposes all past taste exchanges stored on relays.

### Gaps
- I did not check the status of MLS-over-Nostr work (for example, the "Marmot"/NIP-EE proposals) as of 2026.
- I did not find audits of MLS implementations such as OpenMLS this session.

## 7. Legal: US VPPA, GDPR, and developer controller obligations

### Takeaway
Watch history is regulated personal data in both the US (VPPA) and the EU (GDPR), and inferences from it can become GDPR special-category data. Who counts as a VPPA "consumer" is before the US Supreme Court (Salazar v. Paramount Global, cert. granted 26 Jan 2026). Under GDPR, decentralization does not remove controller duties. EDPB says parties are assessed on their factual influence, and a developer who only ships software and never processes data has a stronger argument that it is not a controller than one that runs default relays, indexes or recommendation servers.

### Cited Findings
- VPPA (18 U.S.C. § 2710) bars "video tape service providers" from knowingly disclosing personally identifiable information that identifies a consumer as having requested specific video materials. Damages are $2,500 per violation. [canonical, not re-fetched] — [18 U.S.C. § 2710](https://www.law.cornell.edu/uscode/text/18/2710)
- The Supreme Court granted cert in Salazar v. Paramount Global (No. 25-459) on 26 Jan 2026 to decide whether a "consumer" must subscribe to audiovisual goods or services. The Sixth and D.C. Circuits read it narrowly; the Second (Salazar v. NBA) and Seventh (Gardner v. Me-TV) read it broadly. — [Baker Botts](https://ourtake.bakerbotts.com/post/102med0/supreme-court-to-take-on-definition-of-consumer-under-vppa); [cert petition](https://www.supremecourt.gov/DocketPDF/25/25-459/379417/20251010164519322_25-%20_______Petition%20for%20Writ.pdf); [TCPAWorld](https://tcpaworld.com/2026/01/26/breaking-video-privacy-set-to-be-latest-battleground-as-supreme-court-considers-definition-of-consumer-under-vppa/)
- EDPB Guidelines 02/2025 on blockchain (draft adopted April 2025; consultation to 9 June 2025): roles are assessed factually per processing activity, and governance is key. "Technical impossibility cannot be invoked to justify non-compliance with GDPR requirements." Decentralised governance is "not a reason not to comply". — [EDPB guidelines PDF](https://www.edpb.europa.eu/system/files/documents/2025-06/edpb-guidelines-on-processing-of-personal-data-through-blockchain-9-june-2025.pdf); [Clifford Chance](https://www.cliffordchance.com/insights/resources/blogs/talking-tech/en/articles/2025/06/edpb-draft-guidelines-on-personal-data-processing-through-blockc.html)
- Industry pushback (claim): nodes in permissionless systems do not determine purposes or means and should not count as controllers. — [A&O Shearman summary](https://www.aoshearman.com/en/insights/ao-shearman-on-data/edpb-publishes-draft-guidelines-on-personal-data-in-blockchain)
- CJEU case law on joint controllership and special categories [canonical, not re-fetched]:
  - Wirtschaftsakademie (C-210/16) and Fashion ID (C-40/17): joint controllership arises from influencing purposes and means, even without access to the data.
  - OT v Vyriausioji (C-184/20, 2022): data that indirectly reveals sensitive traits can count as special-category data.
  - Meta v Bundeskartellamt (C-252/21, 2023): processing of browsing data can reveal special categories.
  - Links: [CURIA C-40/17](https://curia.europa.eu/juris/liste.jsf?num=C-40/17); [CURIA C-184/20](https://curia.europa.eu/juris/liste.jsf?num=C-184/20); [CURIA C-252/21](https://curia.europa.eu/juris/liste.jsf?num=C-252/21)

### Inferences
- Video watch history can reveal sexual orientation, religion, health and politics. Under C-184/20 and C-252/21 reasoning, recommendation inferences built from it may be Article 9 data, which needs explicit consent. Keeping taste vectors on-device and E2E-encrypting any exchange keeps the developer out of the processing loop.
- Controller exposure grows with the infrastructure the developer runs: default relays, bootstrap servers, analytics, recommendation services. Shipping client software alone is the weakest basis for controllership, though EDPB's factual-influence test means design choices, such as hardcoded defaults, could still count.
- VPPA risk attaches to a provider that discloses which videos a person watched. A P2P design where peers learn others' viewing (PeerTube-style swarms) or where taste sketches are shared could create disclosure arguments if the app operator is a "video tape service provider". Salazar's outcome will shape that.

### Gaps
- I could not determine whether EDPB Guidelines 02/2025 were finalized after consultation, or how they changed.
- I found no case law applying VPPA or GDPR controllership to a fully decentralized P2P video app or its developer.
- I did not check whether the Supreme Court has decided Salazar v. Paramount as of 2026-10-19. A decision would be due by about June 2026 if it was argued in the October 2025 Term.
