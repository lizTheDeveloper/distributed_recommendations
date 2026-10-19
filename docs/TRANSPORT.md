# Match Feed: metadata-private transport (Oblivious HTTP)

How Match traffic reaches Nostr relays without showing the relays who you are
(THREAT_MODEL T5). Code: `packages/transport`. Deployment: `infra/ohttp`.

> **Status: prototype. Not audited.** It works end to end: two Match clients run
> request → PSI preview → accept → sketches → revoke through a Caddy OHTTP relay,
> Cloudflare's Go gateway and strfry, in Docker, and in process. No external
> review yet. The transport is not wired into `apps/web`; see "Hooks for the web
> app" below.

## The problem

Every Match message is a NIP-59 gift wrap. A relay can't read it or see the real
sender. But a relay that receives a wrap over a WebSocket sees:

- the **IP address** of the connection that published it;
- the IP of every connection that asks for wraps addressed to a key (`#p`);
- **when** both happen.

Put together, that links IPs to the keys they read, and publishers to recipients:
the match graph (THREAT_MODEL T5).

Oblivious HTTP (RFC 9458) splits "who" from "what" across two parties. But OHTTP
is request/response, and Nostr relays speak WebSockets. So we need a **gateway
target**: an HTTP service behind the OHTTP gateway that does the Nostr part.

```
 client ──HTTPS──▶ OHTTP relay ──HTTPS──▶ OHTTP gateway ──HTTP──▶ Nostr target ──WebSocket──▶ Nostr relays
 (app)            party A                party B           (same operator as the gateway)   (anyone)
```

## Who learns what

| Party | Learns | Doesn't learn |
|---|---|---|
| **OHTTP relay** (party A) | Client IP; when it sends; ciphertext sizes (always one of a few fixed sizes); which gateway (there is only one) | Anything inside: which keys, which events, publish or query, the Nostr relays |
| **OHTTP gateway + target** (party B) | Every request in clear: events published, `#p` keys queried, timing of each request | Client IP. It sees the relay's IP. Without the IP, two requests from one user can be linked only by content (the same keys) and timing |
| **Nostr relays** | What any relay sees from one big client: the events and filters, from the gateway's IP | Client IPs; which requests come from the same user, except by the keys in them |
| **Network observer near the client** | That the client talks to the OHTTP relay; sizes and timing | The gateway, the relays, the content |
| **Relay + gateway colluding** | Everything above combined: IP ↔ keys ↔ events. **OHTTP gives no protection against collusion** | — |

So:

- The relay and the gateway **must be run by different parties** that don't share
  logs (`infra/ohttp/relay` and `infra/ohttp/gateway` are separate stacks to make
  that hard to get wrong). A managed relay (Fastly, Cloudflare's Privacy Gateway
  relay service) in front of our own gateway is the intended production setup.
- Running both yourself, or the relay on the same host or provider account as the
  gateway, defeats the purpose.
- The gateway operator is trusted with what a Nostr relay already sees today, minus
  IPs. It isn't trusted with IPs.

What OHTTP doesn't fix:

- **Within one request** the gateway sees all the `#p` keys queried together. A
  user's identity key and per-match keys queried in one filter are linked by that
  filter. `splitKeys: true` sends one key per request (cost: one request per key).
- **Across requests**, timing still links them (next section).
- The **content** of gift wraps was already private (NIP-44); OHTTP doesn't change it.

## The timing caveat (sealed sender)

Martiny et al., "Improving Signal's Sealed Sender" (NDSS 2021) [DESIGN.md S4]:

- Signal hides the sender of each message from its server, but the server still
  sees who receives what and when, and which IP sends right before.
- Over a few messages, matching those times identifies the sender with high
  probability: a statistical disclosure attack. Automatic replies (delivery
  receipts) make it fast.

The same applies here:

- The OHTTP relay sees "IP X sent a request at 12:00:03".
- Anyone can watch public Nostr relays and see "a gift wrap for key P appeared at
  12:00:04".
- Repeat a few times and IP X is linked to talking to P. Match handshakes are
  partly automatic (the PSI preview steps answer each other), much like receipts.

What we do, and how much it helps:

