# @match-feed/circles: group taste pooling (PROTOTYPE)

> **Status: prototype. Not audited. Not for production.** It runs on alpha, unaudited MLS libraries
> (marmot-ts 0.5.1 and ts-mls 2.0.0-rc.16), and its secure aggregation and noise layers are our own composition of
> standard primitives that nobody has reviewed. Read [`docs/CIRCLES.md`](../../docs/CIRCLES.md) before relying on
> anything here, especially §8 "What is not secure yet".

A Circle pools its members' recent endorsements and shows everyone only the **picks**: videos enough members
endorsed, after DP noise. It never shows who endorsed what, or how many did. The package runs the whole round:

| Step | How |
|---|---|
| Membership and transport | MLS (RFC 9420) over Nostr via **marmot-ts**: create a circle, add members by key package and Welcome, remove a member (new epoch, the removed member is locked out), self-update, change admins |
| Authorization (app layer) | marmot-ts 0.5.1 lacks 0.7.0's authorization fixes, so `authz.ts` re-checks them: Welcome author must be an admin member; every applied commit re-authorized against its parent state (violation → the circle halts locally); inner round-event signer must be the MLS sender leaf; kind-445 events must carry exactly one `h` tag; key packages verified before invite |
| Size padding | Every round message is padded to a fixed size bucket (8,192 / 16,384 / 45,056 bytes of plaintext), and all messages of one round use the round-open's bucket, so the relay cannot tell open, key and masked messages apart by size |
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
| `src/client.ts` | `CircleMember`: marmot-ts glue (MLS group, key packages, invites, remove, admins, sync, identity-signed and padded round messages, guard rejections in `rejections`, fail-closed `halted`) |
| `src/authz.ts` | App-level authorization checks around marmot-ts 0.5.1 (Welcome author, commit vs parent state, sender binding, kind-445 shape, key packages) |
| `src/padding.ts` | Fixed-size padding of serialized round rumors (`PAD_BUCKETS`), strict receiver check |
| `src/network.ts` | `InMemoryNostrNetwork`: marmot-ts's `NostrNetworkInterface` in memory, with a relay log. It refuses any relay URL except its own `wss://circles-test.invalid` |

## Usage

Requires Node ≥ 22.6, run with `--experimental-strip-types` (the npm scripts pass it).

```sh
npm install         # .npmrc: ignore-scripts, save-exact
npm test            # 43 offline tests (node:test), including 12 members over real MLS
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

## Tests (43)

| File | Covers |
|---|---|
| `masking.test.ts` (6) | symmetric masks; 12 masked vectors sum to the inputs; a coalition missing one pairwise key sees a one-time pad; the n−1 limit, which equals subtracting from the output; low-order key rejection; encoding |
| `noise.test.ts` (4) | Pólya means; 12 shares sum to discrete Laplace(ε = 1) (P(0), variance); the collusion-tolerance construction; stickiness |
| `messages.test.ts` (3) | round trips; unknown or missing keys; core policy floors; sorted public candidates; size before parse |
| `policy.test.ts` (5) | threshold on the noised count, derived from k; k floor; freeze, stale and released-item exclusion; void finality; unattributed candidates |
| `round.test.ts` (7) | 12-member round without MLS: identical release everywhere, mask cancellation and threshold checked against the true noised sum; structural checks on received messages; one contribution per epoch and only-new endorsements; dropout void; participant-set mismatch void; too few members; refusing weaker policies and an epoch change mid-round |
| `e2e.test.ts` (8) | 12 members over marmot-ts and MLS: create and add (11 epochs); a round; structural checks on what members and the relay see; all 25 kind-445 events of a round have one size and honest members trip no guard; remove → new epoch, the removed member cannot decrypt the next epoch's events, freeze holds; next round with 11 members pools only new endorsements and never re-picks; picks through core `rank()` |
| `authz.test.ts` (10) | **ts-mls override regression**: `package.json` override, lockfile and the ts-mls Node resolves (from this package and from inside marmot-ts) must all be a fixed version, and a commit removing one member must carry an UpdatePath; key-package checks; re-wrapped Welcomes from a non-admin member and a stranger refused; commit authorization on real MLS states; sender binding; extra-tag kind-445 dropped; padding sizes, unpadded messages dropped, a maximal round-open fits under 64 KiB; an unauthorized commit applied by the library halts the member |

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
  ts-mls) or MDK. We only take a release once it has been out for two weeks, so the earliest upgrade date is
  **2026-11-02**. Until then `src/authz.ts` re-checks 0.7.0's authorization fixes at the app layer (docs/CIRCLES.md §1).
  0.7.0 bundles its own ts-mls fork, so on upgrade the override and the version test in `authz.test.ts` must be
  replaced by an equivalent check on the bundled fork.
- **Do not drop the override.** `test/authz.test.ts` fails if the override, the lockfile or the resolved ts-mls
  (also as seen from inside marmot-ts) is not a known-fixed version, or if a single-Remove commit has no UpdatePath.
- **Install scripts:** `.npmrc` sets `ignore-scripts=true`. The installed tree currently has no install scripts.
- **Duplicated libraries:** `applesauce-core` 5.2.0 (under marmot-ts) brings its own `nostr-tools` 2.19.4 with
  `@noble/*` 1.x.

License: Apache-2.0.
