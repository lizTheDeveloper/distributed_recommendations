# Circles: group taste pooling (prototype)

Status: **PROTOTYPE, not audited, not for production.** Draft v1, 2026-10-19.
Code: `packages/circles`. Companion to `DESIGN.md` (Match protocol, step 6),
`PROTOCOL.md` §3, `THREAT_MODEL.md` (T3, T19, T20) and `SIMULATION_RESULTS.md` (Exp 3).

A Circle is a group of 8 or more people (12–30 recommended) who pool their recent endorsements. They see only the
**picks**: videos enough of them endorsed, after DP noise. They never see who endorsed what or how many did.
This prototype builds the full round:

1. **Membership and transport:** MLS (RFC 9420) via Marmot (MLS over Nostr), using `marmot-ts`.
2. **Secure aggregation:** pairwise additive masking (Bonawitz et al.) over a fixed per-round candidate vector.
   No member, and no aggregator, sees another member's input. There is no aggregator: every member sums the
   masked vectors itself.
3. **Distributed DP noise:** each member adds a Pólya share. The shares sum to exactly the discrete-Laplace
   noise core expects (ε = 1). Nobody holds the total noise or a seed for it (T19).
4. **Output:** core's circle policy runs on the aggregate: k ≥ 8, threshold on the noised count, picks only,
   epoch freeze and ledger. Picks become `circle` candidates for `rank()`.

What it does **not** yet protect against is listed under "What is not secure yet" below.

## 1. Transport: which MLS library

| Option | Checked 2026-10-19 | Decision |
|---|---|---|
| **marmot-ts** (`@internet-privacy/marmot-ts`) | 0.5.1 (2026-04-27) installs and works in Node 22: create a group, publish key packages (kind 30443), invite via Welcome (NIP-59 gift wrap, kind 1059), group events (kind 445), remove with an epoch change, self-update. **0.7.0** was published on 2026-10-19, the day of this check. It reworks the API (no `inviteByKeyPackageEvent`) and fixes authorization bugs (see below). Both versions call themselves alpha, "do not use in production". | **Used: 0.5.1**, behind a thin adapter (`client.ts`). We take a release only once it has been out for two weeks (npm `time`: 0.7.0 at 2026-10-19T14:36Z), so the earliest upgrade is 2026-11-02. Until then `authz.ts` re-checks 0.7.0's authorization fixes at the app layer (below). Moving to 0.7.0 is the first follow-up. |
| ts-mls directly | 2.0.0-rc.16 / 1.6.4; "not undergone a formal security audit" | Not needed, since marmot-ts works. ts-mls is still a direct dependency, for the MLS exporter. |
| Pairwise NIP-44 among members | — | Not needed. It would have lost forward secrecy and PCS, and needed n² messages. |

### Finding: removed members could read the next epoch (fixed by a version override)

`marmot-ts` 0.5.1 pins `ts-mls` **2.0.0-rc.10**. That version requires an UpdatePath on a commit only when it
carries **more than one** Remove:

```js
// ts-mls 2.0.0-rc.10, dist/src/clientState.js
const needsUpdatePath = allProposals.length === 0 ||
    Object.values(grouped[defaultProposalTypes.update]).length > 1 ||
    Object.values(grouped[defaultProposalTypes.remove]).length > 1;   // RFC 9420 §12.4: any Remove needs a path
```

- **Effect:** a commit that removes **one** member has no fresh commit secret. The removed member processes the
  commit, derives the new epoch's secrets and **decrypts every later message**. We reproduced this: under rc.10,
  the removed member of a 12-person circle decrypted 23 of the next epoch's application messages.
- **Fix upstream:** ts-mls 1.6.4 (`... remove.length > 0`), 2.0.0-rc.16 (any proposal other than Add, PSK or
  ReInit needs a path) and marmot-ts 0.7.0's bundled fork are all correct.
- **What we did:** `packages/circles/package.json` sets `"overrides": { "ts-mls": "2.0.0-rc.16" }`. Its
  required peer `@noble/ciphers` 2.2.0 is pinned too, along with `@noble/curves` and `@noble/hashes` 2.2.0.
