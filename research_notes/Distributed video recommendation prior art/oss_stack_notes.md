# OSS stack research: raw notes

Date: 2026-10-19. Companion to `docs/OSS_STACK.md`. These are working notes, not a polished document.

## Method and provenance

- **GitHub repo metadata** (language, license as detected, stars, last push, archived flag) comes from the ecosyste.ms API (`https://repos.ecosyste.ms/api/v1/hosts/GitHub/repositories/OWNER%2FREPO`), queried on 2026-10-19. The detected license can read `other` or `None` when GitHub's detector fails. I resolved those against npm or crates metadata, or the repo page, where noted.
- **Package metadata** comes from registry.npmjs.org, pypi.org/pypi/NAME/json and crates.io/api/v1/crates/NAME, all queried on 2026-10-19.
- **Qualitative facts** (maturity warnings, features, audits) come from WebFetch of the repo or project page, or from WebSearch results. Each one is marked with its source below.
- **[unverified]** marks anything I did not confirm from a primary page or registry.
- I used no GitHub MCP tools.
- A not-found lookup means the guessed owner/repo name was wrong. It does not mean the project doesn't exist. Not-found names are listed at the end so nobody re-guesses them.

## Key qualitative findings (with sources)

### Client shells
- **divine-web** (https://github.com/divinevideo/divine-web): MPL-2.0. Built on React 18, TypeScript, Vite, Tailwind, Radix/shadcn, react-router v6 and `@nostrify/react` with TanStack Query. Login uses `@divinevideo/login` (MIT) with the Keycast remote signer. Publishes NIP-71 kind 34236 (addressable short video). Plays MP4 and HLS with Blurhash placeholders. It is an installable PWA with an offline service worker. Moderation is backed by `moderation-api.divine.video`, plus age review and protected-minor settings. — WebFetch of the repo page.
  - `@nostrify/*` npm packages show no license field. **[license unverified]**
- **nostube** (https://github.com/flox1an/nostube): MIT. An npm-workspaces monorepo:
  - `apps/web`, plus `apps/site` (static Vite)
  - `packages/core` (a Nostr client and an HLS loader, no React) and `packages/widgets` (React)
  - a Tauri desktop wrapper
  - a Rust server with a relay, Blossom and admin
  
  The README does not say which Nostr library it uses or which NIP-71 kinds it handles. About 1,650 commits, 38 stars. — WebFetch.
- **zap.stream** (v0l, TypeScript, MIT): Nostr live streaming. Its server zap-stream-core is GPL-3.0.
- **PeerTube official mobile app** (Framasoft): source at https://framagit.org/framasoft/peertube/mobile-application, GPL-3.0-or-later. v2.3.0 landed on F-Droid on 2026-09-26. It is built in Flutter (per a Framablog post from 2024-12-10). F-Droid builds are "built and signed by the original developer" and checked against the source tarball. — f-droid.org/packages/org.framasoft.peertube, framablog.
- **Thorium** (sschueller/peertube-android): Kotlin, AGPL-3.0. Archived; last push 2024-08-01, last F-Droid release 1.12.2 (2022). Dead.
- **NewPipe**: Java, GPL-3.0, 40k stars, active. NewPipeExtractor (Java, GPL-3.0) has a PeerTube service and Sepia Search support (search result: NewPipeExtractor PR #495 "sepiasearch"). Only the Android, Java and GPL route fits it.
- **Fedilab**: hosted on Codeberg, GPL-3.0-only per F-Droid. A multi-protocol client for Mastodon, Pleroma, Friendica, Pixelfed and PeerTube. — fedilab.app, search snippet.
- **Grayjay** (FUTO): **not OSI open source**. FUTO calls its license "Source First". Per mirrors and isitreallyfoss.com, it limits use, modification and distribution to non-commercial purposes. The PeerTube *plugin* is reportedly GPL **[unverified]**. Its GitHub repos are read-only mirrors. Do not fork it; at most, read it for reference.
- **FreeTube**: Vue/Electron, AGPL-3.0. YouTube-focused, not PeerTube.
- **LibreTube** (libre-tube/LibreTube): Kotlin, GPL-3.0. YouTube/Piped only.
- **Tubular**: archived.
- **PeerTube-GTK**: a C GTK desktop client found on zff.dev mirrors. Canonical upstream and license **[unverified]**.
- **Tubefeeder**: not found in any lookup or search. **[unverified, omitted]**
- **satsdisco/videorelay** (https://github.com/satsdisco/videorelay): a YouTube-style front end that loads NIP-71 events. Seen in search results only. **[details unverified]**

### Video catalog and playback
- **PeerTube OpenAPI spec**: https://raw.githubusercontent.com/Chocobozzz/PeerTube/develop/support/doc/api/openapi.yaml. OpenAPI 3.0.3, info.version 8.3.0, license field AGPLv3.0. Shared video filter params: start, count, sort, nsfw, categoryOneOf, languageOneOf, tagsOneOf, tagsAllOf, isLocal, privacyOneOf. — WebFetch.
- **PeerTube REST rate limits** (defaults, admin-configurable): `/api/v1/*` allows 50 calls per 10 s; 429 responses carry X-RateLimit-* headers. — docs.joinpeertube.org/api-rest-reference.html
- **`@peertube/peertube-types`** (npm 8.3.1, 2026-09-28): **AGPL-3.0**. Importing it into a permissively licensed app raises a licensing question (see OSS_STACK.md).
- **`@peertube/embed-api`** (0.2.0, 2024-12): AGPL-3.0.
- **PyPI `peertube`** (1.1.1, 2025-09-23, MIT): auto-generated with openapi-python-client. Its project URLs are template placeholders (`tonkintaylor/YOUR_REPOSITORY`). Low trust; generate our own client instead.
- **Codegen tools**: openapi-typescript 7.13.0 plus openapi-fetch 0.17.0 (MIT, 2026-02), and @hey-api/openapi-ts 0.99.0 (MIT, 2026-06).
- **Sepia Search / search-index** (https://framagit.org/framasoft/peertube/search-index): AGPLv3, 623 commits, created 2020-02-13. The project page does not state its stack or API. **[stack and API compatibility unverified]** Framasoft invites forks. peertube.wtf reportedly uses the same index. — framablog, fedi.tips.
- **hls.js 1.7.3** (Apache-2.0 per npm; ecosyste.ms says "other").
- **video.js 10.1.0** (Apache-2.0 per npm, 2026-10-12): "Video.js v10".
- **Vidstack**: officially deprecated in favour of Video.js 10, with security fixes only until January 2028 (repo description).
- **shaka-player 5.3.1** (Apache-2.0; the repo now lives at shaka-project/shaka-player).
- **p2p-media-loader-core/-hlsjs 4.0.0** (Apache-2.0, 2026-08-19).
- **webtorrent 3.0.21** (MIT).

### Nostr SDKs and identity
- **rust-nostr has moved to the `nostrdevkit` GitHub org**: https://github.com/nostrdevkit/nostr (Rust, MIT, 677 stars, push 2026-10-15). — ecosyste.ms, WebFetch.
  - Its README says: "These libraries are in ALPHA state… will change in breaking ways."
  - Its NIP table marks 17, 44, 46, 59, 90, 32 and 56 as supported. NIP-71 is ❌.
  - Bindings live at https://github.com/nostrdevkit/nostr-sdk-ffi (Rust, MIT, push 2026-09-01). On PyPI, `nostr-sdk` is 0.45.1 (2026-08-19).
  - The JS bindings repo rust-nostr/nostr-sdk-js is ARCHIVED; npm @rust-nostr/nostr-sdk was last published 2025-11-06.
  - The older v0.36 release notes deprecated the separate `nostr-protocol` and other packages in favour of `nostr-sdk`.
- **NDK** (nostr-dev-kit/ndk, MIT): core package 3.0.3 (2026-02-23). — WebFetch.
  - Sub-packages: svelte, react, mobile (React Native), messages (NIP-17, plus "NIP-EE", i.e. MLS), sessions, wot, sync (NIP-77 negentropy), wallet and blossom.
  - Cache adapters: memory, dexie, redis, sqlite, sqlite-wasm (OPFS) and nostr.
  - Signers: private key, NIP-07 and NIP-46 (nsecBunker).
  - Supports NIP-90 DVMs.
  - Last GitHub push 2026-04-16. That is slower than nostr-tools, but the npm sub-packages shipped in 2026-02.
- **nostr-tools** (Unlicense, 2.25.2, 2026-09-04): has nip07, nip17, nip44, nip46 and nip59 modules, and depends only on @noble/@scure. — WebFetch.
- **Cure53 NIP-44 audit** (NOS-01, Nov–Dec 2023): scope was the spec plus the **paulmillr/nip44** reference implementations in JS/TS, Go and Rust. — PDF text extracted locally.
  - Ten findings, none exploitable. They include NOS-01-006, lack of forward secrecy (Medium), and NOS-01-005, missing range checks (Go, Medium).
  - **The audit was not of nostr-tools, NDK or rust-nostr directly.** nostr-tools' nip44 is presumably derived from paulmillr's code (same author family) **[unverified]**.
- **applesauce** (hzrd149): applesauce-core 6.2.0 and applesauce-signers 6.2.3, both MIT on npm (the repo license is undetected). marmot-ts depends on applesauce-core for its EventSigner type.
- **welshman** (coracle-social): MIT, 0.14.0-pre2, 2026-10-15. These are Coracle's libraries.
- **Python Nostr libraries**:
  - `nostr-sdk` (PyPI, rust-nostr bindings)
  - pynostr (holgern, MIT, 0.7.0, 2025-08)
  - monstr (MIT, 2024-07, WIP)
  - python-nostr (jeffthibault, MIT, last push 2024-08, stale)
  
  NIP-44 and NIP-17 support in pynostr and monstr is **[unverified]**. For Python simulation and DVM work, use `nostr-sdk`.
- **Amber** (greenart7c3/Amber): Kotlin, an Android NIP-55 signer with NIP-46 support. — WebFetch of the repo.
  - The sidebar says MIT but a README badge says Apache-2.0. **[conflicting]**
  - Its release badge reads "Stable". Releases are GPG-signed, and it documents a reproducible build.
  - Distributed via F-Droid, Zapstore and Obtainium.
- **nsec.app**: the front end is nostrband/noauth (TypeScript; ecosyste.ms detects no license; last push 2025-05-26), with server noauthd and library nostr-login (npm, MIT, 1.7.12, 2025-09). — search result citing a developer post.
  - Third parties call it beta.
  - noauth-enclaved (AWS Nitro) has not been audited, per its developer.
- **nos2x** (fiatjaf): a NIP-07 extension; ecosyste.ms detects no license **[unverified]**.
- **Alby lightning-browser-extension**: MIT, provides NIP-07.
- **FROSTR**: FROST threshold signing for Nostr keys. — WebFetch of the bifrost page.
  - bifrost (TypeScript, MIT, @frostr/bifrost 2.0.2, 2026-01-25) does k-of-n BIP-340 signing plus collaborative ECDH, over Nostr relays with ChaCha20-Poly1305. It has a security-model doc but **no audit claimed**, and 12 stars.
  - igloo-core (MIT, 0.2.4, 2025-10), igloo-desktop (license undetected), igloo-web (MIT), igloo-server (MIT) and frost2x (a NIP-07 extension, license undetected).
- **ZcashFoundation/frost**: Rust. Crate frost-secp256k1-tr 3.0.0 (MIT OR Apache-2.0, 2026-04-23) supports Taproot/BIP-340, so it is usable for Nostr keys. Audit status **[unverified in this session]**.
- **@cmdcode/frost**: MIT, 1.1.4, 2026-01.
- **Passkeys**: SimpleWebAuthn (MasterKale/SimpleWebAuthn, MIT, @simplewebauthn/browser 14.0.0, 2026-09). Two caveats about PRF:
  - A WebAuthn L3 co-editor (Tim Cappalli) warns against using PRF output as a data-encryption key, because a new authenticator yields a different key and lost passkeys mean lost data.
  - Cloud-synced passkeys move trust to the cloud account.
  
  — search results: lilting.ch, Bitwarden blog, stacker.news.
- **divinevideo/keycast**: Rust, MIT. A NIP-46 signing service.
- **kind-0/nsecbunkerd**: no license detected, push 2026-06.

### Encrypted groups (MLS / Marmot)
- **marmot-ts** (npm `@internet-privacy/marmot-ts` 0.7.0, published 2026-10-19, MIT). — WebFetch.
  - The README says "**Alpha** … Do not use in production yet."
  - Supports MIP-00 through MIP-03; MIP-04 (encrypted media) is in progress. Tracks Marmot v2.
  - Bundles a fork of ts-mls at `@internet-privacy/marmot-ts/mls`.
  - Depends on applesauce-core.
  - Runs in browser, Node 20+, Bun and Deno. React Native is not mentioned.
  - No audit is mentioned.
- **ts-mls** (LukaJCB, MIT, 1.6.4, 2026-08-28): aims to be a full RFC 9420 implementation with 19 ciphersuites, including ML-KEM and X-Wing. Its README says it "has not undergone a formal security audit". The only core dependency is @hpke/core. — WebFetch.
- **MDK** (marmot-protocol/mdk, Rust, MIT): crate mdk-core 0.8.0 (2026-05-04), GitHub push 2026-10-12.
  - Least Authority reviewed the Marmot protocol (MIPs 00–04) and audited whitenoise-rs. The final report is dated 2026-04-01 (from open_source_repos.md).
  - Whether MDK itself was in the audit scope is **[unverified]**. Inference: whitenoise-rs is built on MDK.
- **OpenMLS**: Rust, MIT, crate 0.9.1 (2026-10-07), about 1k stars.
- **whitenoise / whitenoise-rs**: AGPL-3.0. Use as reference only, unless the app is AGPL.

### PSI
- **@openmined/psi.js** (2.0.6, 2025-06-24, Apache-2.0): WASM build by default, with Node, web and worker targets. React Native needs a `crypto.getRandomValues` polyfill and a stubbed `global.document`. — npm/README via search.
- **Python** `openmined.psi` / `openmined-psi`: 2.0.6, same date.
- **The repo**: C++ core with C, Go, JS, Python and Rust bindings, built with Bazel. It supports Golomb Compressed Sets (the default), Bloom filters (false positives possible) or Raw. A `reveal_intersection` flag chooses cardinality-only or full intersection. The README states **no audit and no named security model**. The underlying ECDH-PSI is semi-honest in the literature **[inference]**. Last push 2026-09-20.
- **APSI** (Microsoft, C++, MIT), **private-join-and-compute** (Google, C++, Apache-2.0), **PETAce** (TikTok, Python, Apache-2.0, last push 2025-02) and **libPSI** (osu-crypto, C++, license "other", 2024-12): none has a JS or WASM binding I could find.

### On-device ranking / ML
- **disco-rec** (npm, ankane/disco-node, MIT, 0.3.0, 2026-04-17): "Recommendations for Node.js using collaborative filtering". Browser support **[unverified]**.
- **knn-recommender**: 3.0.0, from 2021. Stale.
- **@huggingface/transformers**: v4.3.1 (2026-10-06, Apache-2.0).
- **onnxruntime-web**: 1.30.0 (MIT).
- **@tensorflow/tfjs**: 4.22.0 (2024-10-21; the repo was last pushed 2026-06). Slowing.
- **sqlite-vec** (asg017, 0.1.9, MIT OR Apache-2.0): ships a WASM build (npm sqlite-vec-wasm-demo). The repo was last pushed 2026-05; its 0.1.x versions mark it pre-1.0.
- **@orama/orama**: 3.1.18 (Apache-2.0 on npm). Full-text plus vector search in the browser.
- **voy-search**: 0.6.3 (2023, stale).
- **hnswlib-wasm**: 0.8.2 (2023, stale).
- **Python**: implicit 0.7.3 (MIT, 2026-05), lightfm 1.17 (2023, repo 2024, stale), recbole 1.2.1 (2025-02), scikit-surprise 1.1.5 (2026-05), recommenders 1.2.1 (MIT, recommenders-team, repo push 2026-10-12), networkx 3.7 (BSD-3, 2026-09), faiss-cpu 1.15.1, sentence-transformers 6.1.0.

### Trust / Sybil
- **Vertex** (vertex-lab): crawler_v2 (Go, MIT, Monte Carlo PageRank). It is a hosted DVM service: "anyone can start processing the same requests and compete" (no lock-in). Pricing and API reference are not found **[unverified]**. — nobsbitcoin.
- **GrapeRank** (graperank-nodejs): TypeScript, AGPL-3.0, WIP, last push 2025-04.
- **MeritRank**:
  - meritrank-python is GPL-2.0 (the "or later" status is **[unverified]**), version 0.2.10 from 2024-02.
  - The Rust crate `meritrank` is 0.4.0 (MIT, 2024-03-05) with no repo link; vsradkevich/meritrank is MIT. Both look stale.
- **go-eigentrust** (Karma3Labs, Go, MIT, 2025-08) and openrank-sdk (Python, a wrapper over go-eigentrust): EigenTrust is global trust, which DESIGN.md explicitly rejects for this purpose.
- **graphology** 0.26.0 plus graphology-metrics 2.4.2 (MIT): pagerank. Personalized PageRank support in graphology-metrics is **[unverified]**; Monte Carlo PPR is about 50 lines to write ourselves.
- **@nostr-dev-kit/wot** 1.0.0 (MIT) and nostr-wot/nostr-wot (MIT, social-graph distance).

### Feed recipes / sandboxes
- **json-logic-js**: 2.0.5 (MIT, last release 2024-07; stable and small).
- **@marcbachmann/cel-js**: 8.0.0 (MIT, 2026-07). Zero-dependency CEL.
- **@bufbuild/cel**: 0.6.1 (Apache-2.0, 2026-08). Buf's CEL-ES, pre-1.0.
- **ChromeGG/cel-js**: ARCHIVED.
- **jsonata**: 2.2.2 (MIT).
- **json-rules-engine**: 7.3.1 (ISC).
- **quickjs-emscripten**: 0.32.0 (MIT, 2026-02). The npm license is MIT; ecosyste.ms says "other".
- **@sebastianwessel/quickjs**: 3.1.0 (MIT). A QuickJS sandbox with TypeScript support.
- **quickjs-ng**: MIT, active.
- **@extism/extism**: 2.0.0-rc13 has been stuck since 2025-05 (BSD-3). Extism core is active; the JS SDK is not.
- **wasmtime**: Apache-2.0. Server or desktop only, not browser.
- **endojs/endo**: SES, Apache-2.0. A hardened-JS compartment.
- **bluesky-social/feed-generator**: MIT. The skeleton pattern.
- **nostrdvm**: Python, MIT, PyPI 1.1.8 (2026-09).
- **Graze and Skylight**: no public source found (per open_source_repos.md).

### DP / private analytics
- **OpenDP**: the repo LICENSE is plain MIT (Harvard); crates.io shows "non-standard". PyPI opendp is 0.16.0 (2026-10-06). The library requires opting into "contrib" features for components that are not yet vetted **[from prior knowledge, unverified this session]**.
- **Tumult** now lives under the opendp org: opendp/tumult-analytics (Apache-2.0, push 2026-09) and opendp/tumult-core. PyPI tmlt.analytics is 0.21.0 (2026-06).
- **google/differential-privacy**: Apache-2.0, push 2026-10. **PyDP** (OpenMined): Apache-2.0, push 2026-05.
- **Janus** (divviup/janus, MPL-2.0): its repo description says "**Experimental** implementation of DAP". janus_client crate 0.7.143 (2026-10-14).
- **libprio-rs**: prio crate 0.18.1 (MPL-2.0 AND Apache-2.0 AND MIT).
- **divviup-ts** (MPL-2.0): the repo was pushed 2026-09, but npm @divviup/dap is 0.9.1 (2024-11) and @divviup/prio3 is 0.8.0 (2024-05). The npm packages lag behind.
- **cloudflare/daphne**: ARCHIVED.
- **Divvi Up service**: the site (©2026) names Mozilla Firefox and Horizontal as users, offers paid pilot pricing on contact, and has no public price list.
- **TS DP library**: none of note found. On-device noise for Circles has to be written ourselves; use discrete (geometric/Laplace) mechanisms to avoid floating-point attacks [inference].

### Transport / relays / OHTTP / anonymity
- **strfry**: C++, GPL-3.0, push 2026-09.
- **nostr-rs-relay**: Rust, MIT. GitHub is a mirror of sr.ht. Push 2026-05.
- **khatru**: the GitHub repo was ARCHIVED on 2026-01-24. Development moved to the Go module `fiatjaf.com/nostr/khatru`, which has small API breaks. — search result citing the repo README and pkg.go.dev.
- **OHTTP**:
  - ohttp-ts (thibmeu/ohttp-ts, npm 0.6.1, 2026-09-30, MIT): RFC 9458 plus a chunked extension. Runs in browser, Workers and Node. It only encapsulates; you make the fetches yourself.
  - oblivious-http (tinfoilanalytics, 0.1.3, 2024-12): a single ciphersuite.
  - chris-wood/ohttp-js: stale since 2023.
  - Rust: `ohttp` and `bhttp` crates 0.8.0 (martinthomson, MIT OR Apache-2.0).
  - Gateway and relay: cloudflare/privacy-gateway-server-go (BSD-3, push 2026-07) and cloudflare/privacy-gateway-relay (Workers, BSD-3).
  - HPKE: hpke-js / @hpke/core (MIT).
- **Arti**: crate `arti-client` 0.47.0 (MIT OR Apache-2.0, 2026-10-01), at gitlab.torproject.org/tpo/core/arti (the page returned 403 to WebFetch). Release 2.6.0 came out 2026-09-01. Onion-service client support has been done since 1.1.6 and hosting since 1.2.0; the relay role is still unfinished. — Tor blog via search.
  - An Alpine package page says GPL-3.0-or-later, which conflicts with crates.io. Trust crates.io.
  - No browser use.
- **Nym**:
  - Monorepo nymtech/nym: "applications and binaries are GPLv3; libraries … Apache 2.0 or MIT".
  - npm: @nymproject/mix-fetch 3.0.0 (2026-10-08, Apache-2.0), @nymproject/mix-tunnel 0.3.0, @nymproject/sdk 1.4.1 (2025-11).
  - One Nym docs page said the TypeScript SDK was temporarily broken by a network upgrade **[status unclear]**.
  - Rust: crate nym-sdk 1.21.6.
- **iroh**: 1.3.0 (MIT OR Apache-2.0, 2026-09-28).

### Local storage / sync / crypto at rest
- **@sqlite.org/sqlite-wasm**: 3.54.1-build1 (2026-10-19, Apache-2.0 wrapper; SQLite is public domain).
- **wa-sqlite**: the repo is MIT and active (2026-10), but the npm `wa-sqlite` 1.0.0 dates from 2024-01. Consume it from GitHub or a fork.
- **Dexie** 4.4.6 (Apache-2.0); **@automerge/automerge** 3.5.0 (MIT); **yjs** 13.6.33 (MIT); **jazz-tools** 0.20.19 (MIT); **@evolu/common** 8.23.2 (MIT).
- **powersync-js**: Apache-2.0, but it needs a PowerSync service.
- **libsodium-wrappers** 0.8.4 (ISC). **@noble/ciphers** and **@noble/curves** 2.4.0 (MIT). The noble repo descriptions say "Audited".
- **SQLCipher**: BSD-3 (community edition).
- **React Native options**: @op-engineering/op-sqlite 18.2.5 (MIT), expo-sqlite 58.0.13, and expo-secure-store 58.0.2.
- **Capacitor**: @capacitor-community/sqlite 8.1.1 (MIT). SQLCipher support in each of these is **[unverified]**.

### Moderation
- **Ozone**: dual MIT/Apache-2.0, atproto-specific, a Next.js UI plus labeling service, Docker self-hosting. — WebFetch.
- **ROOST**: roostorg/coop (TypeScript, Apache-2.0, push 2026-10-16), a review/queue/enforcement dashboard that diVine forked. roostorg/osprey (Python, Apache-2.0), a real-time safety rules engine.
- **facebook/ThreatExchange**: PDQ (photo), TMK+PDQF and vPDQ (video), HMA (Hasher-Matcher-Actioner) and python-threatexchange. BSD per a mirror's README (from 2021); ecosyste.ms says "other" **[verify LICENSE]**.
- **PDQ bindings**: pdqhash-python (MIT, 2025-05) and npm pdq-wasm (BSD-3, 0.3.9, 2025-11, small project).
- **NIP-32/NIP-56**: rust-nostr supports both. I found no dedicated open-source Nostr labeler service. Coracle and Ditto reportedly implement NIP-32 **[unverified]**.

### Supply chain
- **sigstore**: cosign (Go, Apache-2.0), sigstore-js (npm sigstore 5.0.0) and sigstore-python 4.5.0.
- **slsa-github-generator**: Apache-2.0, push 2026-08.
- **in-toto**: 3.1.0, Apache-2.0.
- **diffoscope**: 332, GPL-3+, a tool only.
- **fdroidserver**: 2.4.5, AGPL-3.0, a tool only.
- **F-Droid reproducible builds**: F-Droid rebuilds from source and publishes the *developer-signed* APK only if the build matches. Configure it with `Binaries:` and `AllowedAPKSigningKeys`. — f-droid.org/docs/Reproducible_Builds and the 2023-09-03 blog post.
- **gitleaks**: MIT, a secret scanner.

## Gotchas collected
1. **Hermes and WebAssembly (React Native/Expo).** Several key libraries are WASM: psi.js, sqlite-wasm, transformers.js, onnxruntime-web and quickjs-emscripten. React Native's default Hermes engine has historically lacked WebAssembly **[prior knowledge, verify for current RN/Hermes]**. A WebView-based shell (PWA, Capacitor, Tauri) avoids the problem. This is the main argument against Expo.
2. **Audited crypto paths differ by language.**
   - NIP-44: the audited code is paulmillr/nip44. nostr-tools is presumed to share it.
   - MLS: the audited stack is Rust (whitenoise-rs, and by inference MDK and OpenMLS). The TypeScript path (marmot-ts plus ts-mls) is alpha and unaudited.
   - PSI: OpenMined PSI states no audit.
   - THREAT_MODEL.md says "OpenMined PSI" is an audited primitive. That is **not supported** by its README.
3. **OHTTP and WebSockets.** OHTTP is request/response, while Nostr relays speak WebSocket. Using OHTTP for publishing needs an HTTP→relay shim (gateway target) that we build. Subscriptions over OHTTP become polling.
4. **AGPL type packages.** `@peertube/peertube-types` is AGPL-3.0. Generating types from openapi.yaml (also AGPLv3 per its info.license) raises the same question. For a non-AGPL app, either hand-write minimal types for the ~10 endpoints used, or get a legal opinion that API-interface types are not a derivative work.
5. **Archived or stale packages**: khatru (moved), rust-nostr nostr-sdk-js (archived), cloudflare/daphne (archived), ChromeGG/cel-js (archived), Vidstack (deprecated), Thorium (archived), voy and hnswlib-wasm (2023), tfjs (npm 2024), npm wa-sqlite (2024), and @divviup/dap on npm (2024).
6. **Grayjay is not open source.** Don't fork it.
7. **App Store and GPL.** Distributing GPL-3.0 or AGPL-3.0 apps through Apple's App Store is widely considered to conflict with the store's additional usage terms (VLC was pulled in 2011 over this) **[prior knowledge]**. MPL-2.0 is generally considered App Store-compatible **[prior knowledge]**. This matters if we fork the Framasoft mobile app (GPL-3.0) or adopt any AGPL client code.
8. **GPL-2.0-only.** meritrank-python is GPL-2.0, and if it is "only" it is incompatible with Apache-2.0 and with GPL-3.0. Use it for simulation only, or reimplement it from the paper.

## Raw metadata: GitHub repos (ecosyste.ms, 2026-10-19)

Columns: repo | language | detected license | stars | last push | archived | description

| Repo | Lang | License | Stars | Last push | Archived | Description |
|---|---|---|---|---|---|---|
| [Agoric/SES](https://github.com/Agoric/SES) | None | None | 362 | 2020-04-22 |  | MOVED to @agoric/ses-shim. SES (Secure EcmaScript) is a secure runtime for running third-party code safely |
| [ankane/disco-node](https://github.com/ankane/disco-node) | JavaScript | mit | 57 | 2026-06-27 |  | Recommendations for Node.js using collaborative filtering |
| [asg017/sqlite-vec](https://github.com/asg017/sqlite-vec) | C | apache-2.0 | 8195 | 2026-05-18 |  | A vector search SQLite extension that runs anywhere! |
| [automerge/automerge](https://github.com/automerge/automerge) | JavaScript | mit | 6668 | 2026-10-19 |  | A JSON-like data structure (a CRDT) that can be modified concurrently by different users, and merged again aut |
| [automerge/automerge-repo](https://github.com/automerge/automerge-repo) | TypeScript | mit | 715 | 2026-10-13 |  |  |
| [believethehype/nostrdvm](https://github.com/believethehype/nostrdvm) | Python | mit | 55 | 2026-09-12 |  | Framework to run NIP90 Nostr DVMs |
| [bellard/quickjs](https://github.com/bellard/quickjs) | C | other | 11028 | 2026-10-12 |  | Public repository of the QuickJS Javascript Engine. |
| [benfred/implicit](https://github.com/benfred/implicit) | Python | mit | 3831 | 2026-05-08 |  | Fast Python Collaborative Filtering for Implicit Feedback Datasets |
| [bluesky-social/feed-generator](https://github.com/bluesky-social/feed-generator) | TypeScript | mit | 2071 | 2026-09-25 |  | ATProto Feed Generator Starter Kit |
| [bluesky-social/ozone](https://github.com/bluesky-social/ozone) | TypeScript | other | 544 | 2026-10-14 |  | web interface for labeling content in atproto / Bluesky |
| [bytecodealliance/jco](https://github.com/bytecodealliance/jco) | TypeScript | apache-2.0 | 1011 | 2026-10-18 |  | JavaScript toolchain for working with WebAssembly Components |
| [bytecodealliance/wasm-tools](https://github.com/bytecodealliance/wasm-tools) | Rust | apache-2.0 | 1800 | 2026-10-12 |  |  CLI and Rust libraries for low-level manipulation of WebAssembly modules  |
| [bytecodealliance/wasmtime](https://github.com/bytecodealliance/wasmtime) | Rust | apache-2.0 | 18720 | 2026-10-14 |  | A lightweight WebAssembly runtime that is fast, secure, and standards-compliant |
| [Chocobozzz/PeerTube](https://github.com/Chocobozzz/PeerTube) | TypeScript | agpl-3.0 | 15367 | 2026-10-16 |  | ActivityPub-federated video streaming platform using P2P directly in your web browser |
| [chris-wood/ohttp-js](https://github.com/chris-wood/ohttp-js) | TypeScript | mit | 11 | 2023-06-13 |  | Oblivious HTTP Javascript implementation |
| [ChromeGG/cel-js](https://github.com/ChromeGG/cel-js) | TypeScript | mit | 125 | 2026-04-26 | ARCHIVED | cel-js is a  Common Expression Language (CEL) evaluator for JavaScript |
| [cloudflare/circl](https://github.com/cloudflare/circl) | Go | other | 1728 | 2026-09-28 |  | CIRCL: Cloudflare Interoperable Reusable Cryptographic Library |
| [cloudflare/daphne](https://github.com/cloudflare/daphne) | Rust | bsd-3-clause | 147 | 2026-04-24 | ARCHIVED | Implementation of DAP |
| [cloudflare/privacy-gateway-relay](https://github.com/cloudflare/privacy-gateway-relay) | JavaScript | bsd-3-clause | 38 | 2026-04-23 |  | A Oblivious HTTP ("OHTTP") Relay built on Cloudflare Workers. |
| [cloudflare/privacy-gateway-server-go](https://github.com/cloudflare/privacy-gateway-server-go) | Go | bsd-3-clause | 89 | 2026-07-10 |  | An Oblivious HTTP gateway |
| [coracle-social/coracle](https://github.com/coracle-social/coracle) | Svelte | mit | 367 | 2026-09-22 |  | An experimental Nostr client focused on unlocking the full potential of multiple relays. Browse, filter, zap,  |
| [coracle-social/welshman](https://github.com/coracle-social/welshman) | TypeScript | mit | 28 | 2026-10-12 |  | Tools by the guy who built Coracle |
| [dajiaji/hpke-js](https://github.com/dajiaji/hpke-js) | TypeScript | mit | 126 | 2026-09-02 |  | A Hybrid Public Key Encryption (HPKE) module built on top of Web Cryptography API. |
| [denikryt/PeerTube-browser](https://github.com/denikryt/PeerTube-browser) | Python | agpl-3.0 | 2 | 2026-10-13 |  | PeerTube Browser is a video discovery tool for the federated PeerTube network. It crawls instances, builds a l |
| [dexie/Dexie.js](https://github.com/dexie/Dexie.js) | TypeScript | apache-2.0 | 14646 | 2026-10-16 |  | A Minimalistic Wrapper for IndexedDB |
| [divinevideo/divine-mobile](https://github.com/divinevideo/divine-mobile) | Dart | mpl-2.0 | 266 | 2026-10-19 |  |  |
| [divinevideo/divine-web](https://github.com/divinevideo/divine-web) | TypeScript | mpl-2.0 | 50 | 2026-10-16 |  |  |
| [divinevideo/keycast](https://github.com/divinevideo/keycast) | Rust | mit | 6 | 2026-10-05 |  |  |
| [divviup/divviup-api](https://github.com/divviup/divviup-api) | Rust | mpl-2.0 | 10 | 2026-10-06 |  | Divvi Up Control Plane |
| [divviup/divviup-ts](https://github.com/divviup/divviup-ts) | TypeScript | mpl-2.0 | 5 | 2026-09-23 |  | TypeScript client for the Distributed Aggregation Protocol |
| [divviup/janus](https://github.com/divviup/janus) | Rust | mpl-2.0 | 69 | 2026-10-13 |  | Experimental implementation of the Distributed Aggregation Protocol (DAP) specification. |
| [divviup/libprio-rs](https://github.com/divviup/libprio-rs) | Rust | mpl-2.0 | 122 | 2026-10-01 |  | Implementation of Prio in Rust. |
| [endojs/endo](https://github.com/endojs/endo) | JavaScript | apache-2.0 | 1067 | 2026-10-15 |  | Endo is a distributed secure JavaScript sandbox, based on SES |
| [evoluhq/evolu](https://github.com/evoluhq/evolu) | TypeScript | mit | 1909 | 2026-10-18 |  | Local-first platform and TypeScript library |
| [expo/expo](https://github.com/expo/expo) | TypeScript | mit | 52797 | 2026-10-17 |  | An open-source framework for making universal native apps with React. Expo runs on Android, iOS, and the web. |
| [extism/extism](https://github.com/extism/extism) | Rust | bsd-3-clause | 5806 | 2026-10-09 |  | The framework for building with WebAssembly (wasm). Easily & securely load wasm modules, move data, call funct |
| [extism/js-sdk](https://github.com/extism/js-sdk) | TypeScript | bsd-3-clause | 137 | 2025-05-14 |  | Run Extism WebAssembly plug-ins / functions from JavaScript (supports major browsers, Node.js, Deno, Bun, and  |
| [extism/python-sdk](https://github.com/extism/python-sdk) | Python | bsd-3-clause | 47 | 2026-03-26 |  | Extism Python Host SDK - easily run WebAssembly modules / plugins from Python applications |
| [facebook/ThreatExchange](https://github.com/facebook/ThreatExchange) | C++ | other | 1401 | 2026-10-19 |  | Trust & Safety tools for working together to fight digital harms.  |
| [faustomorales/pdqhash-python](https://github.com/faustomorales/pdqhash-python) | Python | mit | 38 | 2025-05-28 |  | Python bindings for Facebook's PDQ hash |
| [fiatjaf/khatru](https://github.com/fiatjaf/khatru) | Go | unlicense | 137 | 2025-09-22 | ARCHIVED | a framework for making custom Nostr relays |
| [fiatjaf/nak](https://github.com/fiatjaf/nak) | Go | unlicense | 422 | 2026-10-08 |  | a command line tool for doing all things nostr |
| [fiatjaf/nos2x](https://github.com/fiatjaf/nos2x) | JavaScript | None | 395 | 2026-03-21 |  | nostr signer extension |
| [flox1an/nostube](https://github.com/flox1an/nostube) | TypeScript | mit | 38 | 2026-10-11 |  | Nostr based video platform |
| [FreeTubeApp/FreeTube](https://github.com/FreeTubeApp/FreeTube) | Vue | agpl-3.0 | 22045 | 2026-10-12 |  | An Open Source YouTube app for privacy |
| [FROSTR-ORG/bifrost](https://github.com/FROSTR-ORG/bifrost) | TypeScript | mit | 12 | 2026-02-16 |  | Core library for implementing the FROSTR signing protocol. |
| [FROSTR-ORG/frost2x](https://github.com/FROSTR-ORG/frost2x) | TypeScript | None | 12 | 2025-12-18 |  | Nostr signer extension, with the power of FROST. |
| [FROSTR-ORG/igloo-core](https://github.com/FROSTR-ORG/igloo-core) | TypeScript | mit | 1 | 2025-10-18 |  |  |
| [FROSTR-ORG/igloo-desktop](https://github.com/FROSTR-ORG/igloo-desktop) | TypeScript | None | 26 | 2026-02-05 |  | Frostr desktop signer and key management app. |
| [FROSTR-ORG/igloo-mobile](https://github.com/FROSTR-ORG/igloo-mobile) | None | mit | 0 | 2025-05-19 |  | A native mobile Frostr signing client built with... I haven't decided yet. |
| [FROSTR-ORG/igloo-server](https://github.com/FROSTR-ORG/igloo-server) | TypeScript | mit | 8 | 2026-05-28 |  | Lightweight self-hostable Frostr server & signing client |
| [FROSTR-ORG/igloo-web](https://github.com/FROSTR-ORG/igloo-web) | TypeScript | mit | 1 | 2026-03-08 |  | Simple Web Implementation of a FROSTR signer built with igloo-core |
| [futo-org/grayjay-android](https://github.com/futo-org/grayjay-android) | Kotlin | other | 1833 | 2026-10-16 |  | Read-only mirror of Grayjay repo for issue tracking |
| [futo-org/Grayjay.Desktop](https://github.com/futo-org/Grayjay.Desktop) | C# | other | 880 | 2026-09-25 |  | Read-only mirror of Grayjay.Desktop repo for issue tracking |
| [garden-co/jazz](https://github.com/garden-co/jazz) | Rust | mit | 207 | 2026-10-15 |  | A local-first relational database for the browser, React Native and your backend. |
| [getAlby/lightning-browser-extension](https://github.com/getAlby/lightning-browser-extension) | TypeScript | mit | 585 | 2026-10-17 |  | The Bitcoin Lightning Browser Extension that brings deep Lightning & Nostr integration to the web. Wallet inte |
| [gitleaks/gitleaks](https://github.com/gitleaks/gitleaks) | Go | mit | 30078 | 2026-09-30 |  | Find secrets with Gitleaks 🔑 |
| [google/cel-go](https://github.com/google/cel-go) | Go | apache-2.0 | 3 | 2026-09-10 |  |  |
| [google/differential-privacy](https://github.com/google/differential-privacy) | Go | apache-2.0 | 3368 | 2026-10-13 |  | Google's differential privacy libraries. |
| [google/private-join-and-compute](https://github.com/google/private-join-and-compute) | C++ | apache-2.0 | 857 | 2026-03-09 |  |  |
| [graphology/graphology](https://github.com/graphology/graphology) | JavaScript | mit | 1760 | 2026-09-02 |  | A robust & multipurpose Graph object for JavaScript & TypeScript. |
| [greenart7c3/Amber](https://github.com/greenart7c3/Amber) | Kotlin | mit | 355 | 2026-10-13 |  |  |
| [holgern/pynostr](https://github.com/holgern/pynostr) | Python | mit | 78 | 2025-08-07 |  | Python library for nostr |
| [hoytech/strfry](https://github.com/hoytech/strfry) | C++ | gpl-3.0 | 732 | 2026-09-04 |  | a nostr relay |
| [huggingface/transformers.js](https://github.com/huggingface/transformers.js) | JavaScript | apache-2.0 | 16342 | 2026-10-11 |  | State-of-the-art Machine Learning for the web. Run 🤗 Transformers directly in your browser, with no need for a |
| [hzrd149/applesauce](https://github.com/hzrd149/applesauce) | TypeScript | None | 50 | 2026-09-06 |  | A collection of tools for building nostr web clients |
| [hzrd149/blossom](https://github.com/hzrd149/blossom) | None | unlicense | 266 | 2026-04-22 |  | Blobs stored simply on mediaservers |
| [hzrd149/blossom-server](https://github.com/hzrd149/blossom-server) | TypeScript | mit | 76 | 2026-09-28 |  | A blossom server written in Deno |
| [hzrd149/nostrudel](https://github.com/hzrd149/nostrudel) | TypeScript | mit | 222 | 2026-10-05 |  | A sandbox for exploring nostr |
| [ichorid/meritrank-python](https://github.com/ichorid/meritrank-python) | Python | gpl-2.0 | 4 | 2024-06-19 |  | MeritRank decentralized subjective social ranking algorithm - python microservice |
| [in-toto/in-toto](https://github.com/in-toto/in-toto) | Python | other | 1051 | 2026-08-27 |  | in-toto is a framework to protect supply chain integrity. |
| [ionic-team/capacitor](https://github.com/ionic-team/capacitor) | TypeScript | mit | 16865 | 2026-10-14 |  | Build cross-platform Native Progressive Web Apps for iOS, Android, and the Web ⚡️ |
| [jedisct1/libsodium](https://github.com/jedisct1/libsodium) | C | other | 13986 | 2026-10-12 |  | A modern, portable, easy to use crypto library. |
| [jedisct1/libsodium.js](https://github.com/jedisct1/libsodium.js) | HTML | other | 1159 | 2026-09-25 |  | libsodium compiled to Webassembly and pure JavaScript, with convenient wrappers. |
| [jeffthibault/python-nostr](https://github.com/jeffthibault/python-nostr) | Python | mit | 280 | 2024-08-14 |  | A Python library for Nostr |
| [justjake/quickjs-emscripten](https://github.com/justjake/quickjs-emscripten) | TypeScript | other | 1728 | 2026-07-23 |  | Safely execute untrusted Javascript in your Javascript, and execute synchronous code that uses async functions |
| [jwadhams/json-logic-js](https://github.com/jwadhams/json-logic-js) | JavaScript | mit | 1485 | 2024-07-09 |  | Build complex rules, serialize them as JSON, and execute them in JavaScript |
| [Karma3Labs/go-eigentrust](https://github.com/Karma3Labs/go-eigentrust) | Go | mit | 11 | 2025-08-31 |  | EigenTrust implementation in Go |
| [Karma3Labs/openrank-sdk](https://github.com/Karma3Labs/openrank-sdk) | Python | None | 7 | 2024-09-02 |  |  |
| [kind-0/nsecbunkerd](https://github.com/kind-0/nsecbunkerd) | None | None | 143 | 2026-06-02 |  | Coinbase for nostr |
| [libre-tube/LibreTube](https://github.com/libre-tube/LibreTube) | Kotlin | gpl-3.0 | 12838 | 2026-10-17 |  | An alternative frontend for YouTube, for Android. |
| [LukaJCB/ts-mls](https://github.com/LukaJCB/ts-mls) | TypeScript | mit | 109 | 2026-10-03 |  | A Messaging Layer Security (RFC 9420, MLS) implementation in TypeScript  |
| [lyst/lightfm](https://github.com/lyst/lightfm) | Python | apache-2.0 | 5116 | 2024-07-24 |  | A Python implementation of LightFM, a hybrid recommendation algorithm. |
| [marcbachmann/cel-js](https://github.com/marcbachmann/cel-js) | JavaScript | mit | 200 | 2026-10-05 |  | A lightweight, zero-dependency implementation of the Common Expression Language (CEL) in JavaScript. |
| [marmot-protocol/marmot](https://github.com/marmot-protocol/marmot) | None | mit | 141 | 2026-10-08 |  | The Marmot Protocol is a messaging protocol that specifies how to do efficient end-to-end encrypted group mess |
| [marmot-protocol/marmot-ts](https://github.com/marmot-protocol/marmot-ts) | TypeScript | mit | 25 | 2026-10-05 |  | TypeScript implementation of the Marmot protocol |
| [marmot-protocol/marmots-web-chat](https://github.com/marmot-protocol/marmots-web-chat) | TypeScript | None | 4 | 2026-06-29 |  | A references implementation of marmoTS |
| [marmot-protocol/mdk](https://github.com/marmot-protocol/mdk) | Rust | mit | 67 | 2026-10-12 |  | Marmot Development Kit |
| [marmot-protocol/whitenoise](https://github.com/marmot-protocol/whitenoise) | Dart | agpl-3.0 | 75 | 2026-05-25 |  | The White Noise Flutter App |
| [marmot-protocol/whitenoise-rs](https://github.com/marmot-protocol/whitenoise-rs) | Rust | agpl-3.0 | 449 | 2026-06-27 |  | The Rust brain for the White Noise app |
| [martinthomson/ohttp](https://github.com/martinthomson/ohttp) | Rust | apache-2.0 | 64 | 2026-09-08 |  | Rust library for encapsulating HTTP messages in a cryptographic wrapper |
| [MasterKale/SimpleWebAuthn](https://github.com/MasterKale/SimpleWebAuthn) | TypeScript | mit | 2365 | 2026-10-11 |  | WebAuthn, Simplified. A collection of TypeScript-first libraries for simpler WebAuthn integration. Supports mo |
| [microsoft/APSI](https://github.com/microsoft/APSI) | C++ | mit | 214 | 2026-10-02 |  | APSI is a C++ library for Asymmetric (unlabeled or labeled) Private Set Intersection. |
| [microsoft/onnxruntime](https://github.com/microsoft/onnxruntime) | C++ | mit | 22113 | 2026-10-18 |  | ONNX Runtime: cross-platform, high performance ML inferencing and training accelerator |
| [microsoft/SEAL](https://github.com/microsoft/SEAL) | C++ | mit | 4054 | 2026-10-14 |  | Microsoft SEAL is an easy-to-use and powerful homomorphic encryption library. |
| [monty888/monstr](https://github.com/monty888/monstr) | Python | mit | 49 | 2024-07-16 |  | python library for nostr WIP |
| [nbd-wtf/nostr-tools](https://github.com/nbd-wtf/nostr-tools) | TypeScript | unlicense | 854 | 2026-09-30 |  | Tools for developing Nostr clients. |
| [networkx/networkx](https://github.com/networkx/networkx) | Python | other | 17332 | 2026-10-16 |  | Network Analysis in Python |
| [NicolasHug/Surprise](https://github.com/NicolasHug/Surprise) | Python | bsd-3-clause | 6820 | 2026-05-30 |  | A Python scikit for building and analyzing recommender systems |
| [nmslib/hnswlib](https://github.com/nmslib/hnswlib) | C++ | apache-2.0 | 5352 | 2026-09-15 |  | Header-only C++/python library for fast approximate nearest neighbors |
| [nostr-dev-kit/ndk](https://github.com/nostr-dev-kit/ndk) | TypeScript | mit | 452 | 2026-04-16 |  | Nostr Development Kit with outbox-model support |
| [nostr-protocol/nips](https://github.com/nostr-protocol/nips) | None | None | 3120 | 2026-10-17 |  | Nostr Implementation Possibilities |
| [nostr-wot/nostr-wot](https://github.com/nostr-wot/nostr-wot) | MDX | mit | 8 | 2026-10-12 |  | Nostr Web of Trust toolkit - query social graph distance between any pubkeys. Includes browser extension for c |
| [nostrband/noauth](https://github.com/nostrband/noauth) | TypeScript | None | 115 | 2025-05-26 |  | Noauth Nostr key manager. |
| [nostrband/noauth-enclaved](https://github.com/nostrband/noauth-enclaved) | TypeScript | mit | 0 | 2025-04-02 |  |  |
| [nostrdevkit/nostr](https://github.com/nostrdevkit/nostr) | Rust | mit | 677 | 2026-10-15 |  | Rust implementation of the nostr protocol, high-level client library, Nostr Wallet Connect and more. |
| [nostrdevkit/nostr-sdk-ffi](https://github.com/nostrdevkit/nostr-sdk-ffi) | Rust | mit | 19 | 2026-09-01 |  | Nostr SDK  - Native language bindings |
| [Novage/p2p-media-loader](https://github.com/Novage/p2p-media-loader) | TypeScript | apache-2.0 | 1727 | 2026-10-13 |  | An open-source engine for P2P streaming of live and on demand video directly in a web browser HTML page |
| [nymtech/nym](https://github.com/nymtech/nym) | Rust | None | 1969 | 2026-10-09 |  | Nym provides strong network-level privacy against sophisticated end-to-end attackers, and anonymous transactio |
| [nymtech/nym-vpn-client](https://github.com/nymtech/nym-vpn-client) | Rust | gpl-3.0 | 585 | 2026-10-09 |  | Cross-platform open source VPN client built in Rust, with mixnet anonymity and WireGuard speed. Protects metad |
| [OP-Engineering/op-sqlite](https://github.com/OP-Engineering/op-sqlite) | C | mit | 1048 | 2026-09-29 |  | Fastest SQLite library for react-native by @ospfranco |
| [opendp/opendp](https://github.com/opendp/opendp) | Rust | mit | 439 | 2026-10-13 |  | The core library of differential privacy algorithms powering the OpenDP Project. |
| [opendp/tumult-analytics](https://github.com/opendp/tumult-analytics) | Python | apache-2.0 | 16 | 2026-09-28 |  | Tumult Analytics is a Python library for privately computing aggregate queries on tabular data. It is built at |
| [opendp/tumult-core](https://github.com/opendp/tumult-core) | Python | apache-2.0 | 4 | 2026-10-14 |  | Tumult Core is a collection of composable components for implementing algorithms to perform differentially pri |
| [OpenMined/PSI](https://github.com/OpenMined/PSI) | C++ | apache-2.0 | 152 | 2026-09-20 |  | Private Set Intersection Cardinality protocol based on ECDH and Bloom Filters |
| [OpenMined/PyDP](https://github.com/OpenMined/PyDP) | Python | apache-2.0 | 551 | 2026-05-11 |  | The Python Differential Privacy Library. Built on top of: https://github.com/google/differential-privacy |
| [OpenMined/TenSEAL](https://github.com/OpenMined/TenSEAL) | C++ | apache-2.0 | 1040 | 2026-10-07 |  | A library for doing homomorphic encryption operations on tensors |
| [openmls/openmls](https://github.com/openmls/openmls) | Rust | mit | 1045 | 2026-10-19 |  | Rust implementation of the Messaging Layer Security (MLS) protocol |
| [oramasearch/orama](https://github.com/oramasearch/orama) | TypeScript | other | 10578 | 2026-10-18 |  | 🌌  A complete search engine and RAG pipeline in your browser, server or edge network with support for full-tex |
| [osu-crypto/libPSI](https://github.com/osu-crypto/libPSI) | C++ | other | 188 | 2024-12-23 |  | A repository for private set intersection. |
| [paulmillr/nip44](https://github.com/paulmillr/nip44) | C | None | 32 | 2024-12-04 |  | NIP44 encrypted messages for nostr. Spec and implementations |
| [paulmillr/noble-ciphers](https://github.com/paulmillr/noble-ciphers) | TypeScript | mit | 426 | 2026-09-17 |  | Audited & minimal JS implementation of Salsa20, ChaCha and AES |
| [paulmillr/noble-curves](https://github.com/paulmillr/noble-curves) | TypeScript | mit | 962 | 2026-09-08 |  | Audited & minimal JS implementation of elliptic curve cryptography. |
| [paulmillr/noble-hashes](https://github.com/paulmillr/noble-hashes) | TypeScript | mit | 931 | 2026-09-08 |  | Audited & minimal JS implementation of hash functions, MACs and KDFs. |
| [polymorphicshade/Tubular](https://github.com/polymorphicshade/Tubular) | Java | gpl-3.0 | 3169 | 2026-07-07 | ARCHIVED | A fork of NewPipe that implements SponsorBlock and ReturnYouTubeDislike. |
| [powersync-ja/powersync-js](https://github.com/powersync-ja/powersync-js) | TypeScript | apache-2.0 | 735 | 2026-10-19 |  | PowerSync client SDKs for JavaScript clients |
| [Pretty-Good-Freedom-Tech/graperank-nodejs](https://github.com/Pretty-Good-Freedom-Tech/graperank-nodejs) | TypeScript | agpl-3.0 | 11 | 2025-04-18 |  |  |
| [quickjs-ng/quickjs](https://github.com/quickjs-ng/quickjs) | C | mit | 3970 | 2026-10-18 |  | QuickJS, the Next Generation: a mighty JavaScript engine |
| [recommenders-team/recommenders](https://github.com/recommenders-team/recommenders) | Python | mit | 21944 | 2026-10-12 |  | Best Practices on Recommendation Systems |
| [rhashimoto/wa-sqlite](https://github.com/rhashimoto/wa-sqlite) | JavaScript | mit | 1419 | 2026-10-13 |  | WebAssembly SQLite with support for browser storage extensions |
| [roostorg/coop](https://github.com/roostorg/coop) | TypeScript | apache-2.0 | 139 | 2026-10-16 |  | Review and moderation, your way. Online safety dashboard, queues, routing and automatic enforcement rules, and |
| [roostorg/osprey](https://github.com/roostorg/osprey) | Python | apache-2.0 | 492 | 2026-10-16 |  | Automate the obvious and investigate the ambiguous. High-performance safety rules engine for real-time event p |
| [RUCAIBox/RecBole](https://github.com/RUCAIBox/RecBole) | Python | mit | 4586 | 2025-02-24 |  | A unified, comprehensive and efficient recommendation library |
| [rust-nostr/nostr-sdk-js](https://github.com/rust-nostr/nostr-sdk-js) | Rust | mit | 10 | 2026-07-29 | ARCHIVED | Nostr SDK - JavaScript/TypeScript bindings |
| [scsibug/nostr-rs-relay](https://github.com/scsibug/nostr-rs-relay) | Rust | mit | 723 | 2026-05-22 |  | Mirror of https://sr.ht/~gheartsfield/nostr-rs-relay/ |
| [sebastianwessel/quickjs](https://github.com/sebastianwessel/quickjs) | TypeScript | mit | 941 | 2026-06-08 |  | A typescript package to execute JavaScript and TypeScript code in a webassembly quickjs sandbox |
| [ShravanSunder/hnswlib-wasm](https://github.com/ShravanSunder/hnswlib-wasm) | C++ | apache-2.0 | 64 | 2023-07-21 |  | hnswlib-wasm attempts to create a browser friendly version of hnswlib |
| [signalapp/libsignal](https://github.com/signalapp/libsignal) | Rust | agpl-3.0 | 6078 | 2026-10-15 |  | Home to the Signal Protocol as well as other cryptographic primitives which make Signal possible. |
| [sigstore/cosign](https://github.com/sigstore/cosign) | Go | apache-2.0 | 6359 | 2026-10-08 |  | Code signing and transparency for containers and binaries |
| [sigstore/sigstore-js](https://github.com/sigstore/sigstore-js) | TypeScript | apache-2.0 | 185 | 2026-10-13 |  | Code-signing for npm packages |
| [sigstore/sigstore-python](https://github.com/sigstore/sigstore-python) | Python | other | 335 | 2026-10-08 |  | A codesigning tool for Python packages |
| [slsa-framework/slsa-github-generator](https://github.com/slsa-framework/slsa-github-generator) | Go | apache-2.0 | 604 | 2026-08-07 |  | Language-agnostic SLSA provenance generation for Github Actions |
| [sqlcipher/sqlcipher](https://github.com/sqlcipher/sqlcipher) | C | bsd-3-clause | 7306 | 2026-10-09 |  | SQLCipher is a standalone fork of SQLite that adds 256 bit AES encryption of database files and other security |
| [sqlite/sqlite-wasm](https://github.com/sqlite/sqlite-wasm) | JavaScript | None | 1066 | 2026-10-19 |  | SQLite Wasm conveniently wrapped as an ES Module. |
| [sschueller/peertube-android](https://github.com/sschueller/peertube-android) | Kotlin | agpl-3.0 | 359 | 2024-08-01 | ARCHIVED | Thorium, a PeerTube Android Client |
| [tantaraio/voy](https://github.com/tantaraio/voy) | Rust | apache-2.0 | 1075 | 2023-09-20 |  | 🕸️🦀 A WASM vector similarity search written in Rust |
| [tauri-apps/plugins-workspace](https://github.com/tauri-apps/plugins-workspace) | Rust | apache-2.0 | 1833 | 2026-10-19 |  | All of the official Tauri plugins in one place! |
| [tauri-apps/tauri](https://github.com/tauri-apps/tauri) | Rust | apache-2.0 | 111970 | 2026-10-15 |  | Build smaller, faster, and more secure desktop and mobile applications with a web frontend. |
| [TeamNewPipe/NewPipe](https://github.com/TeamNewPipe/NewPipe) | Java | gpl-3.0 | 40136 | 2026-10-14 |  | A libre lightweight streaming front-end for Android. |
| [TeamNewPipe/NewPipeExtractor](https://github.com/TeamNewPipe/NewPipeExtractor) | Java | gpl-3.0 | 2017 | 2026-10-13 |  | NewPipe's core library for extracting data from streaming sites |
| [tensorflow/recommenders](https://github.com/tensorflow/recommenders) | Python | apache-2.0 | 2036 | 2026-10-06 |  | TensorFlow Recommenders is a library for building recommender system models using TensorFlow. |
| [tensorflow/tfjs](https://github.com/tensorflow/tfjs) | TypeScript | apache-2.0 | 19148 | 2026-06-23 |  | A WebGL accelerated JavaScript library for training and deploying ML models. |
| [TheWidlarzGroup/react-native-video](https://github.com/TheWidlarzGroup/react-native-video) | TypeScript | mit | 7720 | 2026-10-15 |  | A <Video /> component for react-native |
| [tiktok-privacy-innovation/PETAce](https://github.com/tiktok-privacy-innovation/PETAce) | Python | apache-2.0 | 33 | 2025-02-28 |  | Privacy-Enhancing Technologies via Applied Cryptography Engineering |
| [v0l/snort](https://github.com/v0l/snort) | TypeScript | mit | 347 | 2026-10-12 |  | Feature packed nostr web UI |
| [v0l/zap.stream](https://github.com/v0l/zap.stream) | TypeScript | mit | 66 | 2026-10-12 |  | Nostr live streaming |
| [vertex-lab/crawler_v2](https://github.com/vertex-lab/crawler_v2) | Go | mit | 8 | 2026-07-02 |  | Crawl the Nostr network, build a social graph and use it to compute Monte Carlo pagerank |
| [video-dev/hls.js](https://github.com/video-dev/hls.js) | TypeScript | other | 16973 | 2026-10-08 |  | HLS.js is a JavaScript library that plays HLS in browsers with support for MSE. |
| [videojs/video.js](https://github.com/videojs/video.js) | TypeScript | other | 39982 | 2026-10-16 |  | Video.js v10 - open source media player framework for HTML and React. |
| [vidstack/player](https://github.com/vidstack/player) | TypeScript | mit | 3688 | 2026-10-07 |  | Deprecated in favour of Video.js 10; security fixes only until January 2028. UI components and hooks for build |
| [vsradkevich/meritrank](https://github.com/vsradkevich/meritrank) | Rust | mit | 1 | 2023-10-19 |  | This is a Rust library for ranking nodes based on their merit scores |
| [webtorrent/webtorrent](https://github.com/webtorrent/webtorrent) | JavaScript | mit | 31449 | 2026-10-17 |  | ⚡️ Streaming torrent client for the web |
| [yjs/yjs](https://github.com/yjs/yjs) | JavaScript | other | 22941 | 2026-10-15 |  | Shared data types for building collaborative software |
| [zama-ai/concrete-ml](https://github.com/zama-ai/concrete-ml) | Python | other | 1457 | 2026-08-04 |  | Concrete ML: Privacy Preserving ML framework using Fully Homomorphic Encryption (FHE), built on top of Concret |
| [ZcashFoundation/frost](https://github.com/ZcashFoundation/frost) | Rust | other | 279 | 2026-10-01 |  | Rust implementation of FROST (Flexible Round-Optimised Schnorr Threshold signatures) by the Zcash Foundation |

## Raw metadata: npm packages (registry.npmjs.org, 2026-10-19)

| Package | Latest | Published | License | Repo |
|---|---|---|---|---|
| @openmined/psi.js | 2.0.6 | 2025-06-24 | Apache-2.0 | git+https://github.com/OpenMined/PSI.git#master |
| @rust-nostr/nostr-sdk | 0.44.0 | 2025-11-06 | MIT | git+https://github.com/rust-nostr/nostr-sdk-js.git |
| nostr-tools | 2.25.2 | 2026-09-04 | Unlicense | git+https://github.com/nbd-wtf/nostr-tools.git |
| @nostr-dev-kit/ndk | 3.0.3 | 2026-02-23 | MIT | git+https://github.com/nostr-dev-kit/ndk.git |
| @nostr-dev-kit/ndk-mobile | 0.8.43 | 2025-10-04 | MIT | None |
| @nostr-dev-kit/ndk-wallet | 0.7.1 | 2025-10-04 | MIT | git+https://github.com/nostr-dev-kit/ndk.git |
| ts-mls | 1.6.4 | 2026-08-28 | MIT | git+https://github.com/LukaJCB/ts-mls.git |
| @internet-privacy/marmot-ts | 0.7.0 | 2026-10-19 | MIT | git+https://github.com/marmot-protocol/marmot-ts.git |
| marmot-ts | NOTFOUND |  |  |  |
| @frostr/bifrost | 2.0.2 | 2026-01-25 | MIT | git+https://github.com/frostr-org/bifrost.git |
| @frostr/igloo-core | 0.2.4 | 2025-10-18 | MIT | git+https://github.com/FROSTR-ORG/igloo-core.git |
| applesauce-core | 6.2.0 | 2026-06-26 | MIT | None |
| applesauce-signers | 6.2.3 | 2026-09-30 | MIT | None |
| @peertube/peertube-types | 8.3.1 | 2026-09-28 | AGPL-3.0 | git+https://github.com/Chocobozzz/PeerTube.git |
| @peertube/embed-api | 0.2.0 | 2024-12-02 | AGPL-3.0 | git+https://github.com/Chocobozzz/PeerTube.git |
| hls.js | 1.7.3 | 2026-09-11 | Apache-2.0 | git+https://github.com/video-dev/hls.js.git |
| video.js | 10.1.0 | 2026-10-12 | Apache-2.0 | git+https://github.com/videojs/video.js.git |
| p2p-media-loader-core | 4.0.0 | 2026-08-19 | Apache-2.0 | https://github.com/Novage/p2p-media-loader |
| p2p-media-loader-hlsjs | 4.0.0 | 2026-08-19 | Apache-2.0 | https://github.com/Novage/p2p-media-loader |
| webtorrent | 3.0.21 | 2026-07-27 | MIT | git://github.com/webtorrent/webtorrent.git |
| @simplewebauthn/browser | 14.0.0 | 2026-09-02 | MIT | git+https://github.com/MasterKale/SimpleWebAuthn.git |
| @noble/curves | 2.4.0 | 2026-08-27 | MIT | git+https://github.com/paulmillr/noble-curves.git |
| @noble/ciphers | 2.4.0 | 2026-08-27 | MIT | git+https://github.com/paulmillr/noble-ciphers.git |
| libsodium-wrappers | 0.8.4 | 2026-04-19 | ISC | git+https://github.com/jedisct1/libsodium.js.git |
| @sqlite.org/sqlite-wasm | 3.54.1-build1 | 2026-10-19 | Apache-2.0 | git+https://github.com/sqlite/sqlite-wasm.git |
| wa-sqlite | 1.0.0 | 2024-01-05 | None | None |
| dexie | 4.4.6 | 2026-09-10 | Apache-2.0 | git+https://github.com/dexie/Dexie.js.git |
| @automerge/automerge | 3.5.0 | 2026-09-16 | MIT | git+https://github.com/automerge/automerge.git |
| @automerge/automerge-repo | 2.6.0-alpha.3 | 2026-08-07 | MIT | https://github.com/automerge/automerge-repo/tree/main/packages/automerge-repo |
| yjs | 13.6.33 | 2026-09-23 | MIT | git+https://github.com/yjs/yjs.git |
| jazz-tools | 0.20.19 | 2026-07-03 | MIT | None |
| @evolu/common | 8.23.2 | 2026-10-17 | MIT | git+https://github.com/evoluhq/evolu.git |
| json-logic-js | 2.0.5 | 2024-07-09 | MIT | git+https://github.com/jwadhams/json-logic-js.git |
| @marcbachmann/cel-js | 8.0.0 | 2026-07-07 | MIT | git+https://github.com/marcbachmann/cel-js.git |
| cel-js | 0.8.2 | 2025-07-11 | MIT | git+https://github.com/ChromeGG/cel-js.git |
| quickjs-emscripten | 0.32.0 | 2026-02-16 | MIT | https://github.com/justjake/quickjs-emscripten |
| @extism/extism | 2.0.0-rc13 | 2025-05-14 | BSD-3-Clause | None |
| sqlite-vec | 0.1.9 | 2026-03-31 | MIT OR Apache | git+https://github.com/asg017/sqlite-vec.git |
| sqlite-vec-wasm-demo | 0.1.9 | 2026-03-31 | MIT OR Apache | git+https://github.com/asg017/sqlite-vec.git |
| hnswlib-wasm | 0.8.2 | 2023-07-08 | Apache-2.0 | git+https://github.com/shravansunder/hnswlib-wasm.git |
| voy-search | 0.6.3 | 2023-09-20 | MIT OR Apache 2.0 | git+https://github.com/tantaraio/voy.git |
| @huggingface/transformers | 4.3.1 | 2026-10-06 | Apache-2.0 | git+https://github.com/huggingface/transformers.js.git |
| onnxruntime-web | 1.30.0 | 2026-09-14 | MIT | git+https://github.com/Microsoft/onnxruntime.git |
| @tensorflow/tfjs | 4.22.0 | 2024-10-21 | Apache-2.0 | git+https://github.com/tensorflow/tfjs.git |
| graphology | 0.26.0 | 2025-01-26 | MIT | git+https://github.com/graphology/graphology.git |
| graphology-metrics | 2.4.2 | 2026-09-02 | MIT | git+https://github.com/graphology/graphology.git |
| @orama/orama | 3.1.18 | 2025-12-19 | Apache-2.0 | git+https://github.com/oramasearch/orama.git |
| disco-rec | 0.3.0 | 2026-04-17 | MIT | git+https://github.com/ankane/disco-node.git |
| knn-recommender | 3.0.0 | 2021-04-19 | MIT | git+https://github.com/koodiohto/knn-recommender.git |
| divviup-ts | NOTFOUND |  |  |  |
| @divviup/dap | 0.9.1 | 2024-11-14 | MPL-2.0 | None |
| @divviup/prio3 | 0.8.0 | 2024-05-02 | MPL-2.0 | None |
| ohttp-js | 0.1.5 | 2023-06-13 | MIT | git+https://github.com/chris-wood/ohttp-js.git |
| hpke-js | 1.8.0 | 2026-03-08 | MIT | git+https://github.com/dajiaji/hpke-js.git |
| @hpke/core | 1.9.0 | 2026-03-08 | MIT | git+https://github.com/dajiaji/hpke-js.git |
| sigstore | 5.0.0 | 2026-06-01 | Apache-2.0 | git+https://github.com/sigstore/sigstore-js.git |
| @sigstore/cli | 0.10.3 | 2026-08-04 | Apache-2.0 | git+https://github.com/sigstore/sigstore-js.git |
| @nostr/tools | NOTFOUND |  |  |  |
| nostr-wasm | 0.1.0 | 2023-12-22 | MIT | None |
| @welshman/net | 0.14.0-pre2 | 2026-10-15 | MIT | None |
| @welshman/app | 0.14.0-pre2 | 2026-10-15 | MIT | None |
| @capacitor/core | 8.5.3 | 2026-10-07 | MIT | git+https://github.com/ionic-team/capacitor.git |
| @tauri-apps/api | 2.12.4 | 2026-10-14 | Apache-2.0 OR MIT | git+https://github.com/tauri-apps/tauri.git |
| expo | 58.0.16 | 2026-10-19 | MIT | https://github.com/expo/expo.git |
| react-native-video | 6.19.3 | 2026-09-18 | MIT | git+https://github.com/TheWidlarzGroup/react-native-video.git |
| @atproto/api | 0.28.0 | 2026-10-17 | MIT | https://github.com/bluesky-social/atproto |
| @atproto/ozone | 0.9.2 | 2026-10-17 | MIT | https://github.com/bluesky-social/atproto |
| vidstack | 1.15.7 | 2026-10-06 | MIT | git+https://github.com/vidstack/player.git |
| ohttp-ts | 0.6.1 | 2026-09-30 | MIT | github.com/thibmeu/ohttp-ts |
| oblivious-http | 0.1.3 | 2024-12-03 | MIT | github.com/tinfoilanalytics/oblivious-http-ts |
| @nymproject/mix-fetch | 3.0.0 | 2026-10-08 | Apache-2.0 | github.com/nymtech/nym |
| @nymproject/sdk | 1.4.1 | 2025-11-07 | Apache-2.0 | — |
| nostr-login | 1.7.12 | 2025-09-25 | MIT | — |
| @nostr-dev-kit/messages | 2.0.0 | 2026-02-10 | MIT | ndk monorepo (NIP-17 + NIP-EE) |
| @nostr-dev-kit/wot | 1.0.0 | 2026-02-10 | MIT | ndk monorepo |
| @nostr-dev-kit/mobile | 0.9.3 | 2026-02-10 | MIT | ndk monorepo |
| @nostr-dev-kit/cache-sqlite-wasm | 1.0.0 | 2026-02-10 | MIT | ndk monorepo (OPFS) |
| openapi-typescript / openapi-fetch | 7.13.0 / 0.17.0 | 2026-02-11 | MIT | openapi-ts/openapi-typescript |
| @hey-api/openapi-ts | 0.99.0 | 2026-06-22 | MIT | hey-api/hey-api |
| @sebastianwessel/quickjs | 3.1.0 | 2026-06-08 | MIT | sebastianwessel/quickjs |
| @bufbuild/cel | 0.6.1 | 2026-08-27 | Apache-2.0 | bufbuild/cel-es |
| jsonata | 2.2.2 | 2026-07-16 | MIT | jsonata-js/jsonata |
| json-rules-engine | 7.3.1 | 2025-02-20 | ISC | cachecontrol/json-rules-engine |
| pdq-wasm | 0.3.9 | 2025-11-08 | BSD-3-Clause | Raudbjorn/pdq-wasm |
| @frostr/igloo-core | 0.2.4 | 2025-10-18 | MIT | FROSTR-ORG/igloo-core |
| @cmdcode/frost | 1.1.4 | 2026-01-22 | MIT | cmdruid/frost |
| shaka-player | 5.3.1 | 2026-10-19 | Apache-2.0 | shaka-project/shaka-player |
| @capacitor-community/sqlite | 8.1.1 | 2026-08-06 | MIT | capacitor-community/sqlite |
| @op-engineering/op-sqlite | 18.2.5 | 2026-09-20 | MIT | OP-Engineering/op-sqlite |
| expo-sqlite / expo-secure-store | 58.0.13 / 58.0.2 | 2026-10 | MIT | expo/expo |
| react-native-mmkv | 4.3.2 | 2026-06-22 | MIT | mrousavy/react-native-mmkv |
| @nostrify/nostrify, @nostrify/react | 0.55.1 / 0.6.8 | 2026-09-03 | (none in npm metadata) | (JSR @nostrify) |
| @divinevideo/login | 1.1.0 | 2026-03-24 | MIT | divinevideo/login |

## Raw metadata: PyPI (2026-10-19)

| Package | Version | Uploaded | License | Notes |
|---|---|---|---|---|
| openmined.psi / openmined-psi | 2.0.6 | 2025-06-24 | Apache 2.0 | OpenMined/PSI |
| nostr-sdk | 0.45.1 | 2026-08-19 | (blank; crate is MIT) | rust-nostr bindings, homepage nostrdevkit.org |
| nostr-protocol | 0.35.0 | 2024-09-19 | MIT | deprecated in favour of nostr-sdk |
| pynostr | 0.7.0 | 2025-08-07 | MIT | holgern/pynostr |
| monstr | 0.1.9 | 2024-06-30 | — | WIP |
| nostr (python-nostr) | 0.0.2 | 2023-01-26 | MIT | stale |
| nostr-dvm | 1.1.8 | 2026-09-10 | MIT | believethehype/nostrdvm |
| opendp | 0.16.0 | 2026-10-06 | MIT | |
| tmlt.analytics / tmlt.core | 0.21.0 / 0.19.1 | 2026-06 | Apache-2.0 | now opendp/tumult-* |
| pdqhash | 0.2.8 | 2025-05-28 | MIT | faustomorales/pdqhash-python |
| vpdq | 0.2.5 | 2026-02-02 | Meta copyright (see ThreatExchange LICENSE) | |
| implicit | 0.7.3 | 2026-05-08 | MIT | |
| lightfm | 1.17 | 2023-03-20 | MIT (repo Apache-2.0) | stale |
| recbole | 1.2.1 | 2025-02-24 | MIT | |
| scikit-surprise | 1.1.5 | 2026-05-30 | BSD-3 | |
| recommenders | 1.2.1 | 2024-12-24 | MIT | repo active 2026-10 |
| networkx | 3.7 | 2026-09-21 | BSD-3 | |
| meritrank-python | 0.2.10 | 2024-02-16 | GPLv2 | |
| peertube | 1.1.1 | 2025-09-23 | MIT | openapi-python-client generated; placeholder repo URLs |
| sigstore | 4.5.0 | 2026-07-28 | Apache | |
| in-toto | 3.1.0 | 2026-04-25 | Apache-2.0 | |
| diffoscope | 332 | 2026-09-28 | GPL-3+ | |
| fdroidserver | 2.4.5 | 2026-06-03 | AGPL-3.0 | |
| sqlite-vec | 0.1.9 | 2026-03-31 | MIT/Apache-2.0 | |
| faiss-cpu | 1.15.1 | 2026-09-16 | MIT | |
| sentence-transformers | 6.1.0 | 2026-09-18 | Apache-2.0 | |
| onnxruntime | 1.31.0 | 2026-10-09 | MIT | |

## Raw metadata: crates.io (2026-10-19)

| Crate | Version | Updated | License | Repo |
|---|---|---|---|---|
| arti-client | 0.47.0 | 2026-10-01 | MIT OR Apache-2.0 | gitlab.torproject.org/tpo/core/arti |
| ohttp / bhttp | 0.8.0 | 2026-07-15 | MIT OR Apache-2.0 | martinthomson/ohttp |
| openmls | 0.9.1 | 2026-10-07 | MIT | openmls/openmls |
| mdk-core | 0.8.0 | 2026-05-04 | MIT | marmot-protocol/mdk |
| nostr-sdk | 0.45.4 | 2026-09-19 | MIT | nostrdevkit/nostr |
| frost-secp256k1-tr | 3.0.0 | 2026-04-23 | MIT OR Apache-2.0 | ZcashFoundation/frost |
| prio | 0.18.1 | 2026-09-25 | MPL-2.0 AND Apache-2.0 AND MIT | divviup/libprio-rs |
| janus_client | 0.7.143 | 2026-10-14 | MPL-2.0 | divviup/janus |
| opendp | 0.16.0 | 2026-10-07 | "non-standard" on crates (repo LICENSE = MIT) | opendp/opendp |
| hpke | 0.14.1 | 2026-09-06 | MIT/Apache-2.0 | rozbb/rust-hpke |
| iroh | 1.3.0 | 2026-09-28 | MIT OR Apache-2.0 | n0-computer/iroh |
| nym-sdk | 1.21.6 | 2026-09-04 | Apache-2.0 | nymtech/nym |
| meritrank | 0.4.0 | 2024-03-05 | MIT | (none listed) |
| petgraph | 0.8.3 | 2025-09-30 | MIT OR Apache-2.0 | petgraph/petgraph |

## Owner/repo guesses that returned not-found (do not cite these)
framasoft/peertube-app, Fedilab/Fedilab, LibreTube/LibreTube, facebook/react-native, react-native-video/react-native-video, google/shaka-player, rust-nostr/nostr, rust-nostr/nostr-sdk-ffi, rust-nostr/nostr-sdk-python, python-nostr/python-nostr, nostrband/nsec-app, frostr-org/igloo, SimpleWebAuthn/SimpleWebAuthn, osu-crypto/volePSI, xenova/transformers.js, yoshoku/hnswlib-wasm, orama-search/orama, microsoft/recommenders, Karma3Labs/rust-eigentrust, Karma3Labs/openrank, openrank-labs/openrank, Openrank-Protocol/openrank, nadar/php-json-logic, json-logic/json-logic-js, google/cel-spec, justinethier/quickjs-emscripten, nostr-dev-kit/ndk-dvm, tumult-labs/core, tumult-labs/analytics, nostr-dev-kit/khatru, cloudflare/ohttp-js, torproject/arti, fdroid/fdroidserver, fdroid/fdroiddata, reproducible-builds/diffoscope, Sepia-Search/search-index, dcadenas/nostr_peertube, peertube/peertube-plugin-auth-openid-connect, rust-nostr/nostr-sdk-swift, nostrband/nsec.app, nostr-dev-kit/ndk-mobile, tumult-labs/tumult, tumult-labs/tmlt.analytics, Karma3Labs/ts-eigentrust, openrank/openrank, KarmaHQ/eigentrust, MeritRank/meritrank-rs, Tribler/meritrank, ichorid/meritrank-rs, graphology/graphology-metrics, quickjs-ng/quickjs-wasm, fermyon/spin, nicholasgasior/peertube-api, thraxil/peertube, Tubefeeder/Tubefeeder, johnfinch/Tubefeeder, peertube/peertube-mobile, kaythomas/peertube-cli, tryffel/fi, arti-rs/arti, cure53/nip44, nostr-dev-kit/nostr-dev-kit, Rhicart/nostr-relay-pool, pablof7z/snort, Dhaliwal/peertube-scraper, MarmotProtocol/marmot, whitenoise-org/whitenoise, privacy-scaling-explorations/zk-kit, nicolo-ribaudo/tc39-proposal-shadowrealm, Shopify/javy, 

Where it moved, if known:
- rust-nostr/nostr is now nostrdevkit/nostr.
- khatru is now the Go module fiatjaf.com/nostr/khatru.
- Tumult is now opendp/tumult-*.
- Fedilab is on Codeberg.
- Arti is at gitlab.torproject.org/tpo/core/arti.
- fdroidserver is on GitLab (PyPI 2.4.5).
- Sepia Search is at framagit.org/framasoft/peertube/search-index.
- The PeerTube mobile app is at framagit.org/framasoft/peertube/mobile-application.
- The Shaka player is at shaka-project/shaka-player.
- transformers.js is at huggingface/transformers.js.
- recommenders is at recommenders-team/recommenders.
- orama is at oramasearch/orama.
- SimpleWebAuthn is at MasterKale/SimpleWebAuthn.
- FROSTR repos are under FROSTR-ORG; igloo is split into igloo-core, igloo-web and igloo-desktop.
