# Web client (v1)

Status: first working client, 2026-10-19. Code: `apps/web/` (see its README for how to run it).
Companion to `DESIGN.md`, `PROTOCOL.md` and `ANALYTICS.md`. Where this document and the code disagree, that is a bug.

## Scope

v1 ships the first tier of the ship order in DESIGN.md: **Follow, Subscribe to taste and reserved explore slots**,
with on-device ranking by `packages/core` `rank()`. Match, Circle, second degree, previews and Tier 2 creator
analytics appear in the UI only as "coming next" placeholders. v1 has no crypto and no private matching.

## Data flow

| Source kind | Where candidates come from | Strength |
|---|---|---|
| `follow` | `channelVideos` on each followed channel's home instance, plus any catalog video by a followed creator | 1 |
| `taste` | videos resolved from each subscribed taste list (`getVideo` on the id's origin instance) | 1 |
| `taste` (instance trending) | each configured instance's `-trending` list, `via` = "Trending on *host*". Toggle in settings, on by default | 0.5 |
| `explore` | each configured instance's `-publishedAt` list. Core keeps only untied videos under 14 days old from creators you don't follow | – |

- All catalog reads go through core's `createPeerTubeClient` (public endpoints, `credentials: "omit"`, no referrer). PeerTube sends `Access-Control-Allow-Origin: *` on its API (checked 2026-10-19 on framatube.org, tilvids.com, peertube.tv, video.blender.org, tube.tchncs.de), so a static page can call instances directly.
- Tier 1 studio counts (followers, views, likes) need fields core's `Video` doesn't carry. The app reads `/api/v1/video-channels/{name}` and `/api/v1/video-channels/{name}/videos` itself, with the same privacy options. Candidate for upstreaming into core.
- Ranking: `rank(candidates, recipe, {now, limit: 60, rng: seededRng(sessionSeed), seen})`. The seed comes from `cryptoRng` once per session, so re-renders stay stable; "Shuffle new creators" re-seeds. `seen` = videos the viewer opened.
- Playback: the PeerTube embed on the video's **origin** instance (`/videos/embed/{id}?p2p=0|1`). P2P is off unless the viewer turns it on (DESIGN.md, State resistance). The embed handles HLS itself, so the app doesn't ship hls.js.

## Local state

Everything is in `localStorage` under `mf.v1.*`, with every access wrapped; if storage fails, the app runs from memory for the session.

| Key | Contents |
|---|---|
| `settings` | instances, trending-as-taste, private watching, P2P, analytics switches, theme |
| `follows` | `{handle, name?, addedAt}` |
| `taste` | subscribed lists (validated again on load) |
| `recipe` | active recipe id, plus a custom recipe in wire form (re-parsed by `parseRecipe` on load) |
| `history` | `{videoId, at, kind: "watch" \| "endorse", tags, via?}`, capped at 2,000. Not written while private watching is on |
| `tally` | local discovery-channel counts (below) |
| `videos` | cache of resolved taste-list videos (600 max) |

- `toSketchHistory()` maps history to core's `HistoryEntry` for when Match ships. It passes **endorsements only**: opening the player is not a finished watch.
- **Wipe local history** clears `history` and `tally`, after an in-page confirmation. Follows, lists and recipes stay.

## Viewer analytics switch (ANALYTICS.md Q1)

Q1 is decided as on by default, with per-signal off switches, and that is how v1 behaves. DAP isn't built, so **nothing is transmitted**. The device keeps a tally of what it would contribute, by discovery channel, honoring the main switch, the per-channel switches and private watching. The settings screen shows that tally. When Tier 2 ships, this tally is the input to the DAP client. The ePrivacy question in ANALYTICS.md must be resolved before anything is sent from EU devices.

## Taste list format, v1 (PROVISIONAL)

PROTOCOL.md doesn't define a taste-list format yet. This is the minimal one the client uses. It follows PROTOCOL.md conventions: a version field, unknown keys rejected, size checked before `JSON.parse`, canonical video URLs as ids, and no control or bidi characters in strings. Parser: `apps/web/src/lib/tastelist.ts` (it reuses core's validation helpers).

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
- Per-list track-record weighting (DESIGN.md: "weight lists by their track record"). v1 uses strength 1 for every subscribed list.
- Whether items may carry title hints, to avoid one `getVideo` per item. v1 resolves every id at its origin instance, 4 at a time, and caches the results.

## Example data

`apps/web/public/examples/*.json` are **example lists, generated automatically** by `npm run snapshot -- --examples`: the most-viewed of an instance's 100 newest local uploads, one per channel. They are labelled as example data everywhere they appear, and no person picked them.

## Offline artifact build

`apps/web/dist-artifact/index.html` is one self-contained file for the claude.ai artifact sandbox, which blocks network access. It bundles a snapshot of real API responses (`src/snapshot/snapshot.json`, about 125 videos from framatube.org and tilvids.com). A snapshot-backed `fetch` serves those responses to the *same* core client, so ranking, follows (of channels in the snapshot), taste lists, recipes, settings and the studio all run the real code. Thumbnails are gradient placeholders, playback and URL import are disabled, and a banner says so. Ranking uses the capture time as "now", so explore slots and recency read as they did that day.
