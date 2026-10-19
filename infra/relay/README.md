# Self-hosted Nostr relay

A relay you can run for the app (working name set by `APP_NAME` in `.env`), either as
the app's default relay or as an optional relay that users add under Matches, Relays. It
carries 1:1 Match traffic (NIP-59 gift wraps, kind 1059) and can also hold public events
such as NIP-71 videos from `packages/bridge`.

It is [strfry](https://github.com/hoytech/strfry) (GPL-3.0, run unmodified as a
separate program) behind [Caddy](https://caddyserver.com) (Apache-2.0) for TLS, with a
small write-policy plugin for rate limits and gift-wrap rules.

| File | What it is |
|---|---|
| `compose.yaml` | strfry, a retention job and Caddy. Images pinned by digest; read-only root filesystems, no capabilities (Caddy gets `NET_BIND_SERVICE`), `no-new-privileges` |
| `strfry.conf` | relay config: limits, NIP-42 (off), logging |
| `policy/write-policy.sh` | strfry write-policy plugin (busybox `sh`/`awk`; the image has nothing else) |
| `Caddyfile` | TLS, security headers, WebSocket proxy, IP-free logging |
| `.env.example` | everything that differs per deployment |
| `test/smoke.mjs` | checks limits and policy against a running relay; CI runs it (`relay` job) |
| `test/run.sh` | starts strfry, runs the smoke test and the retention command, checks the logs for IPs |

## Quick start

You need a host with Docker Compose v2, a DNS name pointing at it, and ports 80 and 443
open (Caddy gets a Let's Encrypt certificate on first start).

```sh
cd infra/relay
cp .env.example .env
$EDITOR .env                 # RELAY_DOMAIN, ACME_EMAIL, APP_NAME, RELAY_CONTACT, ...
docker compose up -d
docker compose ps            # strfry should become "healthy"
curl -s -H 'Accept: application/nostr+json' https://$RELAY_DOMAIN/ | jq .
```

Clients connect to `wss://RELAY_DOMAIN`.

## Configuration

What the protocol needs (`docs/PROTOCOL.md`, `docs/MATCH.md`) and where it is set:

| Need | Setting | Value |
|---|---|---|
| Gift wraps up to 65,536 bytes; NIP-17 sketches are capped at the 128 bucket (~33 KB wraps) to fit common relay limits | `events.maxEventSize` | `65536` (normalised JSON). WebSocket frames up to 128 KiB |
| NIP-40 expiration | built into strfry | Rejects already-expired events, and deletes stored events when they expire |
| Gift wraps must expire: sketches ≤ 30 days after issue, control messages 14 days | write policy | kind 1059 must carry an `expiration` tag, in the future and ≤ `POLICY_GIFTWRAP_MAX_TTL` (31 days) ahead |
| Seals and wraps backdate `created_at` by up to 2 days (NIP-59) | `events.rejectEventsOlderThanSeconds` | 3 years (default). Wraps are bounded by their expiration instead |
| Retention for gift wraps | `retention` service | Deletes kind 1059 with `created_at` older than 33 days (`GIFTWRAP_RETENTION_SECONDS`), every hour. A backstop for wraps stored before the policy existed |
| Rate limits | write policy | Per connection IP token bucket: `POLICY_RATE` events/s (2), burst `POLICY_BURST` (30). REQ load is bounded by strfry's own limits: 50 subscriptions per connection, 500 events per filter, 200 filters per REQ |
| A gateway that carries many users (OHTTP) | `POLICY_TRUSTED_SOURCES`, `POLICY_TRUSTED_RATE`, `POLICY_TRUSTED_BURST` | Empty by default. Listed addresses get their own bucket, 50 events/s, burst 500; see below |
| NIP-42 AUTH, optional | `RELAY_AUTH` | Off by default; see below |
| No IP logging | strfry `--verbosity=WARNING`, `logging.invalidEvents = false`; Caddy has no access log and a filtered process log | See "Logs" |
| Optional: only the app's kinds | `POLICY_ALLOWED_KINDS` | Empty accepts every kind. For an app-only relay: `0,5,1059,10002,10050,34235,34236` |

`APP_NAME` sets the NIP-11 name (`"$APP_NAME relay"`); it is the only place the app's
name appears in the relay setup.

### Trusted gateway sources

The OHTTP Nostr gateway (`infra/ohttp/gateway`, docs/TRANSPORT.md) publishes and
queries for every user of the private transport, so this relay sees all of them as
one IP. Under the per-IP limit (2 events/s, burst 30) a handful of users would use up
the gateway's bucket and everyone's messages would be rejected. List the gateway's
address so it gets a larger bucket of its own:

```sh
# .env
POLICY_TRUSTED_SOURCES=198.51.100.7,2001:db8::7   # the gateway host's egress addresses
POLICY_TRUSTED_RATE=50                            # events/s per listed address
POLICY_TRUSTED_BURST=500
```

- **Default is safe:** empty, so no address gets more than `POLICY_RATE`/`POLICY_BURST`.
- **Still a limit, not an exemption.** Each listed address has its own token bucket.
  The gift-wrap expiration rules and `POLICY_ALLOWED_KINDS` apply as usual. The
  defaults match the target's own global limit (`RATE_GLOBAL=50/200` in
  `infra/ohttp/gateway/.env.example`); the target also limits per recipient key and
  per query, because it can't see user IPs (docs/TRANSPORT.md, "Rate limiting
  without IPs").
- **Format:** exact IPv4 or IPv6 addresses, or IPv4 CIDR prefixes from `/8` to `/32`,
  separated by commas or spaces. Write IPv6 the way strfry prints it (lower case, zeros
  compressed: `2001:db8::7`, not `2001:0db8:0:0:0:0:0:7`); IPv6 prefixes are not
  supported. Invalid entries are ignored and the plugin logs only how many (never the
  entry) at startup.
- **Which address to list:**
  - Gateway on another host, connecting to `wss://RELAY_DOMAIN` through Caddy: its public
    egress address. Caddy overwrites `X-Real-IP` with the TCP peer, so a client cannot
    claim a trusted address.
  - Target on the same Docker host, joined to this stack's network and connecting to
    `ws://strfry:7777` without Caddy: strfry falls back to the TCP peer (and warns once
    that `X-Real-IP` is empty), so list the target container's address or the
    network's subnet. Pin the subnet in Compose if you trust a CIDR. Every container
    on that subnet gets the allowance.
- **Never** publish strfry's port 7777 while a trusted source is set: a direct client
  could then send its own `X-Real-IP` and claim the gateway's address.
- **What it gives away:** nothing new about users. The relay already sees the gateway's
  IP on every request; the list only names it. It doesn't reveal which users use OHTTP.
- Trust only gateways you run or have an agreement with. A listed address can write
  25 times as much as anyone else, so a compromised gateway can flood the relay at that
  rate. Abuse through the gateway is limited at the target (per recipient key and per
  query) and, per client IP, at the OHTTP relay.

### NIP-42 AUTH

Off by default (`RELAY_AUTH=false`). With it on, strfry sends an AUTH challenge, and
`RELAY_AUTH_RESTRICTED_READ_KINDS=1059` would let only the `p`-tagged recipient read a
gift wrap. That stops anyone from scraping all wraps (who receives, when, how big).

Why it's off: AUTH tells the relay which key is connected. The web client authenticates
only with the identity key (`apps/web/README.md`, Known gaps), while sketches are wrapped
to per-match keys, so restricting kind 1059 would stop clients from reading their
sketches. Turn it on when the client can authenticate per key. Until then the relay still
learns the recipient key from the REQ's `#p` filter, so AUTH would add little.

## What the relay operator can see

Gift-wrap content is NIP-44 encrypted to the recipient. The operator **cannot** read
messages, sketches, preview answers, or who the real sender is (the seal is inside the
encryption; the wrap is signed by a one-time key). The operator **can** see:

- **Client IP addresses** of every connection (Caddy sees the TCP peer and passes it to
  strfry in `X-Real-IP` for rate limiting). They're held in memory only (see "Logs"), but
  a malicious operator could log them. Clients that use the OHTTP transport
  (`packages/transport`, docs/TRANSPORT.md) reach the relay through the gateway, so
  the relay sees the gateway's IP instead of theirs. The web app doesn't use it yet;
  until it does, users who need to hide their IP from relays need Tor or a VPN.
- **Recipient keys**: each wrap's `p` tag (an identity key for match requests, a
  per-match key afterwards) and which `#p` each connection asks for. So one connection
  links an IP to the keys it reads, unless the client spreads its keys over relays or
  connections.
