# @match-feed/transport: Match traffic over Oblivious HTTP

Hides the user's IP address from Nostr relays (THREAT_MODEL T5) by sending Match
traffic through an Oblivious HTTP (RFC 9458) relay and gateway to a **Nostr target**
that speaks NIP-01 for the client. Also has a direct WebSocket client with live
subscriptions for users who opt out.

- Design, what each party learns, timing caveats, costs: [`docs/TRANSPORT.md`](../../docs/TRANSPORT.md).
- Deployment (gateway + target, and a separate relay): [`infra/ohttp`](../../infra/ohttp).

> **Status: prototype. Not audited.** Not wired into `apps/web` yet
> (docs/TRANSPORT.md, "Hooks for the web app").

License: Apache-2.0. Runtime dependencies, pinned exactly: `ohttp-ts` 0.6.1 (MIT),
`hpke` 1.1.7 (MIT), `nostr-tools` 2.25.2 (Unlicense). Dev: `ws` 8.22.0 (tests only).

## Layout

| File | What it does |
|---|---|
| `src/ohttpRelay.ts` | `OhttpRelay`: packages/match's `RelayLike` over OHTTP. Batching, fixed-size padding, paging, `on-demand` / `constant-rate` modes, polling `subscribe()` |
| `src/ohttp.ts` | key config fetch (through the relay) and SHA-256 pinning; the in-process gateway and relay used by tests |
| `src/protocol.ts` | the target's one endpoint, `POST /v1/exchange`: schemas, size buckets, strict parsing |
| `src/target.ts` | the Nostr gateway target: validation, kinds, signatures, rate limits, no logging; `serveTarget()` |
| `src/upstream.ts` | target → configured relays over WebSockets (publish to all, REQ until EOSE, CLOSE) |
| `src/ratelimit.ts` | token buckets keyed on recipient / filter HMACs, never on IPs |
| `src/live.ts` | `LiveRelay`: direct WebSockets, live `subscribe()`, reconnect with jittered backoff |
| `src/nip01.ts` | one NIP-01 connection (shared by `upstream.ts` and `live.ts`) |
| `bin/target.ts` | the target's entry point (env config); the Docker image runs it |

## Usage

```ts
import { OhttpRelay } from '@match-feed/transport';
import { MatchClient, openMinedPsi } from '@match-feed/match';

const relay = new OhttpRelay({
  relayUrl: 'https://ohttp-relay.example.net/gateway', // run by someone other than the gateway
  pins: ['<sha256 of the gateway key config>'],
});
const client = await MatchClient.create({ identity, relay, psi: await openMinedPsi() });
await client.sync(); // goes out as fixed-size OHTTP requests
```

Opt-out, with live delivery (relays see your IP):

```ts
import { LiveRelay } from '@match-feed/transport';
const live = new LiveRelay({ urls: ['wss://relay.example.org'] });
const stop = live.subscribe({ kinds: [1059], '#p': myKeys }, () => void client.sync());
```

## Tests

```sh
npm ci
npm test          # 37 tests: 34 offline, 3 Docker tests skip without OHTTP_E2E_RELAY_URL
npm run typecheck
../../infra/ohttp/e2e/run.sh   # from anywhere: Docker e2e (relay → Cloudflare gateway → target → strfry)
```

| File | Covers |
|---|---|
| `protocol.test.ts` | exact padding, strict request parsing, filter rules, response truncation |
| `ohttp.test.ts` | encapsulation round trip, context binding, tampering, target allow-list, pinning, key config lists |
| `target.test.ts` | publish/OK across relays, a relay down, query/EOSE/CLOSE/paging, size limits, kinds, signatures, rate limits, the target process logs nothing |
| `client.test.ts` | batching, sizes the OHTTP relay sees, paging, constant-rate cover traffic, `splitKeys`, unpinned keys, key rotation |
| `live.test.ts` | live subscriptions, de-duplication, reconnect with backoff |
| `e2e.test.ts` | two `MatchClient`s: request, PSI preview, accept, sketches, revoke, all over OHTTP (in process) |
| `e2e-docker.test.ts` | the same through the Docker stacks (run by `infra/ohttp/e2e/run.sh`) |

Tests import packages/match by relative path, so install packages/match first
(`cd ../match && npm ci`). They never contact a public relay.