- **Regression tests:**
  - `test/e2e.test.ts` ("remove a member …", "next round …"). The removed member must notice it is out, must
    receive no round messages, and must fail to decrypt any new-epoch event even when its stale group state is
    handed those events directly.
  - `test/authz.test.ts` ("supply chain: ts-mls is overridden …"): the `overrides` entry, every `ts-mls` entry in
    `package-lock.json`, and the ts-mls that Node actually resolves (from this package **and** from inside
    marmot-ts) must be on a known-fixed list (`2.0.0-rc.16`). Dropping the override, or a lockfile that
    re-resolves marmot-ts's own pin, fails this test.
  - `test/authz.test.ts` ("regression: … a commit removing ONE member carries an UpdatePath"): builds a
    single-Remove commit in public wire format with the resolved ts-mls and asserts `commit.path` is present.
- **Report upstream:** ask marmot-ts to cut a 0.5.x release with the bump, or record that 0.5.x is affected.
  Anyone else on marmot-ts ≤ 0.5.1 with default dependencies has this bug.

### Other marmot-ts 0.5.1 limits we work around or accept

- **No MLS sender for application messages.** 0.5.1's API hands the app only the decrypted bytes (with the
  overridden ts-mls rc.16, the raw ingest result also carries `senderLeafIndex`, which `client.ts` now uses).
  - Workaround: each round message is a Nostr event **signed by the member's identity key**, inside the MLS
    message. Receivers verify a fresh copy (T25), check that the signer is a current MLS member, and check that
    the signer is the credential identity of the MLS sender leaf (`checkSenderBinding`, below).
  - Cost: the signature is non-repudiable. Anyone who gets the plaintext can prove that member X sent a round
    key or masked vector. A masked vector reveals nothing about X's input, but it does prove participation.
  - Better: use the MLS sender, which MLS already authenticates, once the library exposes it.
- **`commit({extraProposals: [builder]})` breaks on builders that return arrays.** We pass the built Remove
  proposals instead. Fixed in 0.7.0.
- **Not in 0.5.1, and fixed in 0.7.0** per its changelog:
  - authenticating the real Welcome author and requiring that author to be an active admin;
  - authorizing commits against the parent state;
  - validating member identity proofs during send and ingest;
  - dropping kind-445 events with extra tags.

  A malicious member or relay may be able to exploit these gaps. **Don't ship on 0.5.1.**

### Authorization gaps in 0.5.1 and the app-level guards (`src/authz.ts`)

Until the upgrade, `CircleMember` re-checks what 0.7.0 fixes inside the library. These are checks around the
library, not patches to it; tests in `test/authz.test.ts`.

| 0.7.0 fix | App-level guard in 0.5.1 | What remains |
|---|---|---|
| Authenticate the real Welcome author and require an active admin | `acceptInvite()` tries Welcomes newest first. The author is the NIP-59 seal signer (applesauce checks that the rumor pubkey equals it). After joining, `checkWelcomeAuthor` requires the author to be a member **and** in the group's admin list; otherwise the group state is destroyed and the next Welcome is tried. Test: the same MLS Welcome re-wrapped by a non-admin member and by a stranger is refused | The check runs after `joinGroupFromWelcome` has adopted the state and marked the key package used; 0.7.0 checks before saving anything |
| Authorize commits against the parent state | `sync()` tracks the state each ingest result was applied to. For every applied commit, `checkCommitAuthorized(parent, child, senderLeafIndex)` (ts-mls rc.16 returns the sender) requires the sender to be an admin in the **parent** state; a non-admin may only self-update (same member set, same group-context extensions). On a violation the member **halts** the circle (`halted`, fail closed): it stops syncing and sending, since MLS state cannot be rolled back at the app layer | 0.5.1 builds its admin callback once per ingest pass. Because each kind-445 event is encrypted under its own epoch's exporter key, consecutive commits land in different passes, so we could not build a batch that exploits the stale list. The guard is defence in depth; the test switches the library check off to show the guard catches an applied unauthorized commit. A halted member needs a fresh invite |
| Validate member identity proofs during send and ingest | `checkSenderBinding`: the Nostr key that signed an inner round event must be the basic-credential identity of the MLS leaf that sent it (rc.16's `senderLeafIndex`, using the epoch's tree for older-epoch messages). A leaf whose credential claims someone else's pubkey cannot sign as them, so it cannot send round keys and is never counted in P | No MLS-level account proof (0.7.0's `0x8009` leaf proof). An admin can still add a leaf that claims another person's pubkey; it counts as an MLS member (and in `members()`), just not as a round participant |
| Drop kind-445 events with extra tags | `checkGroupEvent`: exactly one tag, `["h", group id]`, and a valid signature, checked before decryption | 0.7.0 also allows one NIP-40 `expiration` tag; we refuse it |
| (0.5.1 already checks credential = event pubkey) | `invite()` also verifies the key-package signature and that the author is the invitee (`checkKeyPackageEvent`) | — |

