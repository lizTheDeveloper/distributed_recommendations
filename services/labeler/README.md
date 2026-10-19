# @match-feed/labeler

A moderation labeler for Match Feed (working name "Meme Video") that The Multiverse School can run. Viewers
subscribe to it by npub in Settings → Moderation, and `packages/moderation` applies its labels on their devices.
It covers the "No labeler service exists" item in `packages/moderation/README.md` and THREAT_MODEL T18.

What it does:
1. **Intake.** It reads NIP-56 reports (kind 1984) addressed to the labeler from configured relays into a review
   queue.
2. **Review.** Humans label videos, creators, instances and taste lists with NIP-32 labels (kind 1985). The CLI or a
   local web admin works for this.
3. **Retraction.** Labels are retracted with NIP-09 deletion requests.
4. **Audit.** Every decision goes into a hash-chained audit log, which exports as DSA-style statements of reasons and
   transparency counts.

- TypeScript for Node 22 (`--experimental-strip-types`, erasable syntax only), `node:test`, Apache-2.0.
- `nostr-tools` **2.25.2**, exact, with a lockfile. `.npmrc` disables install scripts.
- **No drift.** `src/deps.ts` imports `packages/moderation` and `packages/bridge` by relative path. Nothing else
  does.
  - The vocabulary is read from moderation's `DEFAULT_LABEL_RULES`.
  - Labels are built with moderation's `buildLabelEvent`.
  - The tests read them back with moderation's own `fetchLabels` → `applyModeration`.
  - Signing and relay I/O are the bridge's code: the local-key or NIP-46 signer, `signWith`, and publish/query with
    NIP-42 and retries.
- Storage is SQLite through `node:sqlite`, which Node 22.22 has unflagged (it prints an ExperimentalWarning). A
  JSON file is used for `*.json` store paths, or when `node:sqlite` is missing.

```sh
npm ci            # ignore-scripts via .npmrc
npm test          # node:test, offline (in-memory relay): 34 tests
npm run typecheck # tsc, strict (also checks the moderation and bridge sources it imports)
npm run labeler -- --help
```

| Module | What it does |
|---|---|
| `vocabulary.ts` | The `match-feed.moderation` values, titles and default effects, taken from `packages/moderation` |
| `targets.ts` | `video:` `event:` `creator:` `channel:` `account:` `instance:` `list:` `address:` `tag:` → NIP-32 target tags, validated by moderation's `buildLabelEvent` |
| `intake.ts` | Report verification, addressing, dedupe, per-reporter rate limits, cases, the opt-in auto-blur, retention purge |
| `labeling.ts` | `issueLabel`, `retractLabel`, `dismissCase`, `reopenCase`, `escalateCase` (each one is audited in the same transaction) |
| `signer.ts` | `--signer bunker` (NIP-46, preferred) or `key`, from the environment or `*_FILE` only; the key must equal `config.labeler` |
| `store.ts`, `repo.ts` | SQLite or JSON driver; append-only audit table (triggers refuse UPDATE/DELETE); SHA-256 hash chain |
| `transparency.ts` | Statements of reasons (DSA Art. 17 structure), aggregate summary, audit export, CSV (spreadsheet-injection safe) |
| `admin.ts` | Optional web admin: 127.0.0.1 only, Host/Origin checks, CSRF token, no scripts, no media |
| `cli.ts` | `match-feed-labeler` |

## How labels look on the wire

```jsonc
// kind 1985, signed by the labeler key
{ "tags": [["L", "match-feed.moderation"], ["l", "spam", "match-feed.moderation"],
           ["r", "https://tube.example/videos/watch/…"], ["expiration", "1793000000"]],
  "content": "Link spam posted across many channels" }      // public reason, shown in "Why hidden"
// retraction: kind 5
{ "tags": [["e", "<label id>"], ["k", "1985"]], "content": "Appeal upheld: …" }
```

- **One namespace per event**, as NIP-32 recommends.
- **Retraction** works even when a relay ignores the deletion. `buildLabelIndex` drops any label the same labeler
  deleted.
- **Expiry** uses NIP-40. Clients ignore expired labels.

