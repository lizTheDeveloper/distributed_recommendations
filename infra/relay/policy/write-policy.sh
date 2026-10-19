#!/bin/sh
# strfry writePolicy plugin for the app relay (busybox sh + awk only; the strfry
# image ships nothing else).
#
# Protocol: strfry writes one JSON object per line on stdin
#   {"type":"new","event":{...},"receivedAt":N,"sourceType":"IP4|IP6|Import|Stream|Sync","sourceInfo":"<ip or ...>"}
# and expects one line back: {"id":"<event id>","action":"accept|reject","msg":"..."}.
#
# Rules (all tunable with environment variables, see infra/relay/.env.example):
#   1. Per-connection-IP token bucket: POLICY_RATE events/second, burst POLICY_BURST.
#      Source IPs live only in this process's memory, are never written anywhere,
#      and are forgotten after POLICY_IDLE_FORGET seconds of inactivity.
#   2. Gift wraps (kind 1059) must carry a NIP-40 "expiration" tag, in the future
#      and at most POLICY_GIFTWRAP_MAX_TTL seconds ahead (docs/PROTOCOL.md: sketches
#      expire <= 30 days after issue, control messages after 14 days).
#   3. Optional kind allow-list (POLICY_ALLOWED_KINDS, comma separated; empty = all).
#   4. Trusted gateway sources (POLICY_TRUSTED_SOURCES; empty by default = none):
#      addresses that carry many users' traffic, such as the OHTTP Nostr gateway
#      (docs/TRANSPORT.md), get their own, larger bucket per address:
#      POLICY_TRUSTED_RATE events/second, burst POLICY_TRUSTED_BURST. Still a
#      limit, not an exemption, and rules 2 and 3 still apply. Entries are exact
#      IPv4 or IPv6 addresses, or IPv4 CIDR prefixes (a.b.c.d/n), separated by
#      commas or spaces. IPv6 entries must be written the way strfry renders
#      addresses (inet_ntop: lower case, zeros compressed, e.g. 2001:db8::7).
#      Invalid entries are ignored, with a count (never the entry) on stderr.
#
# JSON is matched with patterns rather than parsed. That is safe here because strfry
# hands the plugin its own normalised, compact JSON, and every quote inside `content`
# or a tag value is escaped (\"), so the patterns below can only match real keys.
# This script must never print an IP address or event content to stderr/stdout
# other than the response line.

