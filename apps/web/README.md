# Match Feed web client

The Match Feed client: Follow, Subscribe to taste, explore slots, recipes, a vertical **Reels** feed, and 1:1
**Match** with PSI previews (prototype). It reads real PeerTube instances from the browser and ranks on the device
with `packages/core` `rank()`; Match runs `packages/match` over Nostr relays you add. Design notes,
data flow and the provisional taste-list format are in [`docs/WEB_APP.md`](../../docs/WEB_APP.md).

- Fonts are self-hosted (`public/fonts/`, OFL); in normal use the live build contacts only PeerTube instances, plus the host of any taste-list URL you import (or a creator links), and relays only if you add them.
- Vanilla TypeScript with a 40-line DOM helper; no framework. Dev dependencies, all pinned: `esbuild` 0.28.2, `typescript` 5.9.3, `fake-indexeddb` 6.2.5 (tests), `ws` 8.21.3 (the dev relay) and `@openmined/psi.js` 2.0.6 (its browser build is copied to `dist/psi.js` or inlined in the artifact). `.npmrc` sets `ignore-scripts`: psi.js declares build tools as dependencies (`protoc-gen-js` has a download postinstall and a vulnerable `adm-zip`); none of them is run or bundled. `packages/core` and `packages/match` (with its nostr-tools) are imported from source (`src/lib/core.ts`, `src/lib/match/pkg.ts`).
- Static output, so any static host works. It's an installable PWA (manifest, icons, and a small service worker that caches only the app shell, never API data).

## Run

```sh
cd apps/web
npm install
npm run dev            # http://localhost:8080, rebuilds on save
npm run build          # dist/ (PWA) + dist-artifact/index.html
npm test               # node:test with --experimental-strip-types, no network (real PSI, a local relay process)
npm run typecheck      # tsc via scripts/typecheck.mjs: fails on app errors; errors inside packages/core are listed as upstream issues
npm run snapshot       # refresh the offline snapshot (network; add -- --examples to regenerate example lists)
npm run build:artifact # only the single-file artifact
npm run dev-relay      # in-memory Nostr relay on ws://127.0.0.1:7777 for Match (add -- --auth for NIP-42)
```

To try Match locally: run `npm run dev-relay` and `npm run dev`, open the app in two browser profiles, create a key in each (Matches), add `ws://127.0.0.1:7777` under Relays, paste one npub into the other's "Request a match", and press "Check for messages" on each side as you go. Previews need 20+ endorsements on each side (endorse reels). Never point development at public relays.

To serve a build: `python3 -m http.server -d dist 8080`. The service worker registers only over https.

## Screens

| Screen | What works |
|---|---|
| Home: Reels | default view. Full-screen, scroll-snapped short videos on phones; a centered 9:16 column with ↑/↓, j/k, space and m on desktop. Same `rank()` and recipe; prefers ≤ 3 min or portrait videos (PeerTube `duration`/`aspectRatio`), falls back to longer ones; infinite loading through core's client pagination. Only the visible reel plays (PeerTube embed, `p2p=0`, autoplay muted, embed API for play/pause/mute/finish); the next is preloaded, far ones torn down. Overlay with chip and "Why am I seeing this?"; rail: Endorse, Follow, **Taste** (Follow taste: the creator's public picks; filled when followed, disabled "No public picks yet" when there are none), Not interested, Share, Open on PeerTube, Request match (when the creator or curator publishes an npub), mute |
| Home: Grid | the previous feed: on-device ranking of follows, taste lists (≤ 2 items per list by default, strength from each list's track record) and new-creator slots (5% by default, ranked by your on-device tag profile once you've endorsed something); chips, "Why am I seeing this?", Sponsored/Affiliated labels; + Follow and a ⋯ menu (Follow taste, Creator studio, Not interested) on every card. Below it, a separate **Popular on your instances** section (live trending from framatube.org and tilvids.com by default) that never takes feed slots |
| Feed settings (sheet) | gear in the header, Settings in the bottom bar, the ⋯ menu, or the recipe pill. Bottom sheet on phones, drawer on desktop. Recipe picker, weights, explore share (2–10% guidance), half-life, per-list and per-creator caps, filters (tags, languages, length, hidden creators), default view, Popular toggle, theme, links, sources (with followed creator tastes: on/off, remove) |
| Matches | identity (create, import nsec, or NIP-07) with npub copy; relays (none by default) with status; request by npub or from a creator/curator; incoming requests with the preview flow (target sees its remaining yearly budget; requester sees the noised count, "<5" below five); consent sheet (endorsements only or + finished watches, window, exclusions); active matches with similarity, renew, quiet pause, revoke (in-page confirm); sharing ledger; activity log. Offline: a "Demo peer (simulated)" |
| Follow & taste | follow by `name@host` or channel URL; taste lists by URL, pasted JSON, or two bundled **example** lists; validation errors shown in plain text; **Creators' taste**: look up a creator, see where their picks come from (signed NIP-51 list on your relays → taste list linked in their description → public PeerTube playlists without their own uploads), follow, turn each on/off, refresh (daily and on demand), remove; Match/Circle marked "coming next" |
| Recipe import & export | export (copy/download) and import through `parseRecipeJson`, with the error path shown (e.g. `recipe.weights.follow: must be between 0 and 10`). Editing moved to the feed settings sheet |
| Sharing & privacy | ledger of who gets what (instances, video hosts, relays and each match, Circle "coming next", discovery stats); switches for private watching, P2P streaming (off by default), anonymous discovery stats (on by default, with an off switch per signal), and the popular section; the instance list; storage status (encrypted, passphrase, or memory-only); history retention (30/60/90 days, default 60); an optional passphrase; wipe local history with an in-page confirm, which also destroys the encryption key |
| Watch overlay | PeerTube embed from the origin instance with `p2p=0` unless enabled; Endorse, Follow, open on PeerTube; records a watch locally unless private watching is on |
| Creator studio | for any channel: Follow taste…; Tier 0 links to the channel and PeerTube's per-video stats pages; Tier 1 public counts (followers, views and likes over recent videos, picks in your loaded taste lists); Tier 2 "coming next" with the decided defaults |

