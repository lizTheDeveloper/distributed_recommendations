# @match-feed/moderation

On-device moderation for Match Feed (shipped as "Multiverse Video"): reports, labelers, block lists and a
pre-filter for core `rank()`. It addresses THREAT_MODEL T18 (abuse and illegal content), and also T7 (spam)
and T8 (payola) through labels on curators and lists.

- TypeScript for Node 22 (`--experimental-strip-types`), using erasable syntax only. It also runs in browsers.
- The only runtime dependency is `nostr-tools` **2.25.2**, pinned with a lockfile. `.npmrc` disables install scripts. Only `src/nostr.ts` imports it.
- It imports `packages/core` by relative path (`src/core.ts`), the same way `packages/match` does.
- **It never sends anything on its own.** It builds report payloads, and the app shows them to the user. Only `submitAbuse({confirmed: true})` sends anything, and only after the user confirms. Relay access is read-only, and the tests use fake relays and a fake `fetch`.
- License: Apache-2.0.

```sh
npm test          # node:test, offline: 59 tests
npm run typecheck # tsc, strict
```

| Module | What it does |
|---|---|
| `reports.ts` | NIP-56 kind-1984 report builder (video, creator, taste list), optionally addressed to labelers (`labelers`: one untyped `["p", <labeler>]` tag each, as `services/labeler` intake expects); `parseReport`; `labelsFromReports` (reports from people you trust, with a threshold) |
| `peertube.ts` | `prepareAbuseReport` for `POST /api/v1/abuses`; `PeerTubeModerationClient` (injectable `fetch`): `submitAbuse` (requires confirmation), `resolveAccountId`, `instanceConfig`, `publicBlocklistLog`, `blockStatus`, `instanceDefaults`; `parseMuteFeed`, `foldBlocklistActions` |
| `plan.ts` | `planReport`: one Report button produces a PeerTube report to the hosting instance (primary) plus an optional NIP-56 event and notes for the confirmation screen |
| `labels.ts` | NIP-32 kind-1985 parsing (mark rules, `ugc`, NIP-40 expiry, NIP-09 retraction); `selfLabels` (including NIP-36 `content-warning`); `fetchLabels` (filters by labeler only); `LabelIndex`; `buildLabelEvent` for labeler tooling |
| `policy.ts` | settings (`nsfw` / `violence` hide·blur·show, labelers, rules), `DEFAULT_LABEL_RULES` vocabulary, `APP_STORE_SETTINGS`, `setSensitiveMode` (two-step adult opt-in), strict parse/serialize |
| `blocks.ts` | serializable `BlockState` (creators, instances, npubs, tags, keywords, videos, taste lists, imported mute lists), `BlockMatcher` |
| `mutelist.ts` | NIP-51 kind-10000 public mute list import (`p`, `t`, `word`) |
| `moderate.ts` | `applyModeration`, `attachVerdicts`, `moderateVideo`, `publicSubjects`, `peertubeVideoMeta`, `videoTargetKeys` |
| `relay.ts` | minimal read-only NIP-01 REQ client (injectable WebSocket) |

## App-store requirements (verified 2026-10-19)

