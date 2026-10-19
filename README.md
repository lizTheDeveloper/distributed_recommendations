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
as a tested prototype package too (`packages/circles`: MLS groups, secure aggregation,
distributed DP noise), also without real relays or UI. Android, iOS and desktop shells wrap
the web client (working app name **Meme Video**, name check pending). See "Status" below.

## Try it

- **Web client** (offline snapshot build, runs in the browser sandbox): https://claude.ai/artifact/KSbWrUFZXvxVUCFi1yzvSK
  It bundles about 125 real videos from framatube.org and tilvids.com; thumbnails are placeholders and playback is disabled. Run the live build locally (below) for real instances.
- **Design mockup** (static, includes the Match/Circle screens and creator studio): https://claude.ai/artifact/HuSpWCdxK54gjwHjEqagh5 (source: `mockups/match-feed.html`)

## Repository map

| Path | What it is |
|---|---|
| `packages/core/` | `@match-feed/core`: the on-device library. Feed recipes, ranking with explore slots and per-list caps, explanations, taste sketches, trust walk, circle and preview privacy policies, a PeerTube client. TypeScript, no runtime dependencies. Apache-2.0 |
| `packages/match/` | `@match-feed/match`: the private 1:1 Match protocol (prototype, not audited). Match lifecycle as a pure state machine, NIP-59 gift wraps, per-match keys with rotation, PSI-cardinality previews (OpenMined PSI), sketch exchange; provisional rumor kinds 3470–3478. In-memory relay only. Apache-2.0 |
| `packages/circles/` | `@match-feed/circles`: Circles prototype (not audited). MLS groups over Nostr via marmot-ts with a ts-mls security override, pairwise-masked secure aggregation, distributed Pólya noise, core's circle policy on the aggregate, app-level authorization guards, fixed-size padded round messages; provisional kinds 3480–3482. In-memory relay only. Apache-2.0 |
| `packages/moderation/` | `@match-feed/moderation`: on-device moderation: NIP-56 and PeerTube abuse reports, NIP-32 labelers, block and mute lists, app-store defaults, a pre-filter for `rank()`. Not wired into the web client yet. Apache-2.0 |
| `packages/bridge/` | `@match-feed/bridge`: publishes public PeerTube videos as Nostr NIP-71 video events. Library plus a dry-run-by-default CLI. Apache-2.0 |
| `apps/web/` | The v1 web client (PWA): follows, taste lists, recipes, explore slots, creator studio; sensitive local state encrypted at rest in IndexedDB. Vanilla TypeScript built with esbuild. Apache-2.0 |
| `apps/mobile/` | Android and iOS shells (Capacitor 8) around `apps/web/dist`, with the `window.MatchFeedNative` bridge (secure key storage, background fetch, share target, deep links, notifications). Branding in `brand.json` |
| `apps/desktop/` | Desktop shell (Tauri 2) for Linux, macOS and Windows; OS-keychain secrets only, no plugins |
| `infra/relay/` | Self-hostable strfry relay behind Caddy, with a write policy and retention; tested in CI |
| `infra/web/` | Pinned deploy CLIs (Cloudflare Pages, IPFS) and the `security.txt` template for web releases (`docs/DEPLOY.md`) |
| `.github/` | CI (`workflows/ci.yml`), gated web release with provenance (`workflows/deploy-web.yml`), Dependabot |
| `packages/analytics/`, `packages/taste/`, `packages/transport/`, `services/labeler/`, `infra/janus/`, `infra/glitchtip/`, `infra/umami/` | Work in progress in parallel streams (DAP creator analytics, taste-list publishing, OHTTP transport, a moderation labeler, opt-in crash reports). Not described here yet; see each directory |
| `sim/` | Python + numpy simulation harness: recommender quality, explore share, circle leakage, preview leakage, Sybil reach |
| `docs/` | Design, threat model, wire formats, Match, Circles, web app, shipping, deploying, naming, analytics, open-source stack, simulation results |
| `reports/` | Prior-art research report |
| `research_notes/` | Source-verification and research notes behind the report |
| `mockups/` | Static HTML mockup |

## Run it

Requires Node 22.6 or later (TypeScript runs through `--experimental-strip-types`) and,
for the simulation, Python 3 with numpy (tested with Python 3.13, numpy 2.5).

### Core library

```sh
cd packages/core
npm test        # node:test, offline (104 tests)
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

### Circles (prototype)

```sh
cd packages/circles
npm ci              # .npmrc: ignore-scripts, save-exact; keeps the ts-mls security override
npm test            # offline (43 tests), including 12 members over real MLS; about 20 s
npm run typecheck
```

In-memory relay only. Read [`docs/CIRCLES.md`](docs/CIRCLES.md) §8 ("What is not secure yet") before
building on it; do not ship on marmot-ts 0.5.1. Details: [`packages/circles/README.md`](packages/circles/README.md).

### Moderation

```sh
cd packages/moderation
npm ci
npm test            # offline (56 tests), fake relays and fake fetch
npm run typecheck
```

Integration hooks for the web client: [`packages/moderation/README.md`](packages/moderation/README.md).

### PeerTube → NIP-71 bridge

```sh
cd packages/bridge
npm install
npm test            # offline tests against trimmed real API fixtures (58 tests)
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

### Android, iOS and desktop shells

