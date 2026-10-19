# Self-hosted GlitchTip (crash reports and bug reports)

The server for the web app's **opt-in** crash & error reports and bug reports /
feedback (`docs/TELEMETRY.md`). Nothing reaches it unless a viewer turns crash reports
on or presses Send on a bug report.

[GlitchTip](https://glitchtip.com) 6.2.6 (MIT, Sentry-protocol compatible) with
Postgres and Valkey, behind [Caddy](https://caddyserver.com) for TLS. Same layout and
hardening as `infra/relay`.

| File | What it is |
|---|---|
| `compose.yaml` | Postgres 17, Valkey 8.1 (memory only), GlitchTip (one all-in-one process: web, worker, scheduler), Caddy. Images pinned by digest; no capabilities beyond what each entrypoint needs; `no-new-privileges` |
| `Caddyfile` | TLS, security headers, 1 MB body limit, **all forwarding headers removed**, IP-free logging |
| `.env.example` | everything that differs per deployment |
| `test/smoke.sh`, `test/compose.test.yaml`, `test/test.env` | local test with synthetic events (below) |

## Quick start

You need a host with Docker Compose v2, a DNS name pointing at it, and ports 80 and 443 open.

```sh
cd infra/glitchtip
cp .env.example .env
$EDITOR .env                      # GLITCHTIP_DOMAIN, ACME_EMAIL, APP_ORIGINS, secrets
ENABLE_USER_REGISTRATION=true docker compose up -d   # only for the first account
# open https://GLITCHTIP_DOMAIN, create your account, an organization and a project (platform: JavaScript)
docker compose up -d              # again, with registration off (the .env default)
```

Then, in GlitchTip:

1. **Project → Settings:** leave **"Scrub IP addresses"** on (default). It only
   truncates an address GlitchTip receives, as a second line of defense; with this
   Caddy setup GlitchTip receives none (see "IP addresses").
2. **Project → Settings → Data scrubbing:** turn on server-side scrubbing with the
   defaults (passwords, tokens, keys, cards). The client already scrubs; this catches
   anything an older client might send.
3. **Organization → Settings:** keep "Scrub IP addresses" on for new projects too.
4. Copy the project's **DSN** and build the web app with it:
   `MF_GLITCHTIP_DSN=https://<key>@errors.example.org/<id> npm run build` (apps/web).

The DSN's key is public by design (it only allows sending events). Anyone can send
junk to it; the 1 MB body limit, GlitchTip's per-project throttle (Project → Settings
→ event throttle) and CORS (`APP_ORIGINS`) limit the damage.

## IP addresses

The browser's IP address is never stored, by construction:

- **Caddy** removes `X-Forwarded-For`, `X-Real-IP`, `Forwarded`, `True-Client-IP`,
  `CF-Connecting-IP` and every other client-IP header before proxying. GlitchTip sees
  only Caddy's address on the private Docker network.
- **GlitchTip** resolves the client IP with django-ipware (`IPWARE_ALGORITHM = "legacy"`)
  and attaches it to an event only if it is *routable*
  (`apps/event_ingest/api.py`, `get_ip_address`). A private Docker address isn't, so
  events get no `user.ip_address`. Checked in the 6.2.6 source and by `test/smoke.sh`.
- **The client** sends `sendDefaultPii: false` and the scrubber drops `user` and
  `request` entirely, so the SDK never asks GlitchTip to fill in an IP.
- GlitchTip has no setting to turn IP storage off entirely; per-project "Scrub IP
  addresses" (on by default) truncates it (`anonymizeip`: 8.8.4.4 → 8.8.4.0). Keep it
  on in case someone ever bypasses Caddy.

Don't put a CDN or another proxy in front of Caddy without checking what it adds:
GlitchTip would trust a forwarding header from it.

## Retention

`GLITCHTIP_RETENTION_DAYS=30` (from `RETENTION_DAYS`) is GlitchTip's master
retention: events, including bug reports (sent as captured messages), and their
partitions are dropped after 30 days by the built-in scheduler (it logs
"Cleaning up old partitions … (retention: 30 days)" at start).

Bug reports are **not** sent as GlitchTip `user_report`/`feedback` items on purpose:
in 6.2.6 those are stored only as a UserReport row, linked to an issue only if the
associated event already exists, listed only per issue, and deleted only with their
issue. A standalone report would be invisible in the UI and outlive retention.

Postgres backups, if you make them, need the same 30-day limit.

## Logs

No client IP, User-Agent or URI is logged by default:

- Caddy: no access log; the process log runs at WARN through a filter that deletes
  `remote_ip`, `client_ip`, headers, URI and TLS fields.
- GlitchTip: `LOG_LEVEL=WARNING`; granian's access log is off (it needs
  `--access-log`). Even if it logged, it would see only Caddy's address.
- Postgres: `log_connections`/`log_disconnections` off (it sees only containers anyway).
- Valkey: `--save ""`, no append-only file: queued events are never written to disk.
- Docker: `local` driver, 3 × 10 MB. `LOG_DRIVER=none` keeps none.
- Out of scope: the host's firewall, the hosting provider's network logs, DNS.

## Who can see the data

Anyone with an account in the GlitchTip organization. Keep registration off
(`ENABLE_USER_REGISTRATION=false`, `ENABLE_ORGANIZATION_CREATION=false`), use 2FA, and
add only people who fix bugs. Bug reports can include a contact email the viewer typed;
treat it as personal data (docs/TELEMETRY.md, operator obligations).

## Testing

`test/smoke.sh` starts the stack on `https://localhost:8443` (Caddy's local CA,
GlitchTip's DEBUG dev bootstrap for a throwaway project), sends a synthetic crash
report and a synthetic bug report with spoofed forwarding headers, and checks:
both are stored; no IP (or truncated IP) and no `ip_address` field anywhere in a
`pg_dump`; CORS allows only `APP_ORIGINS`; retention is 30 days; no container log
contains the IP. A **control** request sent straight to GlitchTip (bypassing Caddy)
*is* stored with a truncated IP (`8.8.4.0`), which shows the check would catch a leak.
(Documentation-range addresses like 203.0.113.x are non-routable to ipware, so the
test uses a routable one; nothing is sent to it.)

```sh
sh infra/glitchtip/test/smoke.sh        # KEEP=1 to leave it running
```

Last run 2026-10-19: all checks passed. The web client side is checked separately
against mock servers (`apps/web`, `npm run check:telemetry`).

## Updating

The images are pinned by digest (`glitchtip/glitchtip:6.2.6`, built 2026-08-08;
`postgres:17.11-alpine`; `valkey/valkey:8.1.10-alpine`; `caddy:2.11.7-alpine`, the
same digest as `infra/relay`). Add `/infra/glitchtip` to the `docker-compose`
ecosystem in `.github/dependabot.yml` so updates arrive as PRs after the 14-day
cooldown (not done here). After an update, read GlitchTip's CHANGELOG for ingest,
IP or retention changes (7.0 moves envelope ingest to Rust; its client-IP resolution
is documented to mirror the legacy algorithm, but re-run the smoke test), then
`docker compose pull && docker compose up -d`.
