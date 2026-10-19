# Match Feed: the 1:1 Match protocol

Status: prototype, 2026-10-19. Implemented in `packages/match`. Wire schemas: `PROTOCOL.md` §6.
Companion to `DESIGN.md` (Match protocol), `THREAT_MODEL.md` (T2, T4, T5, T10, T15) and `SIMULATION_RESULTS.md` (Exp 4).

**Not audited. Kinds are provisional.**

## Lifecycle

```
 requester (A)                                         target (B)
 requestMatch ── match-request (seal: A id → B id) ──▶ incoming
 [requestMatchPreview ── preview-request ───────────▶ core requestPreview          ]
 [            ◀── preview-response (accept + PSI req) ── respondToMatchPreview      ]
 [answer (PSI server) ── preview-answer ────────────▶ startTargetPreviewRun        ]
 [            ◀── preview-result (noised only) ──────── completeTargetPreview       ]
 active ◀────── match-accept (seal: B id → A match key) ── acceptMatch(consent)  active
 sketch ◀──────────── sketch (match key → match key, weekly) ─────────────▶ sketch
 proposeRenew / acceptRenew ── renew ── new 90-day term + fresh keys on both sides
 revokeMatch ── revoke ──▶ revoked (both wipe keys and sketches)
 tick: 90-day expiry · 7-day request expiry · key grace · tombstones · preview pruning
 setPaused: local only (D2)
```

States per match: `requested` (A), `incoming` (B), `active`, then one of `declined`, `revoked` or `expired`.
- Ended matches keep a tombstone without keys or data for 30 days, so replayed messages for them are refused.
- The state is a plain JSON `MatchBook`; every transition is a pure function (`packages/match/src/state.ts`).

### Previews (THREAT_MODEL T2; SIMULATION_RESULTS Exp 4)

- A preview is optional and happens while the match is pending.
- **The target runs PSI as the party that learns |A ∩ B|** (PSI client). It noises the count on its own device with core `noisyPreviewCardinality` (discrete Laplace, ε = 0.5, floor 5) and sends only `{floor, belowFloor, value}`. The requester (PSI server) never sees the exact count.
- The noising happens inside the state transition (`completeTargetPreview(trueCount, rng)`), so the exact count can't reach the outbox by mistake.
- **Acceptance is the target user's explicit act.**
  - Core `respondToPreview` enforces the budget: **≤ 8 accepted previews per rolling 365 days, from all requesters together**, counted in the target's own `MatchBook.previews`.
  - A spent budget goes out as an ordinary decline, and requesters can't tell the two apart. Only the target's UI learns `refusal: 'target-budget'`.
  - Pair and requester limits (core `requestPreview`) are checked on receipt. The requester's client also self-enforces them.
- **Both sides pad their PSI set to exactly 128 items** with random 64-hex nonces, which never intersect with real ids.
  - So neither side learns the other's set size from the PSI messages.
  - The real size travels only as the requester's self-reported `setSize`, which feeds core `startPreviewRun`'s `minSetSize` check (hygiene only, per Exp 4).
  - The 128 real items are the newest consent-filtered ones, the same cap as a NIP-17 sketch.
- PSI is OpenMined PSI in cardinality-only mode. It is **unaudited**. The requester refuses requests that ask to reveal the intersection.
  - Sizes at 128 items: request 4,480 B, setup 630 B (fpr 1e-9), response 4,480 B.
  - So each PSI message fits one 8,192-byte control message after base64.

### Quiet pause (D2)

`setPaused` changes local consent only. The weekly schedule continues (`dueSketches` includes paused matches), and core `buildSketch` re-sends the same real items in a fresh envelope: new epoch, nonce, padding and shuffle. Newly excluded videos are removed. Nothing on the wire says "paused".

## Keys (THREAT_MODEL T10)

| Key | Lifetime | Seals | Receives (`p` tag) |
|---|---|---|---|
| Identity (npub; may live in a NIP-07/46/55 signer) | long-term | match-request (A); match-accept (B); B's preview replies before it accepts | match-request; A's preview request/answer and a withdrawal sent before A has seen the accept |
| Per-match key, one per side | ≤ 90 days; replaced on every renewal; wiped on revoke or expiry | everything else from that side | everything else |
| Gift-wrap key | one event | the kind-1059 wrap only | — |

- Per-match keys are **fresh random secp256k1 keys** (nostr-tools `generateSecretKey`).
  - They are not derived from the identity, so a leak of one reveals nothing about the others or the identity.
  - The public half is announced **only inside the encrypted request or accept**. The binding "match key ↔ identity" is authenticated by the identity key's seal signature, and relays never see it.
- **Rotation.** `renew` (propose, then accept) carries each side's next match key. It is sent under the current keys.
  - After the accept, both sides switch.
  - The old keys stay valid for receiving and verifying for 14 days (the longest a wrap lives), so in-flight sketches aren't lost. Then they are dropped.
  - Rotation happens at least every 90 days, because an unrenewed match expires.
