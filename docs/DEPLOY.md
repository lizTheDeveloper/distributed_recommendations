# Deploying

How the app (working name **Meme Video**, set once as the `APP_NAME` repository
variable for the workflows and once in `infra/relay/.env` for the relay) is built,
checked, attested and published, and the exact settings the repository owner has to
create. Nothing deploys until the owner opts in.

| Piece | Where | Purpose |
|---|---|---|
| CI | `.github/workflows/ci.yml` | Tests and typechecks for every package, sim unit tests, reproducible-build check, relay config and smoke test, DCO sign-off, workflow lint |
| Docker e2e (manual) | `.github/workflows/e2e.yml` | Run by hand (Actions → "E2E (Docker)"): relay smoke, OHTTP relay → gateway → strfry, Janus leader + helper, GlitchTip and Umami smoke tests. Not on push |
| Web release | `.github/workflows/deploy-web.yml` | Build `apps/web/dist`, attest, then optionally publish to GitHub Pages, Cloudflare Pages and IPFS |
| Dependency updates | `.github/dependabot.yml` | npm, GitHub Actions, Cargo (desktop), Gradle (Android), Docker Compose images, Dockerfile base images, pip; 14-day cooldown |
| Relay | `infra/relay/` | Self-hosted strfry + Caddy; see [`infra/relay/README.md`](../infra/relay/README.md) |
| Server stacks | `infra/ohttp/`, `infra/janus/`, `infra/labeler/`, `infra/glitchtip/`, `infra/umami/` | OHTTP relay and gateway, DAP aggregators, moderation labeler, crash/bug reports, usage analytics; see §7 |
| Release tools | `infra/web/` | Pinned deploy CLIs and the `security.txt` template |

Supply chain (T13): actions are pinned by full commit SHA (version in a comment), npm
installs use lockfiles with `npm ci` (with `--ignore-scripts` where the package's
`.npmrc` asks), Python is hash-pinned, container images are pinned by digest, workflows
default to `contents: read` or nothing, and secrets exist only in protected
environments used by the deploy jobs.

---

## 1. Repository settings (once)

All under the repository's **Settings**.

**Actions, General**
- *Actions permissions:* "Allow lizthedotdev, and select non-lizthedotdev, actions and
  reusable workflows", allowing `actions/*` only (the only third-party actions used).
  Turn on **"Require actions to be pinned to a full-length commit SHA"**.
- *Fork pull request workflows from outside collaborators:* "Require approval for all
  outside collaborators".
- *Workflow permissions:* **"Read repository contents and packages permissions"**. Leave
  "Allow GitHub Actions to create and approve pull requests" **off**.

**Rules, Rulesets**
- Branch ruleset for `main`: require a pull request with **at least 1 approval from
  someone other than the author** (the two-person sign-off in T13), dismiss stale
  approvals, require conversation resolution, block force pushes and deletion, and
  require these status checks:
  `node (packages/core)`, `node (packages/match)`, `node (packages/bridge)`,
  `node (apps/web)`, `sim (Python 3.13)`, `web build is reproducible`,
  `relay config (strfry + Caddy)`, `DCO sign-off`, `lint workflows (actionlint)`.
  Consider also requiring the other `node (…)` matrix checks (`packages/circles`,
  `packages/moderation`, `packages/taste`, `packages/transport`, `packages/analytics`,
  `services/labeler`). The Docker e2e workflow is manual and can't be a required check.
- Tag ruleset for `web-v*`: only maintainers may create, update or delete these tags,
  because pushing one starts a release.

**Code security**
- **Private vulnerability reporting: on** (`SECURITY.md` points to it).
- Dependabot alerts and Dependabot security updates: on. (Version updates come from
  `.github/dependabot.yml`.)
- Secret scanning and push protection: on.

**Pages** (only for option a): *Build and deployment, Source:* **GitHub Actions**.

## 2. Turning on web releases

Create the repository variable (*Settings, Secrets and variables, Actions, Variables*):

| Variable | Value |
|---|---|
| `WEB_DEPLOY_ENABLED` | `true`. While unset, every job in `deploy-web.yml` is skipped |
| `APP_NAME` | optional, defaults to `Meme Video`. Used in job summaries and pin names |

With only this set, a run builds, tests, checks reproducibility, and uploads the
`web-dist` artifact (the `dist/` folder) and `web-release` (deterministic
`web-dist.tar.gz`, `web-dist.car`, `web-dist.cid`, `SHA256SUMS`). It also creates a SLSA
build-provenance attestation for the tarball and CAR with
`actions/attest-build-provenance`, signed keylessly through Sigstore. Attestations need a
public repository, or GitHub Enterprise Cloud for private ones.

