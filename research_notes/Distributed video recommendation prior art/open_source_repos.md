# Open-source repositories (prior art) for a federated video app with peer-shared-taste, on-device recommendations

Research date: 2026-10-19. Repo metadata (stars, language, license, last push) comes from the ecosyste.ms repository API (`repos.ecosyste.ms/api/v1/hosts/GitHub/repositories/<owner>%2F<repo>`), queried 2026-10-19, unless noted. The GitHub API itself was not reachable from this session. "Last push" is the date of the most recent push to GitHub. Stars are approximate. **[unverified]** marks a detail I did not confirm from a primary page.

Metadata source for all GitHub rows: [ecosyste.ms repos API](https://repos.ecosyste.ms/). PeerTube plugin data comes from the [PeerTube plugin index API](https://packages.joinpeertube.org/api/v1/plugins) (183 plugins listed on 2026-10-19). npm data comes from [registry.npmjs.org](https://registry.npmjs.org/).

## Q1: Does any repo already do peer-shared-taste recommendations for video (or any media)?

### Takeaway
I found no maintained open-source project that combines the three pieces this design needs for video (or any media): users choose specific peers, those peers share encrypted watch/like history, and each device computes its own recommendations. The closest prior art splits into three partial matches:
- **Tribler's BuddyCast** (historical): gossip exchange of download histories between "taste buddies". Peers were found automatically rather than chosen, and histories were public, not encrypted.
- **solidheron's PeerTube extension**: on-device content-based recommendations from local watch and like data, with no sharing at all.
- **A few server-side "co-like" feeds and research prototypes** (spacecowboy's For You feed on Bluesky, LikeMinds, REX/SGX, Web3Recommend).

The matching-and-sharing layer would be new work. The parts that exist can be borrowed: MLS-over-Nostr (Marmot) for encrypted groups, PSI libraries for private taste matching, and small CF libraries for on-device scoring.

### Cited Findings
**Closest matches (partial):**
- **Tribler BuddyCast**:
  - What it was: Tribler's historical "decentralized, user-based collaborative filtering" protocol. Each peer kept the top-N most similar peers ("taste buddies") with their download histories, plus a list of random peers. It periodically swapped histories with a taste buddy (exploitation) or a random peer (exploration). It recommended files that taste buddies had downloaded and the user had not. — [Tribler wiki: DecentralizedRecommendation](https://www.tribler.org/DecentralizedRecommendation)
  - Privacy: download histories were publicly visible, and users appeared under nicknames. The wiki page describes V3/V4 and links to old SVN sources, so it appears outdated. — [Tribler wiki](https://www.tribler.org/DecentralizedRecommendation)
  - Current Tribler: the main repo [Tribler/tribler](https://github.com/Tribler/tribler) (Python, GPL-3.0, ~5.3k stars, last push 2026-10-09) now describes itself as a "Privacy enhanced BitTorrent client with P2P content discovery". Its README does not mention BuddyCast. — [GitHub](https://github.com/Tribler/tribler)
- **solidheron/peertube_recomendation_algorythm** ("Peertube Picks"), https://github.com/solidheron/peertube_recomendation_algorythm:
  - Repo facts: JavaScript Chrome extension, MIT per the README page (ecosyste.ms shows no detected license), 4–8 stars, last push 2025-05-01.
  - What it records: watch duration and likes/dislikes on PeerTube pages. It also fetches video metadata from a list of instances into IndexedDB (about 100 MB).
  - How it ranks: it builds bag-of-words vectors from title, tags and description. It weights them by watch time and by +1/−1 for likes and dislikes, then ranks by cosine similarity. Everything runs locally.
  - What it lacks: the README does not mention any peer sharing, sync, or federation. — [GitHub](https://github.com/solidheron/peertube_recomendation_algorythm), [Lemmy alpha post](https://lemmy.ml/post/29267681)
- **PeerTube issue #6978**, "Recommendation algorithm set up" (opened 2025-04-11 by solidheron). — [GitHub issue](https://github.com/Chocobozzz/PeerTube/issues/6978)
  - Proposal: add `Video_description_vector` and `Video_description_vector_history` fields to video JSON, so that locally run or per-instance recommenders can use them.
  - Status: still open, labeled "Component: Recommendation" and "Type: Discussion". Chocobozzz has not commented.
  - Discussion: one commenter suggested text embeddings combined with collaborative filtering and raised the cold-start and small-instance CF problems.
- **spacecowboy's "For You" feed** (Bluesky):
  - Algorithm: it "finds people who liked the same posts as you, and shows you what else they've liked recently". This is co-like, user-based CF, which is exactly the signal this app wants, but it runs centrally.
  - Implementation: a Go server plus SQLite, with a 419 GB main DB and 90-day retention, serving about 72K daily users at 15–25 QPS.
  - Source code: the post does not link to any, so the code is not confirmed open source. — [AT Protocol blog](https://atproto.com/blog/serving-the-for-you-feed), [Simon Willison](https://simonwillison.net/2026/Apr/24/serving-the-for-you-feed/)
- **CompMotifs/LikeMinds**, https://github.com/CompMotifs/LikeMinds (Python/Streamlit, 0 stars, last push 2025-03-27): "Bluesky matching based on shared liked academic posts". It ranks people by TF-IDF similarity or like overlap and recommends the most similar people you don't yet follow. This is taste-based peer matching, done centrally on public data. — [ecosyste.ms metadata](https://repos.ecosyste.ms/); description from [search snippet of GitHub page](https://github.com/CompMotifs/LikeMinds)
- **rafaelppires/rex**, https://github.com/rafaelppires/rex (C++, Apache-2.0, 4 stars, last push 2022-06-02): "SGX decentralized recommender system". It shares raw data between nodes inside Intel SGX enclaves rather than sharing models. It accompanies the paper "TEE-based decentralized recommender systems" ([arXiv 2202.11655](https://arxiv.org/pdf/2202.11655)). It is research code that requires the SGX SDK.
- **Web3Recommend** (TU Delft, Madhwal & Pouwelse): a decentralised social recommender for Android Web3 apps built on GraphJet plus MeritRank, integrated with MusicDAO. — [arXiv 2307.01411](https://arxiv.org/html/2307.01411v1)
  - Code: I could not find a standalone public repo. MusicDAO lives in [Tribler/trustchain-superapp](https://github.com/Tribler/trustchain-superapp) (Kotlin, GPL-3.0, 86 stars, last push 2025-04-22), which has `musicdao`, `musicdao-datafeeder` and `peerai` folders. Its README does not mention Web3Recommend.
- **GOSSPLE / WhatsUp** (EPFL/INRIA): gossip-based interest-clustered overlays and a decentralized news recommender. They are research systems with no code release found. — [CORDIS GOSSPLE report](https://cordis.europa.eu/project/id/204742/reporting/es), [WhatsUp](https://infoscience.epfl.ch/record/199106)
- **Not a match:** [aautonomicc/Watch-It](https://github.com/aautonomicc/Watch-It) syncs watch lists and positions between a user's *own* devices over P2P end-to-end encrypted transfer, on the Autonomi network. It has no friend sharing and no recommendations, per the search summary of its GitHub page. **[details unverified beyond search snippet]**

### Inferences
- The novel contribution here is the combination: chosen peers, end-to-end encrypted sharing of interaction history, and local CF. Each piece exists separately:
  - Encrypted groups: Marmot/MLS (Q4).
  - Private overlap measurement: PSI-cardinality (Q6).
  - Local scoring: small JS CF libraries (Q7), or a solidheron-style content vector.
  - P2P transport: iroh, libp2p, Hypercore (Q5).
- BuddyCast is the best conceptual template: explore/exploit gossip plus taste buddies. This design replaces public histories with an encrypted MLS group and replaces automatic buddy discovery with user choice, optionally aided by PSI-cardinality scores.

### Gaps
- I could not confirm whether any BuddyCast code remains in current Tribler. Inference only: it appears to have been removed long ago.
- I could not confirm whether spacecowboy's For You source is public.
- I did not find the Web3Recommend source repo.

## Q2: PeerTube ecosystem

### Takeaway
Core PeerTube has no recommender plugin ecosystem to speak of. A scan of the 183-plugin index found only one plugin that claims "smart/hybrid recommendations", plus featured-content and channel-explorer plugins. The useful external prior art is two community projects (solidheron's extension and denikryt's PeerTube-browser) and Sepia Search.

### Cited Findings
- **Chocobozzz/PeerTube**, https://github.com/Chocobozzz/PeerTube: TypeScript, AGPL-3.0, ~15.4k stars, last push 2026-10-16. "ActivityPub-federated video streaming platform using P2P directly in your web browser". Its REST API and ActivityPub actors are the integration surface. — [ecosyste.ms](https://repos.ecosyste.ms/)
- **PeerTube plugin index** (183 plugins on 2026-10-19). A keyword scan for recommend/related/discover/trend/suggest/popular/explore/featured/similar returned only these:
  - `peertube-plugin-yaktube-ondemand` (v1.6.9, updated 2026-10-19, AGPL-3.0-or-later on npm): "Accessible On-Demand YouTube Import, Live Streams, Smart Recommendations…". Repo: https://github.com/yakistir98/peertube-plugin-yaktube-ondemand (JavaScript, 0 stars). Its GitHub description says "Hybrid Recommendations". Algorithm **[unverified]**. — [plugin index API](https://packages.joinpeertube.org/api/v1/plugins?search=recommend), [npm](https://registry.npmjs.org/peertube-plugin-yaktube-ondemand/latest)
  - `peertube-plugin-featured-page` (0.0.1): "Adds a page with featured channels and featured videos". — [plugin index](https://packages.joinpeertube.org/api/v1/plugins?search=featured)
  - `peertube-plugin-orion-channel-explorer` (1.3.1): "Allow users to explore channels in the Discover page". — [plugin index](https://packages.joinpeertube.org/api/v1/plugins?search=discover)
  - `peertube-plugin-hide-channels-in-search-result`, `peertube-plugin-matomo`, `peertube-plugin-orion-admin-stats`, `peertube-plugin-video-published-webhook` (an HMAC-signed webhook on publish, useful for ingest), and `peertube-plugin-peerhub` / `peertube-plugin-hive-tube` (cross-network engagement and monetization). — [plugin index](https://packages.joinpeertube.org/api/v1/plugins)
- **peertube-plugin-livechat**, https://github.com/JohnXLivingston/peertube-plugin-livechat: TypeScript, AGPL-3.0, 112 stars, last push 2026-09-15. It is a mature example of a large PeerTube plugin that uses XMPP federation. — [ecosyste.ms](https://repos.ecosyste.ms/)
- **solidheron/peertube_recomendation_algorythm**: see Q1. MIT, on-device cosine-similarity recommendations stored in IndexedDB.
- **denikryt/PeerTube-browser**, https://github.com/denikryt/PeerTube-browser: Python, AGPL-3.0, 2 stars, last push 2026-10-13. Live site: peertube-browser.com. — [GitHub](https://github.com/denikryt/PeerTube-browser)
  - Crawl and index: it crawls instances on the JoinPeerTube whitelist, builds SQLite plus a FAISS ANN index over metadata embeddings (model not named).
  - Ranking: it mixes similarity-to-liked videos, freshness and popularity, using explore/exploit/popular/random/fresh "layers".
  - Architecture: a strict engine (read API) / client backend (write API) split.
- **Sepia Search / search-index**, https://framagit.org/framasoft/peertube/search-index: AGPL-3.0, created 2020-02-13, ~623 commits. This is Framasoft's PeerTube cross-instance search indexer. Architecture (likely TypeScript plus Meilisearch or Elasticsearch) **[unverified]**. — [Framagit](https://framagit.org/framasoft/peertube/search-index)

### Inferences
- A PeerTube plugin is the wrong place for peer-shared taste, because plugins run server-side or in an instance's web client. A browser extension or standalone client, as solidheron did, keeps history on the device.
- PeerTube-browser's FAISS plus layer-mixing pipeline is a good model for a cross-instance candidate generator. The local device would re-rank its output using peer signals.

### Gaps
- I did not read the yaktube plugin's source to see what its "hybrid recommendations" do.
- I did not confirm the Sepia Search tech stack.
- I did not check the PeerTube client's built-in "recommended videos" logic. My knowledge says it is tag- and recency-based, but that is unverified, and the GitHub directory URL I tried returned 404.

## Q3: Fediverse discovery

### Takeaway
Fediverse discovery code is mostly popularity trends (Mastodon) and follow-graph suggestions (Followgraph). None of it uses taste similarity across private histories.

### Cited Findings
- **mastodon/mastodon**, https://github.com/mastodon/mastodon: Ruby, AGPL-3.0, ~50.4k stars, last push 2026-10-19. — [ecosyste.ms](https://repos.ecosyste.ms/)
  - Trends code lives in `app/models/trends/` (`statuses.rb`, `links.rb`, `tags.rb`, `history.rb`, `query.rb`, plus filter and batch classes). — [GitHub tree](https://github.com/mastodon/mastodon/tree/main/app/models/trends)
  - The v2 follow-suggestions API, added in 3.4.0, returns accounts "promoted by staff, or that the user has had past positive interactions with". — [Mastodon API docs](https://docs-p.joinmastodon.org/methods/suggestions/)
- **joinloops/loops-server**, https://github.com/joinloops/loops-server: PHP, AGPL-3.0, 458 stars, last push 2026-10-15. "The federated short video sharing platform". It has "Following and For You feeds", but the README does not describe the ranking. — [GitHub](https://github.com/joinloops/loops-server)
- **pixelfed/pixelfed**: PHP, AGPL-3.0, ~7.1k stars, last push 2026-10-16. — [ecosyste.ms](https://repos.ecosyste.ms/)
- **gabipurcaru/followgraph**, https://github.com/gabipurcaru/followgraph: TypeScript, MIT, 220 stars, last push 2023-09-02. It suggests accounts that your follows follow, computed client-side via public APIs. — [ecosyste.ms](https://repos.ecosyste.ms/), [AlternativeTo](https://alternativeto.net/software/followgraph-for-mastodon/about)
- **hodgesmr/mastodon_digest**, https://github.com/hodgesmr/mastodon_digest: Python, BSD-3, 438 stars, last push 2023-07-12. It aggregates popular posts from your own timeline, which makes it a personal, local ranker. — [ecosyste.ms](https://repos.ecosyste.ms/)
- **yukimochi/Activity-Relay**, https://github.com/yukimochi/Activity-Relay: Go, AGPL-3.0, 331 stars, last push 2026-10-16. A customizable ActivityPub relay. — [ecosyste.ms](https://repos.ecosyste.ms/)
- **FediDB**: I found no public source repo (the `FediDB/fedidb` lookup returned not found).

### Inferences
- Followgraph's pattern fits this app's "creators to follow" side: compute suggestions on the client from the public follow graph, with no server.

### Gaps
- Mastodon's trend scoring formula was not read; only filenames were seen.
- I did not confirm whether FediDB's source is open.

## Q4: Nostr: Web of Trust, DVM feeds, video clients, MLS (Marmot)

### Takeaway
Nostr has the richest relevant stack:
- personalized-PageRank Web of Trust (Vertex, GrapeRank)
- an algorithmic relay (AlgoRelay)
- a NIP-90 DVM framework with feed DVMs
- active video clients (diVine, nostube, zap.stream)
- most importantly, **Marmot**: MLS-based end-to-end encrypted groups over Nostr, with Rust and TypeScript SDKs. Marmot is the closest ready-made substrate for "encrypted taste-sharing groups of chosen peers".

### Cited Findings
**Marmot / White Noise (MLS over Nostr):**
- Marmot is "a messaging protocol that specifies how to do efficient end-to-end encrypted group messaging using Nostr's decentralized identity & relay network combined with the MLS Protocol". Repos:
  - spec: https://github.com/marmot-protocol/marmot (MIT, ~141–144 stars, last push 2026-10-08)
  - **MDK**, the Marmot Development Kit: https://github.com/marmot-protocol/mdk (Rust, MIT, 67 stars, last push 2026-10-12)
  - **marmot-ts**: https://github.com/marmot-protocol/marmot-ts (TypeScript, MIT, 25 stars, last push 2026-10-05)
  - whitenoise-rs: https://github.com/marmot-protocol/whitenoise-rs (Rust, AGPL-3.0, 449 stars)
  - Flutter app: https://github.com/marmot-protocol/whitenoise (Dart, AGPL-3.0)
  - The org has 49 repos, including `marmots-web-chat` (a marmot-ts reference implementation) and `awesome-marmot`. — [GitHub org](https://github.com/marmot-protocol), [ecosyste.ms](https://repos.ecosyste.ms/)
- Audits: Least Authority reviewed the Marmot protocol (MIPs 00–04; MIP-05 excluded as incomplete) and audited whitenoise-rs. The final report is dated 2026-04-01. — [Least Authority protocol review](https://leastauthority.com/white-noise-marmot-protocol-review-summary-report/), [whitenoise-rs audit](https://leastauthority.com/white-noise-whitenoise-rs-final-audit-report/)
- Why MLS: the White Noise team moved to MLS to get forward secrecy and post-compromise security without a central server. — [White Noise year in review](https://damus.io/naddr1qq6hw6rfw3jj6mn0d9ek2tfdd4shymt0wskhqun0w3hkxmmv95erqv3595erqv3494uk2ctj945kuttjv4mxjethqyt8wumn8ghj7un9d3shjtnswf5k6ctv9ehx2aqzyp6awd7rguj8zq5ugjrkkvcdy2zz3zjzw7d4jx3w6nd2r3kq0ma0wqcyqqq823c25cyvm)

**Web of Trust / ranking:**
- **Vertex** (vertex-lab): a Web-of-Trust DVM service using Personalized PageRank. Its initial DVMs are Verify Reputation, Recommend Follows and Sort Authors. It is MIT and explicitly rejected the NIP-85 approach. Repos:
  - https://github.com/vertex-lab/crawler_v2 (Go, MIT, 8 stars, last push 2026-07-02): "Crawl the Nostr network, build a social graph and use it to compute Monte Carlo pagerank"
  - https://github.com/vertex-lab/relay (Go, MIT, 10 stars)
  - https://github.com/vertex-lab/npub.world (Svelte)
  - archived `crawler` (random walks for PPR) and `nostr-sqlite` (Go)
  - — [GitHub org](https://github.com/vertex-lab), [No Bullshit Bitcoin](https://www.nobsbitcoin.com/vertex-web-of-trust-as-a-service/)
- **GrapeRank** (NosFabrica / David Strayhorn), https://github.com/Pretty-Good-Freedom-Tech/graperank-nodejs (TypeScript, AGPL-3.0, 11 stars, last push 2025-04-18). — [GitHub](https://github.com/Pretty-Good-Freedom-Tech/graperank-nodejs)
  - Purpose: "a sovereignty respecting recommendation engine" for people or content based on Webs of Trust.
  - Inputs: pluggable interpreters for follows, mutes and reports (likes are possible).
  - Outputs: planned as NIP-51, NIP-90 and NIP-85 events. The project is marked WIP.
  - Related: https://github.com/wds4/brainstorm (JavaScript, AGPL-3.0, 5 stars, last push 2024-09-07), "bringing web of trust to nostr via the tapestry protocol". — [GitHub search result](https://github.com/wds4), [ecosyste.ms](https://repos.ecosyste.ms/)
- **nostr-wot/nostr-wot**, https://github.com/nostr-wot/nostr-wot (MIT, 8 stars, last push 2026-10-12): a toolkit to query social-graph distance between pubkeys. It includes a browser extension for client-side WoT queries. — [ecosyste.ms](https://repos.ecosyste.ms/)

**Feeds / DVMs:**
- **bitvora/algo-relay**, https://github.com/bitvora/algo-relay (Go, MIT, 54 stars, 66 commits; funded by OpenSats). — [GitHub](https://github.com/bitvora/algo-relay), [No Bullshit Bitcoin](https://nobsbitcoin.com/algorelay-nostr-algorithmic-relay)
  - What it does: an "algorithm relay" that serves personalized feeds without DVMs.
  - Ranking weights: interactions-with-author, global comments/reactions/zaps, recency with a decay rate, and viral-post dampening.
  - Client support: Coracle is the first client to display its feeds.
- **believethehype/nostrdvm**, https://github.com/believethehype/nostrdvm (Python, MIT, ~55 stars, last push 2026-09-12): "Framework to run NIP90 Nostr DVMs". It includes popularity and discovery feeds (counting replies, reactions, reposts and zaps) and WoT author filtering. — [GitHub](https://github.com/believethehype/nostrdvm)
- **nostr-protocol/data-vending-machines**: the DVM kind registry (archived, last push 2025-05-15). — [ecosyste.ms](https://repos.ecosyste.ms/)

**Video clients:**
- **divinevideo** (diVine, the Vine revival). — [GitHub org](https://github.com/divinevideo)
  - Apps: https://github.com/divinevideo/divine-mobile (Dart/Flutter, MPL-2.0, 266 stars, last push 2026-10-19) and https://github.com/divinevideo/divine-web (TypeScript, MPL-2.0, 50 stars).
  - Supporting repos: keycast (NIP-46 signing), a relay manager, and a fork of ROOST "coop" moderation.
  - Feeds: the org README mentions planned "choose your experience" feed algorithms. No recommender repo is visible in the first 10 of 41 repos.
- **flox1an/nostube**, https://github.com/flox1an/nostube (TypeScript plus a Rust server, MIT, 38 stars, last push 2026-10-11): "Nostr based video platform". It is a monorepo with a web app, a Rust relay, Blossom and an HLS loader. No recommendation logic is described. — [GitHub](https://github.com/flox1an/nostube)
- **v0l/zap.stream**, https://github.com/v0l/zap.stream (TypeScript, MIT, 66 stars, last push 2026-10-12) and https://github.com/v0l/zap-stream-core (Rust, GPL-3.0, 27 stars). Nostr live streaming. — [ecosyste.ms](https://repos.ecosyste.ms/)

**SDKs:**
- **nostr-dev-kit/ndk**, https://github.com/nostr-dev-kit/ndk (TypeScript, MIT, 452 stars, last push 2026-04-16): "Nostr Development Kit with outbox-model support". — [ecosyste.ms](https://repos.ecosyste.ms/)
- **nbd-wtf/nostr-tools**, https://github.com/nbd-wtf/nostr-tools (TypeScript, Unlicense, 854 stars, last push 2026-09-30). — [ecosyste.ms](https://repos.ecosyste.ms/)

### Inferences
- Marmot (MDK in Rust, marmot-ts in TypeScript) plus NDK or nostr-tools could carry encrypted "taste packets" (hashed or encrypted watch/like vectors) to a group of chosen peers. Each device then runs CF locally.
- Vertex and GrapeRank give Sybil-resistant ranking of *people*. That is useful for suggesting candidate peers to match with, and for weighting each peer's influence.
- Licenses differ across these components. MDK and marmot-ts are MIT, while the White Noise apps are AGPL.

### Gaps
- The rust-nostr repo path was not confirmed (the `rust-nostr/nostr` lookup returned not found).
- I did not confirm whether diVine has an open recommender ("funnelcake" or similar).
- I did not verify current NIP-71 (video events) support in each client.

## Q5: AT Protocol, and P2P recommenders and infrastructure

### Takeaway
AT Protocol offers a mature, open feed-generator pattern (server-side "skeleton" feeds), but nothing peer-private. On the P2P side, the mature transport and streaming libraries are iroh, libp2p, Hypercore/Autobase/Pear, WebTorrent and p2p-media-loader. TU Delft (Tribler) is the main source of P2P recommender research code.

### Cited Findings
**AT Protocol:**
- **bluesky-social/feed-generator**, https://github.com/bluesky-social/feed-generator (TypeScript, MIT, ~2.1k stars, 714 forks, last push 2026-09-25). — [GitHub](https://github.com/bluesky-social/feed-generator)
  - It subscribes to the firehose and indexes into SQLite.
  - It returns a `getFeedSkeleton` list of URIs, and the PDS hydrates them.
  - Requests carry a JWT signed with the user's ES256K key and are needed only for personalized feeds.
- **bluesky-social/ozone** (TypeScript, 544 stars, last push 2026-10-14): a labeling and moderation UI. **bluesky-social/atproto** (TypeScript, ~9.7k stars). **bluesky-social/indigo** (Go, Apache-2.0, ~1.4k stars). — [ecosyste.ms](https://repos.ecosyste.ms/)
- **blacksky-algorithms/rsky**, https://github.com/blacksky-algorithms/rsky (Rust, Apache-2.0, 706 stars, last push 2026-10-12): an AT Protocol implementation "prioritizing community safety and self-governance". — [ecosyste.ms](https://repos.ecosyste.ms/)
- **skyfeed-dev/feed-generator**, https://github.com/skyfeed-dev/feed-generator (Dart, AGPL-3.0, last push 2023-06-11): the feed generator for skyfeed.xyz feeds. It is stale. — [ecosyste.ms](https://repos.ecosyste.ms/)
- **jlewi/bsctl** (Go, MIT, 8 stars): a CLI for collaborative, community-curated Bluesky feeds, with membership lists kept in GitHub. — [ecosyste.ms](https://repos.ecosyste.ms/)
- Graze and Skylight: no public source repo found (`graze-social/graze` returned not found).

**Tribler / TU Delft:**
- **Tribler/py-ipv8**, https://github.com/Tribler/py-ipv8 (Python, LGPL-3.0, 260 stars, last push 2026-07-08): an authenticated P2P overlay layer. — [GitHub](https://github.com/Tribler/py-ipv8)
- **Tribler/kotlin-ipv8** (Kotlin, 71 stars, last push 2025-02-07). — [ecosyste.ms](https://repos.ecosyste.ms/)
- **MeritRank**: Sybil-tolerant personalized-PageRank reputation from TU Delft ([arXiv 2207.09950](https://arxiv.org/pdf/2207.09950)).
  - Python: https://github.com/ichorid/meritrank-python (GPL-2.0, 4 stars, last push 2024-06-19), also on [PyPI](https://pypi.org/project/meritrank-python/0.1.1).
  - Rust: https://github.com/vsradkevich/meritrank exists, but its canonical status is **[unverified]**.
- **G-Rank** ([arXiv 2301.12530](https://arxiv.org/abs/2301.12530)): unsupervised learn-to-rank for edge devices in a P2P music network. No code repo was found.

**Transport and streaming:**
- **n0-computer/iroh**, https://github.com/n0-computer/iroh (Rust, Apache-2.0, ~12.7k stars, last push 2026-10-13): "dial keys instead" of IP addresses; QUIC plus NAT traversal.
- **libp2p**: js-libp2p (TypeScript, 2.6k stars), rust-libp2p (Rust, 5.6k stars), go-libp2p (Go, 6.9k stars). All are active.
- **Holepunch**: hypercore (JavaScript, MIT, 2.9k stars), autobase (multi-writer, Apache-2.0, 158 stars) and pear (430 stars).
- **webtorrent/webtorrent** (JavaScript, MIT, ~31.4k stars, last push 2026-10-17).
- **Novage/p2p-media-loader**, https://github.com/Novage/p2p-media-loader (TypeScript, Apache-2.0, ~1.7k stars, last push 2026-10-13): P2P HLS/DASH in the browser.
- Source for all transport rows: [ecosyste.ms](https://repos.ecosyste.ms/).

### Inferences
- The AT Protocol skeleton pattern (a ranker returns IDs; a hydrator fills in content) is a clean interface to copy for the on-device ranker. Bluesky feed generators, though, are server-side and see user likes in public.
- iroh or Hypercore/Autobase are plausible alternatives to Nostr relays for direct device-to-device taste sync. Autobase's multi-writer log maps naturally onto a "shared taste log" among matched peers.

### Gaps
- Tribler's current "popularity community" code was not inspected.
- Skylight and Graze source availability is unconfirmed.

## Q6: Privacy primitives

### Takeaway
Production-grade libraries exist for every primitive likely to be needed:
- PSI and PSI-cardinality, to measure taste overlap without revealing histories
- MLS, for group encryption
- HE/PIR
- DAP/Prio, for private aggregate stats
- differential privacy, for noisy shared vectors

### Cited Findings
- **OpenMined/PSI**, https://github.com/OpenMined/PSI (C++ with bindings, Apache-2.0, 152 stars, last push 2026-09-20): "Private Set Intersection Cardinality protocol based on ECDH and Bloom Filters". There are JS/WASM bindings **[unverified in this session]**.
- **google/private-join-and-compute** (C++, Apache-2.0, 857 stars, last push 2026-03-09): private intersection-sum.
- **microsoft/APSI** (C++, MIT, 214 stars, last push 2026-10-02): asymmetric labeled and unlabeled PSI.
- **tiktok-privacy-innovation/PETAce** (Python, Apache-2.0, 33 stars, last push 2025-02-28): used by TikTok for PSI-based friend matching. TikTok notes that plain SHA-256 hashing cannot protect low-entropy identifiers. — [DEV post](https://dev.to/privacyinnovation/petace-in-action-enhancing-privacy-during-friends-matching-in-tiktok-16po)
- **apple/swift-homomorphic-encryption** (Swift, Apache-2.0, 661 stars, last push 2026-10-12): HE plus PIR applications.
- **zama-ai/tfhe-rs** (Rust, custom license, ~1.7k stars).
- **openmls/openmls**, https://github.com/openmls/openmls (Rust, MIT, ~1k stars, last push 2026-10-19). **wireapp/core-crypto** (Rust, GPL-3.0, 51 stars).
- **divviup/janus** (Rust, MPL-2.0, 69 stars; DAP aggregator) and **divviup/libprio-rs** (Rust, MPL-2.0, 122 stars).
- **google/differential-privacy** (Go/C++/Java, Apache-2.0, ~3.4k stars) and **opendp/opendp** (Rust/Python, MIT, 439 stars).
- Source for all rows without their own link: [ecosyste.ms](https://repos.ecosyste.ms/).

### Inferences
- PSI-cardinality (OpenMined) is a strong fit for a "how similar are we?" handshake *before* two users agree to match and share full histories.
- After matching, MLS groups (via Marmot or OpenMLS) protect the shared logs. Optional DP noise on shared vectors limits what a malicious matched peer learns.

### Gaps
- I did not verify WASM or mobile bindings for OpenMined PSI or APSI in this session.

## Q7: On-device recommender libraries, and local-first data

### Takeaway
The mature recommender libraries are Python (implicit, LightFM, Surprise, RecBole, TFRS) and suit prototyping or offline evaluation. Browser and JS options are small and few: disco-node, likely.js, knn-recommender. For a device-local CF over a few hundred matched peers, a hand-rolled item-kNN or a tiny ALS in TS/Rust/WASM is realistic. Local-first CRDTs (Automerge, Yjs, Jazz, DXOS) can hold the shared taste state.

### Cited Findings
**Python recommender libraries:**
- benfred/implicit (Python, MIT, ~3.8k stars, last push 2026-05-08): implicit-feedback ALS/BPR.
- lyst/lightfm (Python, Apache-2.0, ~5.1k stars, last push 2024-07-24): hybrid content plus CF.
- NicolasHug/Surprise (BSD-3, ~6.8k stars).
- RUCAIBox/RecBole (MIT, ~4.6k stars, last push 2025-02-24).
- tensorflow/recommenders (Apache-2.0, ~2k stars, last push 2026-10-06).
- facebookresearch/faiss (MIT, ~41k stars): ANN search.

**JS/TS options:**
- ankane/disco-node, https://github.com/ankane/disco-node (JavaScript, MIT, 57 stars, last push 2026-06-27): "Recommendations for Node.js using collaborative filtering", with user- and item-based matrix factorization. Browser compatibility is **[unverified]**.
- sbyrnes/likely.js (JavaScript, MIT, 201 stars, last push 2018): stale.
- knn-recommender (npm v3.0.0, MIT, repo github.com/koodiohto/knn-recommender): pure-JS kNN for "node and browser", suited to about 1,000 users with ±1 ratings. — [npm](https://registry.npmjs.org/knn-recommender/latest), [npm page](https://npmjs.com/package/knn-recommender)

**Local-first data:**
- automerge/automerge (MIT, ~6.7k stars, last push 2026-10-19).
- yjs/yjs (~22.9k stars).
- garden-co/jazz (Rust, MIT, 207 stars): now "a local-first relational database for the browser, React Native and your backend".
- dxos/dxos (TypeScript, 527 stars, last push 2026-10-19).

Source for rows without their own link: [ecosyste.ms](https://repos.ecosyste.ms/).

### Inferences
- The suggested client stack:
  - **Content side:** a solidheron-style text vector, or small embeddings plus local ANN.
  - **CF side:** item-kNN or co-occurrence over the union of the user's and matched peers' encrypted-then-decrypted histories, which is the BuddyCast idea done privately. disco-node or a WASM port of implicit-ALS could serve as the core.
- I found no project calling itself a "local-first recommendation" engine. This appears to be an open niche.

### Gaps
- I found no "local-first recommender" repo, despite searching phrases such as decentralized recommendation, p2p collaborative filtering and taste sharing.
- I did not verify browser builds of disco-node.
