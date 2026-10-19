# Web client (v1)

Status: first working client, 2026-10-19. Code: `apps/web/` (see its README for how to run it).
Companion to `DESIGN.md`, `PROTOCOL.md` and `ANALYTICS.md`. Where this document and the code disagree, that is a bug.

## Scope

v1 ships the first tier of the ship order in DESIGN.md: **Follow, Subscribe to taste and reserved explore slots**,
with on-device ranking by `packages/core` `rank()`. Match, Circle, second degree, previews and Tier 2 creator
analytics appear in the UI only as "coming next" placeholders. v1 has no private matching. The only cryptography is local encryption at rest (see Local state).

## Data flow

Personal feed, one `rank()` pass with the viewer's recipe:

| Source kind | Where candidates come from | Strength |
|---|---|---|
| `follow` | `channelVideos` on each followed channel's home instance, plus any catalog video by a followed creator | 1 |
| `taste` | videos resolved from each subscribed taste list (`getVideo` on the id's origin instance) | `tasteListStrength` from the list's track record (below); 0.5 for a new list |
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
- Playback: the PeerTube embed on the video's **origin** instance (`/videos/embed/{id}?p2p=0|1`). P2P is off unless the viewer turns it on (DESIGN.md, State resistance). The embed handles HLS itself, so the app doesn't ship hls.js.

## Local state

Local state is split in two. Configuration stays in `localStorage` under `mf.v1.*`. Anything that shows what the viewer watches or likes is encrypted at rest in IndexedDB (THREAT_MODEL.md T9). Every access is wrapped; when storage fails, the app runs from memory for the session.

| Key | Where | Contents |
|---|---|---|
| `settings` | localStorage | instances, popular section, private watching, P2P, analytics switches, theme, `retentionDays` (30/60/90, default 60) |
| `recipe` | localStorage | active recipe id, plus a custom recipe in wire form (re-parsed by `parseRecipe` on load) |
| `tab` | localStorage | last screen |
| `history` | vault | `{videoId, at, kind: "watch" \| "endorse", tags, via?}`, capped at 2,000 and limited to the sharing window. Not written while private watching is on |
| `tally` | vault | local discovery-channel counts (below) |
| `impressions` | vault | ids of feed items seen, overall and per taste list, for track records (2,000 / 500 per list) |
| `follows` | vault | `{handle, name?, addedAt}` |
| `taste` | vault | subscribed lists (validated again on load) |
| `videos` | vault | cache of resolved taste-list videos (600 max) |
| `tags` | vault | tags fetched from video detail endpoints (1,500 max). Includes videos you endorsed, so it counts as sensitive |

- `toSketchHistory()` maps history to core's `HistoryEntry` for when Match ships. It passes **endorsements only**: opening the player is not a finished watch.
- **Private watching** records nothing: no history, impressions or tally.

### Encryption at rest (`src/lib/vault.ts`)

- **Cipher:** WebCrypto only. AES-GCM with a 256-bit key, a fresh random 96-bit IV per write, and the record name as additional authenticated data, so a ciphertext copied into another record fails to decrypt. Each record is one IndexedDB value `{iv, ct}` in database `match-feed`, store `vault`, key `rec:<name>`.
- **Key, default (device mode):** a non-extractable `CryptoKey` generated on first run and stored in the same IndexedDB store. Page scripts can use it but can't export its bytes.
- **Key, optional (passphrase mode):** a setting under Sharing & settings, labeled optional. The key is derived with PBKDF2-HMAC-SHA-256 at 600,000 iterations and a random 16-byte salt. WebCrypto has no Argon2 or scrypt, so PBKDF2 is the strongest KDF available without a dependency. Only the salt, the iteration count and an encrypted check value are stored, and the app asks for the passphrase at startup. **Tradeoff:** a forgotten passphrase means lost history, follows and taste lists. The unlock screen's only way out is "start fresh", which deletes them. Turning the passphrase on or off re-encrypts every record in one transaction.
- **Migration:** on the first start after this change, any plaintext `mf.v1.history`, `tally`, `impressions`, `follows`, `taste`, `videos` and `tags` in localStorage is encrypted into the vault. The plaintext is deleted only after the ciphertext is stored; if that write fails, it stays and the migration retries on the next start.
- **Retention:** history older than the sharing window (`retentionDays`) is deleted when the app starts, when the setting changes, and once a day after that (an hourly check, plus a check when the tab becomes visible). Impressions and the tally carry no timestamps, so they're bounded by their caps and cleared by the wipe.
- **Wipe local history** (in-page confirmation) clears `history`, `tally`, `impressions` and the tag cache, and crypto-shreds the vault. It deletes every ciphertext record and the key (or the passphrase salt and check) in one transaction, then writes what stays (follows, taste lists, the taste-list video cache) under a brand-new device key. Any plaintext left by an older version is deleted too. A wipe turns passphrase mode off, and the toast says so. Settings and recipes stay.
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

## Example data

`apps/web/public/examples/*.json` are **example lists, generated automatically** by `npm run snapshot -- --examples`: the most-viewed of an instance's 100 newest local uploads, one per channel. They are labelled as example data everywhere they appear, and no person picked them.

## Fonts and third parties

The live build self-hosts its fonts (`public/fonts/`, OFL 1.1; Latin and Latin-extended subsets), and its CSP allows fonts only from `'self'`. In normal use the app contacts only the PeerTube instances: the configured catalog instances, the home instances of followed channels, taste-list origins, and the video host when you press play. A taste-list URL import also contacts the host of that URL. The artifact build keeps the Google Fonts link (the sandbox allows it, and the build is a demo).

## Offline artifact build

`apps/web/dist-artifact/index.html` is one self-contained file for the claude.ai artifact sandbox, which blocks network access. It bundles a snapshot of real API responses (`src/snapshot/snapshot.json`, about 125 videos from framatube.org and tilvids.com). A snapshot-backed `fetch` serves those responses to the *same* core client, so ranking, follows (of channels in the snapshot), taste lists, recipes, settings and the studio all run the real code. Thumbnails are gradient placeholders, playback and URL import are disabled, and a banner says so. Ranking uses the capture time as "now", so explore slots and recency read as they did that day. Storage works as in the live build: encrypted in IndexedDB when the sandbox's origin allows it, otherwise memory-only with the banner described under Local state. Retention uses the real clock, not the capture time.
