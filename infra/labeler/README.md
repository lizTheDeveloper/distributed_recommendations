# Moderation labeler (Docker Compose)

Runs `services/labeler` (see its README for the reviewer workflow, escalation and transparency) on a server.

| File | What it is |
|---|---|
| `compose.yaml` | Three services, described below |
| `Dockerfile` | Node 22.22 on Alpine. The base image is pinned by digest. It holds `services/labeler` plus the `packages/moderation`, `packages/bridge` and `packages/core` sources it imports. `npm ci --ignore-scripts --omit=dev`; runs as `node` |
| `Dockerfile.dockerignore` | The build context is the repo root; only the files the image needs are sent |
| `.env.example` | Signer mode, secret file paths, intervals, log driver. No secrets |
| `labeler.config.example.json` | The labeler config: npub, relays, rate limits, auto-blur (off), retention, contact, policy and appeal URLs |

The three services in `compose.yaml`:
- `intake` polls the relays for reports.
- `cli` (profile `tools`) is for reviewers.
- `admin` (profile `admin`) is the web admin, bound to the host's 127.0.0.1.

Every service has a read-only root, no capabilities and `no-new-privileges`.

## Quick start

```sh
cd infra/labeler
cp .env.example .env
cp labeler.config.example.json labeler.config.json
$EDITOR .env labeler.config.json               # labeler npub, relays, contact, policyUrl, appealUrl
mkdir -p secrets && chmod 700 secrets
printf '%s' 'bunker://<signer pubkey>?relay=wss://…&secret=…' > secrets/bunker_url && chmod 600 secrets/bunker_url
docker compose build
docker compose up -d intake
docker compose run --rm cli queue
docker compose run --rm cli whoami --signer bunker
docker compose run --rm cli label --case <id> --value spam --reason "…" --reviewer liz --publish --signer bunker
```

The web admin needs Linux, because it uses host networking. Start it on the server, then tunnel to it from your own
machine:

```sh
LABELER_REVIEWER=liz docker compose --profile admin up admin   # on the server
ssh -L 8787:127.0.0.1:8787 <server>                             # on your machine
# then open http://127.0.0.1:8787
```

The admin binds to the host's 127.0.0.1 only and refuses any other address. Never publish it on a public interface
or behind a reverse proxy.

## Keys

- Keys are read from files in `./secrets`, which is mounted read-only at `/run/labeler-secrets`. The `*_FILE`
  variables in `.env` point to them.
- Never put keys in `.env`, the config, or the command line. The CLI refuses `--nsec`, `--key` and `--bunker`.
- `LABELER_SIGNER=bunker` (NIP-46) is recommended: the labeler's secret key stays in the remote signer.
- Use `key` mode (`secrets/labeler_key`, nsec or hex) only if you enable auto-blur, which needs unattended signing.
  In that case, add `"--signer", "key"` to the `intake` command.

## Logs

There are no inbound connections, so there are no client IPs to log.

- **intake** writes counts and relay URLs to stderr: `intake: 3 accepted, 1 duplicate`.
- **admin** logs nothing about requests.
- **Docker** keeps logs with the `local` driver, rotated at 3 × 10 MB. `LOG_DRIVER=none` keeps none.
- **Not covered here:** the host's firewall and SSH logs, and your provider's network logs. Check those yourself.
- **Reporter data.** Reporter pubkeys and report text live in the SQLite store on the `labeler-data` volume, until
  `purge` removes them (see the service README, "Retention"). Back the volume up encrypted, and delete backups on the
  same schedule.

## Operations

- **Retention.** Run daily from cron: `docker compose run --rm -T cli purge` (`-T`: cron has no TTY).
- **Audit check.** `docker compose run --rm cli audit verify`.
- **Transparency export.** `docker compose run --rm -T cli statements --public --format csv --since 2026-01-01 > statements.csv`.
- **Backup.** `docker compose run --rm -T --entrypoint sh cli -c 'cat /data/labeler.sqlite' > labeler.sqlite`. Stop
  `intake` first, or use `sqlite3 .backup` on the host.
- **Updating the base image.** The `FROM` lines pin `node:22.22.0-alpine3.22` by its multi-arch index digest, read
  from Docker Hub on 2026-10-19. Bump the tag and digest together, rebuild, and run `npm test` in
  `services/labeler`.
  - Dependabot doesn't watch this directory yet. Add `/infra/labeler` (ecosystem `docker`) and `/services/labeler`
    (`npm`) to `.github/dependabot.yml`.

## Testing

- Unit and end-to-end tests are in `services/labeler` (`npm test`). They use an in-memory relay and never publish to a
  public relay.
- `docker compose config` validates this file.
- The image was built and smoke-tested on 2026-10-19. The checks ran offline (`--network none`, read-only root, as
  `node`): `vocab`, a dry-run `label`, `audit verify` and `transparency`. SQLite was created on the `/data` volume.
  - Docker Hub was rate-limiting the build host, so the base image came from `mirror.gcr.io/library/node` at the same
    content digest.