```sh
cd apps/mobile
npm ci && npm test          # link classifier tests (5)
npm run android:debug       # web build -> www/ -> debug APK (JDK 21 + Android SDK)
npm run ios:open            # macOS with Xcode only

cd apps/desktop
npm ci
npm run check               # cargo check --locked
npm run build               # tauri build for this OS (Linux needs webkit2gtk-4.1 and GStreamer)
```

Setup, signing and store steps: [`apps/mobile/README.md`](apps/mobile/README.md),
[`apps/desktop/README.md`](apps/desktop/README.md), [`docs/SHIPPING.md`](docs/SHIPPING.md).

### Relay and releases

`infra/relay/` runs a strfry relay with Docker Compose ([`infra/relay/README.md`](infra/relay/README.md)).
Web releases go through `.github/workflows/deploy-web.yml` and publish only after the owner opts in
([`docs/DEPLOY.md`](docs/DEPLOY.md)). CI runs every package's tests on each push (`.github/workflows/ci.yml`).

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
| [`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md) | Assets, adversaries, threats T1–T33 with mitigations and which are implemented |
| [`docs/MATCH.md`](docs/MATCH.md) | The 1:1 Match protocol in `packages/match`: keys, wire privacy, previews, limits, open items |
| [`docs/CIRCLES.md`](docs/CIRCLES.md) | The Circles prototype in `packages/circles`: MLS library choice and the ts-mls finding, authorization guards, padding, the round, aggregation, distributed noise, what is not secure yet |
| [`docs/PROTOCOL.md`](docs/PROTOCOL.md) | Wire formats: recipes, taste sketches, circles (kinds 3480–3482, provisional), previews, second degree, Match messages (provisional) |
| [`docs/SHIPPING.md`](docs/SHIPPING.md) | From prototype to store apps: owner decisions, phases (web, Android, iOS, desktop), release engineering |
| [`docs/DEPLOY.md`](docs/DEPLOY.md) | CI, the gated web release, repository settings, reproducible-build findings, the relay |
| [`docs/NAMING.md`](docs/NAMING.md) | Naming research and conflict checks for the product name |
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
- Circles (`packages/circles`, prototype): a full round over real MLS among 12 members in tests: pairwise-masked aggregation, distributed noise with no seed (T19), core's output policy, epoch freeze and the void rule, member removal locking the member out (with the ts-mls override, T27), app-level authorization guards around marmot-ts 0.5.1 (T28) and fixed-size round messages (T30).
- On-device moderation library (`packages/moderation`): reports, labelers, blocks and an app-store-ready policy, ready to wire into the apps.
- Native shells: an Android debug APK and a Linux .deb build; the iOS project is generated. CI covers every package; web builds are reproducible and releases attested.

**Not built yet**
- Match over real relays (WebSocket relay I/O, inbox-relay selection, OHTTP), and any Match UI in the web client.
- Circles over real relays, in the UI, and on an audited MLS stack: the prototype runs on alpha marmot-ts 0.5.1 (upgrade to 0.7.0 from 2026-11-02 at the earliest), has no dropout recovery and no input validation against malicious members.
- Moderation, native secure storage, notifications and background checks are not wired into the web client; the shells have not run on a device; no store build is signed.
- Signed taste lists (the format is provisional; lists are imported by URL or paste).
- DAP analytics, identity-key recovery.
- Registered event kinds: the Match rumor kinds 3470–3478 and Circle kinds 3480–3482 are provisional.
- Nothing has had an external review or audit; OpenMined PSI has no published audit.

## Next work (prioritized)

1. **External privacy review of `docs/THREAT_MODEL.md`** before Match talks to real relays.
2. **Match over real relays:** a WebSocket `RelayLike` with random inbox-relay selection (NIP-17 kind 10050) and Oblivious HTTP (T5). Register or move the provisional rumor kinds 3470–3478.
3. **Wire Match into the web client UI:** requests, previews, pause, renew and revoke screens, with the `MatchBook` (per-match keys and sketches) stored in the encrypted vault.
4. **Signed taste lists** as Nostr addressable events, replacing the provisional unsigned format.
5. **Circles:** move to marmot-ts 0.7.0 once it is two weeks old (2026-11-02), replacing the ts-mls override check with one on its bundled fork and dropping app-level guards it makes redundant (T27, T28); then real relay I/O, an exact noise sampler (T20), dropout recovery, input validation (T29), and an audited MLS path (MDK) before launch. Move `releaseAggregatedEpoch` into core.
6. **Wire the native shells and moderation into the web client:** the vault key in the OS keystore, incoming links and shares, opt-in notifications (hooks in `apps/mobile/README.md`), and the moderation pre-filter, Report and Block (hooks in `packages/moderation/README.md`). Test the shells on devices, including the native-bridge frame restriction (T31).
7. **DAP creator analytics** (Tier 2): a Janus leader plus an independent helper; resolve the EU ePrivacy question first.
8. **Bridge:** a consent check before bridging other people's channels. (NIP-09 deletions, the T23 signing policy, NIP-42 AUTH and relay retries are done.)
9. **First-hop Sybil defences** (not yet simulated): per-source trust learned from feedback, a per-match item cap.
10. **External security audit** of the Match and Circle protocols, OpenMined PSI and the client before Match launches.

## License

`packages/core`, `packages/match`, `packages/bridge`, `packages/circles`, `packages/moderation` and `apps/web` are Apache-2.0. Self-hosted fonts in
`apps/web/public/fonts/` are under the SIL Open Font License 1.1.
