# @match-feed/circles: group taste pooling (PROTOTYPE)

> **Status: prototype. Not audited. Not for production.** It runs on alpha, unaudited MLS libraries
> (marmot-ts 0.5.1 and ts-mls 2.0.0-rc.16), and its secure aggregation and noise layers are our own composition of
> standard primitives that nobody has reviewed. Read [`docs/CIRCLES.md`](../../docs/CIRCLES.md) before relying on
> anything here, especially §8 "What is not secure yet".

A Circle pools its members' recent endorsements and shows everyone only the **picks**: videos enough members
endorsed, after DP noise. It never shows who endorsed what, or how many did. The package runs the whole round:

| Step | How |
|---|---|
| Membership and transport | MLS (RFC 9420) over Nostr via **marmot-ts**: create a circle, add members by key package and Welcome, remove a member (new epoch, the removed member is locked out), self-update |
| Secure aggregation | **Pairwise additive masking** (Bonawitz et al., CCS 2017): one-time X25519 keys, HKDF-SHA-256, ChaCha20 masks mod 2^32, all from `@noble/*`. Masks cancel in the sum. There is no aggregator: every member sums the masked vectors |
| Noise (T19) | **Distributed discrete Laplace.** Each member adds Pólya(1/(m−c)) − Pólya(1/(m−c)) from its own secret (Goryczka & Xiong, TDSC 2017, Thm 5.1). No one holds the total noise or a seed for it. ε = 1 holds against up to c colluders (default ⌈m/3⌉ − 1) |
| Dropouts | A member who doesn't send a round key is absent. Any dropout after the key phase **voids the epoch permanently**, consistent with core's freeze rule |
| Output | Core's circle policy on the aggregate: k ≥ 8, threshold 3/4 on the noised count, **picks only**, epoch freeze and ledger. Picks become `circle` candidates for core `rank()` |

The domain is a **public candidate list** (≤ 256 ids) carried in the round-open message. docs/CIRCLES.md §3
explains why hashed buckets lose: pure-DP noise on every bucket makes false picks grow with the domain.

## Layout

| File | What it does |
|---|---|
| `src/round.ts` | `CircleRoundEngine`: one member's round state machine (open → key → fix P → masked → release or void). Transport-agnostic and pure apart from randomness |
| `src/masking.ts` | X25519 round keys, pairwise masks, mask, sum, vector encoding |
| `src/noise.ts` | Pólya noise shares; collusion tolerance; member noise key |
| `src/prg.ts` | HKDF-SHA-256 and ChaCha20 keystream PRG (replaces core's `keyedRng`, T20, in this package) |
| `src/policy.ts` | `releaseAggregatedEpoch`: core's circle policy applied to an aggregate; ledger with release and void records; `circleFeedCandidates` |
| `src/messages.ts` | strict schemas for round-open, round-key and round-masked (provisional kinds 3480–3482) |
| `src/client.ts` | `CircleMember`: marmot-ts glue (MLS group, key packages, invites, remove, sync, identity-signed round messages) |
| `src/network.ts` | `InMemoryNostrNetwork`: marmot-ts's `NostrNetworkInterface` in memory, with a relay log. It refuses any relay URL except its own `wss://circles-test.invalid` |

## Usage

Requires Node ≥ 22.6, run with `--experimental-strip-types` (the npm scripts pass it).

```sh
npm install         # .npmrc: ignore-scripts, save-exact
npm test            # 32 offline tests (node:test), including 12 members over real MLS
npm run typecheck
```

```ts
import { CircleMember, InMemoryNostrNetwork } from '@match-feed/circles';
import { DEFAULT_RECIPE, rank, cryptoRng } from '@match-feed/core';

const network = new InMemoryNostrNetwork();          // tests only; there is no real relay I/O yet
const alice = await CircleMember.create({ signer: aliceSigner, network, now: () => new Date() });
const bob = await CircleMember.create({ signer: bobSigner, network, now: () => new Date() });

await bob.publishKeyPackage();
await alice.createCircle('Film club');
await alice.invite(bob.identity);                    // one MLS commit per add (admin only)
await bob.acceptInvite();

// Any member opens a round over PUBLIC candidates, e.g. new videos from the circle's channels.
await alice.openRound(candidateIds, { keyWindowSec: 3600, maskWindowSec: 3600 });
// Every member, periodically. The history never leaves the device unmasked.
await bob.sync(bobHistory);

await alice.remove(bob.identity);                    // new epoch; Bob can no longer decrypt
const cands = alice.candidates('Film club', videosById);
const feed = rank([...cands, ...otherCandidates], DEFAULT_RECIPE, { now: new Date(), limit: 20, rng: cryptoRng() });
```

## Tests (32)

| File | Covers |
|---|---|
| `masking.test.ts` (6) | symmetric masks; 12 masked vectors sum to the inputs; a coalition missing one pairwise key sees a one-time pad; the n−1 limit, which equals subtracting from the output; low-order key rejection; encoding |
| `noise.test.ts` (4) | Pólya means; 12 shares sum to discrete Laplace(ε = 1) (P(0), variance); the collusion-tolerance construction; stickiness |
| `messages.test.ts` (3) | round trips; unknown or missing keys; core policy floors; sorted public candidates; size before parse |
| `policy.test.ts` (5) | threshold on the noised count, derived from k; k floor; freeze, stale and released-item exclusion; void finality; unattributed candidates |
| `round.test.ts` (7) | 12-member round without MLS: identical release everywhere, mask cancellation and threshold checked against the true noised sum; structural checks on received messages; one contribution per epoch and only-new endorsements; dropout void; participant-set mismatch void; too few members; refusing weaker policies and an epoch change mid-round |
| `e2e.test.ts` (7) | 12 members over marmot-ts and MLS: create and add (11 epochs); a round; structural checks on what members and the relay see; remove → new epoch, the removed member cannot decrypt the next epoch's events, freeze holds; next round with 11 members pools only new endorsements and never re-picks; picks through core `rank()` |

## Supply chain

Runtime dependencies, pinned exactly:

| Package | Version | License |
|---|---|---|
| `@internet-privacy/marmot-ts` | 0.5.1 | MIT |
| `ts-mls` | 2.0.0-rc.16 | MIT |
| `nostr-tools` | 2.25.2 | Unlicense |
| `@noble/ciphers`, `@noble/curves`, `@noble/hashes` | 2.2.0 | MIT |

Notes:
- **`overrides: { "ts-mls": "2.0.0-rc.16" }` is a security fix, not a convenience.** marmot-ts 0.5.1 pins
  ts-mls 2.0.0-rc.10, where a commit that removes a single member has no UpdatePath, so the removed member can
  derive the next epoch and read it. Details and the regression test: docs/CIRCLES.md §1.
- **The upgrade path is marmot-ts 0.7.0** (published 2026-10-19; reworked API, authorization fixes, bundled patched
  ts-mls) or MDK.
- **Install scripts:** `.npmrc` sets `ignore-scripts=true`. The installed tree currently has no install scripts.
- **Duplicated libraries:** `applesauce-core` 5.2.0 (under marmot-ts) brings its own `nostr-tools` 2.19.4 with
  `@noble/*` 1.x.

License: Apache-2.0.
