# Oblivious HTTP for Match traffic

Two stacks, for **two different operators** (docs/TRANSPORT.md explains why):

| Directory | Operator | What |
|---|---|---|
| `gateway/` | us (the app's operator) | Caddy (TLS, size cap, two paths) → Cloudflare privacy-gateway-server-go v0.0.3 → the Nostr target (`packages/transport`) → `NOSTR_RELAYS` |
| `relay/` | **someone else** (a managed OHTTP relay is better still) | Caddy as a single-gateway OHTTP relay: strips client headers, no `X-Forwarded-For`, no logs |
| `e2e/` | — | local end-to-end run of all three (strfry from `infra/relay` included) |

## Gateway

```sh
cd infra/ohttp/gateway
cp .env.example .env
$EDITOR .env      # GATEWAY_SITE, ACME_EMAIL, SEED_SECRET_KEY=$(openssl rand -hex 32), NOSTR_RELAYS
docker compose up -d --build
curl -s https://$GATEWAY_SITE/ohttp-keys | xxd | head   # application/ohttp-keys
```

- `gateway` is built from Cloudflare's source zip on proxy.golang.org, checked
  against a pinned SHA-256, with `go mod verify`.
- `target` is built from `packages/transport` with `npm ci --omit=dev --ignore-scripts`.
- Base images are digest-pinned.
- Networks: the gateway reaches only the target (`inner` is `internal: true`); the
  target is never published.
- Logs:
  - Caddy has no access log, and drops request fields from its process log;
  - the gateway runs at `LOG_LEVEL=WARN`;
  - the target prints one startup line.
- Give the gateway's address a per-IP allowance on the upstream relays: every user
  arrives from it (docs/TRANSPORT.md, "Rate limiting"). On `infra/relay` that is
  `POLICY_TRUSTED_SOURCES` (infra/relay/README.md, "Trusted gateway sources").
- **The key pin** clients ship is the SHA-256 of the X25519 config. Get it with
  `fetchKeyConfig()` from `packages/transport`, through the relay. Changing
  `SEED_SECRET_KEY` rotates the key: ship the new pin first.

## Relay (the other operator)

```sh
cd infra/ohttp/relay
cp .env.example .env
$EDITOR .env      # RELAY_SITE, ACME_EMAIL, GATEWAY_URL=https://<gateway>, CORS_ORIGIN=<app origin>
docker compose up -d
```

- The relay forwards only `POST /gateway` (≤ 96 KB) and `GET /ohttp-keys`, and only
  to `GATEWAY_URL`.
- It sends the gateway nothing from the client but the body and its content type.
- Per-IP rate limiting belongs here. Plain Caddy has none: add the `caddy-ratelimit`
  plugin or use the hosting provider's limits.

## Local e2e

```sh
infra/ohttp/e2e/run.sh                    # from the repo root
KEEP=1 infra/ohttp/e2e/run.sh             # keep the stacks running afterwards
```

It starts three separate Compose projects:

1. strfry, from `infra/relay/compose.yaml` unchanged, apart from its nofile ulimit
   (`e2e/nostr.override.yaml`), with Docker's private ranges in
   `POLICY_TRUSTED_SOURCES` (the target connects without Caddy);
2. the gateway stack, on plain HTTP;
3. the relay stack, published on `127.0.0.1:18081`.

Then it runs `packages/transport/test/e2e-docker.test.ts` (two Match clients, key
pinning, target allow-list), and fails if any relay or gateway log line holds an
IP address or a 64-hex value.

- CI: run by hand with `.github/workflows/e2e.yml` (suite `ohttp`).
- Behind a registry rate limit: `REGISTRY_MIRROR=mirror.gcr.io/library` (same
  digests).
- Behind a TLS-intercepting proxy: `EXTRA_CA_FILE=/path/ca.pem`, used only during
  image builds.
