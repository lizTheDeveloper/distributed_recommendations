# @match-feed/bridge: PeerTube → Nostr NIP-71

Publishes PeerTube videos as Nostr video events ([NIP-71]), so Nostr clients and
Match Feed can refer to a PeerTube video through a signed, stable event. We found
no existing PeerTube→NIP-71 bridge (see `docs/OSS_STACK.md` §2).

- **Library:** `toVideoEvent(ptVideo, opts)` builds an unsigned NIP-71 event.
  `getEventId` and `signWith` handle NIP-01 ids and signing through any signer
  that has the NIP-07 shape.
- **CLI:** `sync` lists a channel's videos and builds the events. It is a dry run
  by default. With `--publish` it sends the events to the relays you name.

License: Apache-2.0. The only runtime dependency is `nostr-tools` (Unlicense),
and only `src/nostr-signer.ts` imports it. The bridge does **not** use any
`@peertube/*` package or code generated from PeerTube's OpenAPI spec, because
both are AGPL-labelled. The PeerTube types in `src/types.ts` are written by hand
from observed API responses.

## Usage

Requires Node ≥ 22.6, run with `--experimental-strip-types` (the npm scripts
already pass it).

```sh
npm install
npm test            # 31 offline tests against real, trimmed API fixtures
npm run typecheck   # tsc --noEmit (erasableSyntaxOnly)

# Dry run: prints one event JSON per line on stdout, progress on stderr
npm run -s sync -- sync --instance framatube.org --channel framaconf --limit 5

# Same, signed with a throwaway key so you see id/pubkey/sig
npm run -s sync -- sync --instance tube.tchncs.de --channel dies_und_das --ephemeral-key

# Publish (the key is read from the environment only, never from argv)
NOSTR_SECRET_KEY=nsec1... npm run -s sync -- sync --instance framatube.org \
  --channel framaconf --publish --relay wss://relay.example
```

The `sync` npm script sets `NODE_USE_ENV_PROXY=1` so that Node's `fetch`
honours `HTTPS_PROXY`. `--help` lists every option: `--regular`, `--kind`,
`--short-max-duration`, `--nsfw warn|skip`, `--mp4-first`, `--mirrors`,
`--magnet`, `--no-extras`, `--creator-pubkey`.

Library:

```ts
import { toVideoEvent, signWith, PeerTubeClient } from '@match-feed/bridge';
const pt = new PeerTubeClient('framatube.org');
const video = await pt.video('d0dc4349-56a9-4388-bc76-b6b1d52efb6c');
const template = toVideoEvent(video, { captions: await pt.captions(video.uuid) });
const event = await signWith(window.nostr, template); // NIP-07, NIP-46 or nostr-tools signer
```

## How PeerTube fields map to NIP-71

