# @match-feed/match: the private Match protocol

The 1:1 Match layer of Match Feed: the match lifecycle, NIP-17-style gift-wrapped
messages, per-match keys, PSI-cardinality previews and sketch exchange. It runs the
policies from `@match-feed/core` (sketches, preview budget and noise, similarity,
ranking) over Nostr.

- Design and threat analysis: [`docs/MATCH.md`](../../docs/MATCH.md).
- Wire formats: [`docs/PROTOCOL.md`](../../docs/PROTOCOL.md), section 6, "Match messages".

> **Status: prototype. Not audited.** The rumor kinds (3470–3478) are provisional
> and not registered. OpenMined PSI has no published audit. Don't ship this to
> users before the external audit THREAT_MODEL.md calls for.

License: Apache-2.0. Runtime dependencies: `nostr-tools` 2.25.2 (Unlicense) and
`@openmined/psi.js` 2.0.6 (Apache-2.0). Both are pinned exactly.

## Layout

| File | What it does |
|---|---|
| `src/state.ts` | the lifecycle as a **pure state machine** over a JSON-serializable `MatchBook`. Every transition takes `now`, keys and randomness as inputs and returns `{book, outbox, event}` or `{ok: false, reason}` |
| `src/messages.ts` | control-message schemas: strict parse, fixed key order, exactly 8,192 bytes each |
| `src/kinds.ts` | rumor kinds 3470–3478 (provisional) |
| `src/wrap.ts` | rumor → seal (kind 13) → gift wrap (kind 1059) with a NIP-40 `expiration`, and the checked unwrap |
| `src/keys.ts` | `NostrSigner` (NIP-07 shape, with `nip44`), `localSigner`, per-match `generateMatchKey` |
| `src/psi.ts` | `PsiCardinality` adapters: `openMinedPsi()` (real) and `INSECURE_plaintextPsiForTests()` |
| `src/candidates.ts` | similarity per match and `match` candidates for core `rank` |
| `src/client.ts` | `MatchClient`: the effectful glue (keys, PSI, wrap, publish, sync) |
| `src/relay.ts` | `InMemoryRelay` for tests and simulations (never touches the network) |

## Usage

Requires Node ≥ 22.6, run with `--experimental-strip-types` (the npm scripts pass it).

```sh
npm install         # .npmrc sets ignore-scripts (see "Supply chain" below)
npm test            # 34 offline tests (node:test), with real OpenMined PSI
npm run typecheck   # tsc, erasableSyntaxOnly
```

```ts
import { MatchClient, InMemoryRelay, openMinedPsi, localSigner } from '@match-feed/match';
import { DEFAULT_RECIPE, rank, selectSketchItems, cryptoRng } from '@match-feed/core';

const relay = new InMemoryRelay();                // or your own RelayLike over real relays
const psi = await openMinedPsi();
const alice = await MatchClient.create({ identity: window.nostr /* NIP-07 */, relay, psi });

// Requester: ask for a match, and optionally a preview.
const matchId = await alice.requestMatch(bobPubkey, { consent });   // consent: core SketchConsent
await alice.requestPreview(matchId, selectSketchItems(history, consent, new Date()));

// Target (Bob's device): see requests, accept or decline the preview, then the match.
const { events } = await bob.sync();              // 'match-requested', 'preview-requested'
await bob.respondToPreview(matchId, true, myItems); // uses 1 of 8 previews this year
await bob.acceptMatch(matchId, { consent: bobConsent });

// Both, on a fixed weekly schedule (also while paused):
await alice.sendDueSketches(history);
await alice.sync();

// Rank: match candidates go into core's ranker with your other sources.
const cands = alice.candidates({ myItems, resolveVideo, nameOf: (pk) => petname(pk) });
const feed = rank([...cands, ...followCandidates], DEFAULT_RECIPE, { now: new Date(), limit: 20, rng: cryptoRng() });

alice.setPaused(matchId, true);   // quiet pause (D2): nothing sent, content stops changing
await alice.proposeRenew(matchId); // new 90-day term and fresh per-match keys on both sides
await alice.revoke(matchId);       // ends it; both sides wipe keys and sketches
alice.tick();                      // call periodically: 90-day expiry, request expiry, pruning
```

The requester's preview result arrives as a `preview-result` event:
`{belowFloor, value?, bucket, label, floor}`. Show `label` ("a few in common"), not
the number.

To drive the protocol without the client (another runtime, a simulator), call the
pure functions in `state.ts` and wrap each `outbox` entry with `giftWrap`.
`test/state.test.ts` does exactly that.

## How it maps to the design

