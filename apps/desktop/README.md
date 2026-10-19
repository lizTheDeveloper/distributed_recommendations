# Meme Video for desktop (Tauri v2)

The Match Feed web client (`apps/web`) in a [Tauri](https://v2.tauri.app) 2 window for Linux,
macOS and Windows. Name and id come from [`../mobile/brand.json`](../mobile/brand.json)
(Meme Video, `school.multiverse.memevideo`); `npm run apply-brand` in apps/mobile rewrites
`src-tauri/tauri.conf.json`.

Status (2026-10-19), built on Ubuntu 24.04 x86_64:

| | Result |
|---|---|
| `cargo check --locked` | passes, no warnings |
| `cargo test --locked` | 1 test (navigation policy) passes |
| `tauri build` (Linux, release) | **builds**: `src-tauri/target/release/bundle/deb/Meme Video_0.1.0_amd64.deb` (2.9 MB) and, as an experiment, `bundle/appimage/Meme Video_0.1.0_amd64.AppImage` (157 MiB with GStreamer bundled; **do not distribute**, see below) |
| Smoke run | release binary under Xvfb: the app renders, loads live PeerTube data under the strict CSP, and plays Reels (muted autoplay in the PeerTube embed) once GStreamer codecs are installed. The AppImage starts and renders too; its first video was still buffering when the screenshot was taken, so AppImage playback is unconfirmed |
| Keychain | code compiles for all three OSes; on Linux the container had no Secret Service, so the app logged "OS keychain unavailable" and kept running. The `invoke` round trip to the keychain was not exercised |
| macOS / Windows bundles | not built (need those OSes; see docs/SHIPPING.md, Phase 4) |

Linux build needs: `libwebkit2gtk-4.1-dev libxdo-dev libssl-dev librsvg2-dev libayatana-appindicator3-dev`,
plus `patchelf` and the GStreamer packages below for the AppImage (build it with
`GSTREAMER_INCLUDE_BAD_PLUGINS=1`)
(installed here with apt; webkit2gtk 2.52.6), Rust 1.85+ (built with 1.97.0), Node 22.6+.
Video playback at runtime needs GStreamer `plugins-good`, `plugins-bad` and `libav`: the .deb
depends on them. Without them PeerTube embeds show "No compatible source was found".

**AppImage is off by default.** An AppImage can only play video if it bundles GStreamer
(`bundleMediaFramework: true`), and on Ubuntu that pulls in the distro FFmpeg (whose Debian
copyright file says the binaries are GPL v2+) and libx264/libx265 (GPL). Shipping that would mean
redistributing GPL binaries and H.264/H.265 codecs ourselves. Ship the .deb and a Flatpak
(Flathub's runtime provides the codecs) instead; `bundle.targets` no longer lists `appimage`.

## Commands

```sh
cd apps/desktop
npm ci                    # .npmrc: ignore-scripts, save-exact
npm run check             # sync www/ + cargo check --locked
npm run build             # sync www/ + tauri build (release, all bundle targets for this OS)
npx tauri build --bundles deb -- --locked
npm run dev               # run from www/ with a debug build
cd src-tauri && cargo test --locked
```

`npm run prepare-www` reuses `apps/mobile/scripts/sync-web.mjs` (copy `apps/web/dist`, drop
`sw.js` and the source map, add the bridge tag, brand the title) and bundles
`bridge/native-bridge.ts` into `www/native-bridge.js`.

## What's in it

```
bridge/native-bridge.ts        window.MatchFeedNative for desktop: secrets only (contract: ../mobile/bridge/types.ts)
scripts/sync-web.mjs           www/ from apps/web/dist
src-tauri/tauri.conf.json      CSP, no global Tauri API, frozen prototypes, no asset protocol, no updater artifacts
src-tauri/capabilities/main.json   the main window may call the 3 keychain commands; nothing else
src-tauri/build.rs             app manifest: the commands need explicit permissions
src-tauri/src/lib.rs           window creation, navigation policy
src-tauri/src/secrets.rs       keychain commands
```

**Security choices.**
- **No plugins at all:** no shell, opener, fs, http, dialog, notification, updater. `core:default` is not granted either; the main window gets only `allow-secret-get`, `allow-secret-set` and `allow-secret-remove`. Remote origins (PeerTube embeds) get no IPC.
- **CSP** (`app.security.csp`): the web app's policy plus `ipc: http://ipc.localhost` in `connect-src`. Tauri adds hashes for its own init scripts. The page's own meta CSP still applies and has no `ipc:`, so Tauri uses its postMessage IPC fallback (it works under that CSP). `freezePrototype: true`, `withGlobalTauri: false` (page scripts don't get `window.__TAURI__`), `assetProtocol` off.
- **Navigation:** the window and its frames may navigate only to the app origin (`tauri://localhost`, `http(s)://tauri.localhost`) or https. WebKitGTK reports iframe navigations through the same hook, so https stays allowed for embeds. file:, data:, javascript: and plain http are refused (tested).
- **Auto-update is off by design.** `tauri-plugin-updater` is not a dependency and `bundle.createUpdaterArtifacts` is `false`. Users update by installing a new signed release. Turning it on later means adding the plugin with a minisign public key in `tauri.conf.json`, keeping the private key (`TAURI_SIGNING_PRIVATE_KEY`) offline or in an HSM-backed CI secret, and serving a static `latest.json` over https. The updater refuses unsigned updates and its signature check can't be turned off; the risk is a stolen signing key, so pair it with reproducible builds and two-person release sign-off (THREAT_MODEL T13).
- Release profile: LTO, `panic = "abort"`, stripped.
- The bundler warns "__TAURI_BUNDLE_TYPE variable not found in binary". It only matters to the updater, which isn't used.

## Keychain

Verified plugin options on crates.io and ecosyste.ms (2026-10-19):

| Option | Verdict |
|---|---|
| `tauri-plugin-keyring` 0.1.0 | one release (2024-12-23), no repository in crates.io metadata. Not maintained |
| `tauri-plugin-keychain` 2.0.2 | last release 2024-11-20. Not maintained |
| `tauri-plugin-keyring-store` 0.2.0 (s00d) | MIT/Apache, May 2026, 1 star, single author, and it adds its own Argon2/ChaCha20 vault layer on top of the keychain. Too new and too much unreviewed crypto |
| `tauri-plugin-secure-storage` 1.5.0 | MIT, no repository link. Can't review |
| `tauri-plugin-stronghold` 2.4.0 (official) | maintained, but it's an encrypted file vault (IOTA Stronghold), not the OS keychain |
| **`keyring-core` 1.0.0 + platform stores (used)** | MIT/Apache, from the keyring-rs maintainers (open-source-cooperative/keyring-rs, push 2026-10-14; the `keyring` crate has 32M downloads). About 60 lines of our own Tauri command code |

So there is no maintained Tauri keychain plugin worth depending on; `src/secrets.rs` wraps
`keyring-core` with `apple-native-keyring-store` 1.0.2 (`keychain` module, login keychain),
`windows-native-keyring-store` 1.1.0 (Credential Manager) and
`zbus-secret-service-keyring-store` 1.0.1 (Secret Service over pure-Rust D-Bus, async-io runtime,
so no libdbus and no clash with Tauri's tokio runtime). Commands are synchronous, so they run on
the main thread outside the async runtime, which the blocking backends need. Only the names
`nostr-secret-key` and `vault-key` are accepted, values at most 4096 characters; the service name
is the app identifier.

Limits: the keychain is per OS user, not per app. On Linux any process in the session can read
Secret Service items; on macOS another app can request the item (the user sees a prompt). The
macOS data-protection keychain (`protected` module) would need a signed app with a keychain
access group; worth switching to once Developer ID signing exists.

## Dependency pinning

- npm: exact versions and a lockfile; the initial versions were resolved with `npm install --before=2026-10-05` (not kept in `.npmrc`, since it would block Dependabot's updates, which have a 14-day cooldown).
- Rust: direct dependencies pinned with `=x.y.z`; `Cargo.lock` committed; every one of its 482 crates was published on or before 2026-10-05 (checked against the crates.io index `pubtime`; 46 newer transitive crates were moved back with `cargo update --precise`). Build with `--locked`.
- Not pinned: the AppImage bundler downloads `linuxdeploy` and its GStreamer plugin from GitHub at build time. For release builds, vendor those tools with checksums, or ship only the .deb and a Flatpak.

## Hooks for apps/web

Desktop implements only `MatchFeedNative.secrets` (see apps/mobile/README.md for the full list of
hooks). Two desktop-specific gaps:
- External links (`target="_blank"`, "Open on PeerTube") do nothing in the window, since no opener is compiled in. Options: a `open_external` command that accepts only `https:` URLs and hands them to the OS, or `tauri-plugin-opener` scoped to `https://*`. Both add a capability; decide deliberately.
- Notifications and background checks: none on desktop yet (the app is open or it isn't).