| Mitigation | Where | Effect |
|---|---|---|
| Fixed request and response sizes | `protocol.ts` buckets | A 19 KB control wrap, a 33 KB sketch and a poll can look the same (constant-rate mode: always the same). Sizes no longer say "this was a sketch" |
| Batching with random delay | `OhttpRelay` `on-demand` (default: 100–1,500 ms) | Breaks exact one-to-one timing. **Weak**: a delay of seconds hides little against hours of observation |
| Constant-rate sending | `OhttpRelay` `mode: 'constant-rate'` | One request every `tickMs` (± 25 %) per user, with or without content. The relay sees the same pattern from everyone, so its timing view carries no information. Costs latency and bandwidth (below) |
| Fixed weekly sketch schedule | packages/match `dueSketches` | Sketches don't follow user activity |
| NIP-59 timestamp jitter | packages/match `wrap.ts` | Relays can't use `created_at`; they still see arrival time |

Not done:

- No mixing at the gateway (holding publishes and releasing them in batches).
- No cover traffic toward Nostr: empty constant-rate requests stop at the target.
  A watcher of public relays still sees real wraps appear when they're published.
  Constant-rate mode only removes the *client side* of the correlation.
- Handshake timing is user-driven (MATCH.md, open items).

Constant-rate mode is the honest answer to timing attacks at the OHTTP relay. The
remaining correlation (wrap appears on Nostr ↔ some user's tick) is weaker but real.
A mixnet (Loopix-style, DESIGN.md S3) is the stronger fix, and it's out of scope here.

## Pieces

| Piece | What | License | Notes |
|---|---|---|---|
| Client encapsulation | [ohttp-ts](https://github.com/thibmeu/ohttp-ts) 0.6.1 (T. Meunier) with [hpke](https://github.com/panva/hpke) 1.1.7 (F. Skokan / panva) | MIT, MIT | WebCrypto; runs in browsers, Node 22, workers. Active (Sept 2026). We found no published third-party audit |
| OHTTP gateway | [Cloudflare privacy-gateway-server-go](https://github.com/cloudflare/privacy-gateway-server-go) **v0.0.3**, built from the Go proxy zip (SHA-256 pinned), `go mod verify` | BSD-3-Clause | Cloudflare's reference gateway (HPKE from cloudflare/circl via chris-wood/ohttp-go). The README says "reference implementation – use in production at your own risk". No key rotation. Not archived: v0.0.4 was tagged 2026-10-14 (adds X-Wing post-quantum configs); it's inside our 14-day cooldown, so upgrade after review |
| Gateway front | Caddy 2.11.7 (same image as `infra/relay`) | Apache-2.0 | TLS, 96 KB body cap, exposes only `POST /gateway` and `GET /ohttp-keys` |
| Nostr target | `packages/transport` `bin/target.ts` | Apache-2.0 | Ours: the gateway shim |
| OHTTP relay | Caddy 2.11.7 as a single-gateway relay (`infra/ohttp/relay`) | Apache-2.0 | Strips all client headers, no `X-Forwarded-For`, no access log, forwards only to the one gateway |

Alternatives looked at:

- **martinthomson/ohttp** (Rust crate 0.8.0, Mozilla, used by Firefox): the most
  production-proven OHTTP library. Its `ohttp-server` is a test server, not a
  deployable gateway.
- **gruberb/ohttp-gateway** (crate 1.0.2, MPL-2.0, built on the Mozilla crate):
  a complete gateway with key rotation and size limits. Not chosen: one
  maintainer, and its default `RUST_LOG=debug` logs every decapsulated request
  (`debug!("Request: {:#?}")`), its `info` level logs target URIs and User-Agents.
  It would work with `RUST_LOG=warn`; worth reconsidering for key rotation.
- **payjoin/ohttp-relay** (crate 0.0.11, MITNFA): a relay with extras (WebSocket
  bootstrap) we don't need. Caddy does the job with less code.
- **Cloudflare privacy-gateway-relay** (Workers): a relay if the relay party runs
  on Cloudflare. Note the operator rule: then the gateway must *not* be on Cloudflare.
- **ohttp-js** (chris-wood, last release 2023): stale. **@hpke/core** (dajiaji):
  fine HPKE, but ohttp-ts builds on panva's `hpke`.

We prefer running Cloudflare's gateway over writing our own: the decapsulation
and key handling are someone else's well-used code, and our code only ever sees
plaintext HTTP. The in-process gateway in `ohttp.ts` (ohttp-ts `OHTTPServer`) is
for tests and Docker-less development only.

## The target's API

One endpoint, used only inside OHTTP: `POST https://nostr-target.internal/v1/exchange`.
The gateway allow-lists the name `nostr-target.internal` and rewrites it to the
target's internal address (`ALLOWED_TARGET_ORIGINS`, `TARGET_REWRITES`). The gateway
can reach nothing else.

```
request  {"v":1,"respBytes":65536,"ops":[
           {"op":"publish","event":{…kind 1059…}},
           {"op":"query","filter":{"kinds":[1059],"#p":["…"],"since":…,"limit":50}}
         ],"pad":"000…"}
response {"v":1,"status":"ok","results":[
           {"op":"publish","ok":true,"relays":[{"relay":"wss://…","ok":true,"message":""}]},
           {"op":"query","ok":true,"events":[…newest first…],"more":false}
         ],"pad":"000…"}
```

- **publish**: verifies the signature, sends `EVENT` to every configured relay, and
  waits for each `OK` (timeout 5 s). `ok` if any relay stored it.
- **query**: sends `REQ` to every relay, collects until `EOSE`, sends `CLOSE`,
  merges and de-duplicates, newest first. `more` when a relay hit the limit or
  the response was too small to hold everything; the client pages with `until`.
- **Sizes**:
  - Request bodies must be exactly 4,096, 40,960 or 81,920 bytes.
  - Responses are exactly `respBytes`: 4,096, 65,536, 262,144 or 983,040 bytes.
  - Events ≤ 65,536 bytes (PROTOCOL.md).
  - At most 8 ops and 4 queries per request.
  - Filters: only `ids`, `authors`, `kinds`, `#p`, `since`, `until`, `limit` (≤ 500),
    and they must name `ids`, `authors` or `#p` (no scans).
- **Kinds**: only `ALLOWED_KINDS` (default `1059`) are published or queried.
- **Relays**: only the operator's `NOSTR_RELAYS`. Clients can't name a relay (that
  would make the gateway an open proxy). So in OHTTP mode the peer's NIP-17 inbox
  relays (kind 10050) don't apply: everyone uses the gateway's relay set.
- **Errors** are padded to the client's `respBytes` too, and the status code is
  inside the encryption: the OHTTP relay sees `200` for everything.
- **Stateless and quiet**:
  - No per-client state. The only memory is the rate-limit table and the pooled
    WebSocket connections to the relays.
  - No request logging at all. The process prints one startup line; a test checks
    this (`target.test.ts`).
  - The Go gateway runs at `LOG_LEVEL=WARN`, which logs neither paths nor errors.
  - The Docker e2e greps every relay and gateway log for IP addresses and 64-hex
    values (keys, ids).

## Rate limiting without IPs

The target can't rate-limit per client IP: it only ever sees the gateway, and the
gateway only sees the OHTTP relay. Per-IP limits there would put all users in one
bucket. Instead (`ratelimit.ts`):

| Limit | Key | Default | Stops |
|---|---|---|---|
| Global | — | 50 req/s, burst 200 | overload of the target and the upstream relays |
| Per recipient | HMAC(`p` tag) | 0.5 publishes/s, burst 60 | flooding one inbox |
| Per query | HMAC(sorted `#p` set) | 1 query/s, burst 30 | hammering one inbox's reads |

- HMAC keys are random per process, and the tables are in memory, idle-evicted and
  bounded (100,000 entries).
- The signature is checked before the per-recipient bucket. Otherwise unsigned
  junk aimed at a victim's key would use up the victim's allowance.
- **The OHTTP relay** limits per client IP. It's the party that legitimately sees
  IPs (Caddy needs a rate-limit plugin or the relay provider's own limits).
- **Upstream relays** see every user as the gateway's IP. `infra/relay`'s write
  policy limits per IP (2 events/s, burst 30), which is far too low for a gateway.
  - Give the gateway's IP its own allowance: a `POLICY_*` exemption list in
    `infra/relay` (not built yet).
  - Or connect the target to strfry inside a shared network without Caddy (the
    e2e does this; strfry then warns that `X-Real-IP` is empty).
- **Per-user anonymous limits** need unlinkable tokens: Privacy Pass (RFC 9576–9578).
  The client redeems a token per request; the issuer authenticates the user once,
  without linking tokens to requests. That's the right next step if abuse appears.
  Not built.

## Keys: fetch, pin, rotate

- The client fetches the gateway's key configuration **through the OHTTP relay**
  (`GET <relay origin>/ohttp-keys`). Fetching it from the gateway directly would
  show the gateway your IP.
- **Pinning.** The client only encapsulates to a config whose SHA-256 (of the
  serialized single config) is in `pins`. Otherwise a gateway could give one user
  a unique key and recognize their requests (key consistency; RFC 9458 §7).
  - Ship pins with the app.
  - Without pins the client trusts on first use: read `relay.pin` and persist it.
  - Or ship the whole config (`keyConfig`), so there's no fetch at all.
- The Go gateway serves two configs: X25519Kyber768Draft00 (primary) and X25519.
  The client is built for one suite (X25519, HKDF-SHA256, AES-128-GCM) and picks
  the matching config (`KeyConfig.select`); the e2e checks it gets X25519.
- **The key** is derived from `SEED_SECRET_KEY`, so it survives restarts.
- **Rotation**:
  1. Generate a new seed.
  2. Compute its pin: start a staging gateway with the new seed and run
     `fetchKeyConfig` against it (it returns `pin`).
  3. Ship an app release with both pins.
  4. Then switch the gateway.
  - Clients that hit a 4xx re-fetch the config once and retry, only if the new one
    is pinned.

## Modes, latency and bandwidth

| | OHTTP `on-demand` (default) | OHTTP `constant-rate` | Direct WebSocket (`LiveRelay`) |
|---|---|---|---|
| Relays see your IP | no | no | **yes, every relay** |
| Timing at the OHTTP relay | follows your activity (+0.1–1.5 s) | flat: one request per tick | n/a |
| Publish latency | batch delay + 1 round trip through 3 hops | up to one tick (default 5 min) | 1 round trip |
| Incoming messages | on the next poll (`subscribe` interval, default 60 s ± 50 %) | on the next tick | live, under a second |
| Bandwidth | per request: 4 KiB or 40 KiB up; 4 KiB (publish only) or 64 KiB (queries) down | 40 KiB up + 64 KiB down per tick: about 30 MB/day at 5 min | events only |

- **Measured locally** (all containers on one host, so no network delay; 40 runs):
  - publish of a 33 KB wrap through relay → gateway → target → strfry: median 25 ms;
  - a query returning 5 × 33 KB wraps: median 19 ms.
- **On a real network**, add the round trips: client → relay → gateway, plus
  target → Nostr relay. With connections kept alive that's about 2–3 RTTs, versus
  1 for a direct WebSocket. A TLS handshake to the relay adds 1–2 RTTs on a cold
  start.
- **Polling cost.** Gift wraps backdate `created_at` by up to 2 days, so a poll
  must ask for `since = now − 2 days − 1 h` and de-duplicate (`subscribe()` does).
  Each poll downloads every wrap from the last two days, in 64 KiB pages.
  - packages/match's `MatchClient.sync()` asks for *all* wraps to the user's keys
    (no `since`). Over OHTTP that's up to 14 days of wraps per sync.
  - So call `sync()` on a schedule (minutes, not seconds), or after a `subscribe()`
    callback.
- **Requests and responses are padded**, so a poll with nothing new costs as much
  as one with something new. That is the point.

## The direct WebSocket option

`LiveRelay` keeps a `REQ` open on each relay and gets events as they're stored. If
a connection drops it reconnects with exponential backoff and full jitter (1 s
doubling to 60 s), re-subscribes, and drops duplicates.

- **The tradeoff:**
  - latency goes from "next poll" to under a second, and there's no gateway
    operator to trust;
  - but **every relay learns your IP**, linked to every key you subscribe to and
    every wrap you publish.
- Offer it only as an explicit choice ("Faster delivery: relays can see your IP
  address"), or for users behind Tor or a VPN.
- It does not do NIP-42 AUTH. The web app's adapter (`apps/web/src/lib/match/wsRelay.ts`)
  already does AUTH on demand, and is the better base for the web client.
  `LiveRelay` is for Node, desktop and tests, and for its `subscribe()`.

## Configuration

**Client** (`new OhttpRelay({...})`):

| Option | Default | Meaning |
|---|---|---|
| `relayUrl` | — | The OHTTP relay's resource for our gateway, `https://…/gateway` |
| `keyConfigUrl` | `<relay origin>/ohttp-keys` | Key config, fetched through the relay |
| `keyConfig` | — | Ship the config in the app instead of fetching it |
| `pins` | `[]` (TOFU) | Accepted SHA-256 pins |
| `targetOrigin` | `https://nostr-target.internal` | Must match the gateway's allow-list |
| `mode` | `on-demand` | or `constant-rate` |
| `batchDelayMs` | `{min: 100, max: 1500}` | on-demand batching window |
| `tickMs`, `tickJitter` | 300,000, 0.25 | constant-rate schedule |
| `uniformRequestBytes` | 40,960 | constant-rate request size |
| `responseBytes` | 65,536 | response size for queries (constant-rate: all requests) |
| `pageLimit`, `maxPages` | 50, 20 | paging |
| `splitKeys` | false | one `#p` key per request |
| `timeoutMs` | 30,000 | per HTTP request |

**Target** (`infra/ohttp/gateway/.env`): `NOSTR_RELAYS` (required), `ALLOWED_KINDS`
(`1059`), `UPSTREAM_TIMEOUT_MS` (5000), and `RATE_GLOBAL`, `RATE_RECIPIENT`,
`RATE_QUERY` as `rate/burst`.

**Gateway**: `GATEWAY_SITE`, `ACME_EMAIL`, `SEED_SECRET_KEY` (`openssl rand -hex 32`),
`CONFIGURATION_ID`.

**Relay** (`infra/ohttp/relay/.env`, the other operator): `RELAY_SITE`, `ACME_EMAIL`,
`GATEWAY_URL`, `CORS_ORIGIN` (the app's origin).

## Hooks for the web app

`apps/web` isn't changed by this work. To use the transport, its relay adapter
needs:

1. **A transport setting** in Matches → Relays:
   - "Private (OHTTP)", the default;
   - "Direct (faster, relays see your IP)".
   - `service.ts` already swaps relays with `setRelay(relay, label)`. Construct an
     `OhttpRelay` (or the existing `WsRelay` for direct) and pass it there. Both
     satisfy `RelayLike`.
2. **Configuration it must ship**: the OHTTP relay URL, the gateway key pin(s), and
   optionally the key config bytes. These are app constants, like the default
   relay list; not user input. Persist the TOFU pin in the encrypted store if no
   pin is shipped.
3. **CSP**: `connect-src` must allow the OHTTP relay's origin. In OHTTP mode it no
   longer needs the `wss://` relay origins.
4. **Sync cadence**: call `MatchClient.sync()` from a timer (minutes) or from
   `OhttpRelay.subscribe(..., { intervalMs })` callbacks; not in a tight loop.
   Each sync over OHTTP downloads padded pages.
5. **Strict privacy option**: `mode: 'constant-rate'` (and `splitKeys: true`) for
   users who want the timing protection and accept slower delivery and ~30 MB/day.
6. **Relay list**:
   - In OHTTP mode the user's relay list (and NIP-17 kind 10050 inbox relays) is
     replaced by the gateway's `NOSTR_RELAYS`.
   - Show that in the UI. A user who wants their own relay must use direct mode,
     or the gateway operator must add it.
7. **AUTH**: NIP-42 isn't available through the gateway (the target never
   authenticates as a user). Relays that require AUTH for kind 1059 reads can't
   be used in OHTTP mode.
8. **Status**: `onRequest({requestBytes, responseBytes, ops})` gives a sizes-only
   activity feed for a "network activity" view; `TransportError` messages are
   safe to show.

Import from source like the app does for packages/match: `packages/transport/src/index.ts`
(dependencies `ohttp-ts`, `hpke`, `nostr-tools`, pinned exactly).

## Testing

- `cd packages/transport && npm ci && npm test`:
  - 37 tests (node:test); 34 run offline, in process;
  - the 3 Docker tests skip unless `OHTTP_E2E_RELAY_URL` is set.
- `npm run typecheck`.
- **Docker e2e**: `infra/ohttp/e2e/run.sh` from the repo root. It runs three
  separate Compose projects:
  1. strfry from `infra/relay`;
  2. gateway + target;
  3. relay.
  - Then two Match clients run through them, and the logs are checked for IPs and
    keys.
  - Last run 2026-10-19: 3/3 passed; the logs held 9 lines (Caddy startup
    warnings and the target's startup line), with no IPs or keys.

Never point any of this at public relays.

## Follow-ups

- Wire into `apps/web` (above). Add `packages/transport` to CI's test matrix and
  to `.github/dependabot.yml` (npm; Docker for `infra/ohttp`).
- Upgrade the gateway to privacy-gateway-server-go v0.0.4 after the cooldown, for
  X-Wing. hpke would need X-Wing for clients to use it.
- `infra/relay`: a per-IP allowance for the gateway in the write policy.
- Privacy Pass for anonymous per-user rate limits.
- Gateway-side mixing (delay and batch publishes), and cover publishes toward Nostr.
- THREAT_MODEL T5 and MATCH.md "Open items" still say OHTTP isn't implemented;
  update them when this is wired into a client.