| Requirement | Where |
|---|---|
| Preview needs the target's acceptance; ≤ 8 accepted previews per target per rolling year from everyone together; ε = 0.5; floor 5 | core `requestPreview`, `respondToPreview`, `previewBudgetRemaining`, `startPreviewRun`, `noisyPreviewCardinality`, called by `state.ts`. A spent budget goes out as an ordinary decline. The noise is applied *inside* `completeTargetPreview`, so the exact count can't reach the outbox |
| PSI roles flipped: the target learns \|A∩B\| | target = PSI client (`createRequest` / `intersectionSize`); requester = PSI server (`answerRequest`) |
| Sketch format, 128 cap over NIP-17, quiet pause, replay / expiry / epoch | core `buildSketch({transport: 'nip17'})`, `decodeSketch({transport: 'nip17', lastEpoch})` |
| Separate per-match keys (T10) | `docs/MATCH.md`, "Keys" |
| 90-day expiry, renew, revoke | `tick`, `proposeRenew`/`acceptRenew`, `revokeMatch` |
| Gift wrap under 64 KiB | tested: control messages wrap to 19,649 bytes and full 128-bucket sketches to 33,305 bytes |

## Threat notes and limitations

Read `docs/MATCH.md` for the full list. In short:

- **No forward secrecy.** NIP-44 has none. Someone who steals a per-match secret key can read every message sent to that key that they've stored, until the key is rotated (renewal, at most every 90 days) or the match ends. Long-term identity-key theft exposes only the handshake messages (request, accept, the target's preview replies), not sketches. MLS (circles) is the transport with forward secrecy.
- **Relay metadata.** Relays see kind-1059 events of two sizes, a `p` tag and an expiration, from one-time keys with jittered timestamps. They do see:
  - that some key receives traffic, and when;
  - that a target's *identity* key receives first-contact messages (the request, and preview messages sent before the accept);
  - IP addresses, unless you use Oblivious HTTP or Tor.

  Pick relays at random from the peer's inbox list and send on a fixed schedule (`dueSketches`). This package does neither the relay choice nor OHTTP.
- **Message type isn't hidden by schedule.** Every control message is padded to the same size as a 64-bucket sketch, but handshakes still happen at user-driven times.
- **A match can keep whatever you sent them.** Pause, exclusions and revoke govern only the future.
- **Quiet pause** hides the pause on the wire. A careful peer can still notice that the content stopped changing (THREAT_MODEL D2).
- **The preview requester learns a noised value**, and the target learns the exact overlap with a set it did not choose. That's the design (SIMULATION_RESULTS Exp 4). The target's *budget* is the defense, and it is only counted on the target's own device.
- **`setSize` in a preview answer is self-reported.** `minSetSize` is hygiene, not a defense (Exp 4).
- **PSI sessions are in memory.** The PSI client key lives in the `PsiSession` between the target's request and the answer. A restart mid-preview loses it; the preview then times out.
- **Out-of-order delivery.** Messages that can't be applied yet (e.g. a preview reply that arrives before the accept) are retried on the next `sync` until they expire. `sync` applies a batch in rumor-timestamp order.
- **The `MatchBook` holds per-match secret keys and sketches.** Store it encrypted at rest (T9).
- **OpenMined PSI is unaudited** (THREAT_MODEL, Process step 2). It is used in semi-honest, cardinality-only mode. The adapter refuses requests that ask to reveal the intersection, and caps sets at 128.
- **No relay I/O over the network here.** Bring your own `RelayLike` that publishes to and queries real relays. Never publish test traffic to public relays.

## Supply chain

`@openmined/psi.js` 2.0.6 declares build-time packages as runtime dependencies (`protoc-gen-js`, `protoc-gen-ts`, `ts-protoc-gen`, `@grpc/grpc-js`, `google-protobuf`). Its Node bundle (`psi_wasm_node.js`) requires only `crypto` and `fs`. `protoc-gen-js` has a postinstall script that downloads a binary from GitHub. That's why the package-local `.npmrc` sets `ignore-scripts=true`: nothing we use needs an install script (T13).

## Plugging in a different PSI

Anything that implements core's `PsiCardinality` (`createRequest`, `answerRequest`, `intersectionSize`) plus `dispose()` works. Pass a factory as `MatchClient`'s `psi` option. The requirements:

- the party calling `createRequest` and then `intersectionSize` (the target) learns only \|A∩B\|;
- the other party learns at most the request's element count;
- each message stays under about 7.5 KB base64, so it fits an 8,192-byte control message.

`INSECURE_plaintextPsiForTests()` follows the same flow with plaintext sets. Use it only where WASM can't load.
