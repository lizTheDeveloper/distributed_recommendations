# Web client (v1)

Status: working client with Reels, a feed settings sheet and Match (prototype), 2026-10-19. Code: `apps/web/` (see its README for how to run it).
Companion to `DESIGN.md`, `PROTOCOL.md` and `ANALYTICS.md`. Where this document and the code disagree, that is a bug.

## Scope

The client ships **Follow, Subscribe to taste (lists, and Follow taste for a creator's own public picks), reserved explore slots and 1:1 Match** (with PSI previews), all
ranked on the device by `packages/core` `rank()`. Match runs `packages/match` (prototype, unaudited) over Nostr
relays the viewer adds. Circle, second degree and Tier 2 creator analytics are still "coming next" placeholders.

Home has two views of the same ranking: **Reels** (vertical short-video feed, the default) and **Grid**.

## Data flow

Personal feed, one `rank()` pass with the viewer's recipe:

| Source kind | Where candidates come from | Strength |
|---|---|---|
| `follow` | `channelVideos` on each followed channel's home instance, plus any catalog video by a followed creator | 1 |
| `match` | items in each active match's latest sketch (`MatchClient.candidates`), resolved to videos from the catalog, or at the video's origin instance when unknown | the match's Jaccard similarity to your endorsements and finished watches |
| `taste` | videos resolved from each subscribed taste list (`getVideo` on the id's origin instance), and the picks of each followed creator taste (see Follow taste), with `via` = the creator's name | `tasteListStrength` from the list's track record (below); 0.5 for a new list |
| `explore` | each configured instance's `-publishedAt` list. Core keeps only untied videos under 14 days old from creators you don't follow | relevance (below) |

Core caps each taste list at `maxPerTasteList` items per page (default 2), and the recipe screen exposes that cap as a slider.

### Instance trending: a separate section, not a feed source

Before core gained the per-list cap, instance trending fed the personal feed as a weak taste list (`via` "Trending on *host*", strength 0.5). Under the cap, that pseudo-list could only place 2 items. Exempting it with a higher cap would undo what the cap is for. Trending is popularity-driven, which is exactly the concentration the cap and the explore slots push against (SIMULATION_RESULTS Exp 1, 5).

So v1 shows trending in a **separate "Popular on your instances" section after the personal feed**:
- It is ranked in its own `rank()` pass. That pass uses the viewer's recipe (filters, decay, per-creator cap, taste weight), with explore off and `maxPerTasteList` = 6, which works out to 6 items per instance.
- It is deduplicated against the feed and the viewer's `seen` set.
- It is labelled "not personalized". A recipe with taste weight 0, such as "Following only", gets no popular section.
- It never takes a slot from the personal feed. It still gives a brand-new viewer something to watch next to the explore picks.
- Settings: "Show Popular on your instances", on by default. The old `trendingAsTaste` setting migrates to it.
- Impressions in this section don't count toward any list's track record.

### Explore relevance

The app passes `exploreRelevance = tagRelevance(tagProfile(endorsed videos))` to `rank()` once the viewer has endorsed at least one video that has tags. Before that it passes nothing, and core falls back to its seeded random pick among the newest. The why-line then says "Not personalized", or "Picked on this device for how well it fits what you watch" when relevance applies.

PeerTube's list endpoints omit tags, so the app fetches tags from the detail endpoint in two cases:
- for a video when you endorse it;
- once a profile exists, for the 40 newest explore candidates. These requests are the same for every viewer (the newest public uploads), so they reveal nothing about the profile.

Fetched tags are cached locally (`tags`). The offline snapshot stores tags for its recent videos.

### Taste-list track record

`tasteListStrength` takes a list's shown and endorsed counts and compares them against the viewer's overall baseline.
- **Shown:** a feed card counts as shown once at least half of it has been on screen (IntersectionObserver). The device records the video id against every subscribed list that contains it.
- **Endorsed:** endorsements of those ids.

The counts live in `impressions` (unique ids, capped). They stay on the device, aren't recorded during private watching, and are wiped with local history.

- All catalog reads go through core's `createPeerTubeClient` (public endpoints, `credentials: "omit"`, no referrer). PeerTube sends `Access-Control-Allow-Origin: *` on its API (checked 2026-10-19 on framatube.org, tilvids.com, peertube.tv, video.blender.org, tube.tchncs.de), so a static page can call instances directly.
- Tier 1 studio counts (followers, views, likes) need fields core's `Video` doesn't carry. The app reads `/api/v1/video-channels/{name}` and `/api/v1/video-channels/{name}/videos` itself, with the same privacy options. Candidate for upstreaming into core.
- Ranking: `rank(candidates, recipe, {now, limit: 60, rng: seededRng(sessionSeed), seen})`. The seed comes from `cryptoRng` once per session, so re-renders stay stable; "Shuffle new creators" re-seeds. `seen` = videos the viewer opened.
- Playback: the PeerTube embed on the video's **origin** instance (`/videos/embed/{id}?p2p=0|1`). P2P is off unless the viewer turns it on (DESIGN.md, State resistance). The embed handles HLS itself, so the app doesn't ship hls.js. Reels adds autoplay, mute, loop and the embed API (see Reels).

## Local state

Local state is split in two. Configuration stays in `localStorage` under `mf.v1.*`. Anything that shows what the viewer watches or likes is encrypted at rest in IndexedDB (THREAT_MODEL.md T9). Every access is wrapped; when storage fails, the app runs from memory for the session.

| Key | Where | Contents |
|---|---|---|
| `settings` | localStorage | instances, popular section, private watching, P2P, analytics switches, theme, `retentionDays` (30/60/90, default 60), `defaultView` (`reels`/`grid`, default reels), `relays` (Match; none by default) |
| `recipe` | localStorage | active recipe id, plus a custom recipe in wire form (re-parsed by `parseRecipe` on load) |
| `tab` | localStorage | last screen |
| `history` | vault | `{videoId, at, kind: "watch" \| "endorse" \| "finish", tags, via?}`, capped at 2,000 and limited to the sharing window. Not written while private watching is on |
| `tally` | vault | local discovery-channel counts (below) |
| `impressions` | vault | ids of feed items seen, overall and per taste list, for track records (2,000 / 500 per list) |
| `follows` | vault | `{handle, name?, addedAt}` |
| `taste` | vault | subscribed lists (validated again on load) |
| `tastefollows` | vault | followed creator tastes: `{handle, name, enabled, addedAt, checkedAt, taste: {source, detail, refs, pubkey?, items, videos, fetchedAt} \| null, error?}` (validated again on load, items through the taste-list parser). Who you follow is sensitive |
| `videos` | vault | cache of resolved taste-list videos (600 max) |
| `tags` | vault | tags fetched from video detail endpoints (1,500 max). Includes videos you endorsed, so it counts as sensitive |
| `hidden` | vault | Reels "not interested" ids (2,000 max) |
| `identity` | vault | Match identity: a local secret key and its pubkey, or the NIP-07 extension's pubkey |
| `matchbook` | vault | the `MatchBook`: matches, per-match secret keys, both sides' last sketches, preview state |
| `matchmeta` | vault | petnames for peers and the local Match activity log |
| `demopeer` | vault | offline artifact only: the simulated demo peer's key, book and made-up history |

- `toSketchHistory()` maps history to core's `HistoryEntry` for Match: endorsements and `finish` events (≥ 80 % played in Reels). Opening the player or scrolling past a reel is not a finished watch.
- **Private watching** records nothing: no history, impressions or tally.

### Encryption at rest (`src/lib/vault.ts`)

- **Cipher:** WebCrypto only. AES-GCM with a 256-bit key, a fresh random 96-bit IV per write, and the record name as additional authenticated data, so a ciphertext copied into another record fails to decrypt. Each record is one IndexedDB value `{iv, ct}` in database `match-feed`, store `vault`, key `rec:<name>`.
- **Key, default (device mode):** a non-extractable `CryptoKey` generated on first run and stored in the same IndexedDB store. Page scripts can use it but can't export its bytes.
- **Key, optional (passphrase mode):** a setting under Sharing & settings, labeled optional. The key is derived with PBKDF2-HMAC-SHA-256 at 600,000 iterations and a random 16-byte salt. WebCrypto has no Argon2 or scrypt, so PBKDF2 is the strongest KDF available without a dependency. Only the salt, the iteration count and an encrypted check value are stored, and the app asks for the passphrase at startup. **Tradeoff:** a forgotten passphrase means lost history, follows and taste lists. The unlock screen's only way out is "start fresh", which deletes them. Turning the passphrase on or off re-encrypts every record in one transaction.
- **Migration:** on the first start after this change, any plaintext `mf.v1.history`, `tally`, `impressions`, `follows`, `taste`, `videos` and `tags` in localStorage is encrypted into the vault. The plaintext is deleted only after the ciphertext is stored; if that write fails, it stays and the migration retries on the next start.
- **Retention:** history older than the sharing window (`retentionDays`) is deleted when the app starts, when the setting changes, and once a day after that (an hourly check, plus a check when the tab becomes visible). Impressions and the tally carry no timestamps, so they're bounded by their caps and cleared by the wipe.
- **Wipe local history** (in-page confirmation) clears `history`, `tally`, `impressions`, `hidden` and the tag cache, and crypto-shreds the vault. The Match identity, book and petnames are re-encrypted under the new key with the follows and taste lists (they're relationships, not history; remove them on the Matches screen). It deletes every ciphertext record and the key (or the passphrase salt and check) in one transaction, then writes what stays (follows, taste lists, followed creator tastes, the taste-list video cache) under a brand-new device key. Any plaintext left by an older version is deleted too. A wipe turns passphrase mode off, and the toast says so. Settings and recipes stay.
- **Fallback:** if IndexedDB or WebCrypto is unavailable or broken (no secure context, a blocked or sandboxed origin, some private windows, or IndexedDB not opening within 4 s), the app uses a memory-only vault. Sensitive state lives in memory for the tab. A banner at the top and the Local history panel both say so. Nothing sensitive is ever written to localStorage as a fallback. Plaintext left by an older version is read for the session but not deleted, since deleting it there would lose it. The panel mentions it, and the wipe removes it.

**What this protects against.** Casual forensic or disk access, such as someone grepping the profile directory or a disk image for video URLs. Tools, backups and sync that copy site storage, since localStorage no longer holds history. Other OS users and other browser profiles, which can't run this origin's scripts with this profile's key. With crypto-shredding, a wipe is final even where IndexedDB leaves deleted pages on disk until compaction, as long as the key is gone too. In passphrase mode, also a full copy of the browser profile, up to the cost of guessing the passphrase.

**What it doesn't protect against.** Malware on the device. A compromised or malicious build of this origin's JavaScript, which can ask the browser to decrypt everything. Anyone using the unlocked browser profile, who can simply open the app. In device mode, someone with a complete copy of the profile directory: the key is stored beside the ciphertext. Non-extractable stops page scripts from exporting it, not disk forensics. Device mode adds no OS-keystore protection, because browsers don't expose one to web pages. Full-disk encryption remains the main defense against a seized device. Ciphertext sizes and write times are visible, and settings and recipes are not encrypted.

## Viewer analytics switch (ANALYTICS.md Q1)

Q1 is decided as on by default, with per-signal off switches, and that is how v1 behaves. DAP isn't built, so **nothing is transmitted**. The device keeps a tally of what it would contribute, by discovery channel, honoring the main switch, the per-channel switches and private watching. The settings screen shows that tally. When Tier 2 ships, this tally is the input to the DAP client. The ePrivacy question in ANALYTICS.md must be resolved before anything is sent from EU devices.

## Taste list format, v1 (PROVISIONAL)

PROTOCOL.md doesn't define a taste-list format yet. This is the minimal one the client uses. It follows PROTOCOL.md conventions: a version field, unknown keys rejected, size checked before `JSON.parse`, canonical video URLs as ids, and no control or bidi characters in strings. Parser: `apps/web/src/lib/tastelist.ts`. It reuses core's validation helpers (`plainObject`, `string`, …) by importing `packages/core/src/validate.ts` directly, because `index.ts` doesn't export them. That's a dependency on core internals: exporting the helpers (or a `parseTasteList`) from core would remove it.

```json
{
  "v": 1,
  "name": "Slow craft picks",
  "author": "hearth@craft.tube",
  "description": "What I've been watching between kiln firings",
  "updatedAt": 1792411200,
  "items": [
    { "id": "https://craft.tube/videos/watch/7516913d-…", "note": "Best cob oven build", "sponsored": false, "affiliated": true, "addedAt": 1792400000 }
  ]
}
```

| Field | Type | Limit | Default | Meaning |
|---|---|---|---|---|
| `v` | number | must be `1` | required | |
| `name` | string | 1–80 chars | required | shown in why-lines: `In the taste list "…"` |
| `author` | string | 1–120 chars | absent | free text, e.g. a handle |
| `description` | string | 1–500 chars | absent | |
| `updatedAt` | integer | Unix seconds | absent | |
| `items` | array | ≤ 256 | required | unique by `id` |
| `items[].id` | string | `http(s)://`, ≤ 512 chars | required | canonical watch URL |
| `items[].note` | string | ≤ 280 chars | absent | |
| `items[].sponsored` | boolean | | `false` | paid placement; the card shows a **Sponsored** label (FTC Endorsement Guides) |
| `items[].affiliated` | boolean | | `false` | curator has a material connection; the card shows **Affiliated** |
| `items[].addedAt` | integer | Unix seconds | absent | |

Whole document: 64 KiB max.

**Open before this becomes normative:**
- Signing and distribution. The plan is a signed Nostr addressable event with this JSON as `content`. Today lists are imported by URL (the host must allow CORS) or pasted, so they're unauthenticated.
- Whether items may carry title hints, to avoid one `getVideo` per item. v1 resolves every id at its origin instance, 4 at a time, and caches the results.

## Follow taste (creators' public picks)

Code: `src/lib/creatortaste.ts` (pure, tested), `src/lib/tastesources.ts` (network adapters), `src/ui/taste.ts`.

"Follow" adds a creator's uploads. "Follow taste" adds what they **recommend**: their public picks of other creators' videos. It needs nothing from the viewer and shares nothing (DESIGN.md, Subscribe to taste).

**Sources, tried in this order; the first with at least one pick wins.** The sheet shows which one was used and why the others weren't.

| # | Source | How it's found | Mapping |
|---|---|---|---|
| 1 | Signed Nostr list | the npub the creator publishes in their channel description or support text (as Match finds it); queried **only on relays the viewer configured**. No relays: skipped, nothing is contacted | NIP-51 **video curation set**, kind 30005 (`e` refs to NIP-71 videos), `authors` = that pubkey. The newest event per `d` wins; every event's id and Schnorr signature is checked (match's `InMemoryRelay.publish`, which runs nostr-tools `verifyEvent`, on a copy without nostr-tools' cached-verdict symbol). Only public items (tags) are read; private, NIP-44-encrypted items are the author's. `a` refs to addressable videos (34235/34236, what our bridge emits) are accepted too. Each referenced video event maps back to its PeerTube watch URL through its `["origin", "peertube", uuid, url]` tag, else an `r` tag that is a watch URL. Tag order is chronological (NIP-51), so the last tag is the newest pick |
| 2 | Taste-list URL | an https URL in the channel description or support text that ends in `.json` or has "taste" in it or on its line (at most 3 tried) | taste list format v1 above, with the same 64 KiB and validation rules; its `sponsored`/`affiliated` flags carry through to the cards |
| 3 | Public PeerTube playlists | `GET /api/v1/video-channels/{name}/video-playlists` and `GET /api/v1/accounts/{owner}/video-playlists` (owner from the channel's `ownerAccount`) on the channel's home instance, then `GET /api/v1/video-playlists/{uuid}/videos` for up to 8 playlists, most recently updated first | keep playlists with `privacy.id` 1 (Public) and `type.id` 1 (Regular; 2 is Watch later); keep elements with `type` 0 (1 deleted, 2 private, 3 unavailable) whose video is public; **drop the creator's own uploads** (video channel = this channel, or video account = the owner account). Elements carry full video objects, so no lookup per pick. Verified 2026-10-19 on video.blender.org, tilvids.com, spectra.video (CORS `*`, fields as above) |

If none has picks, the Taste button is disabled with "No public picks yet" (most channels: their playlists hold only their own uploads, e.g. video.blender.org's).

**Ranking.** Each enabled followed taste is a `taste` source with `via` = the creator's name (made unique against list names, since core caps per `via`), so `maxPerTasteList` caps it like any list (2 per page by default). Its strength is its own track record (`tasteListStrength`, impressions keyed `creator:<handle>`), starting at 0.5. Sponsored/affiliated labels apply when the source provides them (v1 lists; NIP-51 sets and PeerTube playlists have no such flag). The why-line names the creator and source: "In Blender's picks (public PeerTube playlist)". Picks are capped at the 100 newest per creator. Picks from Nostr or a URL without video data are resolved at their origin instance, up to 40 per refresh, and cached in `videos`. Playlist picks are often older and longer than uploads: under the 14-day half-life they score low, and Reels shows long ones only as "Longer video" fill once the short ones run out.

**UI.**
- Reels rail: **Taste** (list-with-star icon) beside Follow. Not following: outline; following: filled star; no picks: disabled, "No public picks yet". The app looks up the creator's picks once the reel has been on screen for 1.2 s (together with the npub lookup, sharing one channel-profile request), and again when the sheet opens.
- Tap: a small sheet with the source used, the playlist/list/set names, the pick count, the three newest picks, where the app looked (all three sources and the outcome of each), a note that this is public data and nothing about the viewer is shared, and Follow taste / Unfollow taste (plus Refresh when followed).
- Also from: the grid card's ⋯ menu, each followed channel in Follow & taste, the Creator studio header, and "Look up a creator" in Follow & taste.
- Management: Follow & taste → Creators' taste, and the feed settings sheet → More → Sources, each with per-taste on/off (off keeps it, out of ranking) and Remove (with Undo). Settings also has Refresh all.

**Refresh and caching.** Followed tastes are stored with their picks in the vault (`tastefollows`) and used at start without a request. Each is refetched when it's more than a day old: at start, on the hourly check, when the tab becomes visible, and on demand (Refresh). A refresh that fails on the network keeps the previous picks and shows "refresh failed"; one that finds no picks (the creator removed them) clears them. Lookups of creators you don't follow live in memory for the session.

**Privacy.** Reading picks contacts only public endpoints: the creator's home instance (profile and playlists; it sees a request from your IP, like opening the channel page), the host of a linked list, and, only if you added relays, those relays with a read-only `REQ`. That relay connection is separate from Match's and never answers NIP-42 AUTH, so it never reveals your Match key. Nothing is published and nothing reaches the creator.

## Example data

`apps/web/public/examples/*.json` are **example lists, generated automatically** by `npm run snapshot -- --examples`: the most-viewed of an instance's 100 newest local uploads, one per channel. They are labelled as example data everywhere they appear, and no person picked them.

## Fonts and third parties

The live build self-hosts its fonts (`public/fonts/`, OFL 1.1; Latin and Latin-extended subsets), and its CSP allows fonts only from `'self'`. In normal use the app contacts only the PeerTube instances: the configured catalog instances, the home instances of followed channels and of creators whose taste you look at or follow (profile and playlists), taste-list origins, the video host when you press play (or when a reel becomes visible), and, for Reels, the channel's profile (to look for a published npub) on a catalog instance or the channel's home instance. A taste-list URL import, or a creator's linked taste list, also contacts the host of that URL. Match and Follow taste contact only the relays you add (Follow taste read-only, without AUTH), plus the origin instance of sketch items it has to resolve. CSP: `script-src 'self' 'wasm-unsafe-eval'`, `connect-src` adds `wss:` and local `ws:` for relays, `frame-src 'self' https:` (the PSI frame and embeds). The artifact build keeps the Google Fonts link (the sandbox allows it, and the build is a demo).

## Offline artifact build

`apps/web/dist-artifact/index.html` is one self-contained file (about 2.3 MB with PSI inlined) for the claude.ai artifact sandbox, which blocks network access. Match runs there against the simulated demo peer (see Match). It bundles a snapshot of real API responses (`src/snapshot/snapshot.json`, about 106 KB: 127 videos from framatube.org and tilvids.com, with `aspectRatio` re-captured on 2026-10-19, plus public profiles and playlists of 10 channels for Follow taste). For Follow taste the snapshot script captures three curators known to keep public playlists of other creators' videos (wex_channel, puppuccino_channel and the_tech_beast_channel on tilvids.com, up to 30 elements per playlist), and the 24 most-represented snapshot channels that have public playlists at all (two elements each when they hold only the channel's own uploads, enough for "No public picks yet"). Offline, Nostr and linked lists are skipped (no network). A snapshot-backed `fetch` serves those responses to the *same* core client, so ranking, follows (of channels in the snapshot), taste lists, recipes, settings and the studio all run the real code. Thumbnails are gradient placeholders, playback and URL import are disabled, and a banner says so. Ranking uses the capture time as "now", so explore slots and recency read as they did that day. Storage works as in the live build: encrypted in IndexedDB when the sandbox's origin allows it, otherwise memory-only with the banner described under Local state. Retention uses the real clock, not the capture time.


## Navigation and the feed settings sheet

- **Phones (< 860 px):** a bottom tab bar (Home, Following, Matches, Studio, Settings) that respects the safe-area insets. Settings opens the sheet. The header shrinks to the name and a gear.
- **Desktop:** header tabs (Home, Follow & taste, Matches, Creator studio, Sharing & privacy), a gear, and a ⋯ menu (Feed settings, Recipe import & export, Sharing & privacy, Matches).
- **Home stays clean:** a Reels/Grid switch and one current-recipe pill (name and explore share). The old recipe and sources panel is gone; the pill opens the sheet.
- **Feed settings sheet** (`src/ui/sheet.ts`, state in `src/lib/sheet.ts`): a bottom sheet that slides up on phones, a right-hand drawer on desktop. Close button, Escape or the scrim close it; focus is trapped inside and returns to whatever opened it; the slide is skipped under `prefers-reduced-motion`. It holds every feed setting:
  - recipe picker, name, "Shuffle new creators", the six source weights, explore share (offered 0–10%, with the 2–10% guidance), recency half-life, max per taste list, max per creator;
  - filters: hidden tags, languages, length (any / under 3 min / under 20 min / over 5 / over 20), hidden creators. Every edit goes through `editRecipe` and so through core `parseRecipe`;
  - view: what Home opens with (Reels or Grid, `settings.defaultView`), the Popular-on-your-instances switch, theme;
  - links to Follow & taste, Matches, Sharing & privacy, Creator studio and Recipe import & export, plus source status (instances, follows, lists, matches).
- The Recipe screen is now import/export only; editing lives in the sheet.

## Reels

`src/ui/reels.ts` (view), `src/lib/reels.ts` (pure logic, tested), `src/ui/player.ts` (embed control).

- **Ranking:** the same `rank()` pass and recipe as the grid (follow, taste, match, explore), with a larger limit, followed by the labelled "Popular on your instances" pass (up to 100 per instance here, since it comes after your picks). Watched and "not interested" videos are excluded.
- **Short first:** a video is short-form if it's at most 3 minutes, or portrait (`aspectRatio` < 1) at any length. PeerTube sends `aspectRatio` and `isLive` on list and detail objects; core's `Video` drops them, so the catalog reads them from the same responses (`catalog.meta`). Live streams are skipped. Reels takes short ones in rank order; long ones fill in (labelled "Longer video") only once pagination is exhausted, or when nothing short exists yet.
- **Stable order:** items already placed never move when the ranking changes (`extendReels`); new ones are appended in batches of 8.
- **Infinite loading:** when the viewer is within 3 items of the end, the next page of each instance's `-publishedAt` and `-trending` lists is fetched through core's client (`listVideos({start, count})`), up to 6 extra pages of 50 per list. The offline snapshot supports `start` too.
- **Layout:** phones get full-viewport items with `scroll-snap-type: y mandatory`, a transparent overlay bar (view switch, recipe pill) under the top safe area, the title/creator/chip/"Why am I seeing this?" overlay at the bottom, and a right rail. Desktop gets a centered 9:16 column with the rail beside it and keyboard control: ↑/↓ or j/k move, space pauses, m mutes (ignored while typing, with the sheet or a dialog open, or when space would press a focused button).
- **Rail:** Endorse (recorded in the encrypted history, unless private watching), Follow, Taste (Follow taste, above), Not interested (hidden from Reels and the grid; stored in the vault as `hidden`, session-only under private watching, with Undo), Share (copies the watch URL; if the clipboard is refused, a selected text field to copy by hand), Open on PeerTube, Request match (only when the creator publishes an npub in their channel description or support text, or the video is in a taste list whose `author` contains an npub; shows "Matched"/"Requested" if you already are), and mute. All buttons have labels.
- **Playback:** the PeerTube embed on the video's origin instance with `p2p=0` (unless the viewer turned P2P on), `autoplay=1&muted=1&loop=1&api=1&controlBar=0`. Only the visible reel plays; the next one is mounted paused (preload); the previous one is paused; anything further is torn down (`playerPlan`). With `api=1` the app speaks PeerTube's embed API (jschannel over postMessage, scope `peertube`, the `publish-request`/`publish-reply` handshake): play, pause, `setVolume`, and `playbackStatusUpdate` for finish detection. If an instance never completes the handshake, pausing falls back to unloading the iframe and mute to reloading it. hls.js isn't used: getting the HLS URL needs a detail request per video, and the embed already handles HLS.
- **History:** a reel that stays visible for 3 s records a `watch` (and counts for discovery stats); one the embed reports ≥ 80 % played records a `finish`, which a match can receive only if its consent includes finished watches.

## Match

`src/lib/match/` (service, identity, relay adapter, PSI loading, demo peer) and `src/ui/matches.ts`. `packages/match` is imported from source like core (`src/lib/match/pkg.ts`). Prototype: the protocol and OpenMined PSI are unaudited; message kinds are provisional (MATCH.md).

### Identity

- Create a key (nostr-tools `generateSecretKey` via `generateMatchKey`), import an `nsec`, or use a NIP-07 extension that supports NIP-44 (`window.nostr.nip44`). A local secret is kept only in the encrypted vault (`identity`); an extension's key never enters the page.
- The npub is shown with Copy (falls back to selecting the text). Removing the identity (in-page confirm) deletes the key and the MatchBook.
- npub/nsec encoding: `src/lib/bech32.ts` (NIP-19, tested against the NIP's vectors).

### Relays

- Settings → `settings.relays` (localStorage; they are configuration). **None by default**, so nothing is sent until the viewer adds one. `wss://` anywhere; plain `ws://` only for localhost / 127.0.0.1. Up to 6.
- `WsRelay` (`src/lib/match/wsRelay.ts`) implements match's `RelayLike`: NIP-01 `EVENT` (waits for `OK`), `REQ` until `EOSE` then `CLOSE`, merge and de-duplicate across relays, re-check the filter locally, ignore malformed events and anything over 64 KiB, refuse to send events over 64 KiB, per-operation timeouts. NIP-42: only when a relay answers `auth-required:` (in `OK` or `CLOSED`) does it sign a kind-22242 event for that relay's challenge with the identity key and retry once. Authenticating identifies you to that relay, so it never happens unasked.
- `npm run dev-relay` (`scripts/dev-relay.mjs`, `ws` 8.21.3): an in-memory relay on 127.0.0.1:7777 for development. It verifies signatures, refuses events over 65,536 bytes, refuses and hides NIP-40-expired events (and purges them each minute), supports live subscriptions, and with `--auth` requires NIP-42 before serving REQs. Never test against public relays.
- The app checks relays when Matches opens, when the tab becomes visible, every minute while visible, and on "Check for messages".

### Requests, previews, consent

- **Request:** by npub (with a local name), from a reel's Match button, from a Creator studio page whose channel publishes an npub, or (offline) the demo peer. It opens the **consent sheet** (mockup's "Request match" modal): endorsements only, or endorsements + finished watches; 30/60/90-day window (with a note when it exceeds the history retention); never-share tags, late night (22:00–06:00) and specific endorsed videos; a live count of what they'd get (newest 128); 90-day expiry; "anything sent can be kept". Optionally "Ask for a preview first".
- **Previews** follow MATCH.md: the target accepts explicitly and sees how many of its 8 yearly previews remain; its device runs PSI as the party that learns |A∩B|, noises it (ε = 0.5, floor 5) and sends only that. The requester sees the noised number and bucket ("23 · a lot in common", or "<5"). Both sides need 20+ shareable items (core's `minSetSize`); the UI says so and disables the buttons below it, since an accepted preview that fails still uses budget. A spent budget goes out as an ordinary decline.
- **Accept:** the target picks its own consent in the same sheet. Active matches show similarity (Jaccard, computed on the device), the preview result, expiry, what you share, and: Renew / Accept renewal, Pause quietly (D2), What I share…, Revoke (in-page confirm that says it can't recall what was sent). Dev builds and the offline demo also offer "Send sketch now".
- **Ledger:** "What you share, and with whom" per match (shares, window, status), on the Matches screen and in Sharing & privacy.

### PSI in the browser

`@openmined/psi.js` 2.0.6 (pinned in apps/web too, `ignore-scripts`) has a browser build with the WASM embedded. Its Emscripten bindings generate code with `new Function`, which the app's CSP forbids (`script-src 'self' 'wasm-unsafe-eval'`, no `'unsafe-eval'`), and Chrome applies the page's CSP to its workers as well. So:

- **Live build:** PSI runs in `psi-frame.html`, a hidden iframe sandboxed with `allow-scripts` only (opaque origin: no access to the app's storage, cookies or vault key) with its own CSP that allows eval. The app talks to it over postMessage (`src/lib/match/psiFrame.ts`, `public/psi-frame.js`). It loads only when a preview is about to run.
- **Artifact build:** psi.js is inlined into the single file (about 2 MB) through the same `openMinedPsi()` adapter as Node.
- **Bundling packages/match:** esbuild resolves `node:module` (used only by match's PSI adapter) to `shims/node-module.js`, which hands back psi.js's browser init; `Buffer.from(...).toString('base64')` is provided by `src/lib/match/buffer.ts`. nostr-tools bundles as is.
- If PSI can't load, previews say "Preview unavailable in this browser" with the reason, and the rest of Match (requests, accept, sketches, ranking) still works.

### Sketches and ranking

- Sketch history comes from the encrypted local history: endorsements, plus `finish` events when a match's consent includes finished watches (`toSketchHistory`). Passive `watch` events never qualify.
- Sketches go out on match's fixed weekly schedule (`sendDueSketches` on every check; the first is due when the match activates), paused matches included (quiet pause). Dev builds can send one on demand.
- Received sketches become `match` candidates for the same `rank()` pass, with the Match chip and why-lines such as "Ines endorsed it (overlap 0.56)". Sketch items the app hasn't seen are resolved at their origin instance (like taste-list items, 60 per check), which tells that instance someone at this IP looked the video up.

### Persistence

The `MatchBook` (per-match secret keys, both sides' last sketches, preview budget) is stored in the vault as `matchbook`, after every operation; petnames and the local activity log as `matchmeta`. Client operations are serialized, since `MatchClient` replaces its book after awaits. PSI sessions live in memory, so a reload mid-preview loses that preview (MATCH.md).

### Offline artifact: the simulated demo peer

The artifact can't reach relays, so Match runs against match's `InMemoryRelay` in the page and a **"Demo peer (simulated)"**, labelled as such wherever it appears: its own random key, 30 made-up endorsements of snapshot videos, real PSI and real gift-wrapped sketches. It accepts previews and matches automatically, accepts renewals, and sends its sketch at once. The viewer can request a match with it, have it ask (to try the target side and the budget), add 24 demo endorsements (12 shared with the peer) to reach the preview minimum, or start over with a new demo peer (previews are limited to one per pair per week). Its state is kept in the vault (`demopeer`).
