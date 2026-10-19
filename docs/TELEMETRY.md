# Crash reports, bug reports and usage analytics (opt-in)

Status: implemented in the web client, 2026-10-19. Code: `apps/web/src/lib/telemetry/`,
`apps/web/src/ui/telemetry.ts`, `apps/web/src/telemetry/crash-entry.ts`. Servers:
`infra/glitchtip/`, `infra/umami/`. Threat: THREAT_MODEL.md T34.

This is **about the app**, for the people who build it. It is separate from the
**discovery stats for creators** (ANALYTICS.md Tier 2, `settings.analytics`), which
count how viewers found videos, for creators, keep their decided default, and are
still not transmitted. The UI says so in one line wherever these switches appear.

## The question

Nothing is collected until the viewer says yes. The app asks once, as a question,
in a small card that doesn't block anything:

- **When:** on the second launch (20 s after start), or after 3 minutes of use in the
  first session. Never on first paint, never as a modal.
- **Three switches, all off:**
  - (a) **Crash & error reports**
  - (b) **Bug reports & feedback** — a report is sent only when the viewer presses
    Send; the switch decides whether diagnostics are attached by default
  - (c) **Usage analytics**
- **Buttons:** "Turn on selected"; "Not now" (asks again in about 30 days, at most
  twice more; the third "Not now" ends it); "No thanks" (never asks again).
