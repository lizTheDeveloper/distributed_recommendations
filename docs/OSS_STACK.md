# Match Feed: open-source stack

Status: draft v1, 2026-10-19. Companion to `DESIGN.md` and `THREAT_MODEL.md`.

**Where the data comes from.** Raw notes, registry metadata and sources are in `research_notes/Distributed video recommendation prior art/oss_stack_notes.md`. Repo facts (license, last push, stars) come from ecosyste.ms, npm, PyPI and crates.io, all queried on 2026-10-19. Maturity claims are quoted from each project's README.

**Markers.** **[unverified]** means I could not confirm the claim from a primary source. "Last" is the last push or publish date.

**Team fit.** The team prefers TypeScript and Python. Where the only audited option is in Rust, that is called out.

## Summary

About 80% of the client can be assembled from existing code. The parts that are actually new are:
- the Match/Circle protocol logic
- the on-device ranker and its explanations
- the recipe schema
- the PeerTube→Nostr catalog bridge
- an OHTTP→relay shim

The biggest decision is **TypeScript vs Rust for the crypto core**:
- **Rust (partly audited).** Least Authority reviewed the Marmot protocol (7 Nov 2025) and audited White Noise's Rust backend, whitenoise-rs (final report 1 Apr 2026). Whether MDK itself or OpenMLS were in scope is unconfirmed. The TypeScript MLS path (marmot-ts plus ts-mls) is alpha and unaudited.
- **TypeScript (fast now).** The audited NIP-44 code is the paulmillr TypeScript reference, which suits a TS app.

Recommended shape:
- **Web-tech shell:** React and Vite as a PWA, wrapped with Capacitor for mobile and Tauri for desktop.
- **TypeScript for everything at first,** with Circles kept behind a flag.
- **Move the MLS core to MDK via Tauri/Capacitor native plugins** before Circles leave beta.

## Quick reference

| # | Component | Primary pick | Main alternative(s) | License of pick |
|---|---|---|---|---|
| 1 | App shell | Fork **nostube** (MIT) or **divine-web** (MPL-2.0); Capacitor (mobile) and Tauri (desktop) | Expo/React Native; Framasoft's Flutter app (GPL) | MIT / MPL-2.0 |
| 2 | Catalog and playback | PeerTube REST via generated client; **hls.js** with **Video.js 10**; self-hosted **Sepia search-index** | PeerTube embed iframe; Shaka; p2p-media-loader (opt-in) | Apache-2.0 (player); AGPL (server-side index) |
| 3 | Identity and keys | **NDK** signers (NIP-07, NIP-46) plus **nostr-tools**; Amber on Android; WebCrypto/OS keystore | applesauce-signers; FROSTR (threshold); passkeys | MIT / Unlicense |
| 4 | 1:1 sketches | **nostr-tools** nip17/nip44/nip59 (audited NIP-44 lineage) | NDK `messages`; rust-nostr `nostr-sdk` (Python sim) | Unlicense |
| 5 | Circles | **marmot-ts** for the prototype, then **MDK** (Rust) for launch | OpenMLS directly; ts-mls | MIT |
| 6 | PSI-cardinality | **@openmined/psi.js** (WASM) plus `openmined.psi` (Python) | APSI, PJC (C++, no JS) | Apache-2.0 |
| 7 | On-device ranking | Hand-written item/user-kNN in TS; **transformers.js** for embeddings; **sqlite-vec** WASM or **Orama** | disco-rec; onnxruntime-web; Python sim: implicit, recommenders, RecBole | MIT/Apache |
| 8 | Trust / Sybil | Own Monte Carlo PPR over **graphology**; **Vertex** DVM as a hint | GrapeRank (AGPL); MeritRank (GPL-2 Python); @nostr-dev-kit/wot | MIT |
| 9 | Feed recipes | **JSON schema plus CEL** (`@marcbachmann/cel-js` or `@bufbuild/cel`) | json-logic-js; QuickJS-WASM sandbox (opt-in tier) | MIT / Apache-2.0 |
| 10 | DP and analytics | **OpenDP** (simulation and server-side DP); **Janus/libprio** (DAP) | Tumult, Google DP/PyDP; skip analytics in v1 | MIT; MPL-2.0 |
| 11 | Transport privacy | Relays: **nostr-rs-relay** or **strfry**; **ohttp-ts** with **Cloudflare privacy-gateway** | khatru (Go); Arti (Rust, desktop); Nym mix-fetch | MIT; GPL-3 (strfry, server) |
| 12 | Local storage | **@sqlite.org/sqlite-wasm** (OPFS) or **Dexie**; WebCrypto/libsodium encryption | wa-sqlite; Evolu; Automerge (device sync) | Apache-2.0 |
| 13 | Moderation | Subscribable **NIP-32 labels** applied on-device (own code); **PDQ** for operators | Ozone (atproto-only), ROOST coop/osprey | — / Apache-2.0 |
| 14 | Supply chain | **Sigstore** (cosign, sigstore-js); **SLSA generator**; F-Droid reproducible builds | in-toto; diffoscope (tool) | Apache-2.0 |

---

## 1. Client app shell

Goal: one codebase for web (PWA), Android, iOS and desktop, with WebAssembly available, because PSI, SQLite, embeddings and the sandbox all ship as WASM.

