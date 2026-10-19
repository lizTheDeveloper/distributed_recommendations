# Match Feed

Distributed recommendations for federated video. Match Feed is a client-side layer on top
of PeerTube: your feed is ranked **on your device** from creators you follow, public taste
lists you subscribe to, reserved slots for new creators, and (later) private, mutual,
expiring **matches** with people you choose and small **circles** that pool picks. No
server decides the feed, and every recommendation says why it is there.

The idea and the evidence behind it are in [`docs/DESIGN.md`](docs/DESIGN.md). The short
version: decentralized peer collaborative filtering is old (Tribler's BuddyCast, PocketLens,
Gossple); what nobody has shipped is the consent model of user-chosen, mutual, expiring
matches plus public creator taste lists plus on-device ranking on an open protocol.

Status: early. The first tier (Follow, Subscribe to taste, explore slots) works in a web
client over live PeerTube instances, with local history encrypted at rest. The 1:1 Match
protocol exists as a tested prototype package (`packages/match`: gift-wrapped messages,
per-match keys, PSI previews) with no real relay networking yet and no UI. Circles exist
as tested policy code and a simulation only. See "Status" below.

## Try it

- **Web client** (offline snapshot build, runs in the browser sandbox): https://claude.ai/artifact/KSbWrUFZXvxVUCFi1yzvSK
  It bundles about 125 real videos from framatube.org and tilvids.com; thumbnails are placeholders and playback is disabled. Run the live build locally (below) for real instances.
- **Design mockup** (static, includes the Match/Circle screens and creator studio): https://claude.ai/artifact/HuSpWCdxK54gjwHjEqagh5 (source: `mockups/match-feed.html`)

## Repository map

| Path | What it is |
|---|---|
| `packages/core/` | `@match-feed/core`: the on-device library. Feed recipes, ranking with explore slots and per-list caps, explanations, taste sketches, trust walk, circle and preview privacy policies, a PeerTube client. TypeScript, no runtime dependencies. Apache-2.0 |
| `packages/match/` | `@match-feed/match`: the private 1:1 Match protocol (prototype, not audited). Match lifecycle as a pure state machine, NIP-59 gift wraps, per-match keys with rotation, PSI-cardinality previews (OpenMined PSI), sketch exchange; provisional rumor kinds 3470–3478. In-memory relay only. Apache-2.0 |
| `packages/bridge/` | `@match-feed/bridge`: publishes public PeerTube videos as Nostr NIP-71 video events. Library plus a dry-run-by-default CLI. Apache-2.0 |
| `apps/web/` | The v1 web client (PWA): follows, taste lists, recipes, explore slots, creator studio; sensitive local state encrypted at rest in IndexedDB. Vanilla TypeScript built with esbuild. Apache-2.0 |
| `sim/` | Python + numpy simulation harness: recommender quality, explore share, circle leakage, preview leakage, Sybil reach |
| `docs/` | Design, threat model, wire formats, web app, analytics, open-source stack, simulation results |
| `reports/` | Prior-art research report |
| `research_notes/` | Source-verification and research notes behind the report |
| `mockups/` | Static HTML mockup |

## Run it

Requires Node 22.6 or later (TypeScript runs through `--experimental-strip-types`) and,
for the simulation, Python 3 with numpy (tested with Python 3.13, numpy 2.5).

### Core library

```sh
cd packages/core
npm test        # node:test, offline (99 tests)
npm run demo    # ranks live videos from framatube.org with invented follows and matches
                # flags: --instance https://… --seed N --limit N
```

### Match protocol

```sh
cd packages/match
npm install         # the package's .npmrc sets ignore-scripts (a psi.js dependency has a postinstall download)
npm test            # offline (34 tests), with real OpenMined PSI; no network
npm run typecheck
```

Everything runs against an in-memory relay; never point tests at public relays. Details:
[`packages/match/README.md`](packages/match/README.md), [`docs/MATCH.md`](docs/MATCH.md).

### PeerTube → NIP-71 bridge

```sh
cd packages/bridge
npm install
npm test            # offline tests against trimmed real API fixtures (31 tests)
npm run typecheck

# Dry run: one event JSON per line on stdout, nothing published
npm run -s sync -- sync --instance framatube.org --channel framaconf --limit 5

# Dry run signed with a throwaway key, to see id/pubkey/sig
npm run -s sync -- sync --instance tube.tchncs.de --channel dies_und_das --ephemeral-key
```

Publishing needs `--publish --relay wss://…` and a key in `NOSTR_SECRET_KEY` (never on the
command line). Read "Who signs" in [`packages/bridge/README.md`](packages/bridge/README.md)
first: an instance-run bridge signs with its own key and names the creator with
`--creator-pubkey`; it must not pose as the creator.

### Web client

```sh
cd apps/web
npm install
npm run dev            # http://localhost:8080, rebuilds on save
npm run build          # dist/ (PWA) and dist-artifact/index.html (single-file offline build)
npm test               # offline (30 tests)
npm run typecheck
npm run snapshot       # refresh the offline snapshot (network)
```

Serve a build with `python3 -m http.server -d dist 8080`. The service worker registers only
over https. Details: [`apps/web/README.md`](apps/web/README.md), [`docs/WEB_APP.md`](docs/WEB_APP.md).

### Simulation

From the repository root:

