# Match Feed web client

The first working client for Match Feed (v1: Follow, Subscribe to taste, explore slots, recipes). It reads real
PeerTube instances from the browser and ranks on the device with `packages/core` `rank()`. Design notes,
data flow and the provisional taste-list format are in [`docs/WEB_APP.md`](../../docs/WEB_APP.md).

- Fonts are self-hosted (`public/fonts/`, OFL); in normal use the live build contacts only PeerTube instances, plus the host of any taste-list URL you import.
- Vanilla TypeScript with a 40-line DOM helper; no framework. Dev dependencies: `esbuild` 0.28.2 and `typescript` 5.9.3, both pinned. No runtime dependencies besides `packages/core`, which is imported from source (see `src/lib/core.ts`).
- Static output, so any static host works. It's an installable PWA (manifest, icons, and a small service worker that caches only the app shell, never API data).

## Run

```sh
cd apps/web
npm install
npm run dev            # http://localhost:8080, rebuilds on save
npm run build          # dist/ (PWA) + dist-artifact/index.html
npm test               # node:test with --experimental-strip-types, no network
npm run typecheck      # tsc via scripts/typecheck.mjs: fails on app errors; errors inside packages/core are listed as upstream issues
npm run snapshot       # refresh the offline snapshot (network; add -- --examples to regenerate example lists)
npm run build:artifact # only the single-file artifact
```

To serve a build: `python3 -m http.server -d dist 8080`. The service worker registers only over https.

## Screens

| Screen | What works |
|---|---|
| Home feed | on-device ranking of follows, taste lists (≤ 2 items per list by default, strength from each list's track record) and new-creator slots (5% by default, ranked by your on-device tag profile once you've endorsed something); chips, "Why am I seeing this?", Sponsored/Affiliated labels; + Follow on every card. Below it, a separate **Popular on your instances** section (live trending from framatube.org and tilvids.com by default) that never takes feed slots |
| Follow & taste | follow by `name@host` or channel URL; taste lists by URL, pasted JSON, or two bundled **example** lists; validation errors shown in plain text; Match/Circle marked "coming next" |
| Recipe | built-in recipes, each with a summary generated from its fields; sliders for every weight, explore share (offered as 0–10%, the recommended range), half-life, per-taste-list cap and per-creator cap (every edit is re-validated by core `parseRecipe`); export (copy/download) and import through `parseRecipeJson`, with the error path shown (e.g. `recipe.weights.follow: must be between 0 and 10`) |
| Sharing & settings | ledger of who gets what (instances, video hosts, Match/Circle "coming next", discovery stats); switches for private watching, P2P streaming (off by default), anonymous discovery stats (on by default, with an off switch per signal), and the popular section; the instance list; wipe local history with an in-page confirm |
| Watch overlay | PeerTube embed from the origin instance with `p2p=0` unless enabled; Endorse, Follow, open on PeerTube; records a watch locally unless private watching is on |
| Creator studio | for any channel: Tier 0 links to the channel and PeerTube's per-video stats pages; Tier 1 public counts (followers, views and likes over recent videos, picks in your loaded taste lists); Tier 2 "coming next" with the decided defaults |

## Layout

```
src/main.ts            live entry           src/main-artifact.ts  offline snapshot entry
src/app.ts             state, persistence, loading, routing
src/lib/               pure logic (tested): catalog, candidates, tastelist, recipes, trackrecord, history,
                       analytics, settings, storage, handles, videos, snapshotFetch
src/ui/                screens: home, follow, recipe, settings, studio, watch; dom.ts helper
public/                index.html, manifest, icons, sw.js, examples/*.json
scripts/build.mjs      esbuild builds (app, artifact, dev server)
scripts/fetch-snapshot.mjs
```

## Known gaps

- **Match, Circle, second degree, previews and Tier 2 analytics are placeholders.** Matches, circles and second-degree weights in recipes have no source yet.
- **The discovery-stat tally is local only.** Nothing is sent until DAP exists. The EU ePrivacy question in ANALYTICS.md is still open.
- **Taste lists are unsigned** (URL or paste). The format is provisional (docs/WEB_APP.md). Track records start at 0.5 and need a few dozen impressions before they move.
- **Explore relevance has no signal until the first endorsement.** It also relies on PeerTube tags, which many videos lack, so the app fetches tags for only the 40 newest explore candidates.
- **The app imports core internals:** `src/lib/core.ts` pulls `packages/core/src/validate.ts`, which core's index doesn't export.
- **The artifact build still loads Google Fonts**; the live build doesn't.
- **Watches are recorded when the player opens**; there's no finish detection (the PeerTube embed API could add it). History is plain `localStorage`, not encrypted at rest.
- **PeerTube sometimes returns 404 for remote thumbnails.** The card falls back to a gradient, but the browser still logs the 404 to the console.
- **Instances that are down or don't send CORS headers** show as "unreachable" in the sources panel. The app doesn't retry them with backoff.
- **The recipe editor doesn't edit filters** (tags, languages, durations, creators). Use JSON import for those.
- **Old taste-list picks fade** under the default 14-day half-life, as `rank()` specifies. The Discovery recipe uses 30 days, and up to 3 items per list.
