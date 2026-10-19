# Prior art: decentralized and user-controlled recommendations (video focus) and the "follow + match / shared history" idea

Scope note: research done 2026-10-19 with about 17 search/fetch calls. Items marked **[verified]** were checked against a fetched page or search results in this session. Items marked **[background, not re-verified]** come from general knowledge. Their URLs are canonical project pages, but the specific claims were not re-checked this session, so the report writer should hedge them.

## Has anyone built this exact thing? Follow creators, plus a "match" relationship where chosen peers exchange watch/like history to drive video recommendations, on an open or decentralized substrate

### Takeaway
I found no shipped product or protocol that combines all three parts: (a) following creators, (b) an explicit, consented peer "match" link through which two or more users exchange private watch/like history, and (c) recommendations computed from that shared history on a decentralized or user-controlled substrate. Each part exists on its own. Centralized, closed services pair (b) and (c): Spotify Blend, YouTube Music Taste Match, Plex Discover Together, and historically Last.fm neighbours. The only working decentralized version of (b)+(c) is Tribler's BuddyCast "taste buddies" from 2006–2008, which was P2P collaborative filtering over download histories, used gossip with similar peers, and was not opt-in per peer. It has since been removed. On the open protocols (Nostr, ATproto, ActivityPub), recommendation work centers on public social-graph trust (follows) and public engagement. None of them has a standard way to share private watch history with chosen peers, and ATproto's "permissioned data" is still at proposal stage.

### Cited Findings