Everything a guard refuses is recorded in `CircleMember.rejections`.
- **Package exports.** `./extra` (the in-memory store) is not in the export map, and `./mls` points at a missing
  `src/` directory. We wrote a 15-line in-memory store instead.
- **Retries.** Joiners must catch up on commits from epochs after their Welcome. The client re-feeds events that
  were unreadable, up to 8 syncs.
- **No self-update after joining.** MIP-02 requires a self-update after joining from a Welcome, for forward
  secrecy. The prototype does not do it automatically; `CircleMember.selfUpdate()` exists.

### Metadata the relay sees

Kind-445 events carry the group's `h` tag and are signed by one-time keys. Before padding, their size gave away
the message type (round-open up to 56.6 KB; key and masked messages a few KB).

**Padding (`src/padding.ts`).** The serialized rumor of every round message (what marmot-ts hands to MLS) is padded
with trailing spaces to exactly one of three buckets. The round-open picks the smallest bucket that fits; every
key and masked message of that round uses the same bucket. Receivers drop any round message whose plaintext is
not exactly a bucket long (size checked before parsing). MLS (ChaCha20-Poly1305 inside, no further padding above
256 bytes) and Marmot's outer ChaCha20-Poly1305 keep the length fixed, so every kind-445 event of a bucket has
one size. Measured in `test/authz.test.ts`:

| Bucket (serialized rumor) | Holds | Kind-445 event |
|---|---|---|
| 8,192 bytes | every key and masked message (≤ 4,096-byte content); a round-open of up to 91 70-character PeerTube watch URLs | 11,592 bytes |
| 16,384 bytes | a round-open of up to 195 such ids | 22,520 bytes |
| 45,056 bytes | a maximal round-open (40,000-byte content → 42,176-byte rumor) | 60,752 bytes (under the 64 KiB relay limit) |

`test/e2e.test.ts` checks that all 25 kind-445 events of a 12-member round (1 open, 12 keys, 12 masked) have
one size. **Cost:** a round in the largest bucket moves 25 × 60.8 KB ≈ 1.5 MB through the relay, and every member
downloads all of it. **What still leaks:** the bucket (a coarse class of candidate-list size), the number of
messages per round (1 + 2|P|, so |P| itself) and their timing. Commits and proposals are not padded and remain
distinguishable from round messages.

Key packages (30443) and Welcomes (1059, with a `p` tag) link identities to the group, as the Least Authority
review of Marmot noted (DESIGN.md N3). The e2e test checks that the relay log has no video ids, no round keys and
no identity-signed 445 events.

## 2. The round

A round binds to **one MLS epoch e**. Each member's engine (`round.ts`) is a state machine.

```text
open     any member → group:  round-open {roundId, circleId, epoch=e, openedAt, keyDeadline, maskDeadline,
                                           policy (core CirclePolicy), candidates[≤256, sorted, public]}
         each member validates against its OWN floor (ε ≤ 1, k ≥ 8, …), epoch == current MLS epoch,
         no other round seen for e, e not yet contributed or released.
key      each taking part → group:  round-key {roundId, epoch, X25519 public key (fresh)}
fix      at keyDeadline: P = senders of keys seen (keys stamped ≤ keyDeadline)
         |P| < minMembers → epoch released as "too few members"; nothing else is sent.
         MLS epoch moved on → round void ("epoch-changed"); nothing is sent.
masked   each i ∈ P → group:  round-masked {roundId, epoch, digest(P), y_i}
             x_i[c]  = 1 if i endorsed candidate c since its last contribution (≤ maxItemsPerMember, newest first),
                       0 for items released in earlier epochs
             y_i     = x_i + noise_i + Σ_{j∈P, id_i<id_j} m_ij − Σ_{j∈P, id_i>id_j} m_ij   (mod 2^32)
         Sending is the point of no return: the epoch is marked contributed, the endorsement cursor moves
         to openedAt, and the round secret key is overwritten.
release  when all |P| vectors are in: Σ y_i = Σ x_i + Σ noise_i  →  core policy  →  ledger.
         Missing vectors at maskDeadline, a digest mismatch, a second different vector from one sender
         or an implausible sum (|value| > 10^6) → epoch VOID, permanently.
```