| Candidate | URL | Lang | License | Last | Maturity | Fit | Gotchas |
|---|---|---|---|---|---|---|---|
| **nostube** | https://github.com/flox1an/nostube | TS (+ Rust server) | MIT | 2026-10-11 | active, small (38★) | Nostr video client: React monorepo with `packages/core` (Nostr client, HLS loader, no React) and `packages/widgets`; Tauri desktop wrapper; Blossom | Nostr library and NIP-71 kinds not documented; no PWA mentioned **[unverified]** |
| **divine-web** | https://github.com/divinevideo/divine-web | TS | MPL-2.0 | 2026-10-16 | production (diVine) | React 18, Vite, Tailwind, shadcn; installable PWA; NIP-71 kind 34236; MP4 and HLS; Keycast NIP-46 login; age and minor safeguards | Short-video UX; MPL file-level copyleft on forked files; `@nostrify/*` license not in npm metadata **[unverified]**; moderation tied to divine's API |
| divine-mobile | https://github.com/divinevideo/divine-mobile | Dart/Flutter | MPL-2.0 | 2026-10-19 | production | reference for mobile video UX | Dart, which is not a team language |
| zap.stream | https://github.com/v0l/zap.stream | TS | MIT | 2026-10-12 | active | live streaming over Nostr | live-only |
| PeerTube web client | https://github.com/Chocobozzz/PeerTube (`client/`) | TS/Angular | AGPL-3.0 | 2026-10-16 | production | the canonical PeerTube UX | instance-bound, heavy Angular, AGPL; use as a reference, not a fork |
| PeerTube mobile app | https://framagit.org/framasoft/peertube/mobile-application | Flutter | GPL-3.0+ | v2.3.0, 2026-09-26 | production (F-Droid, iOS) | official cross-instance PeerTube app | Dart; GPL-3 conflicts with Apple App Store terms **[prior knowledge]** |
| NewPipe + NewPipeExtractor | https://github.com/TeamNewPipe/NewPipe | Java | GPL-3.0 | 2026-10-14 | production | has PeerTube and Sepia support | Android/Java only; GPL |
| Fedilab | Codeberg (per fedilab.app) | Kotlin/Java | GPL-3.0-only | — | production | multi-protocol (Mastodon, PeerTube…) | not video-first |
| Thorium | https://github.com/sschueller/peertube-android | Kotlin | AGPL-3.0 | archived 2024 | dead | — | do not use |
| Grayjay | https://github.com/futo-org/grayjay-android (read-only mirror) | Kotlin/C# | **FUTO "Source First" – not OSI** | 2026-10-16 | production | plugin model incl. PeerTube | **cannot be forked or redistributed**; non-commercial terms |
| Capacitor | https://github.com/ionic-team/capacitor | TS | MIT | v8.5.3, 2026-10 | production | wraps the PWA for iOS/Android; WebView has WASM | native plugins needed for keystore and background tasks |
| Tauri | https://github.com/tauri-apps/tauri | Rust/TS | Apache-2.0 OR MIT | 2.x, 2026-10 | production | desktop (and mobile) wrapper; Rust side can host MDK, Arti, ohttp | Rust in the build |
| Expo / React Native | https://github.com/expo/expo | TS | MIT | v58, 2026-10 | production | native UI; NDK has `@nostr-dev-kit/mobile` | **Hermes has historically lacked WebAssembly [verify]**; psi.js needs polyfills for RN; sqlite-wasm and transformers.js don't apply |

**Options**

- **A. Fork nostube (recommended).**
  - Pros: MIT gives maximum license freedom. It already splits a React-free core from widgets. It is long-form video (closer to PeerTube than diVine) and has a Tauri wrapper.
  - Cons: small project. We add the PWA manifest, Capacitor, and the PeerTube catalog ourselves.
- **B. Fork divine-web.**
  - Pros: a production PWA with moderation and minor-safety work already done.
  - Cons: vertical short-video UX; the MPL-2.0 files stay MPL; it is tied to diVine services.
- **C. Fresh Expo app.**
  - Pros: the best native feel.
  - Cons: WASM-dependent pieces (PSI, SQLite-WASM, embeddings, sandbox) need native rewrites or a hidden WebView.

## 2. Video catalog and playback

| Candidate | URL | Lang | License | Last | Maturity | Fit | Gotchas |
|---|---|---|---|---|---|---|---|
| PeerTube REST API | OpenAPI spec: https://raw.githubusercontent.com/Chocobozzz/PeerTube/develop/support/doc/api/openapi.yaml | — | spec marked AGPLv3 | v8.3.0 | production | list and search videos with `tagsOneOf`, `languageOneOf`, `isLocal`, `nsfw`, sort, start/count | default 50 req/10 s per IP; **we must not send watch history to instances** (read only public endpoints, unauthenticated) |
| openapi-typescript + openapi-fetch | https://github.com/openapi-ts/openapi-typescript | TS | MIT | 2026-02 | production | generate a typed client from the spec | see the AGPL note in the License section |
| @peertube/peertube-types | npm | TS | **AGPL-3.0** | 8.3.1, 2026-09 | official | ready-made types | AGPL; avoid in a non-AGPL app |
| PyPI `peertube` | https://pypi.org/project/peertube/ | Py | MIT | 1.1.1, 2025-09 | low trust | generated client for Python simulation | placeholder repo URLs; regenerate with openapi-python-client instead |
| **Sepia search-index** | https://framagit.org/framasoft/peertube/search-index | TS **[unverified]** | AGPL-3.0 | 623 commits | production (Sepia Search) | self-host a cross-instance index as our candidate source; Framasoft encourages forks | stack and API not confirmed from the page; AGPL is fine if we run it unmodified or publish changes |
| denikryt/PeerTube-browser | https://github.com/denikryt/PeerTube-browser | Python | AGPL-3.0 | 2026-10-13 | experimental | crawler, SQLite and FAISS candidate generator, explore/exploit "layers" | 2★; reference design |
| **hls.js** | https://github.com/video-dev/hls.js | TS | Apache-2.0 | 1.7.3, 2026-09 | production | PeerTube serves HLS | — |
| **Video.js 10** | https://github.com/videojs/video.js | TS | Apache-2.0 | 10.1.0, 2026-10-12 | production (v10 is new) | UI shell around hls.js | v10 is a rewrite; check plugin availability |
| Vidstack | https://github.com/vidstack/player | TS | MIT | 2026-10 | **deprecated** for Video.js 10 | — | security fixes only until Jan 2028 |
| Shaka Player | https://github.com/shaka-project/shaka-player (npm) | TS/JS | Apache-2.0 | 5.3.1, 2026-10-19 | production | alternative player | heavier |
| p2p-media-loader | https://github.com/Novage/p2p-media-loader | TS | Apache-2.0 | 4.0.0, 2026-08 | production (PeerTube uses it) | **opt-in** P2P (T6) | leaks viewer IP to peers and tracker |
| WebTorrent | https://github.com/webtorrent/webtorrent | JS | MIT | 3.0.21, 2026-07 | production | legacy PeerTube web-video P2P | same IP leak; prefer HLS |
| @peertube/embed-api | npm | TS | AGPL-3.0 | 0.2.0, 2024-12 | official | iframe embed control | the iframe loads from the instance, so the instance sees the viewer's IP and the video |