| Target | Tag | Covers in `packages/moderation` |
|---|---|---|
| `video:<watch URL>` | `r` | that video |
| `event:<hex>` / `address:<k:pk:d>` | `e` / `a` | the NIP-71 event (bridge videos) |
| `creator:<npub>` | `p` | videos signed by the key; taste-list and match sources owned by it (`hide` values drop the source) |
| `channel:<name@host>` / `account:<name@host>` | `r` | every video of that channel or account |
| `instance:<host>` | `r` | every video on that instance |
| `list:30005:<pk>:<d>` | `a` | that taste list as a source (T7 spam, T8 `undisclosed-sponsorship`) |
| `tag:<hashtag>` | `t` | videos with that tag |

Run `match-feed-labeler vocab` for the values. Each value's effect comes from moderation's rules:
- `illegal`, `malware`, `scam`, `spam` and `!hide` hide.
- `hate`, `harassment`, `self-harm` and `!warn` blur.
- `nudity`, `sexual`, `porn`, `violence` and `gore` follow the viewer's NSFW or violence setting.
- The rest only label.

## Report addressing (for the app)

NIP-56 has no way to address a report to a moderator. A report reaches this labeler when it carries one extra tag
with no report type, `["p", <labeler pubkey>]`. The reported `e`/`p` tags keep their types. Intake asks relays for
`{"kinds":[1984],"#p":[<labeler>]}`. A `p` tag for the labeler *with* a type is a report about the labeler, and it is
queued like any other report.

`packages/moderation`'s `buildReport` doesn't add this tag. The app should append it when the user picks "also send
to the Multiverse labeler", and publish to the labeler's intake relays as well as the user's own relays. That needs
a small change in `packages/moderation` or `apps/web`, which is outside this directory.

## Operating guide

### 1. Keys

- The labeler is one Nostr identity. Its npub is what viewers subscribe to.
- **Keep the secret key in a NIP-46 remote signer** (`--signer bunker`, `LABELER_BUNKER_URL`). nsecBunker, Amber
  and similar signers work. A reviewer approves each signature, and the key never touches the labeler host.
- `--signer key` (`LABELER_SECRET_KEY`, or `LABELER_SECRET_KEY_FILE` for Docker secrets) is for auto-blur and small
  setups.
- **Secrets are never accepted on argv.** `--nsec`, `--key` and `--bunker` are refused.
- **The signer's pubkey must equal `config.labeler`.** Otherwise nothing is signed.
- If the key leaks, an attacker can publish labels as you. Publish a notice from a new key, and ask viewers to switch
  labelers. There is no key rotation in Nostr.

### 2. Configuration

- Start from `infra/labeler/labeler.config.example.json`. It has no secrets.
- Parsing is strict: unknown keys are rejected.
- Set `policyUrl` (one section per label value), `appealUrl` and `contact`. They go into every statement of reasons.

### 3. Daily workflow

```sh
L="npm run -s labeler --"     # or: docker compose run --rm cli   (infra/labeler)
$L intake                     # or the compose `intake` service, every 15 min
$L queue                      # most urgent first: `illegal`, then trusted reporters, then reporter count, then age
$L show 3f9a1c2b7d10          # reports, with the reporters' text
$L label --case 3f9a1c2b7d10 --value spam --reason "Link spam posted across many channels" \
         --reviewer liz                         # DRY RUN: prints the event, records nothing
$L label --case 3f9a1c2b7d10 --value spam --reason "…" --reviewer liz --publish --signer bunker
$L label --target channel:spambot@tube.example --value spam --reason "…" --expires 90d --reviewer liz --publish --signer bunker
$L dismiss 3f9a1c2b7d10 --reason "Within policy: ordinary self-promotion" --reviewer liz
$L retract <label id> --reason "Appeal upheld: …" --reviewer sam --publish --signer bunker
$L admin --reviewer liz --signer bunker         # http://127.0.0.1:8787 (SSH tunnel from elsewhere)
```

**Reasons.**
- `--reason` is **published** with the label and shown to viewers. Describe the content, never people: no names,
  no reporter details, no personal data.
- `--note` is internal and goes into the audit log only.
- `illegal` requires `--legal-ground`: the law relied on. It is kept for the statement of reasons and not published.

**Reports never label anything on their own.** A human labels or dismisses.
- **Duplicates.** A reporter who reports the same thing twice counts once.
- **Rate limits.** Each reporter gets `rateLimit.perDay` reports per 24 h and `rateLimit.maxOpen` open reports at
  once. Reports over the limit are dropped and counted.
- **Ignored reports.** Reports from `ignoredReporters`, reports older than `maxReportAgeDays` and reports dated in
  the future are dropped.
