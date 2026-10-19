# Meme Video for Android and iOS (Capacitor)

The Match Feed web client (`apps/web`) wrapped as native Android and iOS apps with
[Capacitor](https://capacitorjs.com) 8. The product name, app id and URL scheme live in one file,
[`brand.json`](brand.json) (display name **Meme Video**, id `school.multiverse.memevideo`,
publisher The Multiverse School). The name-conflict check is still pending (docs/SHIPPING.md, Decisions).

The web app is not forked: `npm run sync` copies `apps/web/dist` into `www/`, adds a small bridge
script that defines `window.MatchFeedNative`, and syncs it into the native projects. This
directory never edits `apps/web` or `packages/`.

Status (2026-10-19):

| | Builds here? | Notes |
|---|---|---|
| Android debug APK | **yes** | `android/app/build/outputs/apk/debug/app-debug.apk`, about 5.6 MB. Not run on a device or emulator (no KVM in the build container) |
| Android release APK (unsigned) | **yes** | `android/app/build/outputs/apk/release/app-release-unsigned.apk`, about 4.3 MB. Needs a signing key (see docs/SHIPPING.md) |
| iOS | project generated, **not built** | needs a Mac with Xcode; steps below |

## Layout

```
brand.json                 name, app id, URL scheme, publisher (the one place to rename)
capacitor.config.ts        Capacitor config (reads brand.json)
bridge/types.ts            the window.MatchFeedNative contract (shared with apps/desktop)
bridge/links.ts            deep-link and share-text classifier (pure, tested)
bridge/native-bridge.ts    MatchFeedNative over Capacitor plugins
scripts/sync-web.mjs       apps/web/dist -> www/ (+ bridge tag, branding; drops sw.js and the source map)
scripts/build-bridge.mjs   bundles the bridge into www/native-bridge.js (esbuild, IIFE)
scripts/apply-brand.mjs    writes brand.json into Android/iOS/desktop native files
scripts/android-debug.mjs  gradle assembleDebug with 429 retries; prints APK size and SHA-256
android/                   Gradle project (MainActivity, manifest, resources are ours; see below)
ios/                       Xcode project (Swift Package Manager; MainViewController.swift is ours)
ios-share-extension/       source for the iOS Share Extension target (added in Xcode on a Mac)
test/links.test.ts         node:test
```

## Commands

Requires Node 22.6+. Android also needs JDK 21 and the Android SDK; iOS needs macOS with Xcode.

```sh
cd apps/mobile
npm ci                     # .npmrc: ignore-scripts, save-exact
npm test                   # link classifier tests (offline)
npm run typecheck
npm run sync               # web build -> www/ -> android/ and ios/ (runs apps/web `npm run build` only if dist/ is missing)
npm run android:debug      # sync + debug APK
npm run ios:open           # sync + open Xcode (macOS)
npm run apply-brand        # after editing brand.json
```

### Android SDK without Android Studio

What this container used (all downloads from dl.google.com went through the proxy fine):

```sh
mkdir -p ~/android-sdk/cmdline-tools && cd ~/android-sdk/cmdline-tools
curl -O https://dl.google.com/android/repository/commandlinetools-linux-16111833_latest.zip
sha1sum commandlinetools-linux-16111833_latest.zip   # e025545c62a8e64c7559119566a569fb1dec5f60 (from repository2-3.xml)
unzip commandlinetools-linux-16111833_latest.zip && mv cmdline-tools latest
export ANDROID_HOME=~/android-sdk
yes | latest/bin/sdkmanager "platforms;android-36" "build-tools;35.0.0"
echo "sdk.dir=$ANDROID_HOME" > ~/…/apps/mobile/android/local.properties
```

`sdkmanager` now wraps the new "Android CLI" and prints a deprecation notice; `--licenses` is a
no-op, and licenses are accepted when packages are installed with `yes |`. Capacitor 8.5.2 needs
compileSdk/targetSdk 36 (Google Play requires API 36 for new apps and updates since 31 Aug 2026),
minSdk 24, AGP 8.13.0, Gradle 8.14.3 and Java 21. Maven Central sometimes answers 429 (rate
limiting) to shared egress; `npm run android:debug` retries.

Dependency integrity: `android/gradle/verification-metadata.xml` records SHA-256 for every Maven
artifact (549 components). Gradle fails the build if a downloaded artifact doesn't match. After
changing Android dependencies, regenerate it with
`./gradlew --write-verification-metadata sha256 assembleDebug assembleRelease` and review the diff.

### iOS on a Mac

1. `npm ci && npm run sync && npx cap open ios` (Xcode 26 or later; Capacitor 8 uses Swift Package Manager, no CocoaPods).
2. Let Xcode resolve packages, then commit `ios/App/App.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved`. The generated `Package.swift` uses `from:` ranges for plugin dependencies (KeychainSwift, transistor-background-fetch), so the resolved file is what pins them.
3. Signing & Capabilities for target **App**: your team; add **App Groups** with `group.school.multiverse.memevideo`; **Background Modes** is already in Info.plist (fetch, processing).
4. Share extension: File > New > Target > Share Extension, name `ShareExtension`, bundle id `school.multiverse.memevideo.ShareExtension`. Replace its `ShareViewController.swift` and `Info.plist` with the files in `ios-share-extension/`, delete the generated storyboard, add the same App Group, set its deployment target to 16.0.
5. Product > Run on a device. Check the items in "Test on a device" below.
6. Archive > Distribute > TestFlight (docs/SHIPPING.md, Phase 3).

The deployment target is iOS 16.0 (raised from Capacitor's 15.0): the page CSP uses
`'wasm-unsafe-eval'`, which WebKit supports from Safari 16.

## Native integrations

All plugins are installed with exact versions, each published at least two weeks before 2026-10-19.
Activity data comes from npm, Maven Central and ecosyste.ms, queried 2026-10-19 (the GitHub API was
not reachable from this container).

| Need | Plugin (version) | License | Activity | What we checked |
|---|---|---|---|---|
| Secure key storage | `@aparajita/capacitor-secure-storage` 8.0.1 | MIT | last push 2026-09-23, 173★, 2 open issues | Android: a per-item AES-256-GCM key generated in **AndroidKeyStore**, ciphertext in SharedPreferences. iOS: **Keychain** via KeychainSwift; iCloud sync off by default and we pass `sync=false` explicitly |
| Background fetch | `@transistorsoft/capacitor-background-fetch` 8.1.3 + `com.transistorsoft:tsbackgroundfetch` **4.1.1** (pinned in `variables.gradle`; the plugin asks for `4.1.+`) | MIT (npm and Maven POM; no LICENSE file in the npm tarball) | npm 2026-04-21, 91★ | Wakes the app about every 15 min at most (the OS decides; iOS can take days to start). JS runs in the WebView, so it works only while the app process exists: `stopOnTerminate: true`, no headless mode |
| Share target | `@capgo/capacitor-share-target` 8.0.54 (**iOS only** in practice) | MPL-2.0 (file-level copyleft on its own files; fine to bundle with Apache-2.0, no AGPL) | push 2026-10-15, 20★; publishes very often (pin and review each bump) | **Android cold start is not handled** (it only listens to `onNewIntent`) and it copies shared files to cache, so Android shares go through our `MainActivity` instead (text/plain only). iOS reads an App Group written by our share extension |
| Deep links | `@capacitor/app` 8.1.2 | MIT | official (ionic-team/capacitor-plugins, push 2026-10-07) | `appUrlOpen` + `getLaunchUrl` for `nostr:` and the app scheme |
| Local notifications | `@capacitor/local-notifications` 8.3.1 | MIT | official, push 2026-10-14 | Defaults to **exact alarms** since 8.3.0, which opens the "Alarms & reminders" settings and needs `SCHEDULE_EXACT_ALARM` (Play restricts it). We schedule with `isExactNotification: false` and remove that permission and `RECEIVE_BOOT_COMPLETED` from the manifest |

Final Android permissions (`aapt2 dump permissions`): `INTERNET`, `WAKE_LOCK`, `POST_NOTIFICATIONS`.

Not used: `@capacitor/background-runner` (runs a separate JS engine with no access to the
WebView's IndexedDB vault, where the MatchBook lives), Firebase / Google services (removed from
the Gradle files; F-Droid), `CapacitorHttp` / `CapacitorCookies` (off: they would bypass CORS and
the CSP's `connect-src`).

`npm audit` reports 3 moderate findings, all `uuid` < 11.1.1 (GHSA-w5hq-g745-h8pq) under the
`xcode` package that `@capacitor/cli` uses to edit Xcode projects at build time. It is not shipped
in the app, and the affected calls (v3/v5/v6 with a caller-supplied buffer) aren't used there.

## The bridge: `window.MatchFeedNative`

Contract: [`bridge/types.ts`](bridge/types.ts) (also used by apps/desktop). In a browser it is
undefined; the web app must keep working without it. It is defined before `app.js` runs (the sync
step inserts `<script src="native-bridge.js">` ahead of the deferred `app.js`), and it is frozen and
non-configurable.

```ts
interface MatchFeedNative {
  version: 1;
  platform: "android" | "ios" | "desktop";
  secrets: { get(name), set(name, value), remove(name) };     // names: "nostr-secret-key" | "vault-key"
  incoming?: { onIncoming(handler: (item: Incoming) => void): () => void };   // queued until registered
  notifications?: { permission(), requestPermission(), notify({id, title, body, route}), onOpen(handler) };
  background?: { enable(handler, {minimumIntervalMinutes}), disable() };
}
```

### Hooks apps/web needs to implement

None of this is done; apps/web is being edited by someone else. In order of value:

1. **Feature detection.** `const native = (globalThis as any).MatchFeedNative as MatchFeedNative | undefined;` Copy or import the types from `apps/mobile/bridge/types.ts`.
2. **Vault key in the OS keystore** (`src/lib/vault.ts`, device mode). When `native` exists: `secrets.get("vault-key")`; if null, generate 32 random bytes, `secrets.set("vault-key", base64)`; then `crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt","decrypt"])` and don't store any key in IndexedDB. Migrate existing device-key records by re-encrypting them (the passphrase on/off path already does this in one transaction). The crypto-shredding wipe must also call `secrets.remove("vault-key")`. Passphrase mode stays as it is. Update the "Encryption at rest" copy and THREAT_MODEL T9: the key is now wrapped by Android Keystore / iOS Keychain (`AfterFirstUnlockThisDeviceOnly`, so background checks work while the phone is locked), but JS still holds the raw key briefly and a malicious build can still read it.
3. **Match identity key** (`src/lib/match/identity.ts`). Store a local secret in `secrets.set("nostr-secret-key", hex)` instead of the vault's `identity` record (keep the pubkey there). Removing the identity calls `secrets.remove`. iOS uses `WhenUnlockedThisDeviceOnly` for it.
4. **Incoming links and shares.** After the vault is open (after any passphrase prompt), call `native.incoming?.onIncoming(item => …)` once:
   - `kind: "nostr"`: decode `item.value` with `src/lib/bech32.ts` (it is only shape-checked natively; `nprofile` needs TLV decoding to get the pubkey), then open Matches > Request a match with it filled in. Never act without the user confirming.
   - `kind: "peertube-watch"`: `item.host` + `item.videoId`. Ask before contacting a host that isn't already a catalog instance (the request reveals the user's IP to it), then resolve with core's `getVideo` and open the watch overlay, or offer "Follow channel".
5. **Notifications (opt-in, off by default).** A switch in Matches or Sharing & privacy. On turning it on, call `requestPermission()` from that tap. After a relay check that finds a new request or accept, `notify({ id, title: "New match request", body: "Open Meme Video to review it.", route: "matches" })`, with no petname, npub or video in the text (lock screen). `id`: a stable 31-bit number per event so repeats replace each other. `onOpen(route)` navigates.
6. **Background checks (opt-in, off by default).** A switch "Check for match messages in the background". `background.enable(async () => { await service.check(); })`, where the check runs without UI: open the vault (device mode only; disable the switch in passphrase mode, since there's nobody to type it), fetch from relays, `sendDueSketches`, persist the MatchBook, maybe `notify`. Must finish in about 25 s. Tell the user plainly that relays then see check-ins at times the OS picks, not only while the app is open (T5).
7. **Labels.** Use `native.platform` in the storage panel ("Key stored in Android Keystore" / "iOS Keychain" / "OS keychain").
8. **Product name in the UI.** The header and other copy say "Match Feed". The shell sets `<title>` and the manifest name from `brand.json`, but text inside `app.js` comes from apps/web. Read the name from one constant there (or from `document.title` at boot) so a rename is one edit.
9. **No changes needed:** the service worker (sync drops `sw.js`; registration is https-only and already `.catch`es), `target="_blank"` links (Capacitor opens external URLs in the system browser), the player iframe's `allow="autoplay; fullscreen; picture-in-picture"` (already set).

## WebView model, video and CSP

Origins: Android serves `www/` from `https://localhost` (a secure context: WebCrypto,
IndexedDB, `crypto.subtle`), iOS from `capacitor://localhost`. Both are first-party for storage, so
the vault works as in a browser.

**CSP.** The live build's meta CSP is unchanged
(`default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; … frame-src 'self' https:; …`).
- `'self'` covers `https://localhost` and `capacitor://localhost`, so `native-bridge.js`, `app.js` and `psi-frame.html` load.
- Capacitor's own runtime is injected as a document-start script, which the page CSP doesn't apply to: on Android through `WebViewCompat.addDocumentStartJavaScript` (limited to the app origin), on iOS through a `WKUserScript` (main frame only). **Risk, Android:** on WebViews without `DOCUMENT_START_SCRIPT`, Capacitor falls back to injecting an inline `<script>`, which this CSP blocks, so the bridge would silently be missing. `MainActivity` refuses to start on such WebViews (see below).
- PeerTube instances send `Access-Control-Allow-Origin: *` on their API, so `fetch` from `https://localhost` or `capacitor://localhost` works like it does from a website. `credentials: "omit"` still applies.
- **PSI frame (risk to test on iOS).** `psi-frame.html` runs sandboxed (`allow-scripts` only, opaque origin) with its own CSP `script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'`. On Android (Chromium) it behaves as in Chrome. In WebKit, `'self'` inside an opaque-origin sandboxed document must resolve to the document URL's origin (`capacitor://localhost`) for `psi.js` to load; I could not test this without a device. If previews say "Preview unavailable" on iOS, change that frame's CSP to list the app origins explicitly (`capacitor://localhost https://localhost tauri://localhost http://tauri.localhost`) in apps/web. The frame posts to its parent with `"*"`, which is unchanged in a WebView.

**The native bridge must not be reachable from PeerTube embeds.** Third-party instance JavaScript runs in the embed iframes.
- *Android:* modern WebViews get `addWebMessageListener` restricted to the app origin. Old WebViews fall back to `addJavascriptInterface`, which every frame can call. `MainActivity` checks `WEB_MESSAGE_LISTENER` and `DOCUMENT_START_SCRIPT` and, if either is missing, shows "update Android System WebView" instead of loading the app.
- *iOS:* `MainViewController` replaces Capacitor's script-message handler with one that forwards only main-frame messages from the app origin (defense in depth; see private security notes).

**Video.**
- iOS (`MainViewController`, same as Capacitor's defaults, restated): `allowsInlineMediaPlayback = true`, `mediaTypesRequiringUserActionForPlayback = []` (Reels' muted autoplay and the embed API's `play` work without a tap), AirPlay and Picture in Picture allowed. The embed URL already carries `autoplay=1&muted=1`. **Unverified:** inline playback on iPhone also needs `playsinline` on the `<video>` inside PeerTube's player; PeerTube's embed docs don't mention it. If videos jump to fullscreen on iPhone, that is the cause, and it can only be fixed upstream or by not autoplaying on iOS.
- Android: hardware acceleration on (application and activity), `allowMixedContent: false` (Capacitor default; no http media inside the https page), Capacitor sets `setMediaPlaybackRequiresUserGesture(false)`, fullscreen through `BridgeWebChromeClient.onShowCustomView`.
- `p2p=0` stays the default (T6). WebRTC P2P in a WebView behaves as in the browser if the user turns it on.

**Other hardening in this directory.**
- `android:allowBackup="false"` plus `data_extraction_rules.xml` excluding everything: the vault and the Keystore-wrapped secrets never go to Google Drive or device-to-device transfer.
- `network_security_config.xml`: no cleartext except `127.0.0.1`/`localhost` (the dev relay via `adb reverse tcp:7777 tcp:7777`); system CAs only.
- `server.url` is never set (it would load remote code into the native bridge); `allowNavigation` is empty; `webContentsDebuggingEnabled: false` (turn it on locally to debug with `chrome://inspect` or Safari).
- iOS keychain items use `ThisDeviceOnly` accessibility, so they never sync to iCloud Keychain or restore onto another device.

## Deep links and the share sheet

| Input | Android | iOS |
|---|---|---|
| `nostr:npub1…`, `nostr:nprofile1…` (NIP-21) | intent filter `nostr:` (other Nostr apps register it too; Android shows a chooser) | `CFBundleURLSchemes` `nostr` (iOS picks one app if several claim it) |
| PeerTube watch URL (`/w/<id>`, `/videos/watch/<id>`) | share sheet ("Share to Meme Video", `text/plain`) | share extension (URL or text) |
| PeerTube URL opened directly | not possible on arbitrary hosts: verified App Links / Universal Links need a file on each host. A future `https://<our domain>/open?…` link can be verified (commented template in the manifest) | same, with `apple-app-site-association` |

`bridge/links.ts` only pattern-matches: `nsec` and other entities are refused, URLs must be https
with no user info, and nothing is fetched by the shell.

## Test on a device (not done yet)

- [ ] App starts; `window.MatchFeedNative` exists (`chrome://inspect` / Safari Web Inspector with debugging turned on locally).
- [ ] Reels: muted autoplay, inline on iPhone, play/pause through the embed API, fullscreen and back.
- [ ] Match preview runs (PSI frame loads psi.js) on both platforms.
- [ ] `secrets.set/get/remove` round trip; value survives an app restart; gone after uninstall (Android) / not restored to a new device (iOS).
- [ ] Share a PeerTube link from Firefox/Chrome (Android) and Safari (iOS) with the app closed (cold start) and open.
- [ ] `nostr:npub…` link from another app.
- [ ] Notification permission prompt only after the opt-in tap; tapping a notification routes to Matches.
- [ ] Background fetch fires (Android: `adb shell cmd jobscheduler run -f school.multiverse.memevideo 999`; iOS: Xcode's simulate background fetch).
- [ ] The native bridge ignores everything except the app's main frame (test steps in the private security notes).
- [ ] TalkBack / VoiceOver pass over the main screens.