**Starting a release:** push a tag (`git tag -s web-v0.1.0 && git push origin web-v0.1.0`),
or run *Actions, Deploy web, Run workflow*. Release jobs don't use the npm cache, so a
cache entry poisoned by a PR run can't reach a release.

**Environments** (*Settings, Environments*). Each publish target runs in its own
environment. For each one you use:
- *Required reviewers:* at least one maintainer other than whoever starts the release
  (turn on "Prevent self-review").
- *Deployment branches and tags:* "Selected branches and tags", with `main` and the tag
  pattern `web-v*`.

| Environment | Created by |
|---|---|
| `github-pages` | GitHub, when Pages uses GitHub Actions. Add the rules above |
| `cloudflare-pages` | you |
| `ipfs` | you |

## 3. Targets

### a. GitHub Pages

| Kind | Name | Value |
|---|---|---|
| Variable | `DEPLOY_GITHUB_PAGES` | `true` |
| Setting | Pages, Source | GitHub Actions |
| Setting | Pages, Custom domain | optional; then also enforce HTTPS |

No secrets. The job gets `pages: write` and `id-token: write` only. The app uses
relative URLs (`./sw.js`, `start_url: "./"`), so it also works at
`https://<owner>.github.io/<repo>/`.

### b. Cloudflare Pages (wrangler)

Once, in Cloudflare:
1. Create a Pages project for Direct Upload (dashboard: *Workers & Pages, Create,
   Pages, Upload assets*). The project name becomes `<name>.pages.dev`.
2. Create an API token (*My Profile, API Tokens, Create Custom Token*) with only
   **Account, Cloudflare Pages, Edit**, limited to this account. Set a TTL and rotate it.

| Kind | Name (in environment `cloudflare-pages`) | Value |
|---|---|---|
| Secret | `CLOUDFLARE_API_TOKEN` | the token above |
| Secret | `CLOUDFLARE_ACCOUNT_ID` | the account ID (dashboard sidebar) |
| Variable (repository) | `DEPLOY_CLOUDFLARE_PAGES` | `true` |
| Variable (repository or environment) | `CLOUDFLARE_PAGES_PROJECT` | the project name |
| Variable, optional | `CLOUDFLARE_PAGES_BRANCH` | the project's production branch (default `main`); any other name makes a preview deployment |
| Variable, optional | `CLOUDFLARE_PAGES_URL` | the site URL, shown on the environment |

wrangler 4.147.0 comes from `infra/web/deploy-tools/cloudflare` (lockfile,
`--ignore-scripts`), with telemetry off (`WRANGLER_SEND_METRICS=false`).

### c. IPFS

Every release computes the IPFS root CID of `dist/` (`ipfs-car pack --hidden`, from
`infra/web/deploy-tools/ipfs`). The CID depends only on file names and bytes, and
the build is reproducible, so anyone can rebuild a commit and get the same CID.
Publishing it needs a pinning provider:

| Kind | Name | Value |
|---|---|---|
| Variable (repository) | `DEPLOY_IPFS` | `true` (runs the `ipfs` job, which checks the CAR against `SHA256SUMS` and writes the CID and DNSLink record into the job summary) |

**Storacha (upload the CAR).** Once, on a trusted machine, with the same CLI version
(`cd infra/web/deploy-tools/ipfs && npm ci`, then `npx storacha …`):
1. `storacha login you@example.org`, then `storacha space create <name>`. Note the
   space DID (`did:key:…`).
2. `storacha key create --json`. Save `key` (private, `Mg…`) and `did` (public).
3. `storacha delegation create <did from step 2> --can space/blob/add --can space/index/add --can filecoin/offer --can upload/add --base64`.
   These are the capabilities `storacha up` needs at the time of writing; check
   `storacha delegation create --help` and Storacha's CI guide if an upload is refused.
   Delegate to this key only, never your account.

| Kind | Name (in environment `ipfs`) | Value |
|---|---|---|
| Secret | `STORACHA_PRINCIPAL` | `key` from step 2 |
| Secret | `STORACHA_PROOF` | the base64 output of step 3 |
| Variable | `IPFS_STORACHA` | `true` |
| Variable, optional | `STORACHA_SPACE_DID` | the space DID, if the delegation covers more than one |

The job fails if Storacha reports a different root CID from the build.

**Any IPFS Pinning Service API provider (pin by CID)**, e.g. Pinata
(`https://api.pinata.cloud/psa`) or Filebase (`https://api.filebase.io/v1/ipfs`).
This pins the CID; the provider then fetches the blocks from the IPFS network, so
use it **together with** Storacha (or another node that serves the content). On its
own, the pin waits in `queued`.

