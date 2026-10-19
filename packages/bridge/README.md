# @match-feed/bridge: PeerTube → Nostr NIP-71

Publishes PeerTube videos as Nostr video events ([NIP-71]), so Nostr clients and
Match Feed can refer to a PeerTube video through a signed, stable event. We found
no existing PeerTube→NIP-71 bridge (see `docs/OSS_STACK.md` §2).

- **Library:** `toVideoEvent(ptVideo, opts)` builds an unsigned NIP-71 event.
  `getEventId` and `signWith` handle NIP-01 ids and signing through any signer
  that has the NIP-07 shape.
- **CLI:** `sync` lists a channel's videos and builds the events. It is a dry run
  by default. With `--publish` it sends the events to the relays you name, and
  with `--state` it remembers what it bridged so a later run can send NIP-09
  deletion requests for videos that disappeared.

License: Apache-2.0. The only runtime dependency is `nostr-tools` (Unlicense),
and only `src/nostr-signer.ts` imports it (local key and NIP-46 bunker signers). The bridge does **not** use any
`@peertube/*` package or code generated from PeerTube's OpenAPI spec, because
both are AGPL-labelled. The PeerTube types in `src/types.ts` are written by hand
from observed API responses.

## Usage

Requires Node ≥ 22.6, run with `--experimental-strip-types` (the npm scripts
already pass it).

```sh
npm install
npm test            # 58 offline tests: real, trimmed API fixtures, an in-memory
                    # relay (NIP-09, NIP-42), a fake PeerTube and a fake NIP-46 bunker
npm run typecheck   # tsc --noEmit (erasableSyntaxOnly)

# Dry run: prints one event JSON per line on stdout, progress on stderr
npm run -s sync -- sync --instance framatube.org --channel framaconf --limit 5

# Same, signed with a throwaway key so you see id/pubkey/sig
npm run -s sync -- sync --instance tube.tchncs.de --channel dies_und_das --ephemeral-key

# Publish as the creator through their NIP-46 remote signer (preferred)
NOSTR_BUNKER_URL='bunker://<signer-pubkey>?relay=wss://…&secret=…' \
  npm run -s sync -- sync --instance framatube.org --channel framaconf \
  --signer bunker --state framaconf.state.json --publish --relay wss://relay.example

# Publish with the bridge operator's own key (labelled as bridged)
NOSTR_SECRET_KEY=nsec1... npm run -s sync -- sync --instance framatube.org \
  --channel framaconf --signer instance --operator tube.example \
  --creator-pubkey <creator hex> --state framaconf.state.json \
  --publish --relay wss://relay.example
```

Secrets come from the environment only: `NOSTR_SECRET_KEY` (hex or nsec),
`NOSTR_BUNKER_URL` (its `secret=` is a connection secret) and the optional
`NOSTR_BUNKER_CLIENT_KEY`. `--nsec`, `--secret-key` and `--bunker` are refused
outright. `--publish` requires an explicit `--signer`.

The `sync` npm script sets `NODE_USE_ENV_PROXY=1` so that Node's `fetch` **and
its global `WebSocket`** honour `HTTPS_PROXY`/`NO_PROXY` (both use undici's
global dispatcher; checked on Node 22.22.0 by pointing `HTTPS_PROXY` at a dead
port: relay connections fail only when the flag is set). The CLI warns when
`HTTPS_PROXY` is set without the flag. `--help` lists every option.

## Signing policy: who signs

| `--signer` | Key | Event says | Use when |
|---|---|---|---|
| `bunker` (**preferred**) | the creator's own key, via a NIP-46 remote signer (`NOSTR_BUNKER_URL`) | nothing extra: the creator is the author | the creator runs or approves the bridge |
| `key` | the creator's own key in `NOSTR_SECRET_KEY` | nothing extra | the creator runs the bridge on a machine they trust |
| `instance` | the bridge operator's key in `NOSTR_SECRET_KEY` | `alt` ends with "Bridged to Nostr by <operator> with its own key; not signed by the creator."; `["proxy", <video url>, "activitypub"]` (NIP-48); `["L", "match-feed.bridge"]`, `["l", "instance-signed", "match-feed.bridge"]` (NIP-32); `["p", <creator>]` when `--creator-pubkey` is given | an instance admin bridges creators who have no Nostr key yet |

Prefer `bunker`: the event is then really the creator's, clients attribute it,
zaps and replies reach them, and no bridge machine holds the creator's secret
key (the remote signer can show and refuse each request, and the session can
be revoked). `key` gives the same result but puts the creator's nsec on the
bridge host. `instance` never pretends to be the creator (T23): followers of
the creator won't see these events as theirs, and the operator vouches for the
metadata. In `key`/`bunker` mode `--creator-pubkey`, if given, must equal the
signing pubkey; in `instance` mode it must differ. The bunker URL is parsed
strictly (`bunker://` only, no NIP-05 network lookup) and every NIP-46 request
has a timeout (120 s, enough to approve it on a phone). Implemented with
nostr-tools 2.25.2's `BunkerSigner.fromBunker` from `nostr-tools/nip46`.