```sh
python3 -m sim.run --all --quick                  # smoke test, ~20 s
python3 -m sim.run --all                          # all five experiments, ~7.5 min on 4 cores; writes sim/out/
python3 -m sim.run --exp 2 --seed 5 --out /tmp/simout --workers 2
python3 -m unittest discover -s sim/tests -t .
```

Details: [`sim/README.md`](sim/README.md).

## Documents

| Document | Contents |
|---|---|
| [`docs/DESIGN.md`](docs/DESIGN.md) | The design: tiers, ship order, defaults, match and circle protocols, decisions, implementation status, sources |
| [`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md) | Assets, adversaries, threats T1–T26 with mitigations and which are implemented |
| [`docs/MATCH.md`](docs/MATCH.md) | The 1:1 Match protocol in `packages/match`: keys, wire privacy, previews, limits, open items |
| [`docs/PROTOCOL.md`](docs/PROTOCOL.md) | Wire formats: recipes, taste sketches, circle policy, previews, second degree, Match messages (provisional) |
| [`docs/SIMULATION_RESULTS.md`](docs/SIMULATION_RESULTS.md) | What the simulation found and the parameters it set |
| [`docs/WEB_APP.md`](docs/WEB_APP.md) | Web client data flow, local state, provisional taste-list format |
| [`docs/ANALYTICS.md`](docs/ANALYTICS.md) | Creator analytics tiers and decisions |
| [`docs/OSS_STACK.md`](docs/OSS_STACK.md) | Open-source building blocks, licenses, audit status |
| [`reports/Distributed video recommendation prior art.md`](reports/Distributed%20video%20recommendation%20prior%20art.md) | Prior-art report, with a 2026-10-19 update on what the simulation confirmed or refuted |

## Status (2026-10-19)

**Works**
- On-device ranking over live PeerTube data in the web client: follows, taste lists (at most 2 items per list per page, weighted by each list's track record), 5% explore slots ranked by your on-device tag profile, declarative recipes (decision D1), "Why am I seeing this?", Sponsored/Affiliated labels, P2P off by default, self-hosted fonts.
- Creator studio Tiers 0–1 (host stats links, public counts). Tier 2 discovery stats are tallied on the device only; nothing is sent.
- The bridge produces NIP-71 events (addressable 34235/34236 by default) and can publish them.
- Core implements the simulated policies: sketch padding and transport caps (128 items over NIP-17, 256 over MLS), quiet pause (D2), the trust walk, circle output rules (k ≥ 8, thresholds, ε = 1 sticky noise, epoch freeze, picks only), and noised previews with a per-target yearly budget.
- Encrypted local storage in the web client (T9/T22): history, follows, taste lists and related caches are AES-GCM ciphertext in IndexedDB under a non-extractable device key or an optional passphrase, with retention by the sharing window and a crypto-shredding wipe. In device mode a full copy of the browser profile can still decrypt them (see `docs/WEB_APP.md`).
- The 1:1 Match protocol core (`packages/match`, prototype): request/accept, target-accepted PSI-cardinality previews noised on the target's device (a spent budget looks like a normal decline), weekly padded sketches, quiet pause, 90-day expiry, renewal with per-match key rotation, revoke; NIP-59 gift wraps with replay and expiry checks. Tested against an in-memory relay.

**Not built yet**
- Match over real relays (WebSocket relay I/O, inbox-relay selection, OHTTP), and any Match UI in the web client.
- Circles networking and cryptography: MLS/Marmot, secure aggregation.
- Signed taste lists (the format is provisional; lists are imported by URL or paste).
- DAP analytics, identity-key recovery.
- Registered event kinds: the Match rumor kinds 3470–3478 are provisional.
- Nothing has had an external review or audit; OpenMined PSI has no published audit.

## Next work (prioritized)

1. **External privacy review of `docs/THREAT_MODEL.md`** before Match talks to real relays.
2. **Match over real relays:** a WebSocket `RelayLike` with random inbox-relay selection (NIP-17 kind 10050) and Oblivious HTTP (T5). Register or move the provisional rumor kinds 3470–3478.
3. **Wire Match into the web client UI:** requests, previews, pause, renew and revoke screens, with the `MatchBook` (per-match keys and sketches) stored in the encrypted vault.
4. **Signed taste lists** as Nostr addressable events, replacing the provisional unsigned format.
5. **Circles:** choose a secure-aggregation protocol with the noise added inside it, keep the per-epoch noise seed away from members (T19), replace the reference `keyedRng` with an audited PRF (T20), and carry it over Marmot/MLS (marmot-ts for a prototype; an audited path before launch).
6. **DAP creator analytics** (Tier 2): a Janus leader plus an independent helper; resolve the EU ePrivacy question first.
7. **Bridge:** a consent check before bridging other people's channels. (NIP-09 deletions, the T23 signing policy, NIP-42 AUTH and relay retries are done.)
8. **First-hop Sybil defences** (not yet simulated): per-source trust learned from feedback, a per-match item cap.
9. **External security audit** of the Match and Circle protocols, OpenMined PSI and the client before Match launches.

## License

`packages/core`, `packages/match`, `packages/bridge` and `apps/web` are Apache-2.0. Self-hosted fonts in
`apps/web/public/fonts/` are under the SIL Open Font License 1.1.