**To build:** a PeerTube→NIP-71 bridge (or an index) that publishes signed video events, so taste lists and sketches reference stable IDs. Search found NIP-71's optional `origin` tag for imports and the client satsdisco/videorelay **[seen in search only]**, but no PeerTube↔Nostr bridge.

## 3. Identity and keys

| Candidate | URL | Lang | License | Last | Maturity | Fit | Gotchas |
|---|---|---|---|---|---|---|---|
| **NDK** | https://github.com/nostr-dev-kit/ndk | TS | MIT | core 3.0.3 (2026-02); repo push 2026-04 | production (many clients) | signers (key, NIP-07, NIP-46), sessions (multi-account), React/Svelte/RN bindings, Dexie and SQLite-WASM caches, NIP-77 sync, WoT | repo pace slowed in 2026 |
| **nostr-tools** | https://github.com/nbd-wtf/nostr-tools | TS | Unlicense | 2.25.2, 2026-09 | production | low-level: nip07, nip46, nip17, nip44, nip59; deps are only noble/scure | — |
| applesauce | https://github.com/hzrd149/applesauce | TS | MIT (npm) | 6.2.x, 2026-09 | production (noStrudel) | signers and an event store; **marmot-ts depends on it** | repo license undetected; use npm's MIT |
| nostr-login | npm `nostr-login` | TS | MIT | 1.7.12, 2025-09 | beta | drop-in login UI (nsec.app, extensions, bunker) | — |
| rust-nostr / nostr-sdk | https://github.com/nostrdevkit/nostr (moved from rust-nostr) | Rust (+ Python/Swift/Kotlin bindings via nostr-sdk-ffi) | MIT | 0.45.x, 2026-09 | **ALPHA per README** | Python simulation and DVMs; native core | JS bindings repo archived; NIP-71 not supported |
| Amber | https://github.com/greenart7c3/Amber | Kotlin | MIT vs Apache badge **[conflicting]** | 2026-10-13 | "Stable"; reproducible builds | Android NIP-55 / NIP-46 signer; keeps keys out of our app | Android only |
| nsec.app (noauth) | https://github.com/nostrband/noauth | TS | none detected **[unverified]** | 2025-05 | beta | web NIP-46 signer | license unclear; don't fork without checking |
| nos2x, Alby | https://github.com/fiatjaf/nos2x, https://github.com/getAlby/lightning-browser-extension | JS/TS | ? / MIT | 2026 | production | NIP-07 browser signers | — |
| divinevideo/keycast | https://github.com/divinevideo/keycast | Rust | MIT | 2026-10 | production (diVine) | hosted NIP-46 signer service | custodial-ish |
| **FROSTR bifrost** | https://github.com/FROSTR-ORG/bifrost | TS | MIT | 2.0.2, 2026-01 | early; security-model doc, **no audit** | k-of-n threshold signing **and ECDH** for an nsec, over Nostr relays: a ready social-recovery and multi-device answer for T11 | 12★; ECDH is needed for NIP-44 decryption |
| igloo-core / igloo-web / igloo-desktop / frost2x | https://github.com/FROSTR-ORG | TS | MIT / MIT / none / none | 2025–26 | early | reference signer apps | licenses undetected on two of them |
| ZF FROST | https://github.com/ZcashFoundation/frost | Rust | MIT OR Apache-2.0 | frost-secp256k1-tr 3.0.0, 2026-04 | production in Zcash; audit **[unverified this session]** | BIP-340/Taproot FROST for a native core | Rust |
| SimpleWebAuthn | https://github.com/MasterKale/SimpleWebAuthn | TS | MIT | 14.0.0, 2026-09 | production | passkeys for local unlock; PRF can wrap a local key | **don't make PRF the only copy of a key**: authenticator loss means key loss (WebAuthn co-editor warning) |
| noble-curves / noble-ciphers | https://github.com/paulmillr/noble-curves | TS | MIT | 2.4.0, 2026-08 | audited (per README) | per-match key derivation, rotation | — |

**Pick:** NDK sessions and signers, with nostr-tools for the primitives. Keep the identity key in a NIP-46 or NIP-55 signer when the user has one, and in the OS keystore otherwise. Derive per-match keys locally (T10).

**For T11 (key recovery), the options are:**
- **(a)** FROSTR 2-of-3 across the user's devices and a guardian. It is the most complete, but unaudited.
- **(b)** A key-rotation event signed by the old key. This is our own code.
- **(c)** A hardware or passkey-wrapped backup.

## 4. 1:1 encrypted sketch exchange (NIP-17 / NIP-44 / NIP-59)