- **Dismissed cases** reopen when a *different* reporter reports the same target.

**Auto-blur (off by default).** When `autoBlur.enabled` is true and `autoBlur.threshold` (≥ 2) distinct
`trustedReporters` report the same video event, intake publishes a `!warn` label.
- `!warn` blurs and never hides.
- It expires after `ttlHours`.
- The case stays open for a human, who confirms it with a real label or retracts it.
- It never applies to creators, lists, instances or tags.
- It needs a signer that can sign unattended (`--signer key`).
- This follows NIP-56's own advice: reports are easy to forge, so they warn and only count from people you trust.

**Appeals.**
- Take appeals at `appealUrl`. A different reviewer from the one who decided should handle each one.
- Either retract the label (that reopens the case) or keep it and say why. Both outcomes are audited.

**Retention.** Run `purge` daily (cron or a compose `run`).
- It deletes report records, including reporters' pubkeys and text, `retention.resolvedReportDays` after a case is
  resolved.
- It also deletes old dedupe ids and idle rate-limit state.
- Cases keep counts only. The audit log is kept.

### 4. Escalation and illegal content

The labeler cannot remove anything. Videos live on PeerTube instances, and Nostr events live on relays. A label only
hides or blurs content for people who subscribe. So for content that may be illegal:

1. **Escalate to whoever holds the content.**
   - Report to the hosting instance: its admin contact is at `/about`, or use PeerTube's abuse report.
   - For Nostr events, report to the relay operators.
   - Record each escalation with `escalate <case> --to instance --reference <their ticket> --reason "…"`.
