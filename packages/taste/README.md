# @match-feed/taste

Lets creators **publish** their public picks for Match Feed's Follow taste (docs/WEB_APP.md, "Follow taste"). One set of picks goes out in two formats, which match the web app's resolver sources 1 and 2:

1. **Signed Nostr list.** A NIP-51 *video curation set*: kind 30005, public items only. It references the NIP-71 video events that `packages/bridge` publishes.
2. **Taste-list v1 JSON.** You host this file at a URL and link it from the channel description.

The package also has strict parsers for both formats, helpers that turn a PeerTube URL into its bridged NIP-71 address, and an in-memory relay.

- TypeScript, no install step: runs on Node ≥ 22.6 with `--experimental-strip-types`. It reuses `packages/bridge` for the `Signer` interface, NIP-01 ids and signing checks, the relay client and the kind rule, and `packages/core` for validation helpers. Both are imported by relative path, the same way `packages/match` uses core. nostr-tools is reached only through `bridge/src/nostr-signer.ts`, and only by `./node-signers.ts`.
- `src/index.ts` is browser-safe (no nostr-tools, no `node:` imports). Node-only signers are in `src/node-signers.ts`.
- **Dry run by default.** Nothing is signed or sent unless you ask for it. Only the relays you pass are contacted.

## Formats

### NIP-51 video curation set (kind 30005)

Spec (read 2026-10-19 at raw.githubusercontent.com/nostr-protocol/nips/master/51.md):
- Curation sets of kind 30005 are "groups of videos", with `e` items (kind 21).
- Sets carry a `d` tag and may carry `title`, `image` and `description` tags.
- New items are appended, so the list stays in chronological order.
- Private items are NIP-44-encrypted in `content`.

NIP-51 has **no per-item timestamp or disclosure field**, so this package defines one tag per pick, which is PROVISIONAL like taste-list v1:

```
["pick", <ref>, <canonical watch URL>, <addedAt>, <flags>, <note>?]
```

| Position | Value | Taste-list v1 field |
|---|---|---|
| `ref` | first value of the pick's `a` tag (`kind:pubkey:d`), or of its `e` tag if it has no `a` tag. Must match a ref in the same event | — |
| URL | `<origin>/videos/watch/<uuid>`. For an `a` ref, its uuid must equal the ref's `d` | `items[].id` |
| `addedAt` | Unix seconds as a decimal string, or `""` | `items[].addedAt` |
| `flags` | `""`, `sponsored`, `affiliated` or `sponsored,affiliated` | `items[].sponsored` / `affiliated` |
| `note` | optional, ≤ 280 characters | `items[].note` |

An event built by `buildCurationSet` looks like this. Picks run oldest first, so apps/web reads the last tag as the newest pick.

```
["d", "picks"], ["title", "Slow craft picks"], ["description", "…"], ["image", "https://…"]?,
["alt", "Video curation set: Slow craft picks"],
["a", "34235:<bridge pubkey>:<peertube uuid>", <relay>?],
["e", <video event id>, <relay or "">, <bridge pubkey>]      ← when the id is known
["pick", "34235:<bridge pubkey>:<uuid>", "https://host/videos/watch/<uuid>", "1792400000", "affiliated", "note"],
…
content: ""
```

- **Video refs.** The bridge publishes addressable kinds 34235/34236 with `d` = PeerTube uuid, so the `a` ref is the durable reference. The `e` ref (what NIP-51 lists for kind 21) pins one version, and the package adds it whenever the event id is known. Picks of `--regular` bridged videos (kinds 21/22) carry `e` only.
- **Unbridged picks.** A pick with no bridged video event is left out of the Nostr set and reported in `skipped`. It still goes into the JSON list.
- **Other clients.** `pick` is a multi-letter tag: relays don't index it and other clients ignore it. Other NIP-51 clients' sets (plain `e` refs, extra tags) still parse.
- **Limits.** ≤ 256 picks, ≤ 512 refs, ≤ 1,040 tags, ≤ 1,024 characters per tag value, and ≤ 64 KiB for the serialized event (checked when building and when parsing).

