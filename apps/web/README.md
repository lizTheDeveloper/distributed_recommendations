# Multiverse Video web client

**Multiverse Video** (display name, from one constant in [`src/brand.json`](src/brand.json); the project and
protocol are still called Match Feed) is the web client and PWA: Follow, Subscribe to taste, explore slots,
recipes, a vertical **Reels** feed, 1:1 **Match** with PSI previews (prototype), on-device **moderation**
(report, block/mute, labelers, NSFW policy), **Publish my picks** for creators, first-run onboarding, and the
hooks the native shells (apps/mobile, apps/desktop) call. It reads real PeerTube instances from the browser and ranks on the device
with `packages/core` `rank()`; Match runs `packages/match` over Nostr relays you add. Design notes,
data flow and the provisional taste-list format are in [`docs/WEB_APP.md`](../../docs/WEB_APP.md).

- Fonts are self-hosted (`public/fonts/`, OFL); in normal use the live build contacts only PeerTube instances, plus the host of any taste-list URL you import (or a creator links), and relays only if you add them. Opt-in crash reports, bug reports and usage analytics contact the operator's GlitchTip/Umami only if the build was configured with them **and** the viewer said yes ([`docs/TELEMETRY.md`](../../docs/TELEMETRY.md)).
- Vanilla TypeScript with a 40-line DOM helper; no framework. Dependencies, all pinned exactly in `package.json` and the lockfile (every one published at least two weeks before it was added):
  - build and tests: `esbuild` 0.28.2, `typescript` 5.9.3, `fake-indexeddb` 6.2.5, `ws` 8.21.3 (dev relay);
  - bundled: `nostr-tools` 2.25.2 (with its `@noble/*`, `@scure/*`), `@openmined/psi.js` 2.0.6 (copied to `dist/psi.js` or inlined in the artifact), `@sentry/browser` 10.76.0 (only in `dist/crash.js`, loaded after opt-in), `@divviup/dap` 0.9.1 (only in `dist/dap.js`, loaded when a discovery-stats report is due), `ohttp-ts` 0.6.1 and `hpke` 1.1.7 (the private relay for Match);
  - checks only: `playwright` 1.56.1 and `axe-core` 4.13.0 (`npm run check:ui`; no browser download, see below).
- `.npmrc` sets `ignore-scripts`: psi.js declares build tools as dependencies (`protoc-gen-js` has a download postinstall and a vulnerable `adm-zip`); none of them is run or bundled.
- `packages/core`, `match`, `moderation`, `taste`, `analytics` and `transport` are imported from source (`src/lib/core.ts`, `src/lib/*/pkg.ts`). Their bare imports resolve from **apps/web's own node_modules** (`scripts/build.mjs` plugin, `test/deps-hook.mjs` for tests), so `npm ci` in apps/web alone is enough: nothing is read from another package's node_modules.
- Node is pinned: `.nvmrc` and `engines` say 22.22.0 (what CI uses).
- Static output, so any static host works. An installable PWA: manifest generated from `src/brand.json` (maskable icons, theme colors, shortcuts, share target), a service worker that precaches the app shell by content hash and never caches API or video responses, and `.well-known/security.txt`.

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
npm run check:telemetry # headless opt-in check against local mock servers
npm run check:ui       # headless Chromium: main flows + axe-core at 390x844 and 1280x900 (after npm run build)
```

`check:ui` and `check:telemetry` use the pinned `playwright` package but not its browser download
(`ignore-scripts`): point `PLAYWRIGHT_BROWSERS_PATH` at an installed Chromium, or run `npx playwright install chromium`
once. `check:ui` runs the offline artifact and the live build; the live run contacts framatube.org and tilvids.com
(add `-- --proxy-from-env` behind a proxy, `-- --only artifact` to stay offline, `-- --shots DIR` for screenshots).
It fails on any serious or critical axe violation.

Build-time options (all empty by default, which hides the feature):
- telemetry: `MF_GLITCHTIP_DSN`, `MF_UMAMI_HOST`, `MF_UMAMI_WEBSITE_ID` (below);
- private relay for Match: `MF_OHTTP_RELAY_URL` (the OHTTP relay's resource for our gateway), `MF_OHTTP_PINS` (SHA-256 pins of the gateway key config, required), `MF_OHTTP_TARGET_ORIGIN` (optional); the relay origin is added to the CSP;
- discovery stats (Tier 2): `MF_DAP_HELPERS`, the independent DAP helper origins this build trusts. Empty: no task-config lookups and no uploads.

Opt-in telemetry endpoints come from the environment at build time and are hidden when empty:
`MF_GLITCHTIP_DSN=https://<key>@errors.example.org/1 MF_UMAMI_HOST=https://stats.example.org MF_UMAMI_WEBSITE_ID=<uuid> npm run build`.
The offline artifact is always built without them.

