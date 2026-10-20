# Web client (v1)

Status: working client with Reels, a feed settings sheet and Match (prototype); production pass (name, PWA, moderation, native hooks, pick-dated taste, Publish my picks, onboarding, accessibility, Tier 2 discovery stats, private relay) on 2026-10-19. Code: `apps/web/` (see its README for how to run it). Display name **Multiverse Video** (one constant: `apps/web/src/brand.json`; name check pending, SHIPPING.md).
Companion to `DESIGN.md`, `PROTOCOL.md` and `ANALYTICS.md`. Where this document and the code disagree, that is a bug.

## Scope

The client ships **Follow, Subscribe to taste (lists, and Follow taste for a creator's own public picks), reserved explore slots and 1:1 Match** (with PSI previews), all
ranked on the device by `packages/core` `rank()`. Match runs `packages/match` (prototype, unaudited) over Nostr
relays the viewer adds (or the build's private OHTTP relay). Production features: on-device moderation (packages/moderation), the native-shell hooks, "Publish my picks" (packages/taste), first-run onboarding, and Tier 2 discovery stats (packages/analytics; uploads off unless the build trusts a helper). Circle, second degree and the Tier 2 results view are still "coming next".

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

Fetched tags are cached locally (`tags`). The offline snapshot stores tags for its recent videos. Before the first endorsement, topics chosen at onboarding (`settings.topics`) serve as the tag profile.

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
| `settings` | localStorage | instances, popular section, private watching, P2P, analytics switches, theme, `onboarded`, `topics` (onboarding), `matchTransport` (`ohttp`/`direct`) and `ohttpStrict`, `nativeNotify`/`nativeBackground` (native shells, off by default), `retentionDays` (30/60/90, default 60), `defaultView` (`reels`/`grid`, default reels), `relays` (Match; none by default), `telemetry` (opt-in crash reports / bug-report diagnostics / usage analytics, all off, and the state of the one-time question; see below) |
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
| `identity` | vault | Match identity: a local secret key and its pubkey, or the NIP-07 extension's pubkey. In a native shell only the pubkey (`keystore: true`); the secret is in the OS keystore as `nostr-secret-key` |
| `matchbook` | vault | the `MatchBook`: matches, per-match secret keys, both sides' last sketches, preview state |
| `matchmeta` | vault | petnames for peers and the local Match activity log |
| `demopeer` | vault | offline artifact only: the simulated demo peer's key, book and made-up history |
| `moderation` | vault | packages/moderation policy (`serializePolicy`: NSFW/violence modes, labeler subscriptions, rules, block and mute lists), cached label events (≤ 5,000) and the catalog instances' public moderation data. Says whom the viewer avoids |
| `picks` | vault | the "Publish my picks" draft (a packages/taste `PicksSet`) and the dry-run switch (on by default) |
| `analyticsLedger` | vault | Tier 2: per 28-day window, creator and channel counts. No video ids, titles or times |
| `analyticsJobs` | vault | Tier 2: planned reports (window, creator, channel index, schedule, the encoded DAP report once generated) |
| `analyticsConfigs` | vault | Tier 2: creators' task configs found (re-checked on load), or "none" with the date, for a day |
| `tally` | vault | **dropped**: the old per-kind tally can't become per-creator; it is overwritten with null on first start |

- `toSketchHistory()` maps history to core's `HistoryEntry` for Match: endorsements and `finish` events (≥ 80 % played in Reels). Opening the player or scrolling past a reel is not a finished watch.
- **Private watching** records nothing: no history, impressions or tally.

### Encryption at rest (`src/lib/vault.ts`)

- **Cipher:** WebCrypto only. AES-GCM with a 256-bit key, a fresh random 96-bit IV per write, and the record name as additional authenticated data, so a ciphertext copied into another record fails to decrypt. Each record is one IndexedDB value `{iv, ct}` in database `match-feed`, store `vault`, key `rec:<name>`.
- **Key, default (device mode):** a non-extractable `CryptoKey` generated on first run and stored in the same IndexedDB store. Page scripts can use it but can't export its bytes.
- **Key in a native shell:** 32 random bytes kept by the shell's keystore as `vault-key` (Android Keystore, iOS Keychain with `AfterFirstUnlockThisDeviceOnly`, the desktop keychain), imported as a non-extractable `CryptoKey`; no key in IndexedDB. On the first start in the shell, records under the IndexedDB key are re-encrypted under it and the old key deleted, in one transaction. A wipe replaces the keystore key; passphrase mode removes it and works as before. If the keystore doesn't answer (e.g. Linux without a Secret Service), the browser key is used and the storage panel says where the key lives. JS still holds the raw key briefly while importing it, and a malicious build can still use it (THREAT_MODEL T9).
- **Key, optional (passphrase mode):** a setting under Sharing & settings, labeled optional. The key is derived with PBKDF2-HMAC-SHA-256 at 600,000 iterations and a random 16-byte salt. WebCrypto has no Argon2 or scrypt, so PBKDF2 is the strongest KDF available without a dependency. Only the salt, the iteration count and an encrypted check value are stored, and the app asks for the passphrase at startup. **Tradeoff:** a forgotten passphrase means lost history, follows and taste lists. The unlock screen's only way out is "start fresh", which deletes them. Turning the passphrase on or off re-encrypts every record in one transaction.
- **Migration:** on the first start after this change, any plaintext `mf.v1.history`, `tally`, `impressions`, `follows`, `taste`, `videos` and `tags` in localStorage is encrypted into the vault. The plaintext is deleted only after the ciphertext is stored; if that write fails, it stays and the migration retries on the next start.
- **Retention:** history older than the sharing window (`retentionDays`) is deleted when the app starts, when the setting changes, and once a day after that (an hourly check, plus a check when the tab becomes visible). Impressions and the tally carry no timestamps, so they're bounded by their caps and cleared by the wipe.
- **Wipe local history** (in-page confirmation) clears `history`, `tally`, `impressions`, `hidden` and the tag cache, and crypto-shreds the vault. The Match identity, book and petnames are re-encrypted under the new key with the follows and taste lists (they're relationships, not history; remove them on the Matches screen). It deletes every ciphertext record and the key (or the passphrase salt and check) in one transaction, then writes what stays (follows, taste lists, followed creator tastes, the taste-list video cache) under a brand-new device key. Any plaintext left by an older version is deleted too. A wipe turns passphrase mode off, and the toast says so. Settings and recipes stay.
- **Fallback:** if IndexedDB or WebCrypto is unavailable or broken (no secure context, a blocked or sandboxed origin, some private windows, or IndexedDB not opening within 4 s), the app uses a memory-only vault. Sensitive state lives in memory for the tab. A banner at the top and the Local history panel both say so. Nothing sensitive is ever written to localStorage as a fallback. Plaintext left by an older version is read for the session but not deleted, since deleting it there would lose it. The panel mentions it, and the wipe removes it.

**What this protects against.** Casual forensic or disk access, such as someone grepping the profile directory or a disk image for video URLs. Tools, backups and sync that copy site storage, since localStorage no longer holds history. Other OS users and other browser profiles, which can't run this origin's scripts with this profile's key. With crypto-shredding, a wipe is final even where IndexedDB leaves deleted pages on disk until compaction, as long as the key is gone too. In passphrase mode, also a full copy of the browser profile, up to the cost of guessing the passphrase.

**What it doesn't protect against.** Malware on the device. A compromised or malicious build of this origin's JavaScript, which can ask the browser to decrypt everything. Anyone using the unlocked browser profile, who can simply open the app. In device mode, someone with a complete copy of the profile directory: the key is stored beside the ciphertext. Non-extractable stops page scripts from exporting it, not disk forensics. Device mode adds no OS-keystore protection, because browsers don't expose one to web pages. Full-disk encryption remains the main defense against a seized device. Ciphertext sizes and write times are visible, and settings and recipes are not encrypted.

## Discovery stats, Tier 2 (ANALYTICS.md decisions; packages/analytics)

Wired per `docs/ANALYTICS_IMPLEMENTATION.md` §8 (`src/lib/discovery.ts`, `src/lib/analytics/`):
- **Viewer (Q1): on by default**, with the main switch and the per-channel switches; nothing during private watching. `noteWatch` calls `recordView` with the creator handle and `channelOf(via)` (the ranked item's `primary`; no context = `other`), never the video. Turning contribution off deletes the ledger and every pending report at once.
- **Creator: opt-in, private by default (Q3).** A creator opts in by publishing the task config their instance made with `infra/janus` (`new-task.mjs`): the studio checks it (`parseTaskConfig`), offers "Publish my numbers" (`publish: true`), and publishes it as a signed kind-30078 event (`d` = `match-feed/discovery-task/v1`, confirm step, your relays only) or downloads it to host with a `discovery-stats:` line in the channel description. Showing collected results is not built yet.
- **Uploads stay off unless the build trusts a helper.** `MF_DAP_HELPERS` (build time) is the allowlist of independent helper origins; it is **empty by default**, and then no config is looked up and nothing is sent. With helpers: configs are looked up for creators in the ledger (one REQ with several authors on your relays for creators with a known npub; the `discovery-stats:` URL on the creator's own host otherwise), cached a day, re-checked on load; a timer 3–5 minutes after start and then every 10–30 minutes (`nextRunDelayMs`) runs `planReports` and `runUploads` (one report per tick). The DAP client (`@divviup/dap` 0.9.1, which bundles with esbuild for the browser) is a separate `dist/dap.js`, injected only when a report is due.
- **Not through OHTTP.** The private relay's gateway forwards only Nostr (its target allow-list), so DAP requests go to the leader and helper directly, through `guardedFetch` (only `hpke_config` and the report PUT; no credentials, referrer or redirects).
- The settings ledger row and "Discovery stats your device would contribute" show the ledger's totals and what would be sent, to whom. The ePrivacy question in ANALYTICS.md is still open: ship `contribute: false` for EU users if advice says so.

## Crash reports, bug reports and usage analytics (opt-in)

Full description, event list, retention and operator duties: `docs/TELEMETRY.md`. Threat T34.
This is for the app's developers and is separate from the discovery-stats switch above.

- **Asked once, later, as a question:** a small non-modal card (`src/ui/telemetry.ts`) on the second launch (20 s in) or after 3 minutes of use, never on first paint. Three switches, all off: crash & error reports, bug reports & feedback (diagnostics attached by default), usage analytics. "Turn on selected", "Not now" (again in ~30 days, at most twice more), "No thanks". State machine: `src/lib/telemetry/consent.ts`.
- **Settings → Sharing & privacy:** the same switches with "What gets sent", a status line, a ledger row, and the bug report form (also in the ⋯ menu and the feed settings sheet's links). The form shows the exact JSON before Send.
- **Crash reports:** `@sentry/browser` 10.76.0 in a separate bundle, `dist/crash.js`, injected only after opt-in (`src/telemetry/crash-entry.ts`, `src/lib/telemetry/controller.ts`). No default integrations, no tracing or replay, `sendDefaultPii: false`; every event goes through the allow-list scrubber (`src/lib/telemetry/scrub.ts`), sampling, a rate limit and a final pattern check.
- **Bug reports:** a captured-message envelope POSTed to GlitchTip directly (`src/lib/telemetry/feedback.ts`), no SDK; works without the other switches.
- **Usage analytics:** a small client posting allow-listed events to Umami's `/api/send` (`src/lib/telemetry/usage.ts`), not Umami's tracker script; route names instead of URLs.
- **Configuration:** `MF_GLITCHTIP_DSN`, `MF_UMAMI_HOST`, `MF_UMAMI_WEBSITE_ID` at build time; empty hides the feature. Configured hosts are added to CSP `connect-src`. The offline artifact never has them. Servers: `infra/glitchtip`, `infra/umami`.

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
| 1 | Signed Nostr list | the npub the creator publishes in their channel description or support text (as Match finds it); queried **only on relays the viewer configured**. No relays: skipped, nothing is contacted | NIP-51 **video curation set**, kind 30005 (`e` refs to NIP-71 videos), `authors` = that pubkey. The newest event per `d` wins; every event's id and Schnorr signature is checked (match's `InMemoryRelay.publish`, which runs nostr-tools `verifyEvent`, on a copy without nostr-tools' cached-verdict symbol). Only public items (tags) are read; private, NIP-44-encrypted items are the author's. `a` refs to addressable videos (34235/34236, what our bridge emits) are accepted too. Each referenced video event maps back to its PeerTube watch URL through its `["origin", "peertube", uuid, url]` tag, else an `r` tag that is a watch URL. Tag order is chronological (NIP-51), so the last tag is the newest pick. Read through packages/taste `readCreatorPicks` (strict `parseCurationSet`); `pick` tags (PROTOCOL.md §7) add per-pick `addedAt`, `sponsored`/`affiliated` and a note |
| 2 | Taste-list URL | an https URL in the channel description or support text that ends in `.json` or has "taste" in it or on its line (at most 3 tried) | taste list format v1 above, with the same 64 KiB and validation rules; its `sponsored`/`affiliated` flags carry through to the cards |
| 3 | Public PeerTube playlists | `GET /api/v1/video-channels/{name}/video-playlists` and `GET /api/v1/accounts/{owner}/video-playlists` (owner from the channel's `ownerAccount`) on the channel's home instance, then `GET /api/v1/video-playlists/{uuid}/videos` for up to 8 playlists, most recently updated first | keep playlists with `privacy.id` 1 (Public) and `type.id` 1 (Regular; 2 is Watch later); keep elements with `type` 0 (1 deleted, 2 private, 3 unavailable) whose video is public; **drop the creator's own uploads** (video channel = this channel, or video account = the owner account). Elements carry full video objects, so no lookup per pick. Verified 2026-10-19 on video.blender.org, tilvids.com, spectra.video (CORS `*`, fields as above) |

If none has picks, the Taste button is disabled with "No public picks yet" (most channels: their playlists hold only their own uploads, e.g. video.blender.org's).

**Ranking.** Each enabled followed taste is a `taste` source with `via` = the creator's name (made unique against list names, since core caps per `via`), so `maxPerTasteList` caps it like any list (2 per page by default). Its strength is its own track record (`tasteListStrength`, impressions keyed `creator:<handle>`), starting at 0.5. Sponsored/affiliated labels apply when the source provides them (v1 lists, and NIP-51 sets with `pick` tags; PeerTube playlists have no such flag). Each pick's `addedAt` reaches `rank()` as `source.addedAt`. The why-line names the creator and source: "In Blender's picks (public PeerTube playlist)". Picks are capped at the 100 newest per creator. Picks from Nostr or a URL without video data are resolved at their origin instance, up to 40 per refresh, and cached in `videos`. Playlist picks are often older and longer than uploads: under the 14-day half-life they score low, and Reels shows long ones only as "Longer video" fill once the short ones run out.

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

The live build self-hosts its fonts (`public/fonts/`, OFL 1.1; Latin and Latin-extended subsets), and its CSP allows fonts only from `'self'`. In normal use the app contacts only the PeerTube instances: the configured catalog instances, the home instances of followed channels and of creators whose taste you look at or follow (profile and playlists), taste-list origins, the video host when you press play (or when a reel becomes visible), and, for Reels, the channel's profile (to look for a published npub) on a catalog instance or the channel's home instance. A taste-list URL import, or a creator's linked taste list, also contacts the host of that URL. Match and Follow taste contact only the relays you add (Follow taste read-only, without AUTH), plus the origin instance of sketch items it has to resolve. CSP: `script-src 'self' 'wasm-unsafe-eval'`, `connect-src` adds `wss:` and local `ws:` for relays, `frame-src 'self' https:` (the PSI frame and embeds). The artifact build keeps the Google Fonts link (the sandbox allows it, and the build is a demo). With opt-in telemetry configured at build time and switched on by the viewer, the app also contacts the operator's GlitchTip and Umami hosts (docs/TELEMETRY.md); those hosts are then listed in `connect-src`, and `crash.js` is same-origin. Added in the production pass: the catalog instances' `/api/v1/config` and public blocklist log once a day (moderation defaults); labelers' events, read-only by labeler, from your relays and the labelers' own, only if you subscribed to one; your relays (and the chosen labelers' relays) when you send a Nostr report or publish picks, only on confirm; with the private relay compiled in and chosen, its OHTTP relay instead of your relays for Match; and, only in a build with `MF_DAP_HELPERS`, creators' leader and the helper for Tier 2 reports (plus a config lookup on the creator's host). A shared video's host is named before it's contacted.

## Offline artifact build

`apps/web/dist-artifact/index.html` is one self-contained file (about 2.3 MB with PSI inlined) for the claude.ai artifact sandbox, which blocks network access. Match runs there against the simulated demo peer (see Match). It bundles a snapshot of real API responses (`src/snapshot/snapshot.json`, about 106 KB: 127 videos from framatube.org and tilvids.com, with `aspectRatio` re-captured on 2026-10-19, plus public profiles and playlists of 10 channels for Follow taste). For Follow taste the snapshot script captures three curators known to keep public playlists of other creators' videos (wex_channel, puppuccino_channel and the_tech_beast_channel on tilvids.com, up to 30 elements per playlist), and the 24 most-represented snapshot channels that have public playlists at all (two elements each when they hold only the channel's own uploads, enough for "No public picks yet"). Offline, Nostr and linked lists are skipped (no network). A snapshot-backed `fetch` serves those responses to the *same* core client, so ranking, follows (of channels in the snapshot), taste lists, recipes, settings and the studio all run the real code. Thumbnails are gradient placeholders, playback and URL import are disabled, and a banner says so. Ranking uses the capture time as "now", so explore slots and recency read as they did that day. Storage works as in the live build: encrypted in IndexedDB when the sandbox's origin allows it, otherwise memory-only with the banner described under Local state. Retention uses the real clock, not the capture time. Telemetry is disabled in the artifact: it's built without endpoints, and the app ignores telemetry in snapshot mode, so there's no question, no switch and no request.


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

- Settings → `settings.relays` (localStorage; they are configuration). **None by default**, so nothing is sent until the viewer adds one. Matches, Relays offers one-tap suggestions (`SUGGESTED_RELAYS` in `src/lib/settings.ts`): this deployment's relay, wss://relay.multiversegames.ai, and three public strfry relays. `wss://` anywhere; plain `ws://` only for localhost / 127.0.0.1. Up to 6.
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

## Name

The display name lives in one file, `apps/web/src/brand.json` (`name`, `shortName`, `description`, theme colors), kept in step with `apps/mobile/brand.json`. `scripts/build.mjs` fills `index.html` (`__APP_NAME__` placeholders), writes `manifest.webmanifest` and the artifact `<title>` from it; `src/brand.ts` gives the UI the same constant (header, unlock screen, notifications, onboarding). Internal identifiers are deliberately unchanged, so existing data keeps working without a migration: localStorage keys `mf.v1.*`, the IndexedDB database `match-feed`, the vault's AAD strings, the service worker's cache prefix `mf-shell-`, protocol namespaces and recipe authors ("Match Feed" is still the project and protocol name).

## PWA: service worker, install, offline

- **Precache by content hash.** `sw.js` gets its cache id and file list from the build: a SHA-256 over the path and bytes of **every** file in `dist/` (except `sw.js` itself), so a release that changes only `index.html`, fonts, the manifest or `psi.js` still gets a new cache (DEPLOY.md §5.4). Deterministic: sorted paths, no timestamps (the reproducibility check passes).
- **What is cached:** the app shell only: `./`, `index.html`, `app.js`, `app.css`, `fonts.css` and the fonts, the icons, the manifest, `psi-frame.html/.js` and `psi.js`. **Never:** PeerTube API responses, videos, thumbnails, channel pages, relay traffic, telemetry, `crash.js`, `dap.js`, example lists, `.well-known/`, source maps. The worker doesn't intercept cross-origin requests at all, and same-origin requests outside the list go to the network untouched. History lives only in the encrypted vault, so nothing in the cache shows what anyone watched, and it can't leak between browser profiles (each has its own cache and vault).
- **Updates:** navigations and shell files are served from the current version's cache, so a tab never mixes versions. A new version installs in the background and waits; the page shows "Update available" with Reload, which sends `skip-waiting` and reloads on `controllerchange`. Registration: https or localhost, never in the native shells (they drop `sw.js`).
- **Offline:** the shell opens from the cache with a "You're offline" banner; settings, Matches, history and the wipe work, the feed says it needs the network, and the catalog reloads when the browser comes back online.
- **Install:** manifest `id`, `any` and **maskable** icons (`icon-maskable-*.png`, safe-zone artwork), light/dark `theme-color`, shortcuts (Reels, Matches: `?view=`, `?screen=`) and a GET **share target** (`share_url`/`share_text`/`share_title`, handled like a native share, below). Settings → App shows "Install app" when the browser offers `beforeinstallprompt`, iOS instructions on iPhone/iPad, or "installed".
- **security.txt:** `public/.well-known/security.txt` from `infra/web/.well-known/security.txt`, with the placeholder email and `Canonical` left out until the owner has them (the build refuses `example.org` values).

## Moderation (packages/moderation)

`src/lib/modstate.ts` (state and policy), `src/ui/moderation.ts` (UI). The pre-filter runs between candidates and `rank()` for the feed, Reels and both popular passes (`applyModeration`, then `attachVerdicts`); videos opened from links, shares and the studio are judged in the watch view (`moderateVideo`).
- **Facts:** the catalog keeps `peertubeVideoMeta` (NSFW flags, owner account, description) from the same responses core parses. Sources carry owners: taste lists by `via` (a creator taste's `30005:<pk>:<d>` address and pubkey, or `creator:<handle>`; a v1 list's name and its author npub), matches by the peer's pubkey. Blocking a creator also blocks their picks as a source; blocking a person (npub) revokes or declines a live match, and later requests from that key are declined without being shown.
- **NSFW policy:** blur by default. "Show" takes two separate actions (choose Show, then confirm "I'm 18 or older"; `setSensitiveMode` with `confirmAdult`). On iOS in the native shell NSFW is always hidden and there is no switch (App Review 1.2). Violence: blur by default, hide/blur/show.
- **Labelers:** none by default; subscribe by npub (and optionally a relay). Labels are fetched read-only by labeler (`authors`), never by video, from your relays plus the labeler's, at start and every 4 hours (incremental `since`), cached in the vault and re-indexed on load so deletions apply. Instance defaults: `/api/v1/config` and the public blocklist log of the catalog instances, daily; never `blocklist/status` point queries.
- **"N hidden":** a pill in the feed bar (and links at the end of the grid and Reels) opens a list of hidden videos with plain-language reasons and Unblock for the viewer's own blocks.
- **Report:** two steps with a confirmation (Report dialog, apps/web README). The PeerTube part is primary but needs a signed-in account on the instance, which this app can't provide, so the dialog opens the video there and copies the text. The NIP-56 part (when the target has a Nostr key) is **addressed to the chosen labelers with an untyped `["p", <labeler>]` tag** (packages/moderation `buildReport({labelers})`, the addressing `services/labeler` intake reads) and sent, signed with the Match identity, to the viewer's relays plus the labelers' relays, only on "Sign and send".

## Native shells (window.MatchFeedNative)

Every hook in apps/mobile README "Hooks apps/web needs to implement" (contract `apps/mobile/bridge/types.ts`, copied in `src/lib/native.ts` and compared by a test). In a browser the bridge is undefined and each hook is a no-op.
1. Feature detection (`nativeBridge()`, version 1 only).
2. Vault key in the OS keystore (above, Encryption at rest).
3. Match identity secret in the keystore (`nostr-secret-key`); the vault keeps the pubkey; removing the identity removes the secret; older vault copies move on start.
4. Incoming deep links and shares: `nostr:npub/nprofile` (decoded and checksummed here) opens a confirmation, then the match consent sheet; a PeerTube watch URL opens a confirmation that names the host (and says it isn't a catalog instance, which would see the IP) before resolving it. The PWA share target uses the same dialog.
5. Notifications, opt-in (Settings → App): the permission prompt only from that switch; generic lock-screen text ("New match request" / "Open Multiverse Video to review it."), stable 31-bit ids per event, only while the app isn't visible; tapping routes to Matches.
6. Background checks, opt-in: `background.enable` runs a relay check and due sketches within ~20 s; unavailable in passphrase mode; the switch says relays then see check-ins at OS-chosen times.
7. Labels: the storage panel names the keystore.
8. Product name from one constant (above).
9. Desktop "Open on PeerTube": **apps/desktop exposes no https-only opener** (no plugin, no command), so external links don't open in the Tauri window. Settings → App says so and Share copies the link; adding an `open_external` command is apps/desktop's call.

## Taste: pick-dated ranking and "Publish my picks"

- **Reader:** Follow taste source 1 now uses packages/taste `readCreatorPicks` (strict `parseCurationSet`, signature checks, `resolveCurationSet`). Picks carry `addedAt`, `sponsored`, `affiliated` and `note` from `pick` tags (PROTOCOL.md §7); sets without them fall back to the set's `created_at`.
- **Ranking:** every taste source passes `source.addedAt = new Date(item.addedAt * 1000)` to `rank()` (`buildCandidates`), so a fresh pick of an older video decays from the pick date. Sponsored/Affiliated labels carry through to cards and Reels for all taste sources.
- **Publish my picks** (Creator studio, `src/ui/publish.ts`, `src/lib/picks.ts`): candidates are the viewer's endorsed videos (plus pasted watch URLs); each pick is stamped `addedAt` = now; Sponsored/Affiliated/note per pick; "Check which are on Nostr" (`resolvePicks` on your relays, your key first as a trusted bridge); Preview (`publishPicks` dry run) shows warnings, the kind-30005 event and the v1 JSON; **dry run by default** (Sign without sending); Publish needs a confirmation, signs with the Match identity key (vault/keystore) or NIP-07, and sends only to `settings.relays`; Download `taste.json`; the channel-description lines for Follow taste. The offline artifact publishes to an in-page `MemoryRelay`.

## First-run onboarding

`src/ui/onboarding.ts`, shown once to a viewer with nothing followed, subscribed or watched (existing users are marked done silently): instances and topics (topics become a starting tag profile for explore relevance until the first endorsement; never sent), following suggested creators' tastes (known public-playlist curators; in the artifact, the snapshot's curators) or an example list, then Reels vs Grid and the default view. A modal dialog: focus trapped, Escape/Skip at every step, native buttons and inputs only, a focusable heading per step.

## Private relay for Match (packages/transport, OHTTP)

When the build has `MF_OHTTP_RELAY_URL` and `MF_OHTTP_PINS` (empty: the option is hidden), Matches → Relays offers "Private relay (OHTTP)" (default for new installs; existing relay lists stay direct) or "Direct". OHTTP mode passes an `OhttpRelay` (pinned gateway key, `credentials: "omit"`) to `MatchService.setRelay`; the UI says the gateway's relays replace your list, NIP-42 relays can't be used, and checks run every 5 minutes instead of every minute. "Strict timing" switches to `constant-rate` with `splitKeys`. The relay origin is added to CSP `connect-src`. Covers Match only: Follow-taste reads, labels and picks still use your relay list directly; Tier 2 uploads don't fit the gateway (Nostr only).

## Accessibility

`npm run check:ui` runs axe-core 4.13.0 through Playwright 1.56.1 on each screen (onboarding, Reels, report, hidden list, Grid, feed settings, Matches, studio, settings, dark theme with reduced motion, offline) of both builds at 390×844 and 1280×900, and fails on serious or critical violations. Fixed in this pass: Reels no longer claims `role="feed"` (its children weren't articles), contrast of the light `--second`/`--circle` tokens and avatars, focusable scroll regions (tables, JSON previews), heading order, a skip link, a focusable `main`. Dialogs share one helper (`src/ui/dialog.ts`: `aria-modal`, labelled, focus trapped and restored); the watch overlay traps focus too. The script also checks focus stays inside the onboarding dialog and the feed settings sheet. Reduced motion: the sheet slide, card hover and Reels smooth scrolling are off under `prefers-reduced-motion`. Remaining: one moderate `page-has-heading-one` while the offline shell is still unlocking the vault; no screen-reader (VoiceOver/TalkBack/Orca) pass yet.

## Reproducibility (DEPLOY.md §5)

Done in apps/web: dependencies declared and resolved from apps/web's own `node_modules` (build plugin and test resolve hook; `npm ci` in a clean copy of apps/web + packages/ builds, tests and typechecks), Node pinned (`.nvmrc`, `engines` 22.22.0), the service-worker id hashes every built file, `security.txt` shipped, one name constant, `src/snapshot/snapshot.json` stays committed and is never fetched by `build`. `.github/scripts/check-web-reproducible.sh` passes (dist/ 29 files and dist-artifact identical). CI and DEPLOY.md still install packages/match too; that step is no longer needed for apps/web (not changed here: outside apps/web).