- **Timing and size**: when wraps arrive and are fetched, and their size. Control messages
  are padded to 8,192 bytes and sketches to fixed buckets, and `created_at` is jittered,
  which limits but does not remove this.
- **Expiration** of each wrap (14 days by default for both sketches and control messages).
- **Everything in public events** (profiles, relay lists, NIP-71 videos).

Users should treat any relay as able to see this metadata. Running your own relay moves
that trust to you; it does not remove it.

## Logs

Log policy: **no client IP addresses, User-Agents or request URIs are written by default.**
Checked (relay smoke test through Caddy over `wss://`, 2026-10-19): the logs had no IP.

- **strfry** runs at `--verbosity=WARNING`. At the default `INFO` it logs every
  `Connect from <IP>` and `Disconnect from <IP>`. Rejected-event logging
  (`invalidEvents`) is off.
- **Write-policy plugin errors:** if the plugin crashes or times out, strfry logs
  the whole request at error level, **including the client IP** (`sourceInfo`). The
  plugin is plain `awk` with no external calls, and CI tests it. If you change it,
  run the smoke test and watch for `Plugin error` lines.
- **Caddy** has no access log (no `log` directive in the site block). Its process log
  runs at `WARN`, and a `filter` encoder deletes `remote_ip`, `client_ip`, `remote_port`,
  headers, URI and TLS fields from any entry that does carry a request. The admin API is
  off.