To try Match locally: run `npm run dev-relay` and `npm run dev`, open the app in two browser profiles, create a key in each (Matches), add `ws://127.0.0.1:7777` under Relays, paste one npub into the other's "Request a match", and press "Check for messages" on each side as you go. Previews need 20+ endorsements on each side (endorse reels). Never point development at public relays.

To serve a build: `python3 -m http.server -d dist 8080`. The service worker registers over https and on localhost (not in the native shells, which drop `sw.js`).

## Screens

| Screen | What works |
|---|---|
| First run | a skippable, keyboard-accessible three-step dialog for new viewers (nothing followed or watched yet): pick instances and topics (topics seed explore relevance until the first endorsement), follow a few creators' tastes or an example list, Reels vs Grid and the default view. "Show the welcome steps again" in Settings → App |
| Home: Reels | default view. Full-screen, scroll-snapped short videos on phones; a centered 9:16 column with ↑/↓, j/k, space and m on desktop. Same `rank()` and recipe; prefers ≤ 3 min or portrait videos (PeerTube `duration`/`aspectRatio`), falls back to longer ones; infinite loading through core's client pagination. Only the visible reel plays (PeerTube embed, `p2p=0`, autoplay muted, embed API for play/pause/mute/finish); the next is preloaded, far ones torn down. Overlay with chip and "Why am I seeing this?"; rail: Endorse, Follow, **Taste** (Follow taste: the creator's public picks; filled when followed, disabled "No public picks yet" when there are none), Not interested, Share, Open on PeerTube, Request match (when the creator or curator publishes an npub), mute, **⋯ More** (Report…, Block or mute…, Creator studio). Blurred (moderation) reels don't autoplay and show "Show anyway" |
| Home: Grid | the previous feed: on-device ranking of follows, taste lists (≤ 2 items per list by default, strength from each list's track record) and new-creator slots (5% by default, ranked by your on-device tag profile once you've endorsed something); chips, "Why am I seeing this?", Sponsored/Affiliated labels; + Follow and a ⋯ menu (Follow taste, Creator studio, Not interested, **Block or mute…**, **Report…**) on every card; blurred thumbnails and titles with "Show anyway", label chips, and an **"N hidden"** pill that lists what moderation hid and why. Below it, a separate **Popular on your instances** section (live trending from framatube.org and tilvids.com by default) that never takes feed slots |
| Feed settings (sheet) | gear in the header, Settings in the bottom bar, the ⋯ menu, or the recipe pill. Bottom sheet on phones, drawer on desktop. Recipe picker, weights, explore share (2–10% guidance), half-life, per-list and per-creator caps, filters (tags, languages, length, hidden creators), default view, Popular toggle, theme, links, sources (with followed creator tastes: on/off, remove) |
| Matches | identity (create, import nsec, or NIP-07) with npub copy; how Match reaches relays (private relay over OHTTP when the build has one, or direct); relays (none by default) with status; request by npub or from a creator/curator; incoming requests with the preview flow (target sees its remaining yearly budget; requester sees the noised count, "<5" below five); consent sheet (endorsements only or + finished watches, window, exclusions); active matches with similarity, renew, quiet pause, revoke (in-page confirm), **Block** (ends the match, declines future requests from that key, drops what it recommends); sharing ledger; activity log. Offline: a "Demo peer (simulated)" |
| Follow & taste | follow by `name@host` or channel URL; taste lists by URL, pasted JSON, or two bundled **example** lists; validation errors shown in plain text; **Creators' taste**: look up a creator, see where their picks come from (signed NIP-51 list on your relays → taste list linked in their description → public PeerTube playlists without their own uploads), follow, turn each on/off, refresh (daily and on demand), remove; Match/Circle marked "coming next" |
| Recipe import & export | export (copy/download) and import through `parseRecipeJson`, with the error path shown (e.g. `recipe.weights.follow: must be between 0 and 10`). Editing moved to the feed settings sheet |
| Sharing & privacy | ledger of who gets what (instances, video hosts, relays and each match, Circle "coming next", discovery stats, and the app developers when telemetry is configured); opt-in crash reports / bug-report diagnostics / usage analytics with "What gets sent" and the bug report form (configured builds only); switches for private watching, P2P streaming (off by default), anonymous discovery stats (on by default, with an off switch per signal), and the popular section; the instance list; storage status (encrypted, passphrase, or memory-only); history retention (30/60/90 days, default 60); an optional passphrase; wipe local history with an in-page confirm, which also destroys the encryption key |
| Watch overlay | PeerTube embed from the origin instance with `p2p=0` unless enabled; Endorse, Follow, open on PeerTube, Block…, Report…; records a watch locally unless private watching is on. Videos opened from links go through moderation here: hidden ones show the reasons instead of the embed, blurred ones need "Show anyway" |
| Moderation (Sharing & privacy) | NSFW: blurred by default; Show takes two separate actions (choose Show, then confirm age); on iOS in the native app hidden with no switch. Violence: blur/hide/show. Labeler subscriptions (none by default; add an npub and optionally its relay). "Use my instances' blocklists". Block/mute lists (creators, instances, people, tags, words, videos, lists) with remove. Report and contact information. All stored in the encrypted vault |
| Report (dialog) | from Reels ⋯, a card's ⋯ and the watch view. Step 1: this video or the creator, the NIP-56 type, details, which subscribed labelers to address, "also hide/block". Step 2 (confirm): the report for the hosting instance (open it there + copy text: PeerTube needs a signed-in account), the optional public Nostr report (shown as JSON; addressed to labelers with a `p` tag; signed with your identity and sent to your relays only on "Sign and send"), notes (CSAM hotlines for "illegal") |
| App (Sharing & privacy) | Install app (the browser's install prompt, iOS instructions, or "installed"), what's kept offline, and in the native shells: match-request notifications and background checks (both opt-in) |
| Creator studio | for any channel: Follow taste…; Tier 0 links to the channel and PeerTube's per-video stats pages; Tier 1 public counts (followers, views and likes over recent videos, picks in your loaded taste lists); **Publish my picks** (below); Tier 2 opt-in: paste the task config your instance made (infra/janus), check it, choose "publish my numbers", then publish it on Nostr (kind 30078) or download it to host. Reading the results is coming next |
| Publish my picks | pick from your endorsed videos (or paste a watch URL), mark Sponsored/Affiliated and add a note; "Check which are on Nostr" (bridged); Preview builds the NIP-51 event and the v1 JSON; **dry run by default** (sign without sending); Publish asks for confirmation, signs with your Match identity key or NIP-07, and sends only to your relays (the offline demo uses an in-page relay); Download taste.json; what to put in your channel description |

## Layout

```
src/brand.json         the display name and colors (index.html, manifest, artifact title, UI via src/brand.ts)
src/main.ts            live entry           src/main-artifact.ts  offline snapshot entry
src/boot.ts            opens the encrypted vault (passphrase prompt), migrates old plaintext, starts the app
src/app.ts             state, persistence, loading, routing, shell (header tabs, bottom bar, menu)
src/lib/               pure logic (tested): catalog, candidates, tastelist, creatortaste (Follow taste; network
                       adapters in tastesources), recipes, trackrecord, history,
                       analytics, settings, storage, vault (encryption at rest), localdata (what's sensitive,
                       migration), handles, videos, snapshotFetch, reels, sheet, bech32
src/lib/               … also: native (window.MatchFeedNative bridge), incoming (deep links, shares, share
                       target), modstate (moderation state and policy), picks (Publish my picks), discovery
                       (Tier 2 ledger, jobs, configs)
src/lib/moderation/ taste/ analytics/ transport/   pkg.ts: packages/* imported from source;
                       analytics/dap-entry.ts → dist/dap.js
src/lib/match/         pkg (packages/match import), service (MatchClient + persistence), identity, wsRelay,
                       psi / psiFrame (PSI loading), buffer (Buffer shim), demo (simulated peer)
src/lib/telemetry/     opt-in telemetry: consent, scrub, usage (Umami client), feedback (bug reports), diagnostics,
                       config, controller (loads crash.js only after opt-in)
src/telemetry/         crash-entry: the separately built crash reporter (dist/crash.js, @sentry/browser)
src/ui/                screens: home (grid), reels, player, sheet, matches, follow, recipe, settings, studio,
                       watch, taste (Follow taste sheet and management), telemetry (consent card, panel, form),
                       moderation (report, block, hidden, settings panel), publish (Publish my picks),
                       onboarding, incoming, dialog (accessible modal); icons, dom helper
shims/                 browser stand-ins for match's Node-only PSI loading (bundled by scripts/build.mjs)
public/                index.html (placeholders filled from brand.json), icons (incl. maskable), sw.js,
                       .well-known/security.txt, examples/*.json, psi-frame.html/.js
scripts/build.mjs      esbuild builds (app, crash.js when configured, artifact, dev server)
scripts/telemetry-check.mjs  headless check: no telemetry requests before opt-in, the expected ones after
scripts/ui-check.mjs   headless main flows + axe-core (both builds, phone and desktop sizes, dark, reduced motion, offline)
scripts/dev-relay.mjs  local in-memory Nostr relay (64 KiB, NIP-40, optional NIP-42)
scripts/fetch-snapshot.mjs
```

## Known gaps

- **Reports to PeerTube need the viewer to sign in on the instance.** The app has no PeerTube login, so the Report dialog opens the video (or channel) on its instance and copies the report text; the confirm step says so. The NIP-56 part exists only for creators who publish an npub (and for bridged videos once the app reads their NIP-71 events). We run no labeler yet (`services/labeler` is ready to deploy), and the moderation contact is the GitHub issue tracker until there is an inbox.
- **Desktop "Open on PeerTube" does nothing** in the Tauri window: apps/desktop compiles in no opener, and its bridge exposes no https-only open command. Settings → App says so; the Share button copies the link. Adding an `open_external` command (https only) is apps/desktop's decision (its README, "Hooks for apps/web").
- **Native hooks are tested against a stand-in bridge only** (headless Chromium with a fake `window.MatchFeedNative`), not on a device.
- **Tier 2 is off in every build until a helper is approved** (`MF_DAP_HELPERS` empty): no config lookups, no uploads. The studio checks and publishes a creator's config but doesn't show collected results yet. DAP uploads don't go through the OHTTP relay (its gateway only forwards Nostr); they go to the creator's leader and the helper directly, as ANALYTICS_IMPLEMENTATION.md describes.
- **The private relay covers Match only.** Reading creators' signed picks, labels and publishing picks still use the viewer's relay list directly.

- **Match is a prototype.** packages/match and OpenMined PSI are unaudited; message kinds are provisional. No relay choice from the peer's inbox list (NIP-17 kind 10050), no OHTTP: relays see your IP and when you check. Relays are polled (every minute while open), not subscribed. PSI sessions are in memory, so a reload mid-preview loses it.
- **NIP-42 AUTH signs with the identity key** (only for relays that demand it), which tells that relay who you are.
- **Creators' npubs are found only in channel descriptions or support text** (and taste-list `author`); there's no NIP-05 or signed mapping yet.
- **The embed API couldn't be exercised end to end here:** headless Chromium has no H.264, so PeerTube players error before their API comes up. The handshake follows PeerTube's jschannel fork; without it, off-screen reels are unloaded instead of paused and finish detection doesn't happen. Some instances (e.g. behind Anubis) block headless browsers entirely.
- **Circle, second degree and Tier 2 analytics are placeholders.**
- **Discovery stats: the EU ePrivacy question in ANALYTICS.md is still open.** Contribution is on by default (Q1) everywhere; ship `contribute: false` for EU users if legal advice says so.
- **Taste lists are unsigned** (URL or paste). The format is provisional (docs/WEB_APP.md). Track records start at 0.5 and need a few dozen impressions before they move.
- **Explore relevance has no signal until the first endorsement.** It also relies on PeerTube tags, which many videos lack, so the app fetches tags for only the 40 newest explore candidates.
- **The app imports core internals:** `src/lib/core.ts` pulls `packages/core/src/validate.ts`, which core's index doesn't export.
- **The artifact build still loads Google Fonts**; the live build doesn't.
- **Signing paths need a 2023+ browser** (`String.prototype.isWellFormed`, used by packages/bridge's event code for picks): Safari 16.4+, Chrome 111+, Firefox 119+. The rest of the app targets Safari 15.
- **Watches are recorded when the player opens** (or a reel stays visible 3 s). Finished watches come only from Reels, via the embed API.
- **In a browser, encryption at rest is browser-level, not OS-keystore** (in the native shells the vault key and the Match secret key live in the OS keystore). History, follows and taste lists are AES-256-GCM ciphertext in IndexedDB. The key is non-extractable but sits in the same browser profile, so a full copy of the profile can decrypt it unless you set the optional passphrase. It doesn't protect against malware or anyone using the unlocked profile. Where IndexedDB or WebCrypto is unavailable, nothing sensitive is saved (memory only, with a banner). Details: docs/WEB_APP.md, Local state.
- **PeerTube sometimes returns 404 for remote thumbnails.** The card falls back to a gradient, but the browser still logs the 404 to the console.
- **Instances that are down or don't send CORS headers** show as "unreachable" in the sources panel. The app doesn't retry them with backoff.
- **Follow taste mostly finds playlists.** Few creators publish a NIP-51 set or link a list yet, and most channels' public playlists hold only their own uploads, so the button often says "No public picks yet". Playlists are unsigned (the instance vouches for them), have no sponsored/affiliated flags, and their picks tend to be older and longer, so they score low under the 14-day half-life and show up in Reels only as "Longer video" fill. Looking at a reel for 1.2 s fetches that creator's profile and up to 8 playlists from their instance.
- **Telemetry free text can still identify.** The scrubber can't recognize an unquoted title or a person's name in a bug report or error message; the form shows what will be sent. `check:telemetry` and the infra smoke tests aren't in CI yet (Playwright, Docker).
- **Old taste-list picks fade** under the default 14-day half-life, as `rank()` specifies. The Discovery recipe uses 30 days, and up to 3 items per list.