### Taste-list v1 JSON

Same format and the same limits as docs/WEB_APP.md and `apps/web/src/lib/tastelist.ts`: 64 KiB, 256 items, unknown keys rejected.
- `toTasteList` / `serializeTasteList` write picks newest first. Flags are written only when true.
- `author` defaults to the signer's `npub`, which lets viewers request a match from a list card (WEB_APP.md, Reels rail).
- Output is validated with `parseTasteList` before it is returned.

## API

| Function | What it does |
|---|---|
| `validatePicksSet(x)` | strict check of the editable model (`PicksSet`). Canonicalizes PeerTube URLs (`/w/<short>` → `/videos/watch/<uuid>`) and checks each video ref against its URL. Optional keys set to `undefined` count as absent |
| `parseWatchUrl`, `shortUuidToUuid`, `uuidToShortUuid`, `canonicalFromApi` | PeerTube URL handling. Short UUIDs are flickrBase58, checked against the bridge fixtures |
| `findBridgedVideo(url, {query, verify, bridgePubkeys?})` | finds a URL's bridged event on relays: `#d` = uuid for 34235/34236, `#r` = URL for 21/22. Every candidate must pass its signature check and point back to exactly this URL (`origin` uuid and URL), which defeats look-alikes with the same `d`. Without trusted keys, two authors make the result `ambiguous` |
| `predictBridgedRef(ptVideo, bridgePubkey)`, `bridgedAddresses(url, pubkey)` | the address offline, using the bridge's kind rule. Use these when you have the API object, or want both candidate kinds |
| `resolvePicks(set, {query, verify, bridgePubkeys?})` | attaches refs to picks that lack one, 4 lookups at a time. Reports per pick: `bridged`, `not-bridged`, `ambiguous`, `error` or `kept` |
| `buildCurationSet(set, {createdAt})` → `{template, skipped, included}` | the unsigned kind-30005 event |
| `signCurationSet(signer, template, {verify})` | signs with any `Signer` (NIP-07, NIP-46 bunker, local key) through bridge `signWith`. Rejects a signer that alters the event; `verify` adds the Schnorr check |
| `publishPicks(set, {signer, relays, dryRun = true, signInDryRun, publish, verify, createdAt})` | builds both formats from one set, and in a live run signs and sends. Returns `{template, event?, tasteList, json, skipped, warnings, address, results?}` |
| `buildSetDeletion(pubkey, d)` | NIP-09 request that unpublishes a set |
| `parseCurationSet(event, {pubkey?})` | strict parser for an untrusted kind-30005 event (structure only; check the signature separately) |
| `resolveCurationSet(parsed, videoEvents, {verify})` | maps refs to taste-list v1 items through signed video events. A `pick` URL that disagrees with its video event drops the pick |
| `readCreatorPicks(pubkey, {query, verify})` | the viewer side in one call: newest set per `d` → taste-list v1 |
| `parseTasteList`, `parseTasteListJson` | taste-list v1 parser, a drop-in for apps/web's |
| `picksFromTasteList`, `picksFromCurationSet` | load either format back into the editor |
| `MemoryRelay` | in-memory NIP-01 relay: verifies on publish, keeps one version per address, honours NIP-09 |
| `relaysQuery(urls)`, `relayPublisher(opts)` | the bridge's WebSocket client (NIP-42 AUTH, retries) |
| `nip07Signer(window.nostr)` | NIP-07 extension as a `Signer` |
| `signerFromEnv()` (`./node-signers.ts`) | `NOSTR_BUNKER_URL` (NIP-46, preferred) or `NOSTR_SECRET_KEY`, like the bridge CLI |

## Hooks for apps/web's Creator studio: "Publish my picks"

The studio holds a `PicksSet` (`{d: "picks", title, description?, items: Pick[]}`) in its own state. The steps below are the integration points. apps/web isn't changed by this package.