**Apple App Review Guideline 1.2, User-Generated Content**
(https://developer.apple.com/app-store/review/guidelines/#user-generated-content). Apps with UGC "must include":

> - A method for filtering objectionable material from being posted to the app
> - A mechanism to report offensive content and timely responses to concerns
> - The ability to block abusive users from the service
> - Published contact information so users can easily reach you

It also says: "If your app includes user-generated content from a web-based service, it may display incidental
mature 'NSFW' content, provided that the content is hidden by default and only displayed when the user turns it on
via your website." 1.2.1(a) (creator content) asks for "a way for users to identify content that exceeds the app's
age rating, and use an age restriction mechanism based on verified or declared age to limit access by underage users."

**Google Play, User Generated Content policy** (https://support.google.com/googleplay/android-developer/answer/9876937).
Apps must have "robust, effective, and ongoing UGC moderation". The policy requires:
- terms of use that users accept before they create or upload UGC;
- a definition of objectionable content;
- moderation, "providing an in-app system for reporting and blocking objectionable UGC and users" and "taking action against UGC or users where appropriate".

Public UGC apps must offer in-app reporting of users and content and blocking of users. Incidental sexual content is
allowed only when it is "hidden by default behind filters that require at least two user actions in order to completely
disable". Child endangerment content is never "incidental". "Apps whose primary purpose is featuring objectionable UGC
will be removed from Google Play." Google's page names no contact-information requirement; Apple's does.

| Requirement | What this package gives | What the app or team still owes |
|---|---|---|
| Report content (Apple, Google) | `planReport` → PeerTube abuse report to the hosting instance plus NIP-56 event; `buildReport` for creators and taste lists | the Report UI; a PeerTube login so a report can be sent (PeerTube requires an account); publishing the signed NIP-56 event to the user's relays |
| Timely responses (Apple) | n/a | **someone must answer.** For hosted videos that is the instance operator. For our own labeler, we need a staffed queue (ROOST coop/osprey, OSS_STACK §13) |
| Block abusive users (Apple, Google) | `BlockState` (creators, npubs, instances, …), `applyModeration`, source dropping for matches and taste lists | Block buttons on cards, profiles, matches and lists; unmatch on block |
| Filter objectionable material (Apple, Google) | labelers (NIP-32), keyword/tag filters, PeerTube NSFW flags, instance blocklists | ship a default labeler subscription for store builds (we have no labeler yet: OSS_STACK §13) |
| NSFW hidden by default (Apple), two actions to disable (Google) | `APP_STORE_SETTINGS` (`nsfw: 'hide'`); `setSensitiveMode(…, 'show', {confirmAdult: true})` throws unless the second, explicit confirmation is passed | on iOS, put the NSFW switch on our website rather than in the app (Apple's wording); age gate (1.2.1(a)) |
| Published contact info (Apple) | n/a | a contact address in Settings → About, on the website and in the store listing |
| Terms accepted before posting (Google) | n/a | the app has no upload today; taste lists and match picks count as UGC, so accept terms before publishing a list |

## Integrating with apps/web (exact hooks)

The package is not wired in yet; others are editing `apps/`. Each hook below names the place to make the change.

1. **Storage.** Add `"moderation"` to `SENSITIVE_KEYS` in `apps/web/src/lib/localdata.ts`. This means it lives in the vault, encrypted, because it reveals whom the viewer avoids, which labelers they trust and whether they opted into NSFW.
   - Store `serializePolicy(policy)` and load it with `parsePolicyJson`. Start from `defaultPolicy()`, or `defaultPolicy(true)` for the Capacitor store builds.
   - Also store the raw label events (`fetchLabelEvents`) and the `InstanceDefaults[]` as vault caches. Rebuild the index with `buildLabelIndex` on load, so deletions apply.
2. **Video facts.** Core's `Video` has no `nsfw` field.
   - In `apps/web/src/lib/catalog.ts`, wherever `peertubeVideoToVideo(raw, origin)` runs, also keep `peertubeVideoMeta(raw)` in a `Map<videoId, VideoMeta>`.
   - Pass `videoMeta: (v) => metaMap.get(v.id)` in the context.
   - Instance list endpoints usually omit NSFW videos already (instance default `do_not_list`; framatube.org, peertube.tv and tilvids.com on 2026-10-19). Taste-list, match and deep-link videos come from the detail endpoint, which does not omit them, so this hook matters.
3. **Feed and Reels.** In `apps/web/src/app.ts`, `feed()` and `reelsRanked()` both build `candidates` and then call `rank(candidates, …)`. Insert the pre-filter between the two:
   ```ts
   const m = applyModeration(candidates, policy, { labels, instances: instanceDefaults, videoMeta });
   const items = attachVerdicts(rewriteWhy(rank(m.allowed, recipe, { … }), lists), m);
   // m.hiddenCount → "N hidden" link under the feed; m.hidden[i].reasons → the "Why hidden" sheet
   ```
   - Do the same for the popular pass: `applyModeration(buildPopularCandidates(...), …)`.
   - Also pass `m.allowed` where `feed()` counts `candidates`.
   - `rewriteWhy` (`lib/creatortaste.ts`) spreads items, so it keeps `moderation`. The order of the two calls doesn't matter.
4. **Source owners**, so that blocking a person drops their sources.
   - **Match:** in `matchCandidates()` (`app.ts`), set `moderation: { source: { pubkey: <peer identity pubkey> } }`. `MatchService` knows the peer. Alternatively pass `sourceMeta`.
   - **Nostr taste lists** (`lib/creatortaste.ts`): set `source: { pubkey, list: "30005:<pubkey>:<d>" }`.
   - **Provisional JSON lists** have no key. Blocking one stores its `via` name in `tasteLists`.
5. **Watch page and deep links.** Before `openWatch` (`apps/web/src/ui/watch.ts`) embeds a video, call `moderateVideo(v, policy, ctx, meta)`. Search, history and shared links never go through the feed.
   - `hide`: show an interstitial with the reasons, and do not load the embed.
   - `blur`: show a click-through overlay.
   - Reels must not autoplay a blurred item.
6. **Cards.**
   - `moderation.action === 'blur'`: blur the thumbnail and title, list `moderation.titles`, and offer "Show anyway" for that item only, without persisting it.
   - `'label'`: show `titles` as small chips.
   - Every string is display-safe (control and bidi characters stripped).
7. **Report.** Add a Report item to the card menu and the watch page.
   - `planReport({video, meta, type, details})` → show `plan.notes` and both parts.
   - On confirm, call `client.submitAbuse(plan.peertube, { accessToken, confirmed: true })`.
   - PeerTube needs a user token on that instance (or on the viewer's home instance, via `viaInstance`, which forwards the report). The app needs a PeerTube login flow (`/api/v1/oauth-clients/local` then `/api/v1/users/token`). That flow is not built, and CORS for authenticated POSTs from our origin is **unverified**.
   - Pass `labelers` (hex pubkeys the viewer chose) to `planReport` / `buildReport` to address the NIP-56 event to them; publish it to the viewer's relays plus the labelers' advertised relays.
   - Sign `plan.nostr` with the existing identity (`identity` in the vault, or NIP-07) and publish it only to the user's own relays (`settings.relays`; none by default).
   - Creators and taste lists use `buildReport({type: 'creator' | 'taste-list', …}, type)`.
8. **Block.** Add "Block creator", "Block instance" and "Mute tag" to the card menu (`addBlock`). Matches get "Block", which should also `revokeMatch`. Taste lists get "Block list". Settings gets a block-list editor (`removeBlock`) and a field to import a mute list by npub (`parsePubkey` → `fetchMuteList` → `importMuteList`).
9. **Settings → Moderation.**
   - Labelers by npub (`parsePubkey`) and the relays to read them from.
   - NSFW and violence: hide / blur / show. Going to "show" needs a second confirmation screen (`confirmAdult: true`). On iOS, keep this switch on the website.
   - "Use my instances' blocklists" (`instanceBlocklists`).
   - "Warn after N trusted reports" (`reportThreshold`, trusted = the viewer's follows' or matches' pubkeys).
   - A contact address for us.
10. **Refresh schedule.**
    - Labels: `fetchLabelEvents({since: lastFetch})` at start and every few hours.
    - Instance defaults: `client.instanceDefaults(origin)` daily for each configured instance (`settings.instances`).
    - Pass `publicSubjects(candidates)` only if you accept the leak described below.

## What we can and cannot moderate

**Can (on the device, for this viewer):**
- Hide, blur or label anything in the feed, in Reels, on the watch page and in popular sections. The triggers are: the viewer's blocks; labels from labelers they subscribed to; creators' own NSFW flags and content warnings; the viewer's instances' admin blocklists; and reports from people they trust.
- Drop the influence of blocked matches and curators. Their candidates go before ranking, so they also stop counting toward scores.
- Send reports to the people who can act: the hosting instance (PeerTube abuse report) and labelers (NIP-56).

**Cannot:**
- **Remove anything.** Videos live on PeerTube instances we don't run. Nostr events live on relays we don't run. Only the instance operator (or a relay operator) can take content down, and other instances may still hold federated copies or mirrors.
- **Moderate for other people.** Each viewer's filter is their own. Another client (PeerTube's own UI, Amethyst, nostube) shows whatever it shows.
- **Keep content from being posted.** Apple's "filtering objectionable material from being posted" applies to whoever accepts uploads. We accept none, except taste lists and match picks, which reference existing videos.
- **Stop ban evasion or Sybils.** A blocked npub or channel can come back under a new key or account. Instance blocks and labelers help; nothing closes the gap (DESIGN, "Manipulation and Sybils").
- **Trust reports.** NIP-56 reports are free to forge in bulk. That is why they only warn, only count from trusted pubkeys, and need a threshold (3 by default, as NIP-56 suggests).
- **Inspect media bytes.** No hashing or classifiers run on the device. See the CSAM note below.
- **Keep everything private.** Fetching labels tells relays which labelers you follow (the filter is by `authors`, never by video). `blocklist/status` queries tell an instance which accounts you asked about, so `publicSubjects` defaults to explore candidates, which came from that instance's public lists anyway.

## Operator responsibilities that stay with instances

- **Act on abuse reports.** A PeerTube report filed on a remote video is forwarded to the origin instance as an ActivityPub `Flag` (`server/core/lib/moderation.ts`, `send-flag.ts`). That instance's moderators decide.
  - Hosting providers in many jurisdictions must act on notices of illegal content. Examples: notice-and-action for hosting services in the EU Digital Services Act (Art. 16), and the duty of US providers to report apparent CSAM to NCMEC (18 U.S.C. § 2258A).
  - A Nostr report reaches no one with those duties, which is why `planReport` sends the PeerTube report first.
- **Server blocklists**, mute-list subscriptions (PeerTube ≥ 8.3), registration policy, and the instance NSFW policy.
- **Contact and terms.** Each instance publishes its own rules and admin contact (`/about`). We link to them on reports.
- **Our own labeler, once we run one** (OSS_STACK §13: none exists yet; ROOST coop for review queues, osprey for rules), is an operator too. It needs staff, an appeals path and a public policy for each label value.

### CSAM

Hash matching (PhotoDNA, or Meta's open-source PDQ / vPDQ / TMK through ThreatExchange and Hasher-Matcher-Actioner) belongs to the **instance operator**, who holds the bytes and the legal duty. Hash lists need partner access (NCMEC, Tech Coalition, Thorn Safer; PhotoDNA is not open source). ROOST (coop, osprey) is the open-source moderation stack OSS_STACK §13 points to. This package does **not** hash or scan media, and must not be extended to download suspected material.

Users who report `illegal` see a note in the confirmation screen:
- don't download or share the material;
- report it to the instance;
- report it to a hotline: NCMEC CyberTipline in the US, IWF in the UK, or an INHOPE member elsewhere.

## Instance-level defaults: what PeerTube exposes (checked 2026-10-19)

Sources: PeerTube's OpenAPI (`support/doc/api/openapi.yaml`, version 8.3.0 on `develop` and `master`) and its server source. Live instances were probed read-only.

| Endpoint | Auth | What it gives | Live |
|---|---|---|---|
| `GET /api/v1/server/blocklist/accounts`, `/servers` | **admin only** | the full server mute lists | not usable by clients |
| `GET /api/v1/server/blocklist/public-log?startDate=` | public, **only if the admin enabled `blocklist.public_log`** (PeerTube ≥ 8.3); 403 otherwise | `{name, actions: [{type: block\|unblock, target: name@host \| host, createdAt}]}`, 500 per page, oldest first | disabled (403) on framatube.org and peertube.tv (8.3.1); 400 on tilvids.com (8.2.4) |
| `GET /api/v1/blocklist/status?accounts=…&hosts=…` | public | `blockedByServer` (and `blockedByServerSubscription` on 8.3) for each account or host you name | works on all three |
| `GET /api/v1/config` | public | `instance.isNSFW`, `instance.defaultNSFWPolicy`, `blocklist.publicLog.enabled` | works |

So the server's own mute lists **are not public by default**:
- When an admin turns on the public log, `instanceDefaults` reads the whole list.
- Otherwise the only public signal is point queries through `blocklist/status`, which leak what you ask about (see above). `instanceDefaults` falls back to it only when you pass subjects.
- The old auto-mute plugin's feed format (`{data: [{value, action?}]}`) is parsed too (`parseMuteFeed`). That plugin is deprecated in favour of the 8.3 feature.

Two API discrepancies, where we follow the server:
- The OpenAPI enum lists `violentOrAbusive`, but the server validates against `abusePredefinedReasonsMap`, which has `violentOrRepulsive`. We use `violentOrRepulsive`.
- The OpenAPI marks `startDate` as required on the public log; the server treats it as optional.

The `nsfwFlags` bits are 1 = violent and 2 = explicit sex (`packages/models/src/videos/nsfw-flag.enum.ts`). The OpenAPI enum also lists 4, with no name.

## Labels: vocabulary and defaults

- Only labels from subscribed labelers (`settings.labelers`, hex pubkeys from npubs) count. Signatures are checked on a fresh object (THREAT_MODEL T25).
- Labels can target:
  - the video URL (`r`);
  - the instance origin (`r: https://host`);
  - the channel or account URL (`r: https://host/video-channels/name`, `/c/name`, `/accounts/name`, `/a/name`);
  - the NIP-71 event (`e`, `a`);
  - the signer (`p`);
  - a hashtag (`t`).
- A `hide` label on a curator's pubkey or a list's address drops that taste-list or match source (T7, T8).

| Namespace | Values → default action |
|---|---|
| `match-feed.moderation` (provisional, ours) | `nudity`, `sexual`, `porn` → **NSFW setting**; `violence`, `gore` → **violence setting**; `illegal`, `malware`, `scam`, `spam`, `!hide` → hide; `hate`, `harassment`, `self-harm`, `!warn` → blur; `profanity`, `misleading`, `impersonation`, `undisclosed-sponsorship`, `ai-generated` → label |
| `social.nos.ontology` | `NS-*` → NSFW setting (the code in NIP-56's example; add viewer rules for other codes) |
| `content-warning` (NIP-36 self-label, set by the bridge for PeerTube NSFW) | → NSFW setting |
| `peertube.nsfw` (synthetic, from `nsfw` / `nsfwFlags`) | `violent` → violence setting; others → NSFW setting |
| `peertube.instance` (synthetic, `isNSFW` instances) | `nsfw` → NSFW setting |
| `nip56` (synthetic, trusted reports ≥ threshold) | `nudity` → NSFW setting; `impersonation` → label; others → **blur, never hide** |
| `ugc` | → label |
| anything else from a subscribed labeler | `unknownLabels` (default label) |

- The NSFW and violence settings map hide → hide, blur → blur, show → label.
- Viewer rules (`settings.rules`) are checked first. They can be scoped to one labeler and support `*` prefixes.
- Self-labels can at most blur. They never hide.
- The strongest action wins: hide > blur > label.

## Limits and open items

- No labeler service exists. Store builds need one, or a partner's, before review.
- Reports to PeerTube need the viewer to have a PeerTube account. The app has no PeerTube login yet.
- `BlockState` caps each list at 5,000 entries and 20 imported mute lists. Keyword matching is whole-word after NFKC, in titles, channel names, tags and descriptions. It is not fuzzy, so obfuscated spellings get through.
- Label refresh is pull-only. There is no live subscription yet.
- Kind numbers for the match-feed label namespace and taste lists are provisional, as in PROTOCOL.md.