2. **Label meanwhile.** Use `illegal` (hide) with `--legal-ground`, or `!hide` while you check.
3. **Suspected child sexual abuse material (CSAM).**
   - **Do not open, download, screenshot, copy or forward it.** Not even to colleagues, not even "as evidence".
     Keep only the URL or event id.
   - **US:** report to NCMEC's CyberTipline (https://report.cybertip.org, 1-800-843-5678). Under 18 U.S.C. § 2258A,
     a *provider* (as defined in § 2258E) must report apparent CSAM "as soon as reasonably possible after obtaining
     actual knowledge". The report counts as a request to preserve the reported contents for **1 year**
     (§ 2258A(h)(1); 90 days before the 2024 amendment).
     - Whether a labeler that hosts nothing is a "provider" is a question for counsel.
     - Anyone may report to the CyberTipline, so report it anyway.
     - The hosting instance's operator holds the bytes, and very likely the duty.
   - **UK:** the IWF (https://report.iwf.org.uk). **Elsewhere:** an INHOPE member hotline (https://www.inhope.org).
   - Record it with `escalate <case> --to ncmec --reference <CyberTipline report number>`. **Never store the
     material.**
   - Hash matching (PhotoDNA, PDQ) belongs to instance operators; see `packages/moderation/README.md` "CSAM". This
     service never downloads media.
4. **Threats to life** (credible threats, self-harm in progress): contact local emergency services first. Then
   label (`self-harm` blurs) and escalate to the instance.
5. Get legal advice before relying on any of this. It is a summary, not legal advice.

### 5. Reviewer wellbeing

Moderation work exposes people to harmful material. Repeated exposure is linked to secondary traumatic stress. Plan
for it:

- **See as little as possible.**
  - The CLI and the admin never load media. Targets are shown as text, and reporters' text is collapsed.
  - Decide from the report and the metadata when you can.
  - When you must look, use a separate browser profile with autoplay and sound off and thumbnails blurred or in
    grayscale. Stop once you have what you need.
- **Never assign** CSAM, gore or self-harm queues to volunteers, students or anyone who hasn't opted in. CSAM is
  never "reviewed": follow §4.3.
- **Short, scheduled shifts.**
  - Cap review time per day.
  - Rotate the `illegal`/`gore` work.
  - No reviewing alone late at night.
  - Anyone can step away from a case without explanation, and others pick it up.
- **Support.**
  - A named person reviewers can debrief with.
  - Access to counselling (an employee assistance programme or a local service) paid for by the organisation.
  - A regular check-in that isn't about throughput.
- **Protect reviewers' identities.**
  - Reviewer names exist only in the internal audit log.
  - Labels are signed by the labeler key, not a person.
  - Public exports replace names with keyed pseudonyms.
- **Don't measure people by speed.** The transparency summary reports median time to decision for the service, not
  per reviewer.

## Transparency

```sh
$L audit verify                                     # hash chain intact?
$L transparency --since 2026-01-01 --until 2026-07-01   # counts: reports, decisions by value/subject/effect, automated, retractions, escalations
$L statements --public --format csv --since 2026-01-01  # one statement of reasons per label
$L audit export --format jsonl                      # full internal log (verifiable against the chain)
```

**EU Digital Services Act**, Regulation (EU) 2022/2065, checked on EUR-Lex on 2026-10-19:

- **Art. 17 (statement of reasons)** binds **providers of hosting services**.
  - They must give affected recipients "a clear and specific statement of reasons" for restrictions imposed because
    content is illegal or incompatible with their terms. This covers visibility restrictions (removal, disabling,
    demotion) and restrictions on payments, services or accounts.
  - 17(2): this applies only where the provider knows the recipient's electronic contact details.
  - 17(3): the statement must say:
    - (a) what the restriction is, its territorial scope and its duration;
    - (b) the facts and circumstances, including whether a notice or the provider's own initiative led to it;
    - (c) whether automated means were used to detect the content or to decide;
    - (d) for illegal content, the legal ground and why the content is illegal;
    - (e) for terms-based decisions, the contractual ground;
    - (f) redress: internal complaint handling, out-of-court dispute settlement and judicial redress.
  - 17(4): the statement must be "as precise and specific as reasonably possible".
  - 17(5): Art. 17 does not apply to orders under Art. 9.
- **Art. 24(5)** requires *online platforms* to submit these decisions and statements to the Commission's public
  database (the DSA Transparency Database), without personal data.

**Does it apply to us?**
- A labeler stores no content uploaded by recipients. So it is probably not a hosting service (Art. 3(g)(iii)), and
  Art. 17 probably does not bind it. Get advice before relying on that.
- We use Art. 17's structure anyway, because it is the recognised format:
  - `statements` emits fields for 17(3)(a)–(f): `restriction`, `visibility_effect`, `territorial_scope`, `duration`,
    `facts_and_circumstances`, `source` / `notices`, `automated_detection` / `automated_decision`, `ground` /
    `legal_ground` / `policy_ground` and `redress`.
  - `--public` drops targets and reviewer names, in the spirit of 24(5).
- We can't notify affected creators directly: we usually have no contact details (17(2)). We publish the statements
  instead.
- The PeerTube instances that host the videos are hosting services. Their Art. 16 (notice and action) and Art. 17
  duties stay with them.

**Suggested public commitment.**
- Publish a transparency report every six months: the `transparency` summary plus `statements --public`.
- Publish the policy for each label value at `policyUrl`.
- Keep an appeal route at `appealUrl`.

## Privacy and security

- **Network.** The labeler makes only outbound relay connections and never sees viewer IPs. The admin listens only on
  127.0.0.1 and logs nothing about requests. See `infra/labeler/README.md` "Logs".
- **What it stores.** Reporter pubkeys and their free text, until retention removes them (store file mode 0600), and
  the audit log. It never stores media.
- **Untrusted input.**
  - Report signatures are checked on fresh objects (T25).
  - All reporter text is display-sanitized and HTML-escaped in the admin.
  - CSV exports neutralise formula injection.
- **Tests.** They use an in-memory relay and a fake NIP-46 bunker. They never touch a public relay.

## Limits

- **Auto-blur needs an unattended key.** A NIP-46 signer may ask for approval on every signature, so auto-blur with
  `--signer bunker` only works if the signer auto-approves kind 1985.
- **No push intake.** Intake polls. Each run re-reads a 2-day lookback window, because reports can be backdated, and
  dedupe makes that safe.
- **Rate limits are per pubkey.** Sybil reporters can get around them. That is why reports alone never label, and why
  auto-blur counts only trusted reporters.
- **Single-writer store.** Run one `intake` process; CLI commands are short transactions.
- **Dependabot doesn't know this package yet.** Add `/services/labeler` to the npm directories and `/infra/labeler`
  as a `docker` ecosystem in `.github/dependabot.yml`, and add a CI job running `npm ci && npm test && npm run
  typecheck` here. Those files are outside this directory.
- **Namespace and kinds are provisional.** The `match-feed.moderation` namespace is provisional, as in PROTOCOL.md.