| Kind | Name (in environment `ipfs`) | Value |
|---|---|---|
| Variable | `IPFS_PSA_ENDPOINT` | the provider's PSA base URL (the job POSTs to `<endpoint>/pins`) |
| Secret | `IPFS_PSA_TOKEN` | an access token limited to pinning |

**DNSLink (manual, optional).** The job summary prints the record. Set the variable
`DNSLINK_DOMAIN` to have it filled in:

```
_dnslink.app.example.org.  300  IN  TXT  "dnslink=/ipfs/<CID>"
```

Then point `app.example.org` at an IPFS gateway that serves DNSLink names (or your own
gateway), or use `ipns://app.example.org` in IPFS-aware browsers. Update the TXT record
on each release. Keep the old CIDs pinned for a while so cached clients can roll back.

**Origin caveat.** The web client keeps its encrypted vault in IndexedDB, which is
per origin. A subdomain gateway URL (`https://<cid>.ipfs.<gateway>/`) is a **new origin
for every release**, so users would see an empty app after each update. Give users one
stable origin (the DNSLink domain, GitHub Pages or Cloudflare Pages), and use CID
URLs only for verification and as a fallback when a domain is blocked (T17).

## 4. Verifying a release

```sh
gh run download <run-id> -n web-release -R lizthedotdev/distributed_recommendations
sha256sum -c SHA256SUMS
gh attestation verify web-dist.tar.gz -R lizthedotdev/distributed_recommendations
gh attestation verify web-dist.car    -R lizthedotdev/distributed_recommendations
```

Rebuild yourself: check out the commit, then `(cd packages/match && npm ci) && (cd apps/web && npm ci && npm run build)`.
`dist/` must match the release byte for byte (the tarball is deterministic:
`--sort=name --mtime=@0 --owner=0 --group=0`, `gzip -n`), and `ipfs-car pack` must print
the same CID.

## 5. Reproducible builds: findings (2026-10-19)

Tested on a copy of `apps/web` and `packages/` (Node 22.22.0, esbuild 0.28.2, lockfile
installs with `--ignore-scripts`):

- **Two clean builds are byte-identical:** all 24 files in `dist/`, and
  `dist-artifact/index.html`. Builds from a different, deeper directory (with a space
  in the path), with `TZ=Pacific/Kiritimati`, `LC_ALL=C` and `umask 077`, were also
  identical.
- **The IPFS CAR and its root CID are identical** across all three builds
  (`ipfs-car pack` writes no timestamps). The deterministic tarball is identical too,
  even with the `umask 077` file modes.
- **What differs** is filesystem metadata only (mtimes, and modes under a different
  umask). That matters only for archives, which is why the release tarball fixes mtime,
  owner and mode.
- Things that could have broken it but don't: the service-worker build id is a content
  hash of `app.js` + `app.css` (`scripts/build.mjs`, `stampServiceWorker`); the source map
  uses relative `sources` (`../src/…`, `../../../packages/…`), so no absolute path
  leaks in; esbuild adds no timestamps; `legalComments: "none"`.

CI enforces this (`web build is reproducible` job, `.github/scripts/check-web-reproducible.sh`:
two builds in different directories with different TZ, locale and umask, compared by
SHA-256 manifest). A test that injected `Date.now()` into `sw.js` made the check fail.

**Recommendations for `apps/web`** (not changed here, because others are editing it):
1. **Make the cross-package input explicit.** The build and tests resolve `nostr-tools`
   and `@noble/*` from `packages/match/node_modules` (`nodePaths`), and `psi.js` falls back
   to match's copy. So the output depends on a second lockfile and on `npm ci` having run
   there; the source map's `sourcesContent` embeds those files. Either declare these
   dependencies in `apps/web/package.json` or document the two-step install (CI and
   `docs/DEPLOY.md` do the latter). Remove the `psi.js` fallback so a missing install
   fails instead of silently using another copy.
2. **Pin Node in the repo** (`.nvmrc` or `engines` with an exact version, e.g. 22.22.0).
   CI pins 22.22.0. The output is esbuild's, which is pinned, but this removes a variable.
3. **Cross-platform check.** esbuild runs as a native binary per platform
   (`@esbuild/linux-x64`, `@esbuild/darwin-arm64`, …). Only linux-x64 was tested. Build once
   on macOS and compare manifests before claiming platform-independent reproducibility
   (F-Droid-style rebuilds run on Linux, so Linux is what matters first).
