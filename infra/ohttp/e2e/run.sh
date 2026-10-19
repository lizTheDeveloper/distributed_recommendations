#!/bin/sh
# Local end-to-end run: two Match clients exchange messages through
#   OHTTP relay (Caddy, ../relay) → OHTTP gateway (Cloudflare privacy-gateway-server,
#   ../gateway) → Nostr target (packages/transport) → strfry (infra/relay)
# as three separate Compose projects, like three operators. Nothing public is
# contacted at run time.
#
#   infra/ohttp/e2e/run.sh            # from the repo root; needs Docker Compose v2.24+
#   KEEP=1 infra/ohttp/e2e/run.sh     # leave the stacks running afterwards
#
# Optional: REGISTRY_MIRROR=mirror.gcr.io/library pulls node/golang through a
# mirror (same digests); EXTRA_CA_FILE=/path/ca.pem for TLS-intercepting proxies
# during the image builds.
set -eu

ROOT=$(cd "$(dirname "$0")/../../.." && pwd)
cd "$ROOT"
E2E_RELAY_PORT=${E2E_RELAY_PORT:-18081}
export E2E_RELAY_PORT
export E2E_INTERNET_NETWORK=ohttp-e2e-internet
export E2E_NOSTR_NETWORK=ohttp-e2e-nostr_relay
export EXTRA_CA_FILE=${EXTRA_CA_FILE:-/dev/null}
if [ -n "${REGISTRY_MIRROR:-}" ]; then
  export NODE_IMAGE="$REGISTRY_MIRROR/node:22.22.0-alpine@sha256:e4bf2a82ad0a4037d28035ae71529873c069b13eb0455466ae0bc13363826e34"
  export GO_IMAGE="$REGISTRY_MIRROR/golang:1.25.14-alpine@sha256:1ae0735f00daffa3aaf1363a5184c0d2dc55c78e3db4ec70241cdac97bf84b59"
fi

NOSTR="docker compose -p ohttp-e2e-nostr -f infra/relay/compose.yaml -f infra/ohttp/e2e/nostr.override.yaml --env-file infra/relay/.env.example"
GW="docker compose -p ohttp-e2e-gateway -f infra/ohttp/gateway/compose.yaml -f infra/ohttp/e2e/gateway.override.yaml --env-file infra/ohttp/gateway/.env.example"
RELAY="docker compose -p ohttp-e2e-relay -f infra/ohttp/relay/compose.yaml -f infra/ohttp/e2e/relay.override.yaml --env-file infra/ohttp/relay/.env.example"

cleanup() {
  if [ "${KEEP:-}" = "1" ]; then echo "e2e: KEEP=1, stacks left running"; return; fi
  $RELAY down -v --remove-orphans >/dev/null 2>&1 || true
  $GW down -v --remove-orphans >/dev/null 2>&1 || true
  $NOSTR down -v --remove-orphans >/dev/null 2>&1 || true
  docker network rm "$E2E_INTERNET_NETWORK" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker network inspect "$E2E_INTERNET_NETWORK" >/dev/null 2>&1 || docker network create "$E2E_INTERNET_NETWORK" >/dev/null

echo "e2e: 1/4 Nostr relay (strfry from infra/relay)"
# The gateway is one IP for every user: give it the trusted-source allowance
# (infra/relay/README.md "Trusted gateway sources"). The target connects to strfry
# directly on the Compose network, so strfry sees its container address; trust
# Docker's default address pools. Everyone else keeps the default 2/s, burst 30.
POLICY_TRUSTED_SOURCES=172.16.0.0/12,192.168.0.0/16 POLICY_TRUSTED_RATE=200 POLICY_TRUSTED_BURST=2000 \
  $NOSTR up -d --wait strfry

echo "e2e: 2/4 OHTTP gateway + target"
SEED_SECRET_KEY=$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n')
export SEED_SECRET_KEY
GATEWAY_SITE='http://:80' NOSTR_RELAYS=ws://strfry:7777 RATE_GLOBAL=200/2000 RATE_QUERY=50/500 RATE_RECIPIENT=20/200 \
  $GW up -d --build --wait

echo "e2e: 3/4 OHTTP relay (separate project)"
RELAY_SITE='http://:80' GATEWAY_URL=http://front:80 CORS_ORIGIN=http://localhost \
  $RELAY up -d --wait

echo "e2e: 4/4 two Match clients over OHTTP"
(cd packages/transport && OHTTP_E2E_RELAY_URL="http://127.0.0.1:$E2E_RELAY_PORT/gateway" \
  node --experimental-strip-types --disable-warning=ExperimentalWarning --test --test-reporter=spec test/e2e-docker.test.ts)

echo "e2e: checking logs for client IPs and Nostr keys"
LOGS=$( { $RELAY logs --no-color; $GW logs --no-color; } 2>&1 )
echo "e2e: $(printf '%s\n' "$LOGS" | wc -l) log lines from the relay and gateway stacks"
if printf '%s' "$LOGS" | grep -E '(^|[^0-9])(127\.0\.0\.1|172\.[0-9]+\.[0-9]+\.[0-9]+|192\.168\.)' ; then
  echo "e2e: FAIL: an IP address appears in relay/gateway logs" >&2; exit 1
fi
if printf '%s' "$LOGS" | grep -E '[0-9a-f]{64}'; then
  echo "e2e: FAIL: a 64-hex value (key/id) appears in relay/gateway logs" >&2; exit 1
fi
echo "e2e: OK"