| Candidate | URL | Lang | License | Last | Maturity | Fit | Gotchas |
|---|---|---|---|---|---|---|---|
| **nostr-tools** nip17/nip44/nip59 | above | TS | Unlicense | 2026-09 | production | gift-wrapped DMs, sketch payloads | the Cure53 audit (2023) covered **paulmillr/nip44** (JS/Go/Rust reference), not nostr-tools itself; nostr-tools' NIP-44 is presumed to derive from it **[verify by diff]** |
| paulmillr/nip44 | https://github.com/paulmillr/nip44 | TS/Go/Rust/C | none detected | 2024-12 | **audited (Cure53 NOS-01, 2023)** | reference vectors for our tests | findings include no forward secrecy (Medium) |
| NDK `@nostr-dev-kit/messages` | npm | TS | MIT | 2.0.0, 2026-02 | beta | high-level NIP-17 conversations (also "NIP-EE"/MLS) | DM-chat oriented; we need structured payloads |
| rust-nostr `nostr-sdk` (Python) | PyPI `nostr-sdk` 0.45.1 | Py/Rust | MIT | 2026-08 | alpha | simulation harness and bots that speak real NIP-17 | API churn |
| pynostr | https://github.com/holgern/pynostr | Py | MIT | 2025-08 | small | — | NIP-44 support **[unverified]** |

**Pick:** nostr-tools. Add CI tests against paulmillr/nip44 vectors. Pad sketches to fixed sizes (T5), which is our own code.

## 5. Circles (MLS over Nostr)

| Candidate | URL | Lang | License | Last | Maturity | Fit | Gotchas |
|---|---|---|---|---|---|---|---|
| **marmot-ts** | https://github.com/marmot-protocol/marmot-ts (npm `@internet-privacy/marmot-ts`) | TS | MIT | 0.7.0, 2026-10-19 | **Alpha: "Do not use in production yet"** | Marmot MIP-00–03 in the browser, Node, Bun and Deno; wire-compatible with the reference | bundles a forked ts-mls; no audit; RN not mentioned |
| **MDK** | https://github.com/marmot-protocol/mdk (crate `mdk-core`) | Rust | MIT | 0.8.0 crate; push 2026-10-12 | protocol reviewed and whitenoise-rs audited by Least Authority (2026-04); MDK in scope **[unverified]** | the audited path; embed via Tauri (desktop) or a Capacitor plugin (UniFFI) | Rust and FFI work; mobile plugin is ours to build |
| ts-mls | https://github.com/LukaJCB/ts-mls | TS | MIT | 1.6.4, 2026-08 | "**not undergone a formal security audit**" | full RFC 9420; PQ suites | — |
| OpenMLS | https://github.com/openmls/openmls | Rust | MIT | 0.9.1, 2026-10 | production (Wire/Phoenix ecosystem) | raw MLS if we skip Marmot | we'd redo Marmot's Nostr glue |
| whitenoise / whitenoise-rs | https://github.com/marmot-protocol/whitenoise-rs | Dart / Rust | **AGPL-3.0** | 2026 | audited | reference app | AGPL: read, don't copy, unless our app is AGPL |

**Options:**
- **(a)** marmot-ts for the prototype and the simulations. Ship Circles only after moving to MDK, or after funding an audit of marmot-ts plus ts-mls. This is recommended, and matches THREAT_MODEL's "audited primitives only".
- **(b)** MDK from day one through Tauri, with a Capacitor plugin on mobile. Safer, but slower for a TypeScript team.

**Not covered by any library:** the secure-aggregation, threshold-reveal and DP-noise layer *inside* a circle. That is our own code (see the build list).

## 6. PSI-cardinality preview

| Candidate | URL | Lang | License | Last | Maturity | Fit | Gotchas |
|---|---|---|---|---|---|---|---|
| **OpenMined PSI** | https://github.com/OpenMined/PSI | C++ core; JS/WASM, Python, Go, Rust, C bindings | Apache-2.0 | repo 2026-09-20; npm/PyPI 2.0.6 (2025-06) | used in research and production pilots; **README states no audit or security model** | ECDH-PSI with a cardinality-only mode (`reveal_intersection=false`); two messages map onto two NIP-17 messages | the "server" side learns nothing, the client learns the count; GCS/Bloom options have false positives; semi-honest model **[inference]**; RN needs polyfills |
| APSI | https://github.com/microsoft/APSI | C++ | MIT | 2026-10 | production quality | asymmetric (big vs small set) | no JS/WASM binding found |
| private-join-and-compute | https://github.com/google/private-join-and-compute | C++ | Apache-2.0 | 2026-03 | production (Google) | intersection-sum | no JS |
| PETAce | https://github.com/tiktok-privacy-innovation/PETAce | Py/C++ | Apache-2.0 | 2025-02 | used for TikTok friend-matching | — | stale-ish; no JS |
| libPSI | https://github.com/osu-crypto/libPSI | C++ | "other" | 2024-12 | research | — | — |

**Pick:** @openmined/psi.js in the client and `openmined.psi` in the Python leakage simulation (T2). **THREAT_MODEL.md lists OpenMined PSI as an "audited primitive". Its README does not support that,** so either budget a review or reword the threat model.

## 7. On-device ranking and content embeddings