## Deletions (NIP-09)

With `--state <file.json>`, a publishing run records each bridged video:
pubkey, kind, address `kind:pubkey:uuid`, the event id known to be on the
relays, its `created_at`, and the relays that accepted it. Every run (dry or
not) then checks the recorded videos of that instance + channel + signing key
that it did not bridge this time. If PeerTube now answers 404/410 (removed),
401/403 (private/internal), a non-Public privacy (unlisted, private, internal,
password) or `blacklisted` (blocked by the instance), the bridge builds a kind 5
deletion request as NIP-09 specifies:

```json
{ "kind": 5, "content": "The PeerTube video is no longer public.",
  "tags": [["e", "<last event id>"], ["a", "34235:<pubkey>:<uuid>"], ["k", "34235"]] }
```

Regular kinds 21/22 get `e` + `k` only. A dry run prints the request (signed if
a signer is given) and changes nothing. A publishing run sends it to the
`--relay` list **and** every relay recorded for that video (NIP-09: deletion
requests should reach relays that have the event), then marks the entry
`deleted`; later runs don't send it again. If no relay accepts it, the entry
stays `live` and the next run retries. If the video becomes public again, it is
re-published with a `created_at` newer than the deletion, because relays drop
versions of an `a`-addressed event up to the deletion's `created_at`.

The bridge never deletes on doubt: network errors, 429/5xx and error pages that
are not PeerTube JSON (e.g. a WAF's HTML 403) are reported as errors, and
transient states (transcoding, no files yet, `--nsfw skip`) keep the event.
Videos published before a state file existed are not tracked. The state file
holds no secrets and is written atomically (temp file + rename).

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
| `p` | `--creator-pubkey` with `--signer instance` (an instance key signs on a creator's behalf) |
| `proxy`, `L`/`l` | `--signer instance` only, see "Signing policy" |
| content | `description`, the full Markdown text |

**Event ids.** `serializeEvent` follows NIP-01 exactly. Because NIP-01 is
ambiguous about C0 control characters and lone surrogates, untrusted text is
cleaned before it goes into an event (`cleanText`), and `serializeEvent`
refuses any input that is still ambiguous. Hashing goes through a `Sha256`
function, WebCrypto by default. The tests check the result against a Python
`hashlib` vector, against `node:crypto`, and against nostr-tools'
`getEventHash`. `signWith` recomputes the id itself and rejects a signer that
changes the event, returns a different pubkey or returns a malformed signature.
`verifySignedEvent` checks a fresh object built from the NIP-01 fields only, so
nostr-tools' cached verify verdict (a symbol property that object spread
copies) can't vouch for a tampered copy (THREAT_MODEL T25).

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
- **Consent.** See "Signing policy". There is still no consent check before
  bridging other people's channels, which also raises licence questions:
  PeerTube's `licence` isn't mapped, because NIP-71 has no tag for it.
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
- **Relay client.** Small on purpose: one socket per relay per event or query.
  NIP-42: when a relay answers `auth-required:` (OK or CLOSED) the bridge signs
  a kind 22242 event (`relay`, `challenge` tags) with the event signer, sends
  `AUTH`, and retries once on that connection; `--no-relay-auth` turns this
  off. It authenticates only when asked. Transient failures (connect errors,
  timeouts, socket closed before OK, `rate-limited:`/`error:` replies) are
  retried with exponential backoff and jitter (`--relay-retries`, default 2;
  1 s doubling, capped at 15 s); `invalid:`, `blocked:`, `restricted:` and
  rejected AUTH are not.
- **PeerTube rate limits.** Requests are spaced 250 ms apart. Each video costs 3
  requests (detail, captions, chapters), or 1 with `--no-extras`.
- **Deletions** are requests: relays SHOULD honour them, and clients that
  already have the event may keep it. Deletion only works for videos recorded
  in the state file, under the same signing key.
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
src/relay.ts         EVENT/OK and REQ/EOSE over WebSocket, NIP-42 AUTH, retries
src/sync.ts          sync(instance, channel, signer, relays, opts), incl. deletions
src/deletion.ts      NIP-09 kind 5 requests, goneReason
src/state.ts         bridged-video state (pure); state-file.ts loads/saves it (Node)
src/nostr-signer.ts  nostr-tools local-key and NIP-46 bunker signers, verify
src/cli.ts           CLI
test/helpers.ts      in-memory relay, fake PeerTube, fake NIP-46 bunker
test/fixtures/       real API responses (trimmed: actor objects, long descriptions),
                     fetched 2026-10-19 from framatube.org and tube.tchncs.de
```

[NIP-71]: https://github.com/nostr-protocol/nips/blob/master/71.md
