#!/bin/sh
# Local smoke test for infra/glitchtip, with synthetic events only:
#   - the stack starts (Postgres, GlitchTip, Caddy with a local CA on :8443);
#   - an envelope sent with spoofed X-Forwarded-For / X-Real-IP headers is stored
#     without any IP address (Caddy strips them; GlitchTip sees a private address);
#   - a bug report (captured message, as the web app sends it) is stored;
#   - CORS allows only APP_ORIGINS;
#   - no container log contains the client IP.
# Usage (from the repo root): sh infra/glitchtip/test/smoke.sh   (KEEP=1 leaves it running)
set -eu
cd "$(dirname "$0")/.."
DC="docker compose -p glitchtip-test --env-file test/test.env -f compose.yaml -f test/compose.test.yaml"
# A routable address: GlitchTip ignores documentation and private ranges anyway,
# so those would prove nothing. Nothing is sent to it; it only appears in headers.
FAKE_IP=8.8.4.4
FAKE_PREFIX=8.8.4.
fail=0
ok() { echo "ok   $1"; }
bad() { echo "FAIL $1"; fail=1; }
cleanup() { [ "${KEEP:-}" = 1 ] || $DC down -v >/dev/null 2>&1 || true; }
trap cleanup EXIT

$DC config -q
$DC up -d
echo "waiting for GlitchTip..."
i=0
until curl -sk -o /dev/null -w '%{http_code}' https://localhost:8443/_health/ 2>/dev/null | grep -q 200; do
  i=$((i+1)); [ $i -gt 120 ] && { $DC logs --tail 50 glitchtip; echo "FAIL GlitchTip didn't start"; exit 1; }
  sleep 2
done
ok "stack up behind Caddy (https://localhost:8443)"

DSN=$($DC exec -T glitchtip ./manage.py bootstrap_dev 2>/dev/null | sed -n 's/.*DSN: *//p' | tr -d '\r')
KEY=$(echo "$DSN" | sed -E 's#^https?://([^@]+)@.*#\1#')
PROJECT=$(echo "$DSN" | sed -E 's#.*/([0-9]+)$#\1#')
[ -n "$KEY" ] && [ -n "$PROJECT" ] && ok "dev project $PROJECT" || { bad "no DSN from bootstrap_dev"; exit 1; }
URL="https://localhost:8443/api/$PROJECT/envelope/?sentry_key=$KEY&sentry_version=7"

send() { # $1 = event id, $2 = event JSON
  printf '{"event_id":"%s"}\n{"type":"event"}\n%s\n' "$1" "$2" |
    curl -sk -o /dev/null -w '%{http_code}' -X POST "$URL" -H 'Content-Type: text/plain;charset=UTF-8' \
      -H "Origin: http://127.0.0.1:8080" -H "X-Forwarded-For: $FAKE_IP" -H "X-Real-IP: $FAKE_IP" \
      -H "Forwarded: for=$FAKE_IP" -H "True-Client-IP: $FAKE_IP" --data-binary @-
}
E1=$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n'); E2=$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')
c1=$(send "$E1" '{"event_id":"'"$E1"'","platform":"javascript","level":"error","transaction":"home-reels","tags":{"route":"home-reels"},"exception":{"values":[{"type":"TypeError","value":"synthetic test error <url>","mechanism":{"type":"onerror","handled":false}}]}}')
c2=$(send "$E2" '{"event_id":"'"$E2"'","platform":"javascript","level":"info","logger":"feedback","message":"[bug] synthetic bug report","fingerprint":["user-feedback","bug"],"tags":{"kind":"feedback","category":"bug"},"contexts":{"feedback":{"message":"synthetic bug report","contact_email":"tester@example.invalid"}}}')
[ "$c1" = 200 ] && [ "$c2" = 200 ] && ok "crash report and bug report accepted ($c1, $c2)" || bad "ingest answered $c1 / $c2"

# CORS: the app's origin is allowed, others are not.
acao() { curl -sk -o /dev/null -D - -X OPTIONS "$URL" -H "Origin: $1" -H 'Access-Control-Request-Method: POST' | tr -d '\r' | sed -n 's/^[Aa]ccess-[Cc]ontrol-[Aa]llow-[Oo]rigin: //p'; }
[ "$(acao http://127.0.0.1:8080)" = "http://127.0.0.1:8080" ] && ok "CORS allows the app origin" || bad "CORS doesn't allow the app origin"
[ -z "$(acao https://evil.example)" ] && ok "CORS refuses other origins" || bad "CORS allows other origins"

echo "waiting for ingest..."
n=0
for i in $(seq 1 60); do
  n=$($DC exec -T postgres psql -U glitchtip -d glitchtip -tAc "select count(*) from issue_events_issueevent where event_id in ('$(echo $E1 | sed -E 's/(.{8})(.{4})(.{4})(.{4})(.{12})/\1-\2-\3-\4-\5/')','$(echo $E2 | sed -E 's/(.{8})(.{4})(.{4})(.{4})(.{12})/\1-\2-\3-\4-\5/')')" | tr -d ' \r')
  [ "$n" = 2 ] && break; sleep 2
done
[ "$n" = 2 ] && ok "both events stored" || bad "stored $n of 2 events"

DUMP=$($DC exec -T postgres pg_dump -U glitchtip -d glitchtip --data-only 2>/dev/null)
echo "$DUMP" | grep -q "$FAKE_PREFIX" && bad "the client IP was stored" || ok "no client IP (or truncated IP) anywhere in the database"
echo "$DUMP" | grep -q '"ip_address"' && bad "an ip_address field was stored" || ok "no ip_address field stored"

# Control: the same header sent straight to GlitchTip (bypassing Caddy, from inside
# the Docker network) IS recorded, truncated by GlitchTip's default IP scrubbing.
# This shows the checks above can see an IP when one is stored.
E3=$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')
printf '{"event_id":"%s"}\n{"type":"event"}\n{"event_id":"%s","platform":"javascript","level":"info","message":"synthetic control"}\n' "$E3" "$E3" |
  $DC exec -T caddy sh -c "cat > /tmp/e && wget -qO- --header 'X-Forwarded-For: $FAKE_IP' --header 'Content-Type: text/plain' --post-file=/tmp/e 'http://glitchtip:8000/api/$PROJECT/envelope/?sentry_key=$KEY&sentry_version=7'" >/dev/null
seen=""
for i in $(seq 1 30); do
  seen=$($DC exec -T postgres pg_dump -U glitchtip -d glitchtip --data-only 2>/dev/null | grep -o "\"ip_address\": *\"$FAKE_PREFIX[0-9]*\"" | head -1)
  [ -n "$seen" ] && break; sleep 2
done
[ -n "$seen" ] && ok "control: bypassing Caddy, GlitchTip stores $seen (so the checks above would catch an IP)" || bad "control: no IP stored even without Caddy; the IP checks prove nothing"
echo "$DUMP" | grep -q "synthetic bug report" && ok "bug report text stored" || bad "bug report text missing"
$DC logs 2>&1 | grep -q "$FAKE_IP" && bad "a log contains the client IP" || ok "no log contains the client IP"
$DC exec -T glitchtip env | grep -q '^GLITCHTIP_RETENTION_DAYS=30' && ok "retention 30 days" || bad "retention not set"

[ $fail = 0 ] && echo "glitchtip smoke test passed" || { echo "glitchtip smoke test FAILED"; exit 1; }