### Key derivation (all standard primitives, `@noble/*`)

| Value | Derivation |
|---|---|
| round context | MLS exporter (RFC 9420 §8.5), label `match-feed/circles/v1/round`, context = roundId, 32 bytes. This binds a round to the current epoch secret |
| pairwise mask key k_ij | HKDF-SHA-256(ikm = X25519(a_i, A_j), salt = round context, info = `match-feed/circles/v1/mask` ‖ 0 ‖ id_lo ‖ id_hi ‖ A_lo ‖ A_hi) |
| mask m_ij | ChaCha20 (RFC 8439) keystream under k_ij with a zero nonce, read as little-endian uint32. Each key yields one stream |
| participant digest | SHA-256(HKDF(round context, `participants`) ‖ sorted "identity:roundKey" lines). Members on different epochs, or with different views of P, get different digests |
| noise key | HKDF-SHA-256(ikm = member's local 32-byte secret, salt = circleId, info = `noise-share` ‖ epoch). Sticky per epoch; never leaves the device |
| noise draws | ChaCha20 keystream under the noise key → 53-bit uniforms → Gamma → Poisson samplers |

The X25519 all-zero shared secret is rejected (RFC 7748 §6.1). Core's hand-written `keyedRng` (T20) is not used
anywhere in this package.

### Wire format (provisional)

The three round messages are rumor kinds **3480** (round-open), **3481** (round-key) and **3482** (round-masked).
They are provisional and unregistered, and sit next to Match's 3470–3478. They appear only inside MLS application
messages.

The JSON follows PROTOCOL.md's rules:
- `v: 1`;
- unknown or missing keys rejected;
- fixed key order;
- size checked before parsing: round-open ≤ 40,000 bytes, so the padded kind-445 event stays under a 64 KiB
  relay limit (largest bucket: 60,752 bytes); key and masked messages ≤ 4,096 bytes;
- the transport padding (trailing spaces after the inner JSON in the rumor content, serialized rumor exactly
  8,192, 16,384 or 45,056 bytes, one bucket per round) is mandatory, and unpadded messages are dropped;
- candidates must pass PROTOCOL.md's video-id rule and be sorted and unique.

The policy object is core's `CirclePolicy`, checked by `parseCirclePolicy`. Each member also enforces its own
floor (`acceptsPolicy`):

| Field | A member refuses the round if |
|---|---|
| `minMembers` | it is below the member's own |
| `epsilon` | it is above the member's own |
| `maxItemsPerMember` | it is above the member's own |
| `revealThreshold` | it is below the derived threshold |

## 3. The domain: a public candidate list (and why not hashed buckets)

Pairwise masking needs a fixed vector that every member indexes the same way. Two options were weighed:

| | Per-round candidate list (**chosen**) | Hashed buckets |
|---|---|---|
| Domain | ≤ 256 video ids in round-open | B buckets, H(k_e, id) mod B, so every endorsement counts |
| False picks from noise | D × P(Z ≥ t) over **D ≤ 256** | the same formula over **all B buckets**. At ε = 1 and t = 3, P(Z ≥ 3) = 3.6% (5.2% with distributed noise), so B = 4096 gives about 210 buckets that are pure noise |
| Turning picks back into videos | direct | each member must match pick buckets against its own catalogue. With catalogue C, every pick bucket also matches about C/B unrelated videos, and collisions merge counts |
| Lost signal | endorsements outside the list don't count | none (except collisions) |
| Matches Exp 3 | yes: Exp 3 used 150 candidates per circle | no |

Pure-DP noise must go on every slot of the domain, so false picks grow with the domain's size. That makes a small
domain a **utility** requirement, not just a convenience. The cost of the list is that it must come from **public
data**, such as:
- new videos from channels the circle follows;
- links members chose to post in the circle;
- items from public taste lists.

It must never come from someone's private history: whoever proposes candidates reveals them, like posting in a
chat. Members cannot verify where a list came from. A malicious opener could fill it with videos they want to probe,
but each probe is still answered with ε-DP picks (one round per epoch).

## 4. Secure aggregation: what we kept from Bonawitz et al. and what we dropped

The construction is the pairwise-mask core of Bonawitz et al. (CCS 2017):
- one-time X25519 keys per round;
- a mask expanded by a PRG from each pairwise secret;
- masks that cancel in the sum.

**Kept:**
- Any single masked vector is a one-time pad to anyone who lacks at least one of its owner's pairwise keys.
- A coalition of all members except the target and one other learns nothing from the target's vector. Test:
  `masking.test.ts`, "a masked vector hides its input …".

**Dropped, deliberately, for the prototype:**
- **Dropout recovery.** Bonawitz secret-shares each member's mask key and a self-mask (t-of-n Shamir) so the server
  can finish without dropped members. We have no recovery: **any dropout after the key phase voids the epoch.**
  Members who don't send a key are simply absent, consistent with core's rule. This is simple and safe, and costs
  liveness: with a 5% per-member dropout in the mask window, a 12-member round completes about 54% of the time.
  Real recovery is follow-up work (Bonawitz 2017, or Bell et al. CCS 2020 for lower overhead) and needs its own
  analysis.
- **No server.** Messages are broadcast inside MLS and every member sums them, so no single party sees "the inputs".
  This also removes the server attacks that Bonawitz's malicious-server protocol defends against, such as lying
  about who dropped out.

**Why a void epoch stays consumed.** A member that sends its key but withholds its masked vector still receives
everyone else's. It knows all its own pairwise masks, so it can unmask Σ_{i≠d} (x_i + noise_i): the round's output
without its own input. Re-running the epoch with fresh inputs would then hand out two outputs. So:
- once a member has sent its masked vector for epoch e, it never contributes in e again (`contributedEpochs`);
- its endorsement cursor has already advanced, so those endorsements are spent;
- a void is recorded in the ledger like a release, and later epochs only move forward.

This is the freeze rule from Exp 3, extended to failed rounds.

## 5. Distributed noise (T19)

Core wants per-candidate two-sided geometric noise Z with P(Z = k) ∝ e^(−ε|k|).

- **Construction.** Z = G₁ − G₂ for i.i.d. geometric variables. The geometric distribution is Pólya (negative
  binomial) with shape 1, and Pólya is infinitely divisible. If each of m members adds X_i − Y_i with
  X_i, Y_i ~ Pólya(1/m, e^(−ε)), the sum is **exactly** discrete Laplace(ε). This is Theorem 5.1 of Goryczka &
  Xiong (TDSC 2017).
- **Stickiness.** Each member draws its share from its own local secret, keyed by (circle, epoch). Shares are
  sticky and nobody else can recompute them.
- **No seed anywhere.** No member, server or relay ever holds the total noise or a seed for it. T19's requirement
  ("the seed is generated and used only inside the secure aggregation") holds in the strongest form: there is no
  seed.

### The trust assumption, precisely

- **What colluders know.** A member knows its own share. A coalition C can therefore subtract Σ_{i∈C} share_i, and
  what still protects an honest member is the **honest members' shares only**.
- **The tolerance c.** Each member draws its share with shape r = 1/(m − c). With m participants and at most c
  colluders, the honest shares sum to Pólya((m−|C|)/(m−c)) ≥ Pólya(1) on each side: discrete Laplace(ε) plus
  independent extra noise, so the full **ε = 1 per item per epoch** holds.
- **Default c.** The default is c = ⌈m/3⌉ − 1, mirroring Bonawitz's collusion bound: 3 for m = 12, 6 for m = 20.
  Each member chooses c **locally** (`noiseTolerance`). No agreement is needed; the guarantee holds up to the
  smallest c any honest member used.
- **Cost.** The total noise is Pólya(m/(m − c)): variance about 1.33× the central mechanism at m = 12. Exact rates:

| m, t | Noise | P(pick \| 0 endorsers) | P(pick \| 1) | P(pick \| 2) | P(pick \| 4) |
|---|---|---|---|---|---|
| 12, 3 | central (Exp 3) | 0.036 | 0.099 | 0.269 | 0.901 |
| 12, 3 | distributed, c = 3 | 0.052 | 0.129 | 0.310 | 0.871 |
| 20, 4 | central | 0.013 | 0.036 | 0.099 | 0.731 |
| 20, 4 | distributed, c = 6 | 0.022 | 0.056 | 0.136 | 0.681 |

- **Beyond c colluders, the guarantee degrades.** In Exp 3's "collude" scenario (everyone but the target colludes,
  i.e. pure subtraction), the trusted-seed noise kept conf90 at 0%. **Distributed noise does not**: the target is
  protected only by its own share, Pólya(1/(m−c)) − Pólya(1/(m−c)), which is 0 most of the time. In that scenario,
  Exp 3's numbers do not carry over to this protocol.