- **Docker** keeps container logs with the `local` driver, rotated at 3 × 10 MB. Set
  `LOG_DRIVER=none` in `.env` to keep none.
- **Out of scope here:** the host's firewall and kernel logs, your hosting provider's
  network logs, and DNS. Check those yourself.

Write the log policy in your relay's privacy page (`RELAY_PRIVACY_URL`, shown in NIP-11).

## Operations

- **Status:** `docker compose ps` (strfry has a NIP-11 healthcheck); `docker compose logs --tail 100`.
- **Database stats:** `docker compose exec strfry /app/strfry --config=/etc/strfry.conf --verbosity=WARNING info`.
- **Delete by filter** (abuse, a takedown request): `docker compose exec strfry /app/strfry --config=/etc/strfry.conf delete --filter '{"authors":["<hex pubkey>"]}'`. Add `--dry-run` first.
- **Backup:** `docker compose exec -T strfry /app/strfry --config=/etc/strfry.conf --verbosity=WARNING export > backup.jsonl`. Gift wraps expire within weeks, so a backup is mainly for public events. Encrypt backups and delete them on the same schedule.
- **Compact** after large deletions: stop the relay, then `docker compose run --rm --entrypoint /app/strfry strfry --config=/etc/strfry.conf compact /app/strfry-db/compacted.mdb`, and swap the file in.
- **Disk:** LMDB's `mapsize` (10 TB) is address space, not disk. Watch the `strfry-db` volume's real size.
- **Firewall:** only 80/tcp, 443/tcp and 443/udp need to be open. strfry's port 7777 is not published to the host.
- **Updating:** Dependabot opens PRs that bump the image digests in `compose.yaml`
  after a 14-day cooldown. Upstream strfry publishes only `ghcr.io/hoytech/strfry:latest`,
  so the digest is the real pin. The pinned image was built 2026-09-04 and reports
  `strfry 1.1.2-148-g4cd3cf6` (the 1.1.3 tag is from the same day). To build from a
  tag instead, use upstream's `Dockerfile` at that tag and set `image:` to your build.
  After any update, run the smoke test. Then `docker compose pull && docker compose up -d`.

## Testing

CI (`.github/workflows/ci.yml`, job `relay`) checks `docker compose config`, runs
`caddy validate` and `caddy fmt`, then runs `test/run.sh`, which starts strfry with this config, runs
`test/smoke.mjs` (NIP-11, 33 KB wrap accepted, > 64 KiB rejected, NIP-40, gift-wrap
expiration rules, rate limit, trusted gateway source), runs the retention command, and
fails if the logs contain an IP. The trusted-source checks run when `SMOKE_TRUSTED_IP`
is set: a trusted address in `POLICY_TRUSTED_SOURCES` gets past the default burst, still
needs gift-wrap expirations, and an address just outside the prefix keeps the default
limit. To run it locally from the repo root:

```sh
(cd packages/match && npm ci) && (cd apps/web && npm ci)
infra/relay/test/run.sh            # KEEP=1 leaves the container running
```

The same suite is in the manual `.github/workflows/e2e.yml` (suite `relay`).

To try the whole stack on one machine, set `RELAY_DOMAIN=localhost`. Caddy then uses
its own local CA instead of Let's Encrypt, and `wss://localhost` works with
`NODE_TLS_REJECT_UNAUTHORIZED=0` for the smoke test. Never point the smoke test at a
public relay.

## Known limits

- Rate limits are per IP, so users behind one NAT, VPN exit or Tor exit share a bucket.
  Buckets reset when strfry restarts. A gateway that carries many users needs an entry
  in `POLICY_TRUSTED_SOURCES` (above).
- The relay can't tell Match traffic from other gift wraps; it only enforces sizes and
  expirations.
- The OHTTP gateway (`infra/ohttp`, T5) goes in front of this relay as one more
  client. It needs a trusted-source entry here; NIP-42 AUTH isn't available through it.
- `HEAD /` makes Caddy log a harmless "Unsolicited response" line, because strfry sends a
  body. It contains no IP.