| Candidate | URL | Lang | License | Last | Maturity | Fit | Gotchas |
|---|---|---|---|---|---|---|---|
| **Own kNN / co-occurrence ranker** | — | TS | ours | — | — | DESIGN's scoring is about 100 lines of TS: Jaccard/cosine plus a Σ sim×endorsed sum, explore slots and exposure caps; easy to explain | we own the tests |
| disco-rec (disco-node) | https://github.com/ankane/disco-node | JS | MIT | 0.3.0, 2026-04 | small, maintained | user/item MF if we need it | browser support **[unverified]** |
| knn-recommender | npm | JS | MIT | 2021 | stale | — | — |
| **transformers.js** | https://github.com/huggingface/transformers.js | JS/TS | Apache-2.0 | v4.3.1, 2026-10 | production | small sentence-embedding model over titles and descriptions for cold start | model download (tens of MB); model license is separate **[check per model]** |
| onnxruntime-web | https://github.com/microsoft/onnxruntime | C++/JS | MIT | 1.30.0, 2026-09 | production | runtime under transformers.js | — |
| TensorFlow.js | https://github.com/tensorflow/tfjs | TS | Apache-2.0 | npm 4.22.0 (2024-10) | slowing | — | prefer ONNX |
| **sqlite-vec** | https://github.com/asg017/sqlite-vec | C (WASM build) | MIT OR Apache-2.0 | 0.1.9, 2026-03 | pre-1.0 | vector search *inside* the same SQLite DB as history | pre-1.0 |
| Orama | https://github.com/oramasearch/orama | TS | Apache-2.0 (npm) | 3.1.18, 2025-12 | production | full-text plus vector search in pure TS | in-memory; persist separately |
| Voy / hnswlib-wasm | https://github.com/tantaraio/voy, https://github.com/ShravanSunder/hnswlib-wasm | Rust / C++ | Apache-2.0 | 2023 | stale | — | avoid |
| **Python offline sim:** implicit, recommenders, RecBole, Surprise, LightFM, networkx, faiss | https://github.com/benfred/implicit, https://github.com/recommenders-team/recommenders, https://github.com/RUCAIBox/RecBole, https://github.com/NicolasHug/Surprise, https://github.com/lyst/lightfm | Py | MIT / MIT / MIT / BSD-3 / Apache-2.0 | 2024–26 | production | baselines, Gini/exposure metrics, explore-slot simulation | LightFM is stale (2024); RecBole last pushed 2025-02 |

The catalog is about 10^5–10^6 PeerTube videos and the candidate pool is matches' endorsements, so a hand-written kNN is enough. MF or ANN is needed only for content cold-start, and transformers.js with sqlite-vec covers that.

## 8. Trust / Sybil resistance (second degree, list weighting)

| Candidate | URL | Lang | License | Last | Maturity | Fit | Gotchas |
|---|---|---|---|---|---|---|---|
| **graphology** (+ graphology-metrics) | https://github.com/graphology/graphology | JS/TS | MIT | 2026-09 | production | local graph of matches, matches-of-matches and list authors; run **personalized** Monte Carlo PPR or a decaying walk ourselves | personalization support in its pagerank **[unverified]**; our own walk is about 50 lines |
| networkx | https://github.com/networkx/networkx | Py | BSD-3 | 3.7, 2026-09 | production | `pagerank(personalization=…)` for Sybil-reach simulation (T7) | — |
| **Vertex** | https://github.com/vertex-lab/crawler_v2 | Go | MIT | 2026-07 | production service | hosted PPR over the Nostr follow graph via a DVM: "whom to match" suggestions and a reputation hint for list authors | sends *who you are* to Vertex; pricing and API **[unverified]**; follow graph ≠ taste trust |
| @nostr-dev-kit/wot, nostr-wot | npm; https://github.com/nostr-wot/nostr-wot | TS | MIT | 2026 | early | follow-distance filters | — |
| GrapeRank | https://github.com/Pretty-Good-Freedom-Tech/graperank-nodejs | TS | **AGPL-3.0** | 2025-04 | WIP | pluggable interpreters (follows, mutes, reports) | AGPL; stale |
| MeritRank | https://github.com/ichorid/meritrank-python ; crate `meritrank` 0.4.0 | Py / Rust | **GPL-2.0** / MIT | 2024 | research | Sybil-tolerant PPR (DESIGN A15) | GPL-2.0 (if "only") is incompatible with Apache/GPL-3; stale; reimplement from the paper |
| go-eigentrust / OpenRank | https://github.com/Karma3Labs/go-eigentrust | Go | MIT | 2025-08 | production (Karma3) | — | EigenTrust is *global*; DESIGN rejects it for this purpose |

## 9. Feed recipes (T1, D1)

| Candidate | URL | Lang | License | Last | Maturity | Fit | Gotchas |
|---|---|---|---|---|---|---|---|
| **CEL: @marcbachmann/cel-js** | https://github.com/marcbachmann/cel-js | JS | MIT | 8.0.0, 2026-07 | active | non-Turing-complete expressions for filters and weights; no I/O by construction | one maintainer |
| CEL: @bufbuild/cel | https://github.com/bufbuild/cel-es (npm) | TS | Apache-2.0 | 0.6.1, 2026-08 | pre-1.0, Buf-backed | same, with conformance focus | pre-1.0 |
| json-logic-js | https://github.com/jwadhams/json-logic-js | JS | MIT | 2.0.5, 2024-07 | stable, small | pure-JSON rules, easy to render in a UI editor | weaker typing; Python ports are old |
| JSONata | https://github.com/jsonata-js/jsonata | JS | MIT | 2.2.2, 2026-07 | production | transformation language | more expressive, so harder to audit |
| quickjs-emscripten | https://github.com/justjake/quickjs-emscripten | TS | MIT (npm) | 0.32.0, 2026-02 | production | **WASM tier**: run recipe JS with memory and time limits and no host functions | sandbox escapes are possible (D1); must expose no network, storage or clock |
| @sebastianwessel/quickjs | https://github.com/sebastianwessel/quickjs | TS | MIT | 3.1.0, 2026-06 | active | friendlier QuickJS sandbox wrapper | defaults may enable fetch or fs; lock them down **[check]** |
| Extism | https://github.com/extism/extism, https://github.com/extism/js-sdk | Rust / TS | BSD-3 | core 2026-10; **JS SDK stuck at 2.0.0-rc13 (2025-05)** | — | polyglot WASM plugins | JS SDK stagnant |
| wasmtime | https://github.com/bytecodealliance/wasmtime | Rust | Apache-2.0 | 2026-10 | production | desktop/server only | not in browser |
| Endo/SES | https://github.com/endojs/endo | JS | Apache-2.0 | 2026-10 | production (Agoric, MetaMask Snaps) | hardened JS compartments | same-process isolation, weaker than WASM |
| Bluesky feed-generator | https://github.com/bluesky-social/feed-generator | TS | MIT | 2026-09 | production | the *skeleton* interface: a recipe returns ordered IDs and the client hydrates them | server-side design; copy the interface only |
| nostrdvm | https://github.com/believethehype/nostrdvm | Py | MIT | 1.1.8, 2026-09 | active | NIP-90 DVM framework, if we offer opt-in *public* recipe services | DVMs see the request; never send private history |