4. **`sw.js` cache id covers only `app.js` + `app.css`.** A release that changes only
   `index.html`, `fonts.css` or the manifest keeps the old cache name. The worker is
   network-first, so this is mostly harmless, but hashing every file in `SHELL` is
   more correct and still deterministic.
5. **Keep the snapshot committed.** `src/snapshot/snapshot.json` (the offline
   artifact's data) comes from the network (`npm run snapshot`). It's reproducible
   only because it's committed; never fetch it during `build`.
6. **Ship `.well-known/security.txt`:** copy `infra/web/.well-known/security.txt` into
   `public/.well-known/` after filling in the placeholders. Both deploy paths keep
   dot-directories.
7. **One name.** `public/manifest.webmanifest` and the artifact `<title>` still say "Match
   Feed", while `apps/mobile/brand.json` says "Meme Video". Read it from one place at
   build time (as `apps/mobile` does), so a rename is a one-line change.

## 6. Relay

The relay is deployed by hand on a host you control: [`infra/relay/README.md`](../infra/relay/README.md).
It needs no repository secrets. CI tests its configuration on every push.

If an OHTTP gateway (§7) publishes to this relay, list the gateway's egress address in
`POLICY_TRUSTED_SOURCES` (infra/relay/README.md, "Trusted gateway sources"); otherwise
the per-IP write limit (2 events/s, burst 30) throttles every OHTTP user at once.

## 7. Other server stacks, and who runs what

Every stack is Docker Compose with images pinned by digest, read-only root filesystems,
no added capabilities, no client-IP logging, and an `.env.example`. None needs repository
secrets, and none is deployed by a workflow. Several are privacy-relevant only if they are
run by **different parties**: putting them on one host, one cloud account or one admin
team defeats them.

| Stack | Who runs it | Must be separate from | Docs |
|---|---|---|---|
| `infra/relay` (Nostr relay) | the app's operator, or anyone | — | `infra/relay/README.md` |
| `infra/ohttp/gateway` (OHTTP gateway + Nostr target) | the app's operator | the OHTTP relay's operator | `infra/ohttp/README.md`, `docs/TRANSPORT.md` |
| `infra/ohttp/relay` (OHTTP relay) | **a different party**: a managed OHTTP relay (e.g. Fastly, or Cloudflare's relay service when the gateway isn't on Cloudflare) or a partner | the gateway's operator (no shared host, provider account, admins or logs) | same |
| `infra/janus/leader` (DAP leader) | the creator's home instance | the helper | `infra/janus/README.md`, `docs/ANALYTICS_IMPLEMENTATION.md` §5 |
| `infra/janus/helper` (DAP helper) | **an independent operator** (Divvi Up, a partner nonprofit, an unrelated instance) who signs the operator agreement | the leader (different legal entity, admins, hosting account, database) | same |
| `infra/labeler` (moderation labeler) | whoever staffs moderation (e.g. The Multiverse School) | — | `infra/labeler/README.md`, `services/labeler/README.md` |
| `infra/glitchtip` (crash and bug reports) | the app's operator | — | `infra/glitchtip/README.md`, `docs/TELEMETRY.md` |
| `infra/umami` (usage analytics) | the app's operator | — | `infra/umami/README.md`, `docs/TELEMETRY.md` |

Why the separation matters:
- **OHTTP:** the relay sees client IPs but only ciphertext; the gateway sees requests but
  not IPs. If one party runs both, or they share logs, it learns IP ↔ keys ↔ events, and
  OHTTP protects nothing (THREAT_MODEL T5).
- **DAP:** each report is split into two shares, one per aggregator. Whoever holds both
  can read every viewer's discovery channel. The helper's DP noise also protects viewers
  from the creator (THREAT_MODEL T14).

Order of operations for the private Match transport:
1. Run `infra/relay` (or pick relays that agree to carry the traffic) and add the
   gateway's address to `POLICY_TRUSTED_SOURCES`.
2. Run `infra/ohttp/gateway` with `NOSTR_RELAYS` pointing at them; record the key pin
   (`fetchKeyConfig()` through the relay).
3. Have the other party run `infra/ohttp/relay` (or a managed relay) with `GATEWAY_URL`
   pointing at your gateway and `CORS_ORIGIN` set to the app's origin.
4. Ship the OHTTP relay URL and the key pin with the app (docs/TRANSPORT.md, "Hooks for
   the web app"; not wired yet).

Before and after updating any of these stacks, run the matching suite in
`.github/workflows/e2e.yml`, or locally: `infra/relay/test/run.sh`,
`infra/ohttp/e2e/run.sh`, `cd packages/analytics && npm run test:e2e`,
`sh infra/glitchtip/test/smoke.sh`, `sh infra/umami/test/smoke.sh`.