- **Options to close that gap**, none implemented:
  - a much larger c, at a utility cost;
  - noise generated jointly in MPC by a few designated aggregators under an honest majority (Dwork et al.,
    Eurocrypt 2006, "Our Data, Ourselves");
  - a TEE;
  - local DP, where each member adds full noise: about m times the variance.
- **Related designs.** Kairouz, Liu & Steinke (ICML 2021) and Agarwal, Kairouz & Liu (NeurIPS 2021) use the same
  pattern (local discrete noise shares plus secure aggregation). They use the discrete Gaussian and Skellam, which
  give Rényi/approximate DP. We kept Pólya because core's policy, and Exp 3, are pure ε discrete Laplace.
- **Sampler caveat.** Pólya is sampled as Poisson(Gamma(r) · α/(1−α)) with Marsaglia–Tsang and Knuth, **in floating
  point**. The realised distribution is close (tests check P(0) and variance against theory), but it is not exact
  and has not been reviewed against floating-point attacks (Mironov, CCS 2012). Production needs an exact integer
  sampler.

## 6. Output: core's policy on the aggregate

`policy.ts` `releaseAggregatedEpoch` applies core's rules to the noised counts that come out of the sum. It uses
core's own pieces: `parseCirclePolicy`, `revealThresholdFor`, `circleMembershipId`, and the `CircleLedger` record
format.

