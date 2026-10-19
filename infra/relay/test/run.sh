#!/bin/sh
# Starts strfry with this directory's config and write policy (no Caddy), runs
# test/smoke.mjs against it, runs the retention command, and fails if the relay's
# logs contain an IP address. CI's `relay` job and the manual e2e workflow use it.
#
#   infra/relay/test/run.sh          # from the repo root, after
#                                    # (cd packages/match && npm ci) && (cd apps/web && npm ci)
#   KEEP=1 infra/relay/test/run.sh   # leave the container running
#
# The relay runs with a small burst (POLICY_BURST=5, POLICY_RATE=1) so the rate-limit
# case triggers, and with one trusted gateway prefix (203.0.113.8/30, a documentation
# range) so the trusted-source cases run. Uses throwaway keys and a local relay only.
set -eu

ROOT=$(cd "$(dirname "$0")/../../.." && pwd)
cd "$ROOT/infra/relay"
NAME=${RELAY_TEST_CONTAINER:-relay-test}
PORT=${RELAY_TEST_PORT:-7777}
STRFRY_IMAGE=${STRFRY_IMAGE:-$(docker compose --env-file .env.example config --images | grep -m1 '/strfry')}

cleanup() {
  if [ "${KEEP:-}" = "1" ]; then echo "relay test: KEEP=1, $NAME left running"; return; fi
  docker rm -f "$NAME" >/dev/null 2>&1 || true
}
trap cleanup EXIT
docker rm -f "$NAME" >/dev/null 2>&1 || true

# Same hardening as compose.yaml. The nofile ulimit is lowered because some sandboxes
# and rootless Docker refuse compose.yaml's 65536; a test needs few files.
docker run -d --name "$NAME" --read-only --tmpfs /tmp \
  --cap-drop ALL --security-opt no-new-privileges:true --ulimit nofile=1024:1024 \
  -p "127.0.0.1:$PORT:7777" -e POLICY_BURST=5 -e POLICY_RATE=1 \
  -e POLICY_TRUSTED_SOURCES=203.0.113.8/30 -e POLICY_TRUSTED_BURST=50 \
  -v "$PWD/strfry.conf:/etc/strfry.conf:ro" -v "$PWD/policy:/app/policy:ro" \
  --mount type=tmpfs,destination=/app/strfry-db,tmpfs-mode=1777 \
  "$STRFRY_IMAGE" --config=/etc/strfry.conf --verbosity=WARNING \
  "--set=relay.info.name=CI relay" relay >/dev/null

i=0
until curl -fsS -H 'Accept: application/nostr+json' "http://127.0.0.1:$PORT/" >/dev/null 2>&1; do
  i=$((i + 1))
  if [ "$i" -gt 30 ]; then docker logs "$NAME"; echo "relay test: strfry didn't start" >&2; exit 1; fi
  sleep 1
done

echo "relay test: smoke (limits, NIP-40, write policy, rate limit, trusted source)"
(cd "$ROOT" && SMOKE_TRUSTED_IP=203.0.113.10 node infra/relay/test/smoke.mjs \
  "ws://127.0.0.1:$PORT" packages/match/node_modules,apps/web/node_modules)

echo "relay test: retention command"
docker exec "$NAME" /app/strfry --config=/etc/strfry.conf --verbosity=WARNING \
  delete --age=2851200 '--filter={"kinds":[1059]}'

echo "relay test: logs contain no client IP"
LOGS=$(docker logs "$NAME" 2>&1)
printf '%s\n' "$LOGS"
if printf '%s\n' "$LOGS" | grep -E '203\.0\.113\.|172\.1[6-9]\.|172\.2[0-9]\.|172\.3[01]\.|127\.0\.0\.1'; then
  echo "relay test: FAIL: relay logs contain an IP address" >&2
  exit 1
fi
echo "relay test: OK"
