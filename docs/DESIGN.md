# Match Feed: distributed recommendations for federated video

Status: early design draft. Mockups: `mockups/match-feed.html`.

## Problem

Federated video (PeerTube) handles hosting and follows. Discovery is weak:
there's no official personalized recommender. Community efforts so far are
client-side, e.g. the PeerTube Picks browser add-on (cosine similarity over
your own local watch/like history) and a proposed instance-level recommender
plugin [1][2]. None of them use *other people's* taste, which is the thing
that makes centralized recommenders work.

## Core idea

Recommendations come only from people you chose, and ranking runs on your
device. There are three relationship tiers:

| Tier | What you share | Visibility | Purpose |
|---|---|---|---|
| Follow | nothing | public | uploads in your feed |
| Subscribe to taste | nothing | public, signed list | a curator's endorsements as a rec source |
| Match | taste sketch | E2E, mutual, expiring | private user-based collaborative filtering |

### Change from the original brief

The original brief was "follow creators, and their watch history is published
as a similarity index to yours." The problem with that: a creator with
thousands of matches is effectively publishing their history, and encryption
doesn't change that. So creator taste is split out as an explicitly **public**
tier ("Subscribe to taste"). Private, mutual **Match** is meant for small
numbers of peers.

## Match protocol (sketch)

1. **Preview.** The two parties run private set intersection (PSI) on their
   video-ID sets. Each learns the overlap *count* and nothing else.
2. **Consent.** Each side chooses what goes in its sketch: endorsements only,
   or endorsements plus finished watches. They also choose the time window and
   any excluded tags or hours. The match expires unless both sides renew it.
3. **Exchange.** Each side sends its sketch end-to-end encrypted through relays.
4. **Score locally.** similarity = Jaccard or cosine over the two sketches.
   Candidate score = Σ over matches of `sim(you, match) × endorsed(match, video)`.
   This is plain user-based collaborative filtering, run client-side.
5. **Circles.** A group of k ≥ 5 people pools endorsements with secure
   aggregation [7], so members get group picks that can't be attributed to any
   one person.
6. **Second degree.** Picks from your matches' matches are discounted (e.g.
   ×0.3) and unattributed. They only count when the person in the middle opts
   in.

### Privacy facts to design around

- **Hashing video IDs gives no privacy.** The catalog is public and
  enumerable, so anyone can hash every ID and reverse the sketch. Use real
  encryption to the peer, or PSI.
- **Recommending inherently reveals.** If I'm recommended X because of you, I
  learn you endorsed X. Only circles (aggregation) or noise blunt this.
- **Aggregates leak.** Calandrino et al. showed that individual transactions
  can be inferred from the outputs of item-to-item recommenders [5]. Netflix
  Prize "anonymous" ratings were re-identified [6]. Assume that sketches and
  scores are identifying.
- **Default to endorsements, not passive watch history.** Passive history is
  far more sensitive. US law treats it specially: the Video Privacy Protection
  Act, 18 U.S.C. § 2710.

## "Can't be controlled by the state": what this does and doesn't buy

**It does buy:**

- No central ranker that can be ordered to boost or suppress content.
- No central store of everyone's history to subpoena.

**It doesn't buy protection from these pressure points:**

| Pressure point | What's exposed | Mitigation |
|---|---|---|
| Video host / instance | can remove videos | mirror across instances; P2P delivery; content addressing |
| Relays | who-talks-to-whom metadata, which maps a taste network | many relays; Tor/mixnet transport |
| App stores | distribution of the client | PWA / sideload / F-Droid |
| User device | plaintext history | encryption at rest, short retention, wipe |
| A match | whatever you shared | none; this is inherent to sharing |

**The bigger threat is manipulation, not the state.** Bot farms and Sybil
accounts are what break open recommenders [8]. The match-only design helps:
an attacker has to get *you* to match *their* accounts. Second-degree
propagation should be bounded by a trust metric seeded from your own node, in
the style of EigenTrust or personalized PageRank [9][10].

## Distribution options

| Option | Fit | Main risk |
|---|---|---|
| ActivityPub (PeerTube) for video + follows | interop with the existing catalog for free | instance admins see everything on their instance; no native E2E |
| Nostr for identity + match exchange | user-owned keys; dumb, swappable relays; encrypted DMs; video events exist (NIP-71) [3] | relay metadata; small ecosystem; NIP-71 kind numbers differ across sources, so check the spec |
| AT Protocol (Bluesky) | custom feed generators are a working "pick your algorithm" model [4] | repos are public and feed generators are servers that see requests, so it doesn't fit private matches |
| Custom P2P (libp2p / Iroh) | maximum control | NAT traversal, mobile background limits, a lot of build cost |

A plausible hybrid: PeerTube/ActivityPub for the video catalog, Nostr-style
keys and relays for public taste lists and encrypted match sketches, and
AT-Protocol-style portable "feed recipes" executed on-device.

## Open questions

- Is the target user the creator (discovery for their videos) or the viewer?
  That changes which tier ships first.
- Cold start: a new user with zero matches gets Follow + Explore only. Is that
  acceptable for v1?
- Moderation: on-device ranking means no global blocklists. Should users be
  able to subscribe to labelers, the way Bluesky handles this?

## Sources

1. PeerTube recommender proposal, fairkom GitLab: https://git.fairkom.net/emb/displ.eu/recommender/-/issues/7
2. PeerTube Picks discussion: https://piefed.jeena.net/post/169216 ; alpha recommender: https://piefed.jeena.net/post/158506
3. Nostr NIPs (NIP-71 video events): https://github.com/nostr-protocol/nips
4. AT Protocol custom feeds: https://atproto.com/guides/feeds ; https://docs.bsky.app/docs/starter-templates/custom-feeds
5. Calandrino, Kilzer, Narayanan, Felten, Shmatikov. "You Might Also Like: Privacy Risks of Collaborative Filtering." IEEE S&P 2011.
6. Narayanan, Shmatikov. "Robust De-anonymization of Large Sparse Datasets." IEEE S&P 2008.
7. Bonawitz et al. "Practical Secure Aggregation for Privacy-Preserving Machine Learning." ACM CCS 2017.
8. Douceur. "The Sybil Attack." IPTPS 2002.
9. Kamvar, Schlosser, Garcia-Molina. "The EigenTrust Algorithm for Reputation Management in P2P Networks." WWW 2003.
10. Canny. "Collaborative Filtering with Privacy." IEEE S&P 2002 (an early decentralized, privacy-preserving CF design and a direct precedent for this one).