- Fewer than `minMembers` participants → `too-few-members`, nothing published.
- Threshold on the **noised** count: 3 for k = 8–15, 4 for k ≥ 16, unless the policy sets one.
- **Picks only**, sorted by id. Noised counts are cleared in memory as soon as the picks are computed. They are
  never stored, returned or shown.
- **Epoch freeze.**
  - Asking for a released epoch again returns the stored result.
  - Older epochs are refused, and so are voided epochs.
  - Items released earlier are never picked again.
  - Members contribute only endorsements made since their last contribution.
- `circleFeedCandidates` → core `circleCandidates`, all with the same strength. `via` is
  "Name (k members)" and never names a member.

Core's own `releaseCircleEpoch` takes raw sets plus a seed, which is right for the simulation and wrong for a
deployment. **Suggested core follow-up:** move `releaseAggregatedEpoch` next to it.

**Caveat:** every device computes the noised counts for all candidates while it sums. A modified client can log
them. Within one epoch this is still ε-DP per item, because the counts *are* the mechanism's output. Across epochs
the inputs are disjoint (freeze), so differencing has nothing to work with. "Picks only" is therefore enforced by
honest clients, not by cryptography. Making it cryptographic needs the threshold comparison inside MPC; see the
list below.

## 7. Trust assumptions (summary)

1. **MLS and Marmot are correct.** Confidentiality, membership and removal all rely on them. The libraries are alpha
   and unaudited; see §1 for the bug we hit.
2. **Members are honest-but-curious about privacy, and possibly malicious about integrity.**
   - Masking hides each input from any coalition that lacks some pairwise key of the target.
   - DP holds against up to c colluders, where c is the smallest tolerance an honest member chose.
   - A malicious member can poison or veto a round (see the next list) but cannot read inputs.
3. **The admin is trusted for membership.** k counts MLS leaves, not people. An admin who adds Sybils lowers the
   number of real people behind "k ≥ 8", and the Sybils also count toward c.