**Pick for D1:** declarative by default. A recipe is a signed JSON document with weights, filters and slot shares, where filters and weights are written in CEL. A QuickJS tier can come later, behind a warning. No Graze or Skylight source was found, so the recipe format is ours.

## 10. Differential privacy and private analytics

| Candidate | URL | Lang | License | Last | Maturity | Fit | Gotchas |
|---|---|---|---|---|---|---|---|
| **OpenDP** | https://github.com/opendp/opendp | Rust / Python | MIT (repo LICENSE) | 0.16.0, 2026-10 | production (Harvard); unvetted parts gated as "contrib" **[prior knowledge]** | choose and validate circle noise parameters; simulate T3 | no TS binding; on-device noise must be our own TS (discrete mechanisms) |
| Tumult Analytics / Core | https://github.com/opendp/tumult-analytics | Py | Apache-2.0 | 0.21.0, 2026-06 | production (moved under OpenDP) | aggregate creator stats server-side | Spark-based |
| Google DP / PyDP | https://github.com/google/differential-privacy, https://github.com/OpenMined/PyDP | Go/C++/Java / Py | Apache-2.0 | 2026 | production | alternative | — |
| **Janus** (DAP aggregator) | https://github.com/divviup/janus | Rust | MPL-2.0 | janus_client 0.7.143, 2026-10 | runs Divvi Up (Firefox); README says "**Experimental** implementation" | creator reach counts (C6, T14) | two non-colluding operators needed (D3) |
| libprio-rs | https://github.com/divviup/libprio-rs | Rust | MPL-2.0 (+ Apache/MIT parts) | 0.18.1, 2026-09 | production | Prio3 VDAFs | — |
| divviup-ts | https://github.com/divviup/divviup-ts | TS | MPL-2.0 | repo 2026-09; **npm @divviup/dap 0.9.1 (2024-11)** | client SDK | upload reports from the PWA | npm lags the repo; check DAP draft version compatibility |
| Divvi Up service | https://divviup.org | — | — | ©2026; Firefox and Horizontal listed | production | hosted 2nd aggregator (D3 option) | pricing by contact |
| cloudflare/daphne | https://github.com/cloudflare/daphne | Rust | BSD-3 | **archived** | — | — | avoid |

## 11. Transport and metadata privacy

| Candidate | URL | Lang | License | Last | Maturity | Fit | Gotchas |
|---|---|---|---|---|---|---|---|
| **nostr-rs-relay** | https://github.com/scsibug/nostr-rs-relay (mirror of sr.ht) | Rust | MIT | 2026-05 | production | simple self-hosted relay | — |
| **strfry** | https://github.com/hoytech/strfry | C++ | GPL-3.0 | 2026-09 | production, high-performance; negentropy | big public relay | GPL is fine for an unmodified separate server |
| khatru | Go module `fiatjaf.com/nostr/khatru` (GitHub repo archived 2026-01-24) | Go | Unlicense | — | production | custom relay policies (rate limits, kind filters, auth) | moved, with small API breaks |
| **ohttp-ts** | https://github.com/thibmeu/ohttp-ts | TS | MIT | 0.6.1, 2026-09-30 | early, active | OHTTP client encapsulation in the browser (S2) | **Nostr relays speak WebSocket, so we must build an OHTTP gateway target that publishes to or queries relays**; subscriptions become polling |
| martinthomson/ohttp | https://github.com/martinthomson/ohttp | Rust | MIT OR Apache-2.0 | 0.8.0, 2026-07 | production (Firefox) | gateway-side library | — |
| Cloudflare privacy-gateway-server-go / -relay | https://github.com/cloudflare/privacy-gateway-server-go, https://github.com/cloudflare/privacy-gateway-relay | Go / JS (Workers) | BSD-3 | 2026 | production | ready gateway and relay pair | relay and gateway must be **different operators** |
| Arti (Tor in Rust) | gitlab.torproject.org/tpo/core/arti; crate `arti-client` 0.47.0 | Rust | MIT OR Apache-2.0 | 2.6.0, 2026-09 | production client; relay role unfinished | Tor for the desktop (Tauri) and maybe Android build | no browser; blocked in some states |
| Nym mix-fetch / SDK | https://github.com/nymtech/nym | Rust / TS | libs Apache-2.0/MIT; apps GPL-3 | mix-fetch 3.0.0, 2026-10 | production network; TS SDK had an outage notice **[status unclear]** | mixnet option (S3) for the PWA | latency; depends on the Nym network |
| iroh | https://github.com/n0-computer/iroh | Rust | MIT OR Apache-2.0 | 1.3.0, 2026-09 | production (1.x) | future direct device-to-device transport | exposes IPs to peers |

## 12. Local storage, sync and encryption at rest (T9)

