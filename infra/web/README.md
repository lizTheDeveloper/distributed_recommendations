# infra/web

Release files for the web client (`apps/web`). These live here, outside
`apps/web`, so release engineering does not edit the app while others are working on it.

| Path | What it is |
|---|---|
| `.well-known/security.txt` | [RFC 9116](https://www.rfc-editor.org/rfc/rfc9116) template. **Copy it to `apps/web/public/.well-known/security.txt`** after filling in the placeholders. The build copies `public/` into `dist/` as is, and both deploy paths keep dot-directories (`include-hidden-files: true` for the workflow artifact and GitHub Pages, `ipfs-car pack --hidden` for IPFS). Renew `Expires` every year. |
| `deploy-tools/ipfs/` | Exact-pinned, lockfiled `ipfs-car` 3.1.0 and `@storacha/cli` 3.0.1 for `.github/workflows/deploy-web.yml`. Installed with `npm ci --ignore-scripts`. |
| `deploy-tools/cloudflare/` | Exact-pinned, lockfiled `wrangler` 4.147.0 (published 2026-10-02; the newest was skipped as too fresh). |

Lockfiles were made with `npm install --package-lock-only --ignore-scripts --before=2026-10-05`.
Dependabot (`.github/dependabot.yml`) proposes updates once a release is 14 days old.

To check the IPFS CID of a release yourself:

```sh
(cd packages/match && npm ci) && (cd apps/web && npm ci && npm run build)
(cd infra/web/deploy-tools/ipfs && npm ci && npx --no-install ipfs-car pack ../../../../apps/web/dist --hidden --output /tmp/web.car)
```

The printed root CID must equal the one in the release's `web-dist.cid` and job summary.
How to set up the deploy targets: [`docs/DEPLOY.md`](../../docs/DEPLOY.md).