exec awk '
function now() { return systime() }
function strval(key,   re, s) {
  re = "\"" key "\":\"[^\"]*\""
  if (!match($0, re)) return ""
  s = substr($0, RSTART + length(key) + 4, RLENGTH - length(key) - 5)
  return s
}
function numval(key,   re) {
  re = "\"" key "\":[0-9]+"
  if (!match($0, re)) return -1
  return substr($0, RSTART + length(key) + 3, RLENGTH - length(key) - 3) + 0
}
function respond(id, action, msg) {
  printf "{\"id\":\"%s\",\"action\":\"%s\",\"msg\":\"%s\"}\n", id, action, msg
  fflush()
}
# IPv4 dotted quad to a number, or -1.
function ip4num(s,   n, o, i, v) {
  n = split(s, o, ".")
  if (n != 4) return -1
  v = 0
  for (i = 1; i <= 4; i++) {
    if (o[i] !~ /^[0-9]+$/ || length(o[i]) > 3 || o[i] + 0 > 255) return -1
    v = v * 256 + o[i]
  }
  return v
}
function trusted(ip,   i, a, block) {
  if (nTrusted == 0 || ip == "") return 0
  ip = tolower(ip)
  if (ip in trustExact) return 1
  if (nTrustNet == 0) return 0
  a = ip4num(ip)
  if (a < 0) return 0
  for (i = 1; i <= nTrustNet; i++) {
    block = 2 ^ (32 - trustLen[i])
    if (int(a / block) == int(trustNet[i] / block)) return 1
  }
  return 0
}
function prune(t,   k) {
  for (k in seen) if (t - seen[k] > IDLE) { delete seen[k]; delete tokens[k] }
  lastPrune = t
}
BEGIN {
  RATE  = (ENVIRON["POLICY_RATE"]  != "" ? ENVIRON["POLICY_RATE"]  : 2) + 0
  BURST = (ENVIRON["POLICY_BURST"] != "" ? ENVIRON["POLICY_BURST"] : 30) + 0
  IDLE  = (ENVIRON["POLICY_IDLE_FORGET"] != "" ? ENVIRON["POLICY_IDLE_FORGET"] : 300) + 0
  GWTTL = (ENVIRON["POLICY_GIFTWRAP_MAX_TTL"] != "" ? ENVIRON["POLICY_GIFTWRAP_MAX_TTL"] : 2678400) + 0
  nAllowed = 0
  if (ENVIRON["POLICY_ALLOWED_KINDS"] != "") {
    n = split(ENVIRON["POLICY_ALLOWED_KINDS"], parts, /[ ,]+/)
    for (i = 1; i <= n; i++) if (parts[i] != "") { allowed[parts[i] + 0] = 1; nAllowed++ }
  }
  TRATE  = (ENVIRON["POLICY_TRUSTED_RATE"]  != "" ? ENVIRON["POLICY_TRUSTED_RATE"]  : 50) + 0
  TBURST = (ENVIRON["POLICY_TRUSTED_BURST"] != "" ? ENVIRON["POLICY_TRUSTED_BURST"] : 500) + 0
  nTrusted = 0; nTrustNet = 0; bad = 0
  if (ENVIRON["POLICY_TRUSTED_SOURCES"] != "") {
    n = split(ENVIRON["POLICY_TRUSTED_SOURCES"], parts, /[ ,]+/)
    for (i = 1; i <= n; i++) {
      e = tolower(parts[i])
      if (e == "") continue
      if (e ~ /^[0-9.]+\/[0-9]+$/) {
        split(e, cidr, "/")
        if (ip4num(cidr[1]) < 0 || cidr[2] + 0 < 8 || cidr[2] + 0 > 32) { bad++; continue }
        nTrustNet++; trustNet[nTrustNet] = ip4num(cidr[1]); trustLen[nTrustNet] = cidr[2] + 0
      } else if (ip4num(e) >= 0 || (e ~ /^[0-9a-f:.]+$/ && e ~ /:/)) {
        trustExact[e] = 1
      } else { bad++; continue }
      nTrusted++
    }
  }
  # Report only counts: never echo addresses into the strfry log.
  if (bad > 0) printf "write-policy: ignored %d invalid POLICY_TRUSTED_SOURCES entr%s\n", bad, (bad == 1 ? "y" : "ies") > "/dev/stderr"
  lastPrune = now()
}
{
  id = strval("id")
  if (id !~ /^[0-9a-f]+$/) id = ""
  kind = numval("kind")
  src = strval("sourceType")
  ip = strval("sourceInfo")
  t = now()
  if (t - lastPrune > 60) prune(t)

  if (nAllowed > 0 && !(kind in allowed)) { respond(id, "reject", "blocked: kind not accepted by this relay"); next }

  # Rate limit live client writes only (not import/stream/sync by the operator).
  # A trusted gateway address gets the larger POLICY_TRUSTED_* bucket.
  if (src == "IP4" || src == "IP6") {
    if (trusted(ip)) { r = TRATE; b = TBURST } else { r = RATE; b = BURST }
    if (!(ip in tokens)) { tokens[ip] = b; seen[ip] = t }
    tokens[ip] += (t - seen[ip]) * r
    if (tokens[ip] > b) tokens[ip] = b
    seen[ip] = t
    if (tokens[ip] < 1) { respond(id, "reject", "rate-limited: slow down"); next }
    tokens[ip] -= 1
  }

  if (kind == 1059) {
    if (!match($0, /\["expiration","[0-9]+"/)) { respond(id, "reject", "invalid: gift wraps need a NIP-40 expiration tag"); next }
    expAt = substr($0, RSTART + 15, RLENGTH - 16) + 0
    if (expAt <= t) { respond(id, "reject", "invalid: event has expired"); next }
    if (expAt - t > GWTTL) { respond(id, "reject", "invalid: gift wrap expiration too far in the future"); next }
  }

  respond(id, "accept", "")
}
'