- **Revoke and expiry** wipe the per-match keys and both sketches at once.
- **No new cryptography.** The package composes nostr-tools primitives:
  - `getEventHash`, `finalizeEvent` and `verifyEvent` (BIP-340);
  - `generateSecretKey`;
  - `nip44.v2` (ECDH + HKDF + ChaCha20 + HMAC).

  We don't use `nip59.wrapEvent` itself: it needs a raw sender secret key, so an identity key in a signer couldn't seal, and it can't add the NIP-40 `expiration` tag PROTOCOL.md requires.

### What the key split buys, and what it doesn't

- Stealing **the identity key** exposes:
  - the handshake messages already stored (who requested whom, the announced match public keys, preview messages);
  - the ability to impersonate the user in *new* requests.

  It does **not** expose sketches, which go to match keys.
- Stealing **a match key** exposes every stored message sent to it (all of that match's sketches since the last rotation) and lets the thief forge that side's messages to the peer, until rotation or revocation. NIP-44 has **no forward secrecy** and **no post-compromise security**. Rotation every ≤ 90 days bounds the window, nothing more.
- Both keys sit on the same device. Device compromise (A9) gets both. The split protects against leaks of one key (e.g. an identity key used in many apps or remote signers), not against a stolen phone (see T9).
- Identity-key seals in the handshake mean the peer can prove to a third party that you sent a match request or accept. Seals are signed. NIP-17 deniability doesn't apply to the seal.

## Wire privacy

- Every message is a NIP-59 gift wrap: a one-time author key, `created_at` jittered up to 2 days into the past, and tags `p` and `expiration` only.
- All control messages are padded to **exactly 8,192 bytes**, the same as a 64-bucket sketch. A relay sees only two event sizes:
  - **19,649 bytes**: any control message or a 64-bucket sketch;
  - **33,305 bytes**: a 128-bucket sketch.
- Every wrap expires 14 days after it's sent (a sketch's own `expiresAt` defaults to 14 days too), so the expiration doesn't reveal the type either.
- **The 64 KiB check.** The 128-bucket NIP-17 sketch wraps to 33,305 bytes when ids are ordinary URLs.
  - Ids containing `"`, `\` or control characters get JSON-escaped twice (once in the sketch, once in the rumor). With enough of them a 128-bucket wrap would pass 64 KiB.
  - `buildMatchSketch` drops such ids; canonical URLs never contain them. `giftWrap` refuses anything over 65,536 bytes as a backstop.
  - Tests cover both.
- **Still visible to relays:**
  - a target's identity receives a few first-contact wraps;
  - the timing of user-driven handshakes;
  - which keys receive traffic, and how often;
  - IP addresses (use OHTTP or Tor; T5).

  The mitigations are the fixed weekly schedule and random relay choice from the peer's inbox list. The second is the transport's job, not this package's.

## Receive checks

In order:
1. Event size ≤ 64 KiB.
2. Kind 1059, and a valid wrap signature (verified on a fresh copy: nostr-tools caches verification in a property that object spread copies).
3. `p` = one of my keys, and an unexpired `expiration`.
4. The seal is kind 13, has no tags and a valid signature.
5. The rumor pubkey equals the seal pubkey, and the rumor id is correct.
6. The rumor kind is one of ours.
7. The content's schema (exact size before parse, exact keys).
8. Freshness: `issuedAt` within 14 days and not more than 300 s ahead.
9. The match exists and is in the right state.
10. The seal key is one this peer may use now, and the recipient key is mine for this match.
11. For sketches, core `decodeSketch` with `transport: 'nip17'` and `lastEpoch`: bucket ≤ 128, expiry, epoch strictly increasing (T15).

## Kinds (provisional)

Rumor kinds **3470–3478**: match-request, match-accept, preview-request, preview-response, preview-answer, preview-result, sketch, renew, revoke.
- Checked against the NIP registry README on 2026-10-19, which lists no kinds in 3000–3999.
- They are regular kinds (NIP-01: 1000–9999), like NIP-17's kind 14.
- They only ever appear inside gift wraps. Register them, or move them, before any client ships.

## Open items

- A real `RelayLike` over WebSockets with random inbox-relay selection (NIP-17 kind 10050) and OHTTP. Never point tests at public relays.
- A persistent PSI client key, so a preview survives an app restart. psi.js offers `createFromKey`; the key would have to live in the encrypted book.
- Cover traffic for handshakes: their timing is user-driven.
- The second-degree relay list inside the sketch channel (PROTOCOL.md §5) isn't specified yet.
- Interop vectors: add tests against paulmillr/nip44 vectors (OSS_STACK §4).
- **Core changes requested** (core was not edited):
  1. Export a helper that maps a received noised value and floor to `{bucket, label}`, e.g. `previewDisplay(belowFloor, value, floor)`. `packages/match` mirrors `noisyPreviewCardinality`'s thresholds (`previewDisplay` in `state.ts`), and a test pins the two together.
  2. Tighten `VIDEO_ID` in `sketch.ts` (`selectSketchItems` and `validateSketch`) to refuse `"`, `\` and C0/C1 control characters. The 64 KiB bound for 128-bucket NIP-17 wraps relies on ids not needing JSON escapes. Today `packages/match` filters them before calling `buildSketch`.
