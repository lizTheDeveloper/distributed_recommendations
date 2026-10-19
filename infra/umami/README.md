# Self-hosted Umami (usage analytics)

The server for the web app's **opt-in** usage analytics (`docs/TELEMETRY.md`). Nothing
reaches it unless a viewer turns usage analytics on.

[Umami](https://umami.is) 3.4.0 (MIT; license checked in the repository, 2026-10-19)
with Postgres, a retention job, and [Caddy](https://caddyserver.com) for TLS. Umami
is cookie-free. Same layout and hardening as `infra/relay` and `infra/glitchtip`.

| File | What it is |
|---|---|
| `compose.yaml` | Postgres 17, Umami, a retention job (Postgres image, `psql` hourly), Caddy. Images pinned by digest |
| `retention.sql` | deletes events, event data, session data and unused sessions older than `RETENTION_DAYS` (30) |
| `Caddyfile` | TLS, security headers, 64 KB body limit, **all forwarding headers removed**, tracker scripts not served, IP-free logging |
| `.env.example` | everything that differs per deployment |
| `test/smoke.sh`, `test/compose.test.yaml`, `test/test.env` | local test with synthetic events (below) |

## Quick start

```sh
cd infra/umami
cp .env.example .env
$EDITOR .env                 # UMAMI_DOMAIN, ACME_EMAIL, secrets
docker compose up -d
```

1. Open `https://UMAMI_DOMAIN`, log in as `admin` / `umami` and **change the password
   at once** (Settings → Profile). Turn on 2FA.
2. Settings → Websites → Add website: any name, domain e.g. `app.example.org`. Copy
   its **website id**.
3. Build the web app with it:
   `MF_UMAMI_HOST=https://stats.example.org MF_UMAMI_WEBSITE_ID=<id> npm run build` (apps/web).

## How the app sends events (and why not Umami's tracker)

The app does **not** load Umami's `script.js`. The tracker reads `location.href`,
`document.referrer`, the page title, the exact screen size and the browser language on
its own, and tracks page views automatically. Its `data-before-send` hook could rewrite
those, but the script would still be third-party code running in the page and would
need a CSP exception. Instead, a ~60-line client in the app
(`apps/web/src/lib/telemetry/usage.ts`) POSTs to `/api/send` with only:
`website`, `hostname: "app"`, `url: "/<route>"`, an optional allow-listed event `name`
and `data`, and coarse `browser`/`os`/`device`. No cookies, no referrer, no
`x-umami-cache` token, no id. The tracker endpoints are not served (`404`).

Checked against Umami 3.4.0 `src/app/api/send/route.ts`: all of `url`, `referrer`,
`title`, `screen`, `language`, `id` are optional; `browser`, `os` and `device` from the
payload take precedence over the User-Agent; `ip` from the payload would override the
connection's (the app never sends it).

## IP addresses

- **Caddy** removes every client-IP header Umami looks at (`X-Forwarded-For`,
  `X-Real-IP`, `True-Client-IP`, `CF-Connecting-IP`, `Forwarded`, … and `CF-IPCountry`).
  Umami runs in Next.js behind Caddy and reads the client IP only from those headers
  (`src/lib/ip.ts`), so it gets none.
- Umami never stores the IP itself. It uses it for two things, both disabled by the
  above: **geolocation** (country/region/city stay empty; `SKIP_LOCATION_HEADERS=1`
  too) and the **session hash** `uuid(website, ip, user-agent, monthly salt)`. Without
  an IP, everyone with the same browser version shares a session within a month, so
  "visitors" are not unique people. That is intended.
- `test/smoke.sh` checks this with a control: the same request sent straight to
  Umami (bypassing Caddy) gets country `US` from the spoofed IP.

## Retention

Umami keeps data forever by default. The `retention` service runs `retention.sql`
every hour and deletes rows older than `RETENTION_DAYS` (30) from `website_event`,
`event_data`, `session_data`, and sessions that have nothing left. Websites, users
and saved reports are kept. Backups, if any, need the same limit.

## Logs

- Caddy: no access log; WARN-level process log with client fields removed.
- Umami (Next.js standalone server) doesn't log requests. `DISABLE_TELEMETRY=1` and
  `DISABLE_UPDATES=1` stop it from contacting umami.is.
- Postgres: no connection logging. Docker: `local` driver, 3 × 10 MB, or `LOG_DRIVER=none`.

## Who can see the data

Anyone with a login on this Umami. Keep it to the people who need it; never enable a
public share URL for the website if you don't intend to publish the numbers.

## Testing

```sh
sh infra/umami/test/smoke.sh       # KEEP=1 to leave it running
```

Starts the stack on `https://localhost:8444` (Caddy's local CA), creates a test
website, posts a screen view and a feature event exactly as the app builds them
(with spoofed forwarding headers), and checks: stored with the route path only (no
referrer, title, language); no location; no IP anywhere in a `pg_dump`; the control
request (straight to Umami) does get a country; `/script.js` is 404; the retention SQL
deletes a 40-day-old event and keeps a new one; no container log contains the IP.
Last run 2026-10-19: all checks passed.

## Updating

Pinned: `ghcr.io/umami-software/umami:3.4.0` (released 2026-09-16), `postgres:17.11-alpine`,
`caddy:2.11.7-alpine`. Add `/infra/umami` to the `docker-compose` ecosystem in
`.github/dependabot.yml` (not done here). After an update, check `/api/send`'s schema
and `src/lib/ip.ts` for new client-IP headers (add them to the Caddyfile), check the
table names in `retention.sql`, and re-run the smoke test.