## Layout

```
src/main.ts            live entry           src/main-artifact.ts  offline snapshot entry
src/boot.ts            opens the encrypted vault (passphrase prompt), migrates old plaintext, starts the app
src/app.ts             state, persistence, loading, routing, shell (header tabs, bottom bar, menu)
src/lib/               pure logic (tested): catalog, candidates, tastelist, creatortaste (Follow taste; network
                       adapters in tastesources), recipes, trackrecord, history,
                       analytics, settings, storage, vault (encryption at rest), localdata (what's sensitive,
                       migration), handles, videos, snapshotFetch, reels, sheet, bech32
src/lib/match/         pkg (packages/match import), service (MatchClient + persistence), identity, wsRelay,
                       psi / psiFrame (PSI loading), buffer (Buffer shim), demo (simulated peer)
src/ui/                screens: home (grid), reels, player, sheet, matches, follow, recipe, settings, studio,
                       watch, taste (Follow taste sheet and management); icons, dom helper
shims/                 browser stand-ins for match's Node-only PSI loading (bundled by scripts/build.mjs)
public/                index.html, manifest, icons, sw.js, examples/*.json, psi-frame.html/.js
scripts/build.mjs      esbuild builds (app, artifact, dev server)
scripts/dev-relay.mjs  local in-memory Nostr relay (64 KiB, NIP-40, optional NIP-42)
scripts/fetch-snapshot.mjs
```

## Known gaps

- **Match is a prototype.** packages/match and OpenMined PSI are unaudited; message kinds are provisional. No relay choice from the peer's inbox list (NIP-17 kind 10050), no OHTTP: relays see your IP and when you check. Relays are polled (every minute while open), not subscribed. PSI sessions are in memory, so a reload mid-preview loses it.
- **NIP-42 AUTH signs with the identity key** (only for relays that demand it), which tells that relay who you are.
- **Creators' npubs are found only in channel descriptions or support text** (and taste-list `author`); there's no NIP-05 or signed mapping yet.
- **The embed API couldn't be exercised end to end here:** headless Chromium has no H.264, so PeerTube players error before their API comes up. The handshake follows PeerTube's jschannel fork; without it, off-screen reels are unloaded instead of paused and finish detection doesn't happen. Some instances (e.g. behind Anubis) block headless browsers entirely.
- **Circle, second degree and Tier 2 analytics are placeholders.**
- **The discovery-stat tally is local only.** Nothing is sent until DAP exists. The EU ePrivacy question in ANALYTICS.md is still open.
- **Taste lists are unsigned** (URL or paste). The format is provisional (docs/WEB_APP.md). Track records start at 0.5 and need a few dozen impressions before they move.
- **Explore relevance has no signal until the first endorsement.** It also relies on PeerTube tags, which many videos lack, so the app fetches tags for only the 40 newest explore candidates.
- **The app imports core internals:** `src/lib/core.ts` pulls `packages/core/src/validate.ts`, which core's index doesn't export.
- **The artifact build still loads Google Fonts**; the live build doesn't.
- **Watches are recorded when the player opens** (or a reel stays visible 3 s). Finished watches come only from Reels, via the embed API.
- **Encryption at rest is browser-level, not OS-keystore.** History, follows and taste lists are AES-256-GCM ciphertext in IndexedDB. The key is non-extractable but sits in the same browser profile, so a full copy of the profile can decrypt it unless you set the optional passphrase. It doesn't protect against malware or anyone using the unlocked profile. Where IndexedDB or WebCrypto is unavailable, nothing sensitive is saved (memory only, with a banner). Details: docs/WEB_APP.md, Local state.
- **PeerTube sometimes returns 404 for remote thumbnails.** The card falls back to a gradient, but the browser still logs the 404 to the console.
- **Instances that are down or don't send CORS headers** show as "unreachable" in the sources panel. The app doesn't retry them with backoff.
- **Follow taste mostly finds playlists.** Few creators publish a NIP-51 set or link a list yet, and most channels' public playlists hold only their own uploads, so the button often says "No public picks yet". Playlists are unsigned (the instance vouches for them), have no sponsored/affiliated flags, and their picks tend to be older and longer, so they score low under the 14-day half-life and show up in Reels only as "Longer video" fill. Looking at a reel for 1.2 s fetches that creator's profile and up to 8 playlists from their instance.
- **Old taste-list picks fade** under the default 14-day half-life, as `rank()` specifies. The Discovery recipe uses 30 days, and up to 3 items per list.