| Candidate | URL | Lang | License | Last | Maturity | Fit | Gotchas |
|---|---|---|---|---|---|---|---|
| **@sqlite.org/sqlite-wasm** | https://github.com/sqlite/sqlite-wasm | C/JS | Apache-2.0 wrapper; SQLite public domain | 3.54.1, 2026-10-19 | official | history, sketches and the candidate cache in OPFS; pairs with sqlite-vec | OPFS needs a worker; no built-in encryption, so encrypt rows or columns |
| wa-sqlite | https://github.com/rhashimoto/wa-sqlite | JS | MIT | repo 2026-10; **npm 1.0.0 (2024)** | mature | custom VFS (e.g. encrypting VFS) | consume from Git |
| Dexie | https://github.com/dexie/Dexie.js | TS | Apache-2.0 | 4.4.6, 2026-09 | production | simpler IndexedDB; NDK has a Dexie cache | — |
| NDK cache-sqlite-wasm / cache-dexie | npm | TS | MIT | 2026-02 | beta | caches relay events | — |
| Evolu | https://github.com/evoluhq/evolu | TS | MIT | 2026-10 | active | local-first SQLite with E2E-encrypted sync, for **multi-device sync of your own history** | its sync server sees ciphertext and timing |
| Automerge / Yjs / Jazz | https://github.com/automerge/automerge, https://github.com/yjs/yjs, https://github.com/garden-co/jazz | Rust+JS / JS / Rust+TS | MIT | 2026-10 | production | CRDT device sync, if needed | not needed for v1 |
| libsodium.js | https://github.com/jedisct1/libsodium.js | JS/WASM | ISC | 0.8.4, 2026-04 | production | secretbox for at-rest records | — |
| noble-ciphers | https://github.com/paulmillr/noble-ciphers | TS | MIT | 2.4.0, 2026-08 | audited (per README) | pure-TS XChaCha20-Poly1305 | — |
| SQLCipher | https://github.com/sqlcipher/sqlcipher | C | BSD-3 | 2026-10 | production | native builds (Capacitor or Tauri SQLite plugins) | plugin support per platform **[unverified]** |

Browsers have no OS keystore. The best available option is a non-extractable WebCrypto key in IndexedDB, optionally unlocked through a passkey. Capacitor and Tauri builds can use Keychain or Keystore through native plugins.

## 13. Moderation and labelers (T18)

| Candidate | URL | Lang | License | Last | Maturity | Fit | Gotchas |
|---|---|---|---|---|---|---|---|
| NIP-32 labels / NIP-56 reports | https://github.com/nostr-protocol/nips | spec | — | 2026-10 | in use (Coracle, Ditto **[unverified]**) | subscribe to labeler pubkeys and apply on-device | **no open-source Nostr labeler service found**; we build a small one or reuse ROOST tools behind it |
| Ozone | https://github.com/bluesky-social/ozone | TS (Next.js) | MIT OR Apache-2.0 | 2026-10 | production (Bluesky) | the model for "subscribable labelers"; reuse UI ideas | atproto-specific |
| ROOST coop | https://github.com/roostorg/coop | TS | Apache-2.0 | 2026-10 | early-production (diVine forked it) | review queues and enforcement for a labeler service | — |
| ROOST osprey | https://github.com/roostorg/osprey | Py | Apache-2.0 | 2026-10 | production (from Discord **[unverified]**) | rules engine for spam and abuse signals | — |
| Meta ThreatExchange: PDQ, vPDQ, TMK, HMA | https://github.com/facebook/ThreatExchange | C++/Py | BSD (per mirror README) **[verify LICENSE]** | 2026-10-19 | production | perceptual hashing for instance operators and labelers | hash *lists* (e.g. CSAM) need partner access; Thorn Safer and PhotoDNA are not OSS |
| pdqhash-python, pdq-wasm | https://github.com/faustomorales/pdqhash-python, npm `pdq-wasm` | Py / WASM | MIT / BSD-3 | 2025 | small | bindings | — |

## 14. Supply chain and distribution (T13, T17)

| Candidate | URL | License | Fit |
|---|---|---|---|
| Sigstore cosign / sigstore-js / sigstore-python | https://github.com/sigstore/cosign | Apache-2.0 | keyless signing of release artifacts and npm provenance |
| SLSA GitHub generator | https://github.com/slsa-framework/slsa-github-generator | Apache-2.0 | build provenance attestations |
| in-toto | https://github.com/in-toto/in-toto | Apache-2.0 | two-person release layout (T13 "two-person sign-off") |
| F-Droid reproducible builds | https://f-droid.org/docs/Reproducible_Builds/ | — (fdroidserver AGPL, tool only) | F-Droid publishes our **developer-signed APK** only if its rebuild matches (`Binaries:` and `AllowedAPKSigningKeys`) |
| diffoscope | PyPI `diffoscope` | GPL-3+ (tool) | debug non-reproducible builds |
| gitleaks | https://github.com/gitleaks/gitleaks | MIT | secret scanning in CI |
| Reference | Amber documents a reproducible Android build and GPG-signed releases | — | a template to copy |

---

## License compatibility

### How each license affects us

| License | Where we meet it | Effect |
|---|---|---|
| **AGPL-3.0** | PeerTube server, Sepia search-index, `@peertube/peertube-types`, `@peertube/embed-api`, whitenoise and whitenoise-rs, GrapeRank, FreeTube, PeerTube-browser, fdroidserver (tool) | **Calling PeerTube's REST API over the network does not make our app a derivative work.** AGPL duties apply to *modified versions we run as a network service* (publish the source) and to code we *copy or link*. Running unmodified Sepia or PeerTube servers is fine. **Do not import AGPL npm packages (peertube-types, embed-api) or copy White Noise code into a non-AGPL client.** OpenAPI-generated types from an AGPL-labelled spec are a grey area: either hand-write the few types we need or get legal advice. |
| **GPL-3.0** | strfry, NewPipe, LibreTube, Framasoft mobile app, Fedilab, zap-stream-core, Nym apps, diffoscope | Fine as separate programs or servers. Forking a GPL client makes our app GPL-3. **Apple's App Store terms are widely considered incompatible with GPL-3/AGPL-3 distribution [prior knowledge]**, which matters because the design depends on iOS via app stores. |
| **GPL-2.0** | meritrank-python | If "only", it is incompatible with Apache-2.0 and with GPL-3. Use it for simulation only, or reimplement. |
| **MPL-2.0** | divine-web/divine-mobile, Janus, libprio-rs, divviup-ts | File-level copyleft. Modified MPL files stay MPL with source available; the rest of the app can be any license. Compatible with Apache, MIT and (A)GPL. Generally App Store-compatible. |
| **Apache-2.0 / MIT / BSD / ISC / Unlicense** | almost everything else (NDK, nostr-tools, Marmot MDK/ts, OpenMLS, ts-mls, PSI, hls.js, Video.js, Tauri, Capacitor, OpenDP, ohttp, Arti, sqlite-wasm…) | Keep notices; Apache-2.0 includes a patent grant. No constraints on our license. |
| **Non-OSI / source-available** | **Grayjay** (FUTO "Source First"; non-commercial; no modified redistribution) | **Do not fork or copy.** |
| **Unknown / undetected** | nsec.app/noauth, nos2x, igloo-desktop, frost2x, `@nostrify/*` (npm metadata), paulmillr/nip44 repo, Amber (MIT vs Apache badge) | Check the LICENSE file before vendoring any code. Using them as *external* signers (a separate app or extension) has no license impact. |
| **Model weights** | transformers.js embedding models | Each model has its own license; pick an Apache- or MIT-licensed model **[check per model]**. |