4. **Honest clients enforce the rules.**
   - one contribution per epoch;
   - the endorsement cursor;
   - the floor policy;
   - picks only.

   That is enough to protect an honest member's own data. It does not stop a modified client from reading what it
   legitimately received.
5. **Devices keep the local noise secret and the ledger confidential** (T9: encrypted at rest; in memory in this
   prototype).

## 8. What is not secure yet

**Privacy:**

- More than c colluding members (or Sybils) reduce or remove the DP protection of the remaining members (§5).
- Every device sees noised counts; "picks only" is a UI rule (§6).
- **Size and timing metadata:** round messages are now padded to one size per round (§1), so their type no longer
  shows in size. The bucket, the message count (1 + 2|P|) and timing still show when rounds run and roughly how
  many took part; commits are not padded. Group membership is linkable through Marmot's plaintext `h` tags, key
  packages and Welcome `p` tags. Use OHTTP or Tor to relays; consider cover traffic.
- **Non-repudiation:** round messages are signed with identity keys (§1).
- Ephemeral X25519 secrets are overwritten after use, but JavaScript cannot guarantee zeroization.

**Integrity and liveness:**

- **No input validation.** A member can send any vector (Prio, Corrigan-Gibbs & Boneh NSDI 2017, and zero-knowledge
  range proofs are the known fixes). With that it can:
  - force picks or suppress them;
  - void any round, at will;
  - send 0/1 values outside its endorsements, or exceed `maxItemsPerMember`;
  - omit its noise share. That stays covered while the member is within the c tolerance.
- **Cross-member consistency is only partial.** The participant digest catches different views of P and different
  epochs. A sender who equivocates on masked vectors is caught only when both versions reach the same member. No
  final transcript-confirmation round exists.
- **Liveness:** one dropout after the key phase voids the epoch (§4).

**Crypto hygiene:**

- Floating-point Pólya sampling (§5).
- marmot-ts 0.5.1 lacks 0.7.0's authorization fixes. `authz.ts` re-checks them at the app layer (§1), with the
  residual gaps listed there (no MLS account proof; Welcome checked after adoption; a halted member needs a new
  invite).
- `applesauce-core` 5.2.0, a dependency of marmot-ts, pulls in `nostr-tools` 2.19.4 with `@noble/*` 1.x.
- The ts-mls version is overridden, which marmot-ts 0.5.1 never tested.
- No MIP-02 self-update after joining.

**Scope:**

- In-memory relay only; no network I/O.
- One circle per `CircleMember`.
- Ledger, local secret and MLS state live only in memory.
- Not wired into the web client.
- DP accounting across epochs is still open (ε per item per epoch; a member's loss per epoch is at most
  ε × maxItemsPerMember).

## 9. What an audit must cover

1. **The MLS layer as deployed.**
   - The marmot-ts version and its ts-mls; MIP-00..03 conformance.
   - Removal: a commit with a single Remove must carry an UpdatePath (the bug in §1). Proposals and commits
     authorized against admin lists and the parent state. Welcome author validation.
   - Exporter use.
   - Or the plan to move to MDK (Rust), the audited path, per OSS_STACK.md.
2. **The masking construction.**
   - Key and mask derivation: HKDF salts and info, ChaCha20 used as a PRG with a zero nonce and one key per stream.
   - Ordering and sign conventions; mod-2^32 arithmetic.
   - The participant digest.
   - Replay and cross-round binding (roundId, epoch, round context).
   - Low-order key handling.
   - That no code path re-masks or re-sends in an epoch.
3. **The void and freeze logic.**
   - That a withheld vector can never yield a second output for the same inputs.
   - Behaviour when two rounds open in one epoch, when keys arrive late or are duplicated, under clock skew and
     reordering, and when commits land mid-round.
4. **The DP argument.**
   - The Pólya-share proof (Goryczka & Xiong Thm 5.1) as applied: per-member shape 1/(m − c).
   - The c-collusion claim, and what happens beyond c.
   - Sensitivity: 0/1 per candidate and ≤ maxItemsPerMember candidates per member.
   - Composition across epochs.
   - An exact sampler replacing the floating-point one.