1. **Add a pick.** Paste a watch URL, or use "Add to my picks" on any card. Run `validatePicksSet` (it canonicalizes the URL), then `findBridgedVideo(url, {query: relaysQuery(settings.relays), verify: verifyNostrEvent, bridgePubkeys})` to show **"On Nostr ✓"** or **"Not bridged: JSON list only"**. List the creator's own key and any instance bridge they trust in `bridgePubkeys`. On `ambiguous`, let them choose from `candidates`. Stamp `addedAt = now` (Unix seconds).
2. **Edit.** Checkboxes for **Sponsored** (paid placement) and **Affiliated** (material connection), and a 280-character note. Viewers' cards show the labels: apps/web's URL source already does, and its Nostr source can once it reads `pick` tags (below).
3. **Preview.** Call `publishPicks(set, {signer: nip07Signer(), createdAt})`. It is a dry run and sends nothing. Show `warnings`, `skipped` and the event JSON. Add `signInDryRun: true` only if you want the extension prompt during preview.
4. **Publish.** Call `publishPicks(set, {signer, relays: settings.relays, dryRun: false, publish: relayPublisher({authSigner: signer}), verify})`. Use only the relays the creator configured, and show `results` per relay. The signer is `nip07Signer()` or a NIP-46 bunker; the app never sees a secret key.
5. **Host the JSON.** Offer `json` as a download, `taste.json`, to upload anywhere with CORS. Then tell the creator what to put in the channel description so Follow taste finds the picks:
   - their `npub` (source 1, `findNpub`);
   - the URL (source 2: must end in `.json` or contain "taste", ≤ 3 links).
6. **Load published picks.** `readCreatorPicks(pubkey, …)` reads them back; feed the raw event through `picksFromCurationSet` to edit them. Or load a hosted list with `picksFromTasteList(parseTasteListJson(text))`.
7. **Unpublish.** Sign `buildSetDeletion(pubkey, d)` and send it to the same relays.
8. **Offline artifact build.** Use `MemoryRelay` in place of relays.

**When apps/web switches readers.** Replace `curationSets` / `curationItems` with `readCreatorPicks`, or with `parseCurationSet` + `resolveCurationSet`, to get:
- per-pick `addedAt`, where today every pick gets the set's `created_at`;
- `sponsored` / `affiliated` / `note` on Nostr picks;
- the strict limits.

Replace `tastelist.ts` with this package's `parseTasteList`, which is identical (tested against the same vectors). Then pass each item's `addedAt` to core as `source.addedAt = new Date(addedAt * 1000)`. Core now decays taste, match and circle sources from the pick date, so a creator's fresh pick of an older video no longer scores about 0 (packages/core README, "pick-dated recency").

## CLI

```sh
npm run cli -- publish --picks taste.json                        # dry run: prints the event and the JSON
npm run cli -- publish --picks taste.json --relay wss://my.relay --bridge-pubkey <hex> --json-out out.json
NOSTR_BUNKER_URL='bunker://…' npm run cli -- publish --picks taste.json --relay wss://my.relay --signer bunker --publish
```

`--picks` takes a taste-list v1 file or a `PicksSet` file. Keys are read from the environment only: secrets on argv are refused.

## Tests

```sh
npm test        # node:test, offline
npm run typecheck
```

- **Web-app compatibility.** The tests import apps/web's parsers read-only: `tastelist.ts`, `creatortaste.ts` (`curationSets`, `refFilters`, `curationItems`, `resolveCreatorTaste`) and `bech32.ts`. They check that everything this package emits is accepted there, and that both taste-list parsers agree on every valid and invalid vector.
- **Round trips** go through `MemoryRelay` and through the bridge's fake WebSocket relay. Neither touches the network.

## Open items

- Status: `pick` is provisional, like taste-list v1. docs/PROTOCOL.md and docs/WEB_APP.md should document it when either format becomes normative. This package doesn't edit docs outside its own folder.
- Trust: `addedAt` is the curator's claim. Core bounds what re-dating can buy (per-list cap, track record). Clients may also clamp `addedAt` to when they first saw the pick.

License: Apache-2.0.