### Suggested license for this project

The project has three kinds of deliverable, and each can take a different license.

| Option | Protocol specs, SDK packages (match protocol, recipe schema, ranker) | Client app | Servers we run (bridge, labeler, OHTTP shim) | Pros | Cons |
|---|---|---|---|---|---|
| **A. Recommended: split** | **Apache-2.0** (or MIT OR Apache-2.0) | **MPL-2.0** | **AGPL-3.0** | Other clients (Amethyst, nostube, PeerTube plugins) can adopt the protocol freely. The client stays open file by file and ships on the App Store. Server forks must share changes. Can absorb divine-web code. | Three licenses to explain; contributors need a clear per-directory LICENSE |
| B. All Apache-2.0 | Apache-2.0 | Apache-2.0 | Apache-2.0 | Simplest; maximum adoption; patent grant; App Store OK | A closed fork could ship a tracking variant under our name. Mitigate with a trademark policy and reproducible builds rather than copyleft. |
| C. All AGPL-3.0 (like PeerTube) | AGPL | AGPL | AGPL | Ideological match with PeerTube and White Noise; can reuse whitenoise-rs and GrapeRank code | App Store problems; discourages other clients from adopting the protocol; can't reuse divine-web's MPL code without care **[MPL→GPL is allowed by MPL's secondary-license clause unless marked "Incompatible With Secondary Licenses"]** |
| D. GPL-3.0 app + Apache SDK | Apache-2.0 | GPL-3.0 | AGPL-3.0 | Strong copyleft on the app; NewPipe/Fedilab-style | App Store issue as in C |

Whatever we pick, use the **DCO** (not a CLA) so the project can never be relicensed closed, and register a trademark policy for the app name. The trademark is what stops malicious look-alike builds; the license does not.

---

## What we still have to build ourselves

Ordered by ship order in DESIGN.md.

1. **Taste-list event format.** Use NIP-51 lists if they fit, plus per-entry `sponsored`/`affiliated` tags, track-record weighting and list-share caps (T8, T16). Small spec plus code.
2. **PeerTube→Nostr catalog bridge or indexer.** Crawl via the REST API or Sepia, publish or resolve NIP-71 events with an `origin` tag, and keep stable video IDs across mirrored instances. No existing bridge was found.
3. **On-device ranker.** User-kNN over sketches, explore-slot allocator, per-creator exposure caps and popularity calibration, an explanation generator ("because Match X endorsed…"), and recipe evaluation glue.
4. **Recipe schema and editor.** JSON plus CEL, signing, a UI, and a test corpus of hostile recipes (T1).
5. **Match protocol state machine.**
   - Messages: preview request, accept, PSI rounds over NIP-17, consent options, sketch build, exchange, expiry and renewal.
   - Safety: nonces and epochs (T15), rate limits and minimum set size (T2), silent pause and exclusions (T4).
   - Keys: per-match key derivation and rotation (T10).
6. **Sketch format.** Fixed-size padding, a fixed send schedule and cover traffic (T5).
7. **OHTTP → relay gateway target.** An HTTP endpoint behind a Cloudflare-style gateway that publishes and queries Nostr relays.
8. **Circle aggregation layer** inside MLS:
   - secure aggregation or threshold reveal
   - discrete DP noise in TS
   - fixed membership per round and an epoch delay
   - dropout handling (T3)
   
   No library does this; use OpenDP in Python to pick parameters.
9. **Personalized trust walk** (PPR / TrustWalker-style) with DSybil-style per-source feedback weights (T7), plus a Vertex client as an optional hint.
10. **Labeler subscription** on-device (NIP-32), plus a small labeler service (ROOST coop or osprey can sit behind it).
11. **Encrypted local store.** WebCrypto/libsodium record encryption, retention windows and a fast wipe (T9).
12. **Creator analytics.** DAP task definitions, client upload (divviup-ts) and operator agreements (D3).
13. **Simulation harness** (Python): implicit, recommenders, networkx, OpenDP and openmined.psi, plus nostr-sdk for protocol-level bots (T2, T3, T7, explore-slot share, Gini).
14. **Native glue (later):** Capacitor and Tauri plugins for the keystore and for MDK (UniFFI), if we take the audited Rust MLS path.
15. **Release pipeline:** reproducible web and Android builds, Sigstore/SLSA provenance, F-Droid metadata and in-toto two-person sign-off.

## Corrections this research suggests for other docs

- **THREAT_MODEL.md, Process step 2,** lists "OpenMined PSI" among audited primitives. Its README makes no audit claim. Also, "NIP-44 implementations covered by the Cure53 audit" means paulmillr/nip44 specifically, so confirm that nostr-tools ships the same code.
- **DESIGN.md "Building blocks"** lists "Automerge or iroh". For v1, only device-local SQLite is needed. Evolu or Automerge are for optional multi-device sync later.
