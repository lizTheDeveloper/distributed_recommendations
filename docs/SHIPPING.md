# Shipping: from prototype to real apps

Status: draft v1, 2026-10-19. Companion to `THREAT_MODEL.md`, `OSS_STACK.md` and `WEB_APP.md`.
Native shells: [`apps/mobile`](../apps/mobile/README.md) (Capacitor 8, Android and iOS) and
[`apps/desktop`](../apps/desktop/README.md) (Tauri 2).

Store-policy claims were checked against the official pages on 2026-10-19 and are linked inline.
**[unverified]** marks claims I could not confirm from a primary source.

## Owner decisions so far

| Decision | Value | Status |
|---|---|---|
| Product name | **Multiverse Video** (display name), published under Multiverse Games | Decided 2026-10-19 by the owner. Not screened in [`NAMING.md`](NAMING.md); a USPTO/EUIPO knockout search is still owed before the first store listing ("Multiverse" is a crowded word: WB's *MultiVersus*, Multiverse the company). The name lives in `apps/mobile/brand.json` (`npm run apply-brand` writes it into the Android, iOS and desktop projects) and in the web app's `index.html`, `manifest.webmanifest` and header |
| Publisher | Multiverse Games | Needs to be a legal entity for organization store accounts (see Decisions) |
| App id / bundle id | `ai.multiversegames.video` | Reverse DNS for `multiversegames.ai`, which the publisher controls. After a store release the id can't change without creating a new listing |
| Platform order | Web/PWA first, then **Android**, then iOS, then desktop | Decided |
| Hosting | `https://video.multiversegames.ai`: a static nginx container on the Multiverse Games server behind Traefik, access logs off, security headers set by the server. IPFS mirror still planned | Decided 2026-10-19 |

## Where things stand

| Target | State on 2026-10-19 |
|---|---|
| Web/PWA (`apps/web`) | works; installable; service worker caches the shell |
| Android (`apps/mobile/android`) | **debug APK builds** (5.6 MB) and an unsigned release APK (4.3 MB), with the Android SDK installed from dl.google.com in the build container. Not yet run on a device |
| iOS (`apps/mobile/ios`) | Xcode project generated (SPM, iOS 16+); needs a Mac to build |
| Desktop (`apps/desktop`) | **Linux .deb builds** (2.9 MB) and runs (video plays with GStreamer codecs installed); macOS/Windows not built |
| Native features | secure key storage, background fetch, share target, deep links and opt-in notifications are wired in the shells behind `window.MatchFeedNative`; **apps/web doesn't call them yet** (hook list in apps/mobile/README.md) |

---

## Phase 1: production web app / PWA

The web app is the base for every other target, and the fallback when stores remove the app (T17).

### Hosting

The release pipeline already exists: [`DEPLOY.md`](DEPLOY.md) (`.github/workflows/deploy-web.yml`) builds `apps/web/dist`, attests it, and can publish to GitHub Pages, Cloudflare Pages and IPFS (CID plus DNSLink record in the job summary). Nothing deploys until the owner opts in. The table below is for choosing which of those to turn on.

| Option | Pros | Cons |
|---|---|---|
| **Codeberg Pages** | nonprofit (Germany), FOSS-aligned, free | custom headers limited **[unverified]**; smaller CDN |
| GitHub Pages | free, simple CI | no custom HTTP headers (CSP stays a meta tag, so no `frame-ancestors`); US company |
| Cloudflare Pages / Netlify | `_headers` file for CSP, HSTS, `frame-ancestors`; global CDN | the CDN sees every visitor's IP and request times; commercial dependency |
| Own VPS with Caddy | full control of headers and logs (can log nothing) | we operate it (patching, uptime, DDoS) |
| **IPFS mirror** (decided) | content-addressed and censorship-resistant: anyone can pin and serve the exact build; the CID is a checksum of the release | see notes below |

Notes for the IPFS mirror:
- **Origin matters.** The vault, follows and settings are stored per origin. Each subdomain-gateway URL `https://<cid>.ipfs.<gateway>` is a new origin, so every release would start empty. Publish through **DNSLink** on a stable name (`_dnslink.<sub>.<domain>` TXT record) and link to `https://<sub-domain-with-dashes>.ipns.<gateway>`, which stays the same origin across releases. Tell users the mirror is a separate copy of their data from the main site.
- Use subdomain gateways only, never path gateways (`/ipfs/<cid>/`), which put every site on one origin.
- Pin each release with two or more independent pinning services plus our own Kubo node. Publish the CID in signed release notes.
- The meta CSP keeps working because everything is `'self'`.

Work items:
- [ ] Choose the primary host (recommendation: Codeberg Pages or a small VPS; Cloudflare only if we accept the IP exposure).
- [ ] Domain with HSTS (preload later). The CSP as an HTTP header, adding `frame-ancestors 'none'`; `Referrer-Policy: no-referrer`; `Permissions-Policy` turning off camera, mic and geolocation.
- [ ] Server logs off, or IP-truncated with short retention; say so in the privacy policy.
- [ ] Release script: build, hash, upload to the host, add to IPFS, update DNSLink, publish CID + SHA-256 + signature.

### Service worker, offline shell, installability (apps/web, after the current work lands)

- [ ] Precache the full shell (`index.html`, `app.js`, `app.css`, fonts, icons, `psi-frame.html/.js`, `psi.js`) at install, keyed by build hash. Keep "never cache API data or media".
- [ ] Update flow: when a new service worker is waiting, show "Update available, reload" instead of `skipWaiting()` on install, so a tab never runs mixed versions.
- [ ] Offline screen: the feed needs the network, so show the cached shell with "You're offline", local settings, Matches state and the history wipe.
- [ ] Manifest: `id`, `screenshots`, maskable icons, `shortcuts` (Reels, Matches), and **`share_target`** (Android Chrome lets an installed PWA receive shared PeerTube links, the PWA version of the native share sheet). `protocol_handlers` only accepts `web+` schemes outside a short safelist, so it would be `web+nostr`, not `nostr` **[unverified: check the current safelist]**.
- [ ] Lighthouse PWA/installability check in CI.
- [ ] The native shells drop `sw.js`. Keep registration guarded (it already `.catch`es and is https-only).

### Default relays

Today: **none by default** (WEB_APP.md); Match sends nothing until the user adds a relay.

| Option | Pros | Cons |
|---|---|---|
| Keep none; show a vetted suggestion list | nothing is sent without a choice; no operator liability | friction; most people pick the first suggestion anyway |
| Run our own relay | we can set retention (NIP-40 expiry honored, short TTL), no IP logs, NIP-42 AUTH, size limits that match the 64 KiB wraps; one known operator | we become a metadata observer (T5) and a legal target (A7/A8); uptime cost |
| Default to well-known public relays | zero ops | unknown logging and retention; metadata goes to third parties |

Self-hosted relay software:
- **strfry**: C++, GPL-3.0, last push 2026-09-04. Runs on our server, so the GPL doesn't touch the app. **Already packaged** in [`infra/relay/`](../infra/relay/README.md): strfry + Caddy, NIP-40 expiry, gift wraps deleted after 33 days, per-IP rate limits, no IP logging, NIP-42 optional.
- **nostr-rs-relay**: Rust, MIT, last push 2026-05-22. Simpler to operate.

Recommendation: keep "none by default" and offer one relay we run as a clearly labeled suggestion, with a published retention and logging policy. Choose inbox relays per NIP-17 once that lands.

### Privacy policy and terms

Both stores require a privacy policy URL and an in-app link ([Apple 5.1.1(i)](https://developer.apple.com/app-store/review/guidelines/#data-collection-and-storage); Google: "required to complete the Data safety form", [Data safety](https://support.google.com/googleplay/android-developer/answer/10787469)).

- [ ] **Privacy policy**, written from the Sharing & privacy ledger. Cover:
  - what stays on the device (history, the encrypted vault, the keystore key);
  - what goes to PeerTube instances the user picks (IP, which videos are looked up and played);
  - what goes to relays the user adds (encrypted, padded messages; IP and timing);
  - what goes to matches (sketches, with consent);
  - that **we run no analytics** (DAP is off: nothing is sent);
  - our own servers' logs, if any; retention; how to wipe (in-app wipe; uninstall);
  - children and age rating;
  - contact.
- [ ] **Terms / community rules**, needed for UGC on both stores. Play requires users to accept terms "before users can create or upload UGC" ([Play UGC policy](https://support.google.com/googleplay/android-developer/answer/9876937)). Accept on first use of: publishing a taste list, sending a match request.
- [ ] Legal review (GDPR controller question: are we a controller when we run no servers? If we run a relay, yes for that relay). VPPA exposure is low because we hold no history (THREAT_MODEL A9/T12).

### Report, block, moderation (store requirement)

[Apple 1.2](https://developer.apple.com/app-store/review/guidelines/#user-generated-content) (guidelines last updated 16 Oct 2026) requires, for apps with user-generated content: "A method for filtering objectionable material", "A mechanism to report offensive content and timely responses to concerns", "The ability to block abusive users from the service", and "Published contact information". 1.2 also allows incidental NSFW from a web-based service only if it is "hidden by default and only displayed when the user turns it on via your website". [1.2.1(a)](https://developer.apple.com/app-store/review/guidelines/#creator-content) adds an age-restriction mechanism for creator-content apps.

Google Play's [UGC policy](https://support.google.com/googleplay/android-developer/answer/9876937) requires: terms acceptance, defined objectionable content, ongoing moderation "consistent with the type of UGC", in-app reporting of "users and content", and in-app blocking for one-to-one features (Match is one).

Our UGC: PeerTube videos shown in the feed (hosted by instances), taste lists, match requests from strangers, creator npubs.

- [ ] **Filter:** hide PeerTube `nsfw: true` videos by default. On iOS, keep them hidden with no in-app switch (1.2's "via your website" rule; we have no website account). Subscribable on-device labelers (T18) later.
- [ ] **Block:** block a pubkey (drop its match requests and sketches, hide its taste lists) and hide a channel (exists as "hidden creators"). Store blocks in the vault.
- [ ] **Report:** "Report video" opens the origin instance's abuse flow (PeerTube has an abuse API; whether it accepts anonymous reports is **[unverified]**); "Report user/list" goes to our moderation inbox (email or form) with the event id. Write down a response-time target.
- [ ] **Contact:** in-app About, plus the store listings.
- [ ] **Age rating** questionnaires (IARC on Play; Apple's age rating) answered honestly for unmoderated third-party video. Expect 17+/Mature. Decide whether to require a declared age (1.2.1(a)).
- [ ] App Review notes: explain that videos come from PeerTube instances the user picks, show the filter, report and block flows, and say that "Match" is not dating (avoid the "random or anonymous chat" reading of 1.2).

### Crash reporting without tracking

**In progress in apps/web (another workstream):** opt-in telemetry with three separate switches, all off by default and asked once after some use: crash reports (GlitchTip via `@sentry/browser`, loaded only after opt-in), bug reports sent only on "Send", and Umami usage analytics. Each is compiled out when its build-time endpoint is empty (`MF_GLITCHTIP_DSN`, `MF_UMAMI_*`). Consequences for shipping:
- **Store builds:** if a build ships with a crash or analytics endpoint, declare it in Play Data safety ("Crash logs", "Diagnostics", "App interactions": optional, user-consented) and Apple privacy labels. Opt-in data is still "collected"; Apple's optional-disclosure criteria require that collection be infrequent *and* outside the app's primary use, and ongoing collection "after an initial request for permission must be disclosed".
- **F-Droid:** build with empty endpoints, or the listing gets the **Tracking** anti-feature, which applies "even when this can be turned off" ([Anti-Features](https://f-droid.org/docs/Anti-Features/)).
- **Native shells:** no change needed: the CSP's `connect-src https:` allows the endpoints, and `crash.js` loads from `'self'`.
- The privacy policy must name the GlitchTip and Umami hosts, what they receive and their retention.

Options, for reference:

| Option | Pros | Cons |
|---|---|---|
| **None** (start here) | nothing to disclose; F-Droid-friendly | blind to crashes |
| Opt-in "Send report" button that opens the share sheet or email with a scrubbed error (no history, no video ids, no keys) | user sees and sends it; no SDK | manual; low volume |
| ACRA (Android; Apache-2.0, active, push 2026-10-15) with its dialog + email or own-server sender | mature, self-hosted | Android only; must scrub WebView errors |
| Self-hosted GlitchTip (Sentry protocol; license **[unverified]**) | dashboards | another server; any automatic sending is "Tracking" for F-Droid and must be declared in Data safety / privacy labels |
| Sentry SaaS | easy | FSL-licensed server, third-party data flow; contradicts "no analytics SDKs" (THREAT_MODEL Process 5) |

Recommendation: ship F-Droid and the first store builds with crash and analytics endpoints empty (bug reports only), and turn on opt-in crash reports once the privacy policy and store declarations cover them.

### Accessibility and i18n

- [ ] WCAG 2.2 AA audit: axe-core in CI, a manual pass with keyboard, VoiceOver (iOS/macOS), TalkBack (Android) and Orca (Linux). Reels needs particular care: focus order in the rail, labels (they exist), autoplay respecting `prefers-reduced-motion`, captions from PeerTube.
- [ ] Contrast in both themes; dynamic type / zoom to 200%; safe-area insets in the WebViews (viewport-fit=cover is set).
- [ ] i18n: extract strings, ICU message format, locale-aware dates and numbers, RTL (Android `supportsRtl` is on). Weblate for community translation. Start with English, French and German (most PeerTube instances are French or German).

---

## Phase 2: Android (first native target)

### Google Play

- [ ] **Account type.**
  - Organization: needs a D-U-N-S number ("You will not be able to create a developer account for an organization without one"), a website, and verified contact details ([Play Console requirements](https://support.google.com/googleplay/android-developer/answer/13628312)).
  - Personal accounts created after 13 Nov 2023 must run a closed test "with a minimum of 12 testers who have been opted in continuously for at least 14 days" before production ([testing requirements](https://support.google.com/googleplay/android-developer/answer/14151465)); the page doesn't say this applies to organizations.
  - One-time registration fee: US$25 **[unverified on the pages read; confirm in Console]**.
- [ ] **Target API:** "New apps and app updates must target Android 16 (API level 36) or higher" since 31 Aug 2026 ([target API](https://support.google.com/googleplay/android-developer/answer/11926878)). The project targets 36.
- [ ] Upload an **AAB** (`./gradlew bundleRelease`). Decide on Play App Signing (Google holds the app signing key, we hold an upload key) versus our own key. F-Droid's reproducible-build path wants the APK signed with our key, so keep our own key for direct and F-Droid builds either way.
- [ ] **Data safety form.** "Collection" is "transmitting data from your app off a user's device". Data processed only on the device isn't collected. End-to-end encrypted data that no intermediary, including the developer, can read doesn't need disclosing ([Data safety](https://support.google.com/googleplay/android-developer/answer/10787469)). Suggested answers, to review with counsel:
  - Watch history, endorsements, follows, taste lists: **not collected** (on device only, encrypted).
  - Sketches and previews to matches: end-to-end encrypted (NIP-44 gift wraps, PSI), so **not disclosed**; describe them in the privacy policy anyway.
  - Requests to PeerTube instances and relays the user picks carry the IP and which videos are looked up. These go to third parties the user chooses, not to us. Google's page doesn't address user-chosen third-party servers. The conservative answer is "App activity: other actions / App interactions, shared with third parties chosen by the user, not used for tracking". **If we run a default relay or instance, its data is collected by us and must be declared.**
  - Encrypted in transit: yes (https/wss only).
  - Deletion: data lives on the device; in-app wipe and uninstall delete it. There are no accounts. A Nostr identity is a local key, so offer "Remove identity" (it exists) and explain that relays may keep published events.
- [ ] Content rating (IARC), target audience (not children), UGC declarations, ads: none.
- [ ] Reviewer access notes (no login; how to see Reels, Matches with the demo relay).
- [ ] Permissions are already minimal: `INTERNET`, `WAKE_LOCK`, `POST_NOTIFICATIONS`. No exact alarms (Play restricts `SCHEDULE_EXACT_ALARM`), no boot receiver, backups off.

### Android developer verification (affects F-Droid and sideloading too)

Per [developer.android.com/developer-verification](https://developer.android.com/developer-verification):
- "Protections begin for all users who install apps from participating stores in Brazil, Indonesia, Singapore, and Thailand on certified devices running Android 7+" on **30 Sep 2026**.
- "Verification capability will be expanded globally for all apps on certified Android devices in 2027."
- Play registers most Play apps automatically. Apps distributed outside Play are registered through the Android Developer Console.
- "Limited distribution accounts" let "students, teachers, and hobbyists … share apps with up to 20 devices without a government-issued ID or registration fee".
- A power-user "advanced flow" for unverified apps is planned. How ADB installs are treated isn't stated on that page.
- F-Droid opposes the program ([open letter, Feb 2026](https://f-droid.org/2026/02/24/open-letter-opposing-developer-verification.html)).

- [ ] Register `ai.multiversegames.video` and our signing key once the account exists, so direct-APK and F-Droid builds (signed with our key; see below) install on certified devices in 2027.

### F-Droid

[Inclusion policy](https://f-droid.org/docs/Inclusion_Policy/): FLOSS only. Built from source by F-Droid. "proprietary tracking or advertising libraries and analytics tools" are "strictly forbidden", with Google Play Services, Firebase and Crashlytics named. "Prebuilt binaries should only come from authorized trusted sources", and Maven artifacts "must still be freely licensed, simply being included in one of those repositories is not enough".

- [x] No Play Services or Firebase: the `google-services` Gradle plugin was removed from the generated project.
- [ ] **Possible blocker:** `com.transistorsoft:tsbackgroundfetch` 4.1.1 comes as a prebuilt AAR from Maven Central (MIT, source at github.com/transistorsoft/transistor-background-fetch). F-Droid may require building it from source (an srclib) or a flavor without it. Alternative: replace it with a ~100-line WorkManager plugin of our own.
- [ ] Capacitor and plugin code comes from npm (`node_modules`). F-Droid builds need `npm ci --ignore-scripts` from the lockfile in its recipe, and must run `apps/web`'s build (esbuild, from npm) to produce `www/`.
- [ ] **Anti-features** ([list](https://f-droid.org/docs/Anti-Features/)): none expected today. "Tracking" would apply if any crash or analytics reporting is added without opt-in. "NonFreeNet"/"TetheredNet" don't apply (PeerTube and Nostr are open, replaceable networks), provided there's no hard-coded server we run.
- [ ] **Reproducible builds** ([F-Droid](https://f-droid.org/docs/Reproducible_Builds/)): with `Binaries:` and `AllowedAPKSigningKeys`, F-Droid publishes **our** signed APK only if its rebuild is identical apart from the signature ("the APKs must be completely identical before and after signing"). That gives one signing key across direct download and F-Droid (and, with Play App Signing off, Play). Needs pinned JDK, build-tools and Node, deterministic esbuild output, `SOURCE_DATE_EPOCH`, and no build timestamps.

### Direct APK (sideload)

- [ ] Signed release APKs on Codeberg/GitHub Releases with SHA-256 and a Sigstore signature; works with Obtainium.
- [ ] Explain verification (`apksigner verify --print-certs`, published certificate fingerprint).
- [ ] Register with Android developer verification before the 2027 global rollout.

---

## Phase 3: iOS

- [ ] **Apple Developer Program**, organization enrollment ([requirements](https://developer.apple.com/support/enrollment/)): "your organization must be a legal entity … We don't accept DBAs, fictitious businesses, trade names, or branches"; a D-U-N-S Number; a work email on the organization's domain; a public website on that domain. A sole proprietor "must join as an individual and your legal name will appear as the seller". Fee: 99 USD per year.
- [ ] **Fee waiver** ([details](https://developer.apple.com/support/membership-fee-waiver/)): for nonprofits, accredited educational institutions and government entities, with no paid apps or in-app purchases. Check whether The Multiverse School qualifies (accreditation or nonprofit status).
- [ ] Build on a Mac: steps in apps/mobile/README.md (App Group, share extension target, commit `Package.resolved`).
- [ ] **App Review risks:**
  - **4.2 Minimum Functionality.** The app must be more than a "repackaged website", and 4.2.2 excludes apps that are primarily "web clippings, content aggregators, or a collection of links" ([4.2](https://developer.apple.com/app-store/review/guidelines/#minimum-functionality)). We are a wrapped web app that aggregates PeerTube, which is the main rejection risk. Mitigations:
    - native features that matter: Keychain-held keys, the share extension, opt-in notifications for match requests, background sketch delivery, offline shell;
    - the on-device ranking and Match are real functionality, not links;
    - say this in the review notes, with a demo path.
  - **1.2 UGC**: the Phase 1 checklist above. NSFW hidden by default with no in-app switch.
  - **5.1.1 privacy**: privacy policy in metadata and in the app; account deletion: "If your app supports account creation, you must also offer account deletion within the app". A local Nostr identity is arguably an account, so keep "Remove identity" prominent.
  - **5.1 privacy labels** ([App Privacy details](https://developer.apple.com/app-store/app-privacy-details/)): "Collect" means "transmitting data off the device in a way that allows you and/or your third-party partners to access it for a period longer than what is necessary to service the transmitted request in real time", and "Data that is processed only on device is not 'collected'". Same analysis as Play's Data safety form; Apple's page doesn't address end-to-end encryption or user-chosen servers.
  - **Privacy manifest** (`PrivacyInfo.xcprivacy`): add one for the app declaring required-reason APIs (UserDefaults via plugins, file timestamps). The background-fetch plugin ships its own.
  - **2.5.2**: apps "may not download, install, or execute code which introduces or changes features". All app code is in the bundle (`server.url` is never set). PeerTube embeds are web content, not app code.
  - **Export compliance**: we use AES-GCM and NIP-44 (ChaCha20) for our own data, beyond OS-provided TLS. That likely makes `ITSAppUsesNonExemptEncryption` true, plus US BIS self-classification. Apple's documentation page didn't render for me **[unverified]**; get advice before the first upload.
- [ ] **GPL/AGPL.** Our code is Apache-2.0. Bundled third-party code is MIT, 0BSD, Apache-2.0, OFL (fonts) and MPL-2.0 (`@capgo/capacitor-share-target`, file-level copyleft; fine). **Nothing GPL or AGPL may be bundled**: the FSF's position is that App Store terms add restrictions the GPL forbids ([FSF, 2010](https://www.fsf.org/blogs/licensing/more-about-the-app-store-gpl-enforcement)). That rules out copying code from the PeerTube web client (AGPL-3.0), Framasoft's app (GPL-3.0+), NewPipe (GPL-3.0) or Thorium (AGPL). Loading a PeerTube instance's embed at runtime is not bundling. Add a CI license check (`npm ls` licenses, `cargo deny`).
- [ ] **TestFlight** ([TestFlight](https://developer.apple.com/testflight/)): up to 100 internal testers; "up to 10,000 external testers"; the first build for external testing must be "approved by App Review for TestFlight".
- [ ] Device test list in apps/mobile/README.md (inline autoplay needs `playsinline` inside PeerTube's player, **[unverified]**; PSI frame CSP in WebKit; bridge frame filter).

---

## Phase 4: desktop (Tauri)

- [x] Linux: .deb builds and runs here. It depends on GStreamer `plugins-good`, `plugins-bad` and `libav` for video.
- [ ] Linux: a **Flatpak** on Flathub (the runtime provides codecs) instead of an AppImage. An AppImage can only play video by bundling GStreamer, which on Ubuntu pulls in GPL-built FFmpeg, libx264 and libx265 (tested: the Debian copyright file says the binaries are GPL v2+). `bundle.targets` excludes AppImage for that reason.
- [ ] **macOS**: Developer ID signing and notarization (`notarytool`), hardened runtime. Included in the 99 USD/year Apple Developer Program (same membership as iOS). Then move keychain items to the data-protection keychain (needs a signed app with a keychain access group).
- [ ] **Windows**: Authenticode signing, or SmartScreen warns on every download.
  - Microsoft's Azure **Artifact Signing** (formerly Trusted Signing) lists Basic (5,000 signatures/month) and Premium (100,000) tiers ([pricing](https://azure.microsoft.com/pricing/details/artifact-signing/)); the prices and eligibility for individuals or new organizations didn't load **[unverified]**.
  - Alternative: an OV/EV certificate from a CA on a hardware token (typically a few hundred USD per year **[unverified]**).
  - The Microsoft Store is another distribution path that handles signing.
- [x] Auto-update **off** (supply-chain risk, T13). Users install signed releases. If it's turned on later: `tauri-plugin-updater` refuses unsigned artifacts and its check can't be disabled ([Tauri updater](https://v2.tauri.app/plugin/updater/)); keep the minisign key offline or HSM-backed, and serve `latest.json` from our own static host.
- [ ] Desktop hooks: external links need a scoped `https`-only opener; no notifications or background yet.

Rough recurring costs: Apple 99 USD/yr (or waived); Windows signing (see above); Google Play one-time; domain; static hosting can be free; relay VPS (optional).

---

## Release engineering

- [ ] **Reproducible builds.**
  - Pin toolchains: Node, JDK 21, Android build-tools 35.0.0, Rust 1.97, by container image digest.
  - Lockfiles everywhere. Done: npm lockfiles (initial versions resolved with `--before=2026-10-05`); `Cargo.lock` checked against crate publish dates; Gradle `verification-metadata.xml` with SHA-256 for 549 artifacts.
  - `SOURCE_DATE_EPOCH`; deterministic esbuild output (no timestamps); Gradle reproducible archive settings.
  - Verify by building twice on different machines and diffing (`diffoscope`).
- [ ] **Signing and transparency.** Sign release artifacts with **Sigstore** (`cosign sign-blob`, keyless with the CI's OIDC identity, entries in the Rekor transparency log). Publish SHA-256 sums. Keep platform keys (Android signing, Apple, Windows) on hardware or in a managed HSM, with documented backup and recovery for the Android key (losing it means a new app id for direct and F-Droid users).
- [ ] **SLSA provenance**: build-provenance attestations from CI (SLSA Build L2 with hosted CI; L3 with isolated, ephemeral builders). Attach them to releases.
- [ ] **CI**: tests (core, match, bridge, web, mobile link tests, desktop `cargo test`), typechecks, `cargo check --locked` for all three desktop targets, Android `assembleRelease` with verification metadata, license check (no GPL/AGPL in shipped artifacts), `npm audit` / `cargo audit` reviewed, not auto-fixed.
- [ ] **Two-person release sign-off** (T13): one builds, one reproduces and co-signs.
- [ ] **Versioning.** SemVer for the app (`0.x` until the Match audit). Android `versionCode = major*10000 + minor*100 + patch`. iOS `CFBundleShortVersionString` = SemVer, build number increments. Protocol versions (event kinds, sketch format) versioned separately and listed in the public changelog (THREAT_MODEL Process 5).
- [ ] **Dependency updates**: Dependabot (14-day cooldown) already covers npm in apps/mobile and apps/desktop and Cargo in apps/desktop. **Add the `gradle` ecosystem for `apps/mobile/android`** (and regenerate `verification-metadata.xml` in those PRs). Read changelogs; nothing auto-merges. `@capgo/capacitor-share-target` publishes almost daily: review its diff on every bump.
- [ ] `security.txt` and a disclosure policy before the first store release.

---

## Decisions the owner must make

| Decision | Options | Tradeoffs | Recommendation |
|---|---|---|---|
| **Name / brand** | Decided: Multiverse Video | A house-brand name: easy to say, but descriptive and in a crowded word space, so a weak trademark. Changing later is cheap only before store release (display name is one file; the app id isn't) | Knockout search on "Multiverse Video" before the first store listing |
| **Domain** | Org domain subpath; a new product domain | Needed for: the privacy policy URL, the Apple org website requirement (on the org's domain), App Links/Universal Links, DNSLink for the IPFS mirror, and it should match the app id | A product subdomain on the org domain now; a separate domain later if the brand sticks |
| **Legal entity for store accounts** | Multiverse Games as an organization; an individual | Organization accounts need a legal entity plus D-U-N-S (both stores) and show the org as seller. Individuals show a personal legal name, and Play personal accounts need the 12-tester, 14-day closed test. Apple fee waiver only for nonprofit or accredited educational entities | Organization, if Multiverse Games is a legal entity; get the D-U-N-S number now (it can take up to 30 days) |
| **Hosting provider** (static + IPFS decided) | Codeberg Pages, VPS + Caddy, Cloudflare/Netlify, GitHub Pages | Header control and log policy versus operational load and IP exposure to a CDN | VPS + Caddy with no logs, or Codeberg; IPFS via DNSLink |
| **Platform order** | Decided: web, Android, iOS, desktop | Android first allows F-Droid and sideloading (T17) and avoids Apple's 4.2 risk while the app matures | Within Android: direct APK + F-Droid first, then Play once moderation tooling exists |
| **Default relay** | None; our relay as a suggestion; public relays | Privacy and liability versus friction | None by default, plus our relay as a labeled suggestion |
| **Crash reporting / telemetry** | Endpoints empty; opt-in GlitchTip crash reports; plus Umami usage | Visibility versus disclosure duties and F-Droid's Tracking anti-feature | Empty endpoints for F-Droid; opt-in crash reports on store builds after the policy covers them |
| **Signing key custody** | Play App Signing; own key everywhere | Google-held key versus one key across F-Droid, direct and Play | Own key in an HSM, with backup |
| **iOS content policy** | NSFW hidden with no switch; NSFW toggle via a website | Apple 1.2 allows NSFW only if "turned on via your website" | Hidden on iOS |
| **Background checks** | Off by default (opt-in); on | Relays see check-ins at OS-chosen times (T5) | Opt-in |