| NIP-71 | Source / rule |
|---|---|
| kind | Default: addressable **34235** (normal) or **34236** (short), with `d` = PeerTube `uuid`. The uuid is the same on every federated instance, so a re-run or metadata edit replaces the event instead of duplicating it. `--regular` gives kinds 21/22. A video counts as *short* when it is portrait (`aspectRatio < 1`, or file dimensions if that field is missing) **and** its duration is ≤ 180 s (`--short-max-duration`). |
| `title` | `name` |
| `published_at` | `originallyPublishedAt`, falling back to `publishedAt` (the spec asks for "the first time the video was published") |
| `alt` | `Video: "<title>" by <channel> (m:ss). Watch on PeerTube: <url>` |
| `duration` | `duration`, as a top-level tag (shown in the spec's addressable example) and in each `imeta` |
| `imeta` | One tag for the **HLS master playlist** (`m application/x-mpegURL`, `dim` = largest rendition), then one per **resolution**, largest first: `url`, `m`, `dim WxH` (real width×height, so portrait reads 1080x1920), `size`, `bitrate` (= size·8/duration, an average), `duration`, `image`. An audio-only rendition (`m audio/mp4`, `l <lang> <ns> ov`) comes last. For each resolution the "web video" MP4 is used when one exists, otherwise the HLS fragmented MP4. They are different files, so neither is listed as a `fallback` of the other. Each URL gets at most one `imeta` (NIP-92). `--mp4-first` puts the MP4s ahead of HLS. |
| `image` (in imeta) | From the `thumbnails[]` entry whose aspect ratio is closest to the video's, the largest one; otherwise `previewPath`/`thumbnailPath`. PeerTube only generates 16:9 and 1:1 thumbnails, so portrait videos get the square one. |
| `text-track` | `["text-track", <vtt url>, "captions", <lang>]` from `/videos/{id}/captions` |
| `segment` | Chapters from `/videos/{id}/chapters` → `HH:MM:SS.sss` start/end + title |
| `content-warning` | Added when `nsfw`. The reason is `nsfwSummary`, or a generic text if that is empty. `--nsfw skip` refuses NSFW videos instead. |
| `t` | PeerTube `tags`: lowercased, leading `#` removed, spaces turned into `-`, duplicates removed |
| `L`/`l` (NIP-32) | `language.id` under `ISO-639-1` (2 letters) or `ISO-639-3` (3 letters) |
| `r` | The canonical watch URL (`video.url`, on the origin instance even when the JSON came from another instance) |
| `origin` | `["origin", "peertube", <uuid>, <canonical url>]`, NIP-71's "optional tag for imported content" |
| `p` | `--creator-pubkey`: use this when an instance key signs on a creator's behalf |
| content | `description`, the full Markdown text |

**Event ids.** `serializeEvent` follows NIP-01 exactly. Because NIP-01 is
ambiguous about C0 control characters and lone surrogates, untrusted text is
cleaned before it goes into an event (`cleanText`), and `serializeEvent`
refuses any input that is still ambiguous. Hashing goes through a `Sha256`
function, WebCrypto by default. The tests check the result against a Python
`hashlib` vector, against `node:crypto`, and against nostr-tools'
`getEventHash`. `signWith` recomputes the id itself and rejects a signer that
changes the event, returns a different pubkey or returns a malformed signature.

## What gets refused

`checkBridgeable` and `toVideoEvent` (which throws `BridgeRefusal`) refuse a video when:
- privacy is anything other than **Public**, i.e. unlisted, private, internal or password-protected;
- it is a live stream (NIP-53 covers live streams);
- its state is anything other than Published, for example still transcoding;
- the instance has blocked it;
- it has no playable files;
- it is NSFW and the run uses `--nsfw skip`.

If the uploader **disabled downloads**, only the HLS playlist is bridged and no
direct MP4 links are published.

## Limitations and open points

- **No `x` (sha256) on imeta.** PeerTube's API doesn't expose a hash for whole
  files. HLS has a `segmentsSha256Url`, but those are per-segment hashes. So
  clients can't check the bytes they download or find the file on Blossom by
  hash. Adding `x` would mean downloading every file and hashing it.
- **The signer vouches for the metadata, not the video.** If the instance later
  serves different bytes at the same URL, the event can't show that, because
  there is no `x` hash.
- **Who signs.** Best case, the creator signs with their own key, through NIP-07
  or NIP-46. A bridge run by an instance can sign with its own key and add the
  creator as `p`. It must not pretend to be the creator. Bridging other people's
  channels without their consent also raises licence questions: PeerTube's
  `licence` isn't mapped, because NIP-71 has no tag for it.
- **Mirrors.** `--mirrors` adds PeerTube redundancy copies as `fallback` URLs,
  and switches those resolutions to HLS fragmented MP4s, the only files mirrors
  hold. Mirrors are partial and best effort. In a spot check on 2026-10-19,
  some mirrored files returned 200 and others 404. The master playlist was never
  available on a mirror, so it gets no fallbacks. For that reason the option is
  off by default.
- **`magnet`.** Off by default. P2P exposes viewers' IP addresses (DESIGN.md,
  PeerTube privacy guide).
- **`created_at`** is the time of the run. When publishing, the bridge first
  asks each relay for an existing event (`#d` for addressable kinds, `#r` for
  regular ones). It skips relays whose latest stored version has identical tags
  and content, so repeated runs don't create churn. Regular kinds 21/22 can't be
  edited, so the bridge never re-sends them.
- **Relay client.** It is deliberately minimal: one socket per relay per event,
  no NIP-42 auth, and no retry or backoff. Node's global `WebSocket` doesn't
  use `HTTPS_PROXY`.
- **PeerTube rate limits.** Requests are spaced 250 ms apart. Each video costs 3
  requests (detail, captions, chapters), or 1 with `--no-extras`.
- **Deletions** are not propagated. A video that is later made private or
  deleted on PeerTube needs a NIP-09 deletion event, which isn't implemented yet.
- The spec's `text-track` example shows an "encoded kind 6000 event", but its
  prose says "link to WebVTT file". We follow the prose.
- Some clients only play the first `imeta`, and not all of them can play HLS. If
  your target clients can't, use `--mp4-first`.

## Layout

```
src/types.ts         hand-written PeerTube subset + NIP-01/71 types/kinds
src/event.ts         NIP-01 serialization, id (Sha256 abstraction), Signer, signWith
src/mapping.ts       checkBridgeable, selectKind, toVideoEvent
src/peertube.ts      unauthenticated REST client (rate-limited, paged)
src/relay.ts         minimal EVENT/OK and REQ/EOSE over WebSocket
src/sync.ts          sync(instance, channel, signer, relays, opts)
src/nostr-signer.ts  nostr-tools local-key signer, verify
src/cli.ts           CLI
test/fixtures/       real API responses (trimmed: actor objects, long descriptions),
                     fetched 2026-10-19 from framatube.org and tube.tchncs.de
```

[NIP-71]: https://github.com/nostr-protocol/nips/blob/master/71.md