**Closest analogues: consented taste-sharing between chosen people (centralized)**
- **Spotify Blend** [verified]. One user invites another, and Spotify generates a shared playlist from both users' tastes that refreshes daily. A "taste match score" is shown as a percentage, along with the song that brings the two together. Blend launched officially in 2021. — [TechCrunch](https://techcrunch.com/?p=2196189); [RouteNote](https://routenote.com/blog/?p=87509)
- Spotify later expanded Blend to up to 10 people and to some artists. — [Engadget](https://www.engadget.com/spotify-blend-10-people-artists-update-143038156.html)
- Spotify does not publish how the match score is calculated. Search results describing Blend did not explain the computation (gap).
- **YouTube Music "Taste Match"** [verified, thin]. You send an invite link to a friend and get a combined playlist. This is the closest video-company analogue, but it covers music only. — [Android Central](https://www.androidcentral.com/apps-software/how-to-taste-match-your-youtube-music-playlist-with-a-friend)
- **Plex Discover Together** [verified]. It went public in Nov 2023 as a social layer: watch history, watchlist and ratings can each be set to Private or Friends Only. Friends' activity shows in an Activity feed, and title pages show which friends watched or rated a title. — [TechCrunch](https://techcrunch.com/2023/11/01/plex-becomes-a-social-network-with-public-debut-of-discover-together); [Plex forum](https://forums.plex.tv/t/discover-together-public-release/857227)
  - What it got wrong: the privacy setting applies to a whole category of content at once, and a weekly friends'-activity email was on by default. This caused a backlash, and Plex added an opt-out. — [Cord Cutters News](https://cordcuttersnews.com/this-new-plex-feature-shares-your-weird-watch-history-with-friends-and-its-tricky-to-turn-off/); [The Register](https://www.theregister.com/2023/11/28/plex_privacy/)
  - It covers only activity on Plex. It does not import history from other streaming services. — [Cord Cutters News](https://cordcuttersnews.com/plexs-new-discover-together-makes-the-app-more-like-social-media/)
- **Last.fm neighbours** [verified for existence]. Last.fm's 2008 blog post "Musical Soulmates" introduced neighbours as a way to meet other users "who have lots in common with you", computed from public scrobble (listening) history. A "taste-o-meter" compared two users. — [Last.fm blog 2008](https://blog.last.fm/2008/08/22/musical-soulmates)
  - Current status unclear. I found no primary source confirming when or whether neighbours was removed. Only a weak secondary blog mention exists. — [bubbles.town](https://bubbles.town/entry/17742987)
- **Consumer movie "match" apps** [verified, listings only]. Minu ("Movie Match" connects people with shared taste) and Matched (couples swipe on titles and get recommendations). Both are closed apps. — [Minu App Store](https://apps.apple.com/us/app/minu-watch-movies-together/id1608136692); [Matched Google Play](https://play.google.com/store/apps/details?id=io.taste.matched&hl=en_US)
- **Trakt, Letterboxd, Goodreads** [background, not re-verified]. These are social logging services where you follow people and see their watch/read activity. Trakt has an open API that third-party apps use to import full watch history (e.g., What2WatchAI per its listing). — [Trakt](https://trakt.tv); [Letterboxd](https://letterboxd.com); [JustWatched listing](https://apps.apple.com/us/app/-/id6748724422)

**Closest decentralized analogue: Tribler BuddyCast (P2P "taste buddies")**
- Tribler (TU Delft) ran a decentralized recommender that compared download histories to find "taste buddies" and recommended files they had that you lacked. Tribler describes it as decentralized user-based collaborative filtering. — [Tribler: DecentralizedRecommendation](https://tribler.org/DecentralizedRecommendation)
- How it worked: each peer keeps a list of its most similar peers and a list of random peers. It periodically gossips with a taste buddy (exploitation) or a random peer (exploration). BuddyCast3 added ratings and comments. — [Tribler: Buddycast3](https://tribler.org/Buddycast3); [Tribler paper, TU/e](https://research.tue.nl/en/publications/tribler-a-social-based-peer-to-peer-system/)
- The approach was applied to P2P TV, predicting interest from zapping (channel-switching) behaviour. — [CWI](https://ir.cwi.nl/pub/13818)
- Status: a Tribler forum reply from the team says "Taste-Buddies algorithms" were removed about a decade ago. — [Tribler forum](https://forum.tribler.org/t/clarification-needed-regarding-cooperative-downloading/7064); context in [Pouwelse et al., "fifteen year struggle"](https://arxiv.org/pdf/1404.4818)
- Lessons: the design is technically close (history-sharing with similar peers, gossip). But history was shared with algorithmically chosen peers rather than consented "matches", which raises privacy issues, and the feature did not survive.

**Academic P2P collaborative filtering (no shipping products found)**
- P2PCF (2021): each peer sees only its friends' interactions, and recommendations are computed locally. The design aims at privacy and cold start. This is the closest academic match to "share with chosen peers". — [SAGE / JHS](https://journals.sagepub.com/doi/full/10.3233/JHS-210649)
- TU Darmstadt (2009): a P2P recommender that restricts information exchange to friends and avoids super-peers. — [PDF](https://www.kom.tu-darmstadt.de/papers/PKFS09_567.pdf)
- PipeCF and DHT-based distributed CF: distributed CF scales comparably to centralized CF. — [ScienceDirect](https://www.sciencedirect.com/science/article/abs/pii/S0957417404000065); [ResearchGate](https://www.researchgate.net/publication/221000888_Distributed_Collaborative_Filtering_for_Peer-to-Peer_File_Sharing_Systems)
- An extended search for an open-protocol app that shares watch history with friends found no such open-source product. — search conducted 2026-10-19 (no URL; negative result)

### Inferences
- The "match" concept is validated as a consumer feature in centralized form (Spotify Blend, Taste Match, Plex) and was technically demonstrated P2P (Tribler). The new part would be consented, pairwise, private history exchange plus local CF on an open protocol, applied to video.
- What went wrong in the analogues: Plex's all-or-nothing visibility and default-on emails, and Tribler's non-consensual similarity gossip. Both suggest per-item or per-peer controls and explicit opt-in.
- Blend's visible match percentage and "the song that brings you together" are the parts users share socially. That makes them a likely good UX pattern to borrow.

### Gaps
- I could not verify whether Last.fm neighbours still exists.
- Spotify Blend's algorithm is undisclosed.
- I did not check whether any Nostr or ATproto hobby project implements "shared watch history with chosen follows". GitHub code search was unavailable (GitHub MCP failed to connect).

## Fediverse (ActivityPub): PeerTube, Sepia Search, PeerTube Picks, Loops, Owncast, Funkwhale, Mastodon discovery

### Takeaway
PeerTube itself has essentially no personalized recommendation engine. Its "next video" suggestion was described in an issue tracker as random. Personalization exists only in third-party, client-side experiments that keep history local and share nothing (PeerTube Picks). Loops (fediverse TikTok-style) has a For You feed using engagement, hashtags and social-graph signals. Fediverse discovery is mostly server-side trending plus search indexes.

### Cited Findings
- **PeerTube Picks** [verified]. A Firefox add-on that recommends PeerTube videos using cosine similarity over the videos you watched and liked. Watch history stays in the browser, with export/import/delete in its Options page. It contacts servers only to fetch video metadata. The author is Cattail@lemmy.world. It is "meant to be open source", but no repo or license was linked. — [PieFed post](https://piefed.jeena.net/post/169216)
- **PeerTube recommendation algorithm (alpha)** [verified]. A Chromium extension by the same author, with repo `solidheron/peertube_recomendation_algorythm`. It pulls videos from several instances and ranks by "like similarity" and "time engagement similarity" (cosine similarity over English title/description/tag words). It halves the scores of already-seen videos and caps results at 5 per channel. Data is stored in IndexedDB, for a single user only, with "no data sharing yet". — [PieFed post](https://piefed.jeena.net/post/158506); [GitHub](https://github.com/solidheron/peertube_recomendation_algorythm)
  - Relevance: this is the closest open-source video project to the idea. It already has the local profile; what it lacks is peer exchange.
- **PeerTube-Browser** [verified, thin]. A third-party site whose recommendations use embedding vectors, approximate-nearest-neighbour (ANN) search, and user likes. — [PieFed](https://piefed.jeena.net/post/326824)
- **Recommender issue (displ.eu/fairkom)** [verified, thin]. Proposes a PeerTube plugin to build a sorted recommendation list from local and federated content. It notes that PeerTube's current next-video recommendation is random. — [fairkom GitLab](https://git.fairkom.net/emb/displ.eu/recommender/-/issues/7)
- **Loops** [verified]. Open-source short-video app by Daniel Supernault (Pixelfed). It added ActivityPub federation on 14 Oct 2025. It has a chronological Following feed and a For You feed that, per the project, draws on engagement, hashtags and social-graph signals (self-description). Wikipedia notes human-led "trust scores" for moderation. The iOS app launch date was reported as 30 Jan 2026. — [joinloops.org features](https://joinloops.org/features); [Wikipedia](https://en.wikipedia.org/wiki/Loops_(app)); [roadmap](https://joinloops.org/roadmap)
- **Sepia Search** [background, not re-verified]. Framasoft's search engine that indexes PeerTube instances. It is global search, not personalized recommendations. — [sepiasearch.org](https://sepiasearch.org); [PeerTube](https://joinpeertube.org)
- **Owncast** (self-hosted livestreaming with fediverse integration) and **Funkwhale** (federated audio): I found no personalized recommendation features. [background, not re-verified] — [owncast.online](https://owncast.online); [funkwhale.audio](https://www.funkwhale.audio)
- **Mastodon** [background, not re-verified]. Discovery is server-local trending (posts, hashtags, links) plus follow suggestions. Mastodon deliberately avoids an algorithmic home feed. Relays share public posts between servers. — [Mastodon docs: trends](https://docs.joinmastodon.org/admin/settings/#discovery)

### Inferences
- PeerTube has the greatest unmet need and the least prior work. A browser-side or client-side recommender that exchanges profiles with consented peers would extend PeerTube Picks directly.
- ActivityPub has no private, consented data-sharing primitive beyond direct/followers-only posts. History exchange would need an out-of-band or encrypted channel.

### Gaps
- PeerTube Picks' source code and license could not be confirmed.
- I found no usage numbers for any PeerTube recommender.

## Nostr: video clients, DVMs (NIP-90), Web-of-Trust scoring

### Takeaway
Nostr has the most developed "algorithm marketplace". NIP-90 Data Vending Machines (DVMs) let users request discovery feeds from competing providers, and trust services such as Vertex compute personalized PageRank over the follow graph. These systems rank by public follows and engagement, not by private watch history shared between peers. diVine (the Vine reboot, Nov 2025) is the most prominent Nostr video app. I found no public documentation of its feed ranking.

### Cited Findings
- **NIP-90 DVMs** [verified]. A job marketplace: requests use kinds 5000–5999, results 6000–6999, and status updates kind 7000. Providers compete on output and price. — [NIP-90 (fork mirror)](https://github.com/SpaceXpanse/nips/blob/dev/90.md)
- Content discovery is a headline DVM use case. The NostrDVM framework lists discovery algorithms first, and its author expects the best algorithms to emerge from an open market. — [nostr.at note](https://nostr.at/note1npxzx3s94s8x5929qeyd4hkz58fplnyhye7sknh6s8lekq7dldgsmys8cw)
- Client support: Amethyst v0.87.2 added DVM discovery feeds. noStrudel and Coracle can use them via Vendata. — [No BS Bitcoin](https://nobsbitcoin.com/amethyst-v0-87-2); [Uncensored Tech "Bring Your Own Algo"](https://uncensoredtech.substack.com/p/bring-your-own-algo)
- What went wrong: discoverability of DVMs is poor. One operator saw zero jobs in 8 hours because most clients don't surface NIP-89 handler announcements. — [Stacker News](https://www.stacker.news/items/1463738)
- Unverified claim: one guide says upstream NIP-90 is now flagged "unrecommended" in favour of use-case-specific NIPs. I could not confirm this. — [D-Central](https://d-central.tech/nostr-data-vending-machines/)
- **Vertex** [verified]. "Web of Trust as a service" for Nostr. It continuously crawls follow lists and computes Monte Carlo Personalized PageRank. It is exposed as DVMs (Verify Reputation, Recommend Follows, Sort Authors), launched Feb 2025, and is MIT-licensed. — [No BS Bitcoin](https://www.nobsbitcoin.com/vertex-web-of-trust-as-a-service/)
- Related trust work: Relatr computes per-perspective trust. NIP-85 "trusted assertions" (kind 30382) let scoring services publish results to clients. OpenSats funds Web-of-Trust work. — [OpenSats WoT topic](https://opensats.org/topics/web-of-trust)
- **diVine** [verified]. A Vine reboot on Nostr, led by Evan "Rabble" Henshaw-Plath and funded by Jack Dorsey's nonprofit "and Other Stuff". It launched in Nov 2025 with a restored Vine archive (TechCrunch says more than 100,000 videos; other outlets say about 10,000, a conflict). It blocks suspected generative-AI uploads. Its feed ranking is not described in coverage. — [TechCrunch](https://techcrunch.com/2025/11/12/jack-dorsey-funds-divine-a-vine-reboot-that-includes-vines-video-archive); [Cassius](https://cassiuslife.com/1268047/divine-everything-we-know-about-the-vine-reboot/); [werd.io](https://werd.io/jack-dorsey-funds-divine-a-vine-reboot-that-includes-vines-video-archive/)
- Other Nostr video and media clients (zap.stream for live, Olas for photos/short video, Nostube, Tunestr for music) [background, not re-verified]. These are generally follow-based or DVM-fed feeds. — [zap.stream](https://zap.stream); [olas.app](https://olas.app)
- NIP-51 lists, including encrypted private list entries, are a possible substrate for sharing a "liked" or "watched" list privately with chosen peers. [background, not re-verified] — [NIP-51](https://github.com/nostr-protocol/nips/blob/master/51.md)

### Inferences
- Nostr is the most natural fit for this idea. Signed events, NIP-44 encryption and gift-wraps for private peer-to-peer data, DVMs for pluggable ranking, and WoT for spam resistance already exist. The missing pieces are a convention for "watch/like history" events and a consented "match" relationship.
- Personalized PageRank over follows (Vertex) is a trust or popularity signal, not taste similarity. A "match" layer would add collaborative-filtering signal on top of it.

### Gaps
- I found no current usage figures for DVM feeds or diVine.
- NIP-90's current status in the upstream repo was not confirmed.

## AT Protocol / Bluesky: custom feeds, Graze, Skylight, Flashes, permissioned data

### Takeaway
ATproto has shipped the clearest working version of "algorithmic choice". Anyone can run a feed generator, and users subscribe to it. Graze turned this into a business. Video apps on ATproto (Skylight, Flashes) lean on human curators and custom feeds rather than a single For You algorithm. All ATproto repo data, including likes, is public. Private, permissioned data that would allow sharing watch history with chosen peers is still a proposal (0016) as of the spring 2026 roadmap.

### Cited Findings
- **Graze** [verified]. A no-code custom feed builder for Bluesky. It raised a $1M pre-seed led by Betaworks and Salesforce Ventures. The company said 2.3M people had seen Graze-powered feeds (early 2025). TechCrunch reported about 4,500 feeds by about 3,000 creators. A later Graze newsletter claims 5M readers (self-reported and cumulative). — [GeekWire](https://www.geekwire.com/2025/portland-startup-graze-raises-1m-to-help-people-build-bluesky-feeds/); [TechCrunch](https://techcrunch.com/2025/01/31/custom-feed-builder-graze-is-building-a-business-on-bluesky-and-investors-are-paying-attention/); [Graze newsletter](https://graze-newsletter.beehiiv.com/p/breaking-news)
- **Skylight** [verified]. A TikTok-style video app on ATproto. In Aug 2025 it added community curators who post, repost and build custom feeds users can subscribe to (swipe left to reach them) instead of relying only on an algorithmic main feed. It planned to integrate Graze for in-app feed building. Community reports said it tweaked its algorithm because of heavy US-politics content. — [TechCrunch Aug 2025](https://techcrunch.com/2025/08/26/skylights-tiktok-alternative-adds-community-curators-to-the-mix/); [Bluesky Report #110](https://socialhub.activitypub.rocks/t/bluesky-report-110video-app-skylight-is-available-for/5225); [Influencer Marketing Hub](https://influencermarketinghub.com/skylight-bets-on-human-curation-to-counter-tiktoks-algorithm/)
- Bluesky also rolled out custom video feeds positioned against TikTok. — [EM360](https://em360tech.com/tech-articles/bluesky-rolls-out-custom-video-feeds-rival-tiktok)
- **Permissioned data** [verified]. The Spring 2026 ATproto roadmap describes "permissioned data" (non-public records with access control) as in design. Blacksky, Northsky and Habitat are experimenting with extensions. It was tracked as proposal 0016 and depends on Auth Scopes. Critics, such as Puppet founder Luke Kanies, argue the design splits the system into separate public and private parts. — [atproto.com roadmap](https://atproto.com/blog/2026-spring-roadmap); [minifeed summary of Proposal 0016](https://minifeed.net/items/YcPr2quT8HZU); [zeli.app](https://zeli.app/de/story/49025984)
- SkyFeed, Blacksky, labelers/Ozone, Flashes [background, not re-verified]. SkyFeed was an early visual feed builder. Labelers (Ozone) provide stackable moderation. Flashes is an Instagram-style photo/video client on ATproto. — [Bluesky blog: algorithmic choice](https://bsky.social/about/blog/3-30-2023-algorithmic-choice); [Bluesky: Ozone](https://bsky.social/about/blog/03-12-2024-stackable-moderation)

### Inferences
- ATproto has proven that users will choose third-party feeds at scale (millions of feed viewers). That is a demand signal for pluggable recommendation.
- Because likes are public on ATproto, a public "match" (CF over public likes of chosen accounts) is buildable today as a feed generator. Private history matching must wait for permissioned data.

### Gaps
- I found no official documentation of Skylight's or Flashes' ranking.
- The status of proposal 0016 after spring 2026 is unknown.

## Farcaster, Lens and web3 reputation: OpenRank / Karma3 Labs

### Takeaway
OpenRank (Karma3 Labs) provides EigenTrust-based global and personalized rankings of people and casts for Farcaster and Lens. Like Nostr WoT, it is graph-trust ranking, not shared-history matching.

### Cited Findings
- Karma3 Labs raised a $4.5M seed in Mar 2024 (Galaxy, IDEO CoLab) to build OpenRank, a "decentralized reputation protocol". Its early use cases were ranking and recommendation APIs for Lens and Farcaster (press release). — [Decrypt](https://decrypt.co/219892/karma3-labs-raises-a-4-5m-seed-round-led-by-galaxy-and-ideo-colab-to-build-openrank-a-decentralized-reputation-protocol)
- The OpenRank APIs offered global and personalized profile and frame rankings over following or engagement graphs. The Eigencaster demo shows casts from people you don't follow, chosen by EigenTrust. — [ETHGlobal](https://ethglobal.com/events/frameworks/prizes/karma3labs); [GitHub Eigencaster](https://github.com/Karma3Labs/eigencaster)
- The repos found were last updated in early 2024, so current status is unclear. — [ecosyste.ms](https://awesome.ecosyste.ms/projects/758181)
- Farcaster channels and Lens Open Algorithms [background, not re-verified]. — [docs.farcaster.xyz](https://docs.farcaster.xyz); [lens.xyz](https://www.lens.xyz)

### Inferences
- EigenTrust/PageRank seeded from "my follows" is the dominant decentralized-recommendation primitive across Nostr, Farcaster and Lens. It could serve as the trust and spam layer under a taste-matching layer.

### Gaps
- OpenRank's activity in 2025–2026 was not verified.

## Other decentralized/alt video and P2P platforms (LBRY/Odysee, DTube/3Speak, BitChute, Rumble, SSB, Freenet, Holochain, Gun, Ceramic, Matrix, Diaspora)

### Takeaway
None of these offered peer-shared-history recommendations. The blockchain video platforms recommend centrally (Odysee) or by token-weighted votes (Steem/Hive). LBRY Inc. shut down after losing to the SEC.

### Cited Findings
- **LBRY** [verified]. A judge ruled for the SEC (Nov 2022) that LBC sales were unregistered securities. LBRY announced its wind-down in 2023 (July and later October announcements) and dropped its appeal. The court did not enjoin Odysee, which continues. The LBRY blockchain and about 30M content items were said to persist. — [Baker McKenzie](https://blockchain.bakermckenzie.com/2023/07/18/lbry-to-shut-down-after-judges-decision-that-its-token-sale-was-an-unregistered-offering-of-securities/); [Cointelegraph](https://regional-front.cointelegraph.com/news/blockchain-firm-lbry-wind-down-sec-appeal-final-goodbye); [Forklog](https://forklog.com/en/regulated-to-oblivion-blockchain-startup-lbry-shuts-down-after-sec-battle/)
- I found no source describing Odysee's recommendation mechanism (gap).
- **DTube / 3Speak (Steem/Hive)** [background, not re-verified]. Discovery comes from stake-weighted upvotes ("trending") on chain. That is a public, plutocratic signal. — [3speak.tv](https://3speak.tv)
- **BitChute, Rumble** [background]. These are centralized "alt" platforms, not decentralized. They are relevant only as non-YouTube competitors.
- **Secure Scuttlebutt** [background, not re-verified]. Offline-first gossip replicates the feeds of the people you follow (and friends-of-friends hops). That is social-graph-scoped replication, a close architectural analogue for exchanging data only with chosen peers. It has no recommender. Activity has declined. — [scuttlebutt.nz](https://scuttlebutt.nz)
- Freenet/Hyphanet, Holochain, Gun, Ceramic, Matrix, Diaspora: I found no recommendation-sharing features in this session. — [freenet.org](https://freenet.org); [holochain.org](https://www.holochain.org)

### Inferences
- SSB's "replicate only your follows" model is the best architectural precedent for exchanging watch history only with matched peers.

### Gaps
- Odysee, 3Speak and DTube recommendation details and user numbers were not verified.

## Middleware / "algorithmic choice" policy lineage (Fukuyama, Masnick, Free Our Feeds, Project Liberty/DSNP, Bluesky)

### Takeaway
There is a strong intellectual case, and some institutional backing, for separating recommendation from hosting ("middleware"). It has so far been realized mainly as ATproto custom feeds and Nostr DVMs. None of the proposals specifically envisions peer-to-peer taste sharing.

### Cited Findings
- Fukuyama argues that middleware, meaning third-party layers that curate or rank on top of platforms, is "the only solution to platform power" (2023). — [Carnegie Endowment](https://carnegieendowment.org/russia-eurasia/posts/2023/03/why-middleware-is-the-only-solution-to-platform-power)
- Original Stanford Working Group on Platform Scale report (Fukuyama et al., 2020) [background, not re-verified]. — [Stanford Cyber Policy Center](https://cyber.fsi.stanford.edu/publication/report-working-group-platform-scale)
- Mike Masnick, "Protocols, Not Platforms" (Knight First Amendment Institute, 2019) [background, not re-verified]. — [Knight Institute](https://knightcolumbia.org/content/protocols-not-platforms-a-technological-approach-to-free-speech)
- **Project Liberty / DSNP** [verified]. Frank McCourt launched it in 2021 with $100M. DSNP is an open-source social-graph protocol "owned by the public". Project Liberty announced a partnership with **Free Our Feeds**, the effort to protect ATproto's independence. — [Project Liberty launch](https://www.projectliberty.io/news/civic-entrepreneur-frank-mccourt-launches-project-liberty-transformational-new-initiative-to-enable-healthier-more-equitable-online-economy/); [TechCrunch Mar 2025](https://techcrunch.com/2025/03/10/open-web-initiatives-project-liberty-and-solid-could-be-teaming-up/)
- Bluesky's own "algorithmic choice" framing (2023). — [Bluesky blog](https://bsky.social/about/blog/3-30-2023-algorithmic-choice)
- Free Our Feeds website [background, not re-verified]. — [freeourfeeds.com](https://freeourfeeds.com)

### Inferences
- A "match"-based recommender fits the middleware vision. It is user-chosen ranking whose inputs (peer histories) are controlled by the users themselves. It can be framed as the user-to-user form of middleware.

### Gaps
- I did not check the current activity of DSNP (Frequency chain) or Free Our Feeds' 2026 status.