- **Settings → Sharing & privacy** has the same three switches, each with a
  "What gets sent" disclosure, a status line ("Crash reporter not loaded", "Usage
  analytics off: nothing is sent"), a row in "What you share, and with whom", and the
  bug report form. Changing a switch there counts as an answer.
- Choices are stored in `settings.telemetry` (localStorage, like other settings):
  `{crash, diagnostics, usage, prompt: {state, launches, snoozes, nextAskAt, decidedAt}}`.
  Malformed stored values fall back to everything off.
- A build without endpoints (below) shows no card, no switches and no form.

**EU (ePrivacy Art. 5(3), GDPR Art. 6(1)(a)):** sending crash reports or usage data
reads and transmits information from the device and isn't strictly necessary for the
service, so it needs prior consent. Off-by-default, separate switches, a plain
question with an equally easy "No thanks", and withdrawal in Settings at any time is
the consent model those rules expect, so the same behavior works everywhere,
including the EU. (The open ePrivacy question in ANALYTICS.md is about the
*on-by-default* discovery stats, not this.)

## What is sent, per switch

### (a) Crash & error reports → GlitchTip

When an uncaught error or unhandled promise rejection happens. Built with
`@sentry/browser` 10.76.0 (pinned exactly; released 2026-10-02), in its own bundle
`crash.js`, which is **downloaded and initialized only after the viewer turns this on**.
A viewer who hasn't opted in never fetches it.

Sent (and nothing else; the scrubber is an allow-list over the event):

| Field | Example |
|---|---|
| error type, scrubbed message | `TypeError`, `boom at <url> for <nostr> in <path>` |
| mechanism | `onerror`, handled: false |
| stack frames: function, file, line, column | `loadInstance`, `app:///app.js`, 1:2345 (other origins/extensions become `app:///<other>`) |
| route (screen name) | `home-reels`, `home-grid`, `follow`, `matches`, `studio`, `settings`, `recipe`, `feed-settings` |
| up to 10 route breadcrumbs | `route: settings` |
| app version, environment | `web@0.1.0`, `production` |
| browser and OS family, screen class | `Firefox`, `Android`, `small` |
| event id, timestamp, SDK name/version | |

The message scrubber replaces: URLs of every scheme (PeerTube, taste lists, relays
`wss://`, `file://`, `blob:`), protocol-relative URLs, Nostr NIP-19 strings
(npub, nsec, nprofile, nevent, naddr, note, …), hex strings of 32+ digits (keys,
event ids), UUIDs and PeerTube short ids, PeerTube paths (`/w/…`, `/videos/watch/…`,
`/c/…`, `/api/v1/…`), handles and emails (`name@host`), bare host names with common
TLDs, local paths (`/home/…`, `/Users/…`, `C:\…`, `~/…`), JSON objects (recipes, taste
lists), and quoted strings (the app quotes titles and list names). Control and bidi
characters are removed first; messages are cut at 300 characters. A final check
refuses to send an event whose JSON still contains a URL, npub/nsec, a 64-hex key or
a home path.

Dropped entirely: `request` (URL, query string, headers, Referer, User-Agent),
`user` (id, IP, email), `extra`, `server_name`, `modules`, SDK contexts (trace ids,
culture/locale/timezone, device model), all non-route breadcrumbs, frame variables
and source context.

SDK configuration: `sendDefaultPii: false`; no default integrations (so no console,
DOM-click, fetch/XHR or navigation breadcrumbs, no HTTP context, no session tracking),
only global error handlers, browser API error wrapping, linked errors, dedupe and
inbound filters; no tracing (`tracesSampleRate` unset, no tracing integration), no
replay, no profiling, no logs, no client reports; transport with
`referrerPolicy: no-referrer`, `credentials: omit`.

Sampling and limits: crashes (unhandled) 100%, handled errors 25%; the same error at
most once per page load; at most 10 reports per page load; a burst of 5 refilled at
one per 2 minutes.

No user id, and no per-install id. GlitchTip groups by error, not by person, so none
is needed.

### (b) Bug reports & feedback → GlitchTip

Only when the viewer opens the form (Sharing & privacy, the ⋯ menu, or the feed
settings sheet), writes something and presses **Send**. Works whether or not (a) or
(c) are on. The form shows **exactly** the JSON that will be sent, updated as you type.

| Field | |
|---|---|
| category | bug, idea, other |
| text | up to 4,000 characters, through the same scrubber (links, handles, keys, quoted text replaced) |
| contact email | optional; only if the viewer types a valid one |
| diagnostics (if "Attach diagnostics" is ticked; the default follows switch (b)) | app version; browser and OS family; screen class; up to 5 recent errors (type, scrubbed message, screen, minute since load), kept in memory only; which switches are on: private watching, P2P, popular section, discovery stats, default view, theme, history window, passphrase on, storage mode, whether relays are configured, built-in recipe id or "custom", crash reports, usage analytics. Never history, follows, lists, matches, relay URLs or keys |

Transport: one Sentry envelope with one `event` item (a captured message, level
`info`, fingerprint `["user-feedback", <category>]`, text in `contexts.feedback`),
`POST /api/<project>/envelope/?sentry_key=…` as `text/plain` (no preflight), no
credentials or referrer. No SDK is loaded for this. Why not GlitchTip's
`feedback`/`user_report` items: see infra/glitchtip/README.md, Retention.

### (c) Usage analytics → Umami

Cookie-free, through a small client (not Umami's tracker script; infra/umami/README.md
explains why). Sent only while the switch is on. **The complete list:**

| Event | Data (fixed values only) | When |
|---|---|---|
| *(screen view)* | path `/<route>` | the viewer switches screens (routes as above) |
| `app-open` | `view`: reels/grid; `display`: browser/installed | the app starts with (c) on, or (c) is turned on |
| `follow-creator`, `unfollow-creator` | — | follow or unfollow a channel (never which) |
| `follow-taste` | — | follow a creator's taste |
| `subscribe-taste-list` | `source`: url/paste/example | subscribe to a taste list (never which) |
| `match-requested`, `match-accepted`, `preview-requested` | — | the Match action succeeded (never with whom) |
| `endorse`, `not-interested`, `share` | — | the action (never on what) |
| `recipe-selected` | `kind`: built-in/custom; `recipe`: default/following/discovery/custom/other | a recipe is picked (built-in or the custom one) |
| `recipe-imported` | — | a recipe was imported (never its contents) |
| `view-mode` | `view`: reels/grid | Home switches view |
| `feed-settings-opened` | — | the feed settings sheet opens |
| `private-watching` | `on`: true/false | the private-watching switch changed (whether it is on, not what was watched) |
| `bug-report-sent` | `category`: bug/idea/other | a bug report was sent (only with (c) on) |

Each request also carries `website` (the Umami site id), `hostname: "app"`, and
`browser`, `os` (families, computed on the device) and `device`
(mobile/tablet/desktop from the viewport). Not sent: page URL, query, referrer, page
title, language, exact screen size, any id or cookie, any video, creator, list,
search or peer. Unknown event names, keys and values are dropped before sending
(`USAGE_EVENTS` in `usage.ts` is the source of truth; a test checks every value is a
short fixed token). At most 200 events per page load.

## Build configuration

Endpoints are compiled in from the environment at build time (`apps/web/scripts/build.mjs`):

| Variable | Example | Empty |
|---|---|---|
| `MF_GLITCHTIP_DSN` | `https://<key>@errors.example.org/1` | crash reports and bug reports hidden, `crash.js` not built |
| `MF_UMAMI_HOST` + `MF_UMAMI_WEBSITE_ID` | `https://stats.example.org`, a UUID | usage analytics hidden |

https only (plain http only for localhost, for tests). A malformed value fails the
build. When configured, the hosts are added explicitly to the CSP `connect-src` in
`dist/index.html`. (It already allows `https:` for user-chosen PeerTube instances, so
this matters for local http test servers and if `connect-src` is ever narrowed.)
`crash.js` is same-origin, so `script-src 'self'` covers it.

**Offline artifact:** always built without endpoints, and the app ignores telemetry
in snapshot mode. No card, no switches, no requests.

The default build (no variables) contains the telemetry UI code but no endpoints,
so it behaves exactly like the offline artifact as far as telemetry goes.

## Retention and who can see it

| Data | Where | Kept | Who can see it |
|---|---|---|---|
| crash reports, bug reports (incl. contact email, diagnostics) | GlitchTip (`infra/glitchtip`) | 30 days (`GLITCHTIP_RETENTION_DAYS`), then deleted with their partitions | members of the operator's GlitchTip organization (registration off) |
| usage events, sessions | Umami (`infra/umami`) | 30 days (hourly retention job) | people with a login on the operator's Umami |
| IP addresses | nowhere | — | Caddy sees them in memory to serve the connection and passes none on |
| recent errors for diagnostics | the viewer's tab, memory only | until the tab closes | the viewer |

## Turning it off

Settings → Sharing & privacy → "Crash reports, feedback and usage stats": untick a
switch. Crash reports stop immediately (the SDK client is closed and any event in
flight is dropped by `beforeSend`); usage events stop with the next action. Nothing
already sent can be recalled from the device; ask the operator (below).

## Server operator's obligations

Whoever runs `infra/glitchtip` and `infra/umami` for a build that points at them:

1. **Keep IPs out.** Run the Caddy fronts as configured; don't add a CDN or proxy
   that injects client-IP headers. Keep GlitchTip's "Scrub IP addresses" on. Re-run
   both `test/smoke.sh` after updates.
2. **Retention:** keep 30 days (or shorter), including backups.
3. **Access:** limit accounts to people who fix bugs; 2FA; registration off; change
   Umami's default admin password before anything else.
4. **Purpose limitation:** use the data only to fix bugs and decide what to build.
   Don't combine it with other data, don't try to identify people, don't share it.
5. **Contact emails** in bug reports are personal data: use them only to reply,
   delete them with the report, honor deletion requests (GlitchTip: delete the event
   or issue).
6. **Requests from viewers:** since there is no id, you usually can't find "their"
   data; say so. A viewer who gave an email can be found by it.
7. **Publish** the privacy-policy paragraph below (adapted) and name a contact.
8. **Security:** keep images updated (pinned by digest; Dependabot), TLS on, the
   servers patched. A breach of contact emails may need notification (GDPR Art. 33/34).
9. **Records:** these are processing activities for GDPR Art. 30 if you're in scope;
   the legal basis is consent (Art. 6(1)(a)).

## Privacy-policy paragraph (draft)

> **Crash reports, bug reports and usage statistics (optional).** The app asks
> whether you want to help fix bugs and improve it. Unless you say yes, it sends us
> none of this. If you turn on *crash & error reports*, the app sends us a report when
> it hits an error: the error and where in the app's code it happened, the name of
> the screen you were on, the app version, your browser and operating system family
> and a rough screen size. Links, handles, keys, ids and quoted text are removed
> before sending, and the reports never include the videos you watch, the people you
> follow or match with, or your history. If you write a *bug report or feedback* and
> press Send, we receive your text, the category, your email address if you give one,
> and, if you choose, the same kind of technical details plus which app settings are
> switched on. If you turn on *usage analytics*, the app tells us which screens and
> features are used (for example "switched to grid view"), never which videos,
> creators or people, without cookies or identifiers. We run these services ourselves
> (GlitchTip and Umami), do not store your IP address, keep the data for 30 days,
> and let only the people who work on the app see it. We use it only to fix problems
> and decide what to improve, and never sell or share it. You can turn each part off
> at any time in Sharing & privacy. Our legal basis is your consent. Questions or
> deletion requests: [contact].

## Checks

- `npm test` (apps/web): `test/telemetry.test.ts` — consent transitions (defaults,
  ask timing, Turn on selected / Not now ×3 / No thanks, Settings changes, storage
  round-trip and garbage), the scrubber against a corpus of ~30 realistic sensitive
  strings and a hostile Sentry event (allow-listed keys only), sampling and rate
  limits, the usage allow-list and client, **nothing loads or sends before consent**
  (the controller with an injected loader and fetch), exactly the chosen parts after
  consent, everything stops after opt-out, an empty build config hides everything,
  DSN parsing, the bug-report event and envelope, coarse diagnostics.
- `npm run check:telemetry` (apps/web; needs Playwright, see the script header):
  builds the app against two local mock servers standing in for GlitchTip and Umami,
  blocks every request outside 127.0.0.1, and drives headless Chromium at 390×844.
  Asserts zero requests to either host and no `crash.js` on the first launch and the
  second (before answering); the card appears on the second launch with three
  unticked switches; after opting in, `crash.js` loads once, Umami gets allow-listed
  fields only, a thrown error carrying a URL, an npub and a home path arrives
  scrubbed with the route; the bug report sent equals the preview; after opting out,
  nothing more is sent; no request carries cookies or a referrer; a build without
  endpoints shows no telemetry UI and loads nothing. Last run 2026-10-19: 21/21 passed.
- `infra/glitchtip/test/smoke.sh`, `infra/umami/test/smoke.sh`: the servers with
  synthetic events (IP not stored, with controls; retention; CORS; logs).

## Known limits

- **Free text can still identify.** The scrubber can't recognize an unquoted video
  title, a petname ("Ines endorsed …") or a person's name typed into a bug report.
  The form asks people not to name videos or people, and shows what will be sent.
- **Stack traces reveal code paths**, e.g. that the error happened in Match code,
  which hints that the viewer uses Match. Route names reveal which screens are used.
  Both are the point of the feature; they say nothing about whom or what.
- **Timing:** a crash report's timestamp plus the route is a weak signal; GlitchTip
  has no IP or id to link it to.
- **The operator is trusted** to run the servers as configured. A malicious operator
  could log IPs at Caddy. The client side can't prevent that; the request still
  carries no id, no URL and no content.
- **Umami sessions** are a hash of site, user-agent and a monthly salt (no IP), so
  "unique visitors" mean "browser versions", not people.
- Not in CI yet: `check:telemetry` needs Playwright and the smoke tests need Docker
  (`.github/` wasn't changed here).