5. **Message parsing.** Size-before-parse, strict keys, video-id rule, signature verification on fresh objects
   (T25), the membership check of signers, the sender-leaf binding, and the padding rule (exact bucket length,
   only trailing spaces).
6. **The app-level authorization guards** (`authz.ts`): the parent-state tracking across `ingest()` yields, the
   non-admin "self-update only" rule, the fail-closed halt, and the Welcome author check after adoption.
7. **Supply chain.**
   - `@internet-privacy/marmot-ts`, `ts-mls` and their transitive dependencies (`applesauce-*`, `@hpke/core`,
     duplicated `nostr-tools` and `@noble` 1.x).
   - The npm override.
   - `ignore-scripts`.

## 10. Sources

Verified on 2026-10-19 unless marked.

- K. Bonawitz et al., "Practical Secure Aggregation for Privacy-Preserving Machine Learning", ACM CCS 2017.
  https://eprint.iacr.org/2017/281
- S. Goryczka, L. Xiong, "A Comprehensive Comparison of Multiparty Secure Additions with Differential Privacy",
  IEEE TDSC 14(5):463–477, 2017. DOI 10.1109/TDSC.2015.2484326. https://pmc.ncbi.nlm.nih.gov/articles/PMC5598559
  (§5.2, Theorem 5.1: two-sided geometric noise as a sum of Pólya(1/n) differences).
- P. Kairouz, Z. Liu, T. Steinke, "The Distributed Discrete Gaussian Mechanism for Federated Learning with Secure
  Aggregation", ICML 2021, PMLR 139:5201–5212. https://proceedings.mlr.press/v139/kairouz21a.html
- N. Agarwal, P. Kairouz, Z. Liu, "The Skellam Mechanism for Differentially Private Federated Learning",
  NeurIPS 2021. https://arxiv.org/abs/2110.04995
- E. Shi, T.-H. H. Chan, E. Rieffel, R. Chow, D. Song, "Privacy-Preserving Aggregation of Time-Series Data",
  NDSS 2011. Distributed noise robust to a compromised subset.
  https://www.ndss-symposium.org/ndss2011/privacy-preserving-aggregation-of-time-series-data/
- [not re-verified this session] C. Dwork et al., "Our Data, Ourselves: Privacy via Distributed Noise Generation",
  EUROCRYPT 2006. H. Corrigan-Gibbs, D. Boneh, "Prio", NSDI 2017. J. Bell et al., "Secure Single-Server Aggregation
  with (Poly)Logarithmic Overhead", CCS 2020. C. Canonne, G. Kamath, T. Steinke, "The Discrete Gaussian for
  Differential Privacy", NeurIPS 2020. I. Mironov, "On Significance of the Least Significant Bits for Differential
  Privacy", CCS 2012 (already cited by core).
- RFC 9420 (MLS) §8.5 exporter and §12.4 commit path. RFC 7748 (X25519). RFC 5869 (HKDF). RFC 8439 (ChaCha20).
- marmot-ts CHANGELOG 0.7.0 and the README alpha warning (npm, 2026-10-19). ts-mls source for 2.0.0-rc.10,
  rc.16 and 1.6.4 (npm tarballs).

## 11. Follow-ups for other documents

Done in the 2026-10-19 docs pass (PROTOCOL.md §3 and the Circles section, THREAT_MODEL.md T3/T19/T20 and the new
Circles threats, DESIGN.md implementation status and open questions). Still open: the core move below.


- **PROTOCOL.md §3:**
  - record the chosen aggregation (pairwise masking, distributed Pólya noise, public candidate domain);
  - add kinds 3480–3482;
  - add the void rule: a failed round consumes its epoch.
- **THREAT_MODEL:**
  - **T19:** implemented in prototype form (no seed exists), with the c-collusion caveat.
  - **T20:** not used by Circles (HKDF and ChaCha20 replace it), but the sampler is still floating point.
  - **T3:** the Exp 3 "collude" result does not hold beyond c colluders under distributed noise.
  - **New:** the ts-mls rc.10 single-Remove path bug; malicious-input poisoning; size and timing metadata of round
    messages.
- **DESIGN.md:** in "Implementation status", the Circles row; in "Open questions", the aggregation choice is made
  for the prototype.
- **Core:** move `releaseAggregatedEpoch` next to `releaseCircleEpoch`.
