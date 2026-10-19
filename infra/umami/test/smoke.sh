#!/bin/sh
# Local smoke test for infra/umami, with synthetic events only:
#   - the stack starts (Postgres, Umami, retention job, Caddy with a local CA on :8444);
#   - events posted the way the web app posts them (spoofed forwarding headers
#     added) are stored with no location and no IP;
#   - control: the same request straight to Umami (bypassing Caddy) gets a country
#     from the IP, so the check above can see a leak when there is one;
#   - the tracker script isn't served; the retention SQL deletes old rows;
#   - no log contains the client IP.
# Usage (from the repo root): sh infra/umami/test/smoke.sh   (KEEP=1 leaves it running)
set -eu
cd "$(dirname "$0")/.."
DC="docker compose -p umami-test --env-file test/test.env -f compose.yaml -f test/compose.test.yaml"
FAKE_IP=8.8.4.4   # routable, so geolocation would work if it got through; nothing is sent to it
UA="Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0"
fail=0
ok() { echo "ok   $1"; }
bad() { echo "FAIL $1"; fail=1; }
cleanup() { [ "${KEEP:-}" = 1 ] || $DC down -v >/dev/null 2>&1 || true; }
trap cleanup EXIT
psql() { $DC exec -T postgres psql -U umami -d umami -tAc "$1" | tr -d '\r'; }

$DC config -q
$DC up -d
echo "waiting for Umami..."
i=0
until curl -sk https://localhost:8444/api/heartbeat 2>/dev/null | grep -q ok; do
  i=$((i+1)); [ $i -gt 90 ] && { $DC logs --tail 50 umami; echo "FAIL Umami didn't start"; exit 1; }
  sleep 2
done
ok "stack up behind Caddy (https://localhost:8444)"

TOKEN=$(curl -sk https://localhost:8444/api/auth/login -H 'Content-Type: application/json' -d '{"username":"admin","password":"umami"}' | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
SITE=$(curl -sk https://localhost:8444/api/websites -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"name":"app (test)","domain":"app.example"}' | sed -n 's/.*"id":"\([^"]*\)".*/\1/p' | head -1)
[ -n "$SITE" ] && ok "test website $SITE" || { bad "couldn't create a website"; exit 1; }

post() { # $1 = base URL, $2 = JSON payload (as the web app's client builds it)
  curl -sk -o /dev/null -w '%{http_code}' "$1/api/send" -H 'Content-Type: application/json' -H "User-Agent: $UA" \
    -H "Origin: https://app.example" -H "X-Forwarded-For: $FAKE_IP" -H "X-Real-IP: $FAKE_IP" -H "Forwarded: for=$FAKE_IP" -H "True-Client-IP: $FAKE_IP" \
    -d "{\"type\":\"event\",\"payload\":$2}"
}
P1="{\"website\":\"$SITE\",\"hostname\":\"app\",\"url\":\"/settings\",\"browser\":\"Firefox\",\"os\":\"Linux\",\"device\":\"desktop\"}"
P2="{\"website\":\"$SITE\",\"hostname\":\"app\",\"url\":\"/home-reels\",\"name\":\"view-mode\",\"data\":{\"view\":\"grid\"},\"browser\":\"Firefox\",\"os\":\"Linux\",\"device\":\"desktop\"}"
c1=$(post https://localhost:8444 "$P1"); c2=$(post https://localhost:8444 "$P2")
[ "$c1" = 200 ] && [ "$c2" = 200 ] && ok "screen view and feature event accepted" || bad "send answered $c1 / $c2"
[ "$(psql "select count(*) from website_event where website_id='$SITE'")" = 2 ] && ok "both events stored" || bad "events not stored"
[ "$(psql "select count(*) from website_event where website_id='$SITE' and url_path in ('/settings','/home-reels') and referrer_domain is null and page_title is null")" = 2 ] && ok "only the route path; no referrer or title" || bad "unexpected page fields"
[ "$(psql "select count(*) from session where website_id='$SITE' and (country is not null or region is not null or city is not null)")" = 0 ] && ok "no location derived (no IP reached Umami)" || bad "a session has a location"
[ "$(psql "select count(*) from session where website_id='$SITE' and language is null and browser='Firefox' and device='desktop'")" -ge 1 ] && ok "session has only the coarse facts the client sent" || bad "session fields unexpected"

# Control: straight to Umami with the forwarding header. Umami geolocates it.
P3="{\"website\":\"$SITE\",\"hostname\":\"app\",\"url\":\"/control\",\"browser\":\"Chrome\",\"os\":\"Android\",\"device\":\"mobile\"}"
post http://127.0.0.1:3001 "$P3" >/dev/null
ctl=$(psql "select coalesce(max(s.country),'') from session s join website_event e on e.session_id=s.session_id where e.url_path='/control'")
[ -n "$ctl" ] && ok "control: bypassing Caddy, Umami derives country '$ctl' (the check above would catch a leak)" || bad "control: no location even without Caddy; the check proves nothing"

DUMP=$($DC exec -T postgres pg_dump -U umami -d umami --data-only 2>/dev/null)
echo "$DUMP" | grep -qF "8.8.4." && bad "the IP is stored" || ok "no IP anywhere in the database"
[ "$(curl -sk -o /dev/null -w '%{http_code}' https://localhost:8444/script.js)" = 404 ] && ok "tracker script not served" || bad "tracker script is served"

# Retention: age one event past the window and run the job's SQL.
psql "update website_event set created_at = now() - interval '40 days' where url_path='/settings'" >/dev/null
$DC exec -T retention psql -q -v ON_ERROR_STOP=1 -v days=30 -f /retention.sql
[ "$(psql "select count(*) from website_event where url_path='/settings'")" = 0 ] && [ "$(psql "select count(*) from website_event where url_path='/home-reels'")" = 1 ] && ok "retention deletes events older than 30 days, keeps newer" || bad "retention didn't work"
$DC logs 2>&1 | grep -qF "$FAKE_IP" && bad "a log contains the client IP" || ok "no log contains the client IP"

[ $fail = 0 ] && echo "umami smoke test passed" || { echo "umami smoke test FAILED"; exit 1; }
