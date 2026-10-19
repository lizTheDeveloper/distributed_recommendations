# Match Feed: wire formats and protocol

Status: draft v1, 2026-10-19, revised the same day to apply `SIMULATION_RESULTS.md`. Companion to `DESIGN.md` and `THREAT_MODEL.md`.
The reference implementation is `packages/core` (TypeScript, no dependencies).
Where this document and the code disagree, that is a bug; file it against both.

## Conventions

- All formats are UTF-8 JSON objects with a version field (`version` or `v`). This document defines version 1 of each.
- **Receivers reject unknown keys.** A new field means a new version. This keeps untrusted input auditable (T1) and stops "extension" fields from smuggling data.
- Receivers enforce a size limit **before** `JSON.parse`.
- A video is identified by its **canonical URL**: the watch-page URL on its origin instance, as PeerTube's `url` field gives it (e.g. `https://tube.tchncs.de/videos/watch/7516913d-…`). The same video federated to many instances keeps one id.
  - Ids are sent in the clear *inside* end-to-end encryption. Hashing them would add no privacy, because the catalog is enumerable (DESIGN.md, "Privacy facts").
- Timestamps on the wire are integer Unix seconds.
- Strings shown to users must not contain control characters or bidi overrides (U+0000–U+001F, U+007F–U+009F, U+202A–U+202E, U+2066–U+2069).

| Object | Version field | Max size | Code |
|---|---|---|---|
| Feed recipe | `version: 1` | 16 KiB | `parseRecipe`, `parseRecipeJson` |
| Taste sketch | `v: 1` | exactly 8,192 / 15,872 bytes over NIP-17; also 31,232 over MLS | `buildSketch`, `decodeSketch`, `validateSketch` |
| Circle policy | `v: 1` | (small, fixed keys) | `parseCirclePolicy` |
| Preview policy | `v: 1` | (small, fixed keys) | `parsePreviewPolicy` |

## 1. Feed recipe

A recipe is **declarative data only** (decision D1). It is never evaluated as code. The client applies it to candidate lists, never to raw history.

### Fields

| Field | Type | Range / limit | Default | Meaning |
|---|---|---|---|---|
| `version` | number | must be `1` | required | |
| `name` | string | 1–80 chars | required | shown in the recipe picker |
| `author` | string | 1–120 chars | absent | free text, e.g. a handle |
| `weights` | object | keys ⊆ `follow`, `taste`, `match`, `circle`, `second`, `explore`; each 0–10 | missing keys = 0 | weight per source kind; 0 turns a source off |
| `recencyHalfLifeDays` | number | 0–3650 | required | recency half-life; 0 = no decay |
| `exploreShare` | number | 0–0.5 | required | share of slots reserved for explore. **Recommended 0.02–0.10, default 0.05**; 0 turns explore off. Clients should offer only 2–10% (`EXPLORE_SHARE`) |
| `maxPerCreator` | integer | 1–100 | required | most items per creator in one page |
| `maxPerTasteList` | integer | 1–100 | absent = 2 | most items any one taste list (one `via`) contributes to one page |
| `filters.excludeTags` | string[] | ≤ 64 items, each ≤ 64 chars | `[]` | case-insensitive |
| `filters.includeLanguages` | string[] | ≤ 32 items, BCP 47-like (`en`, `pt-BR`) | `[]` = any | `en` also matches `en-GB`. Videos with no language pass |
| `filters.minDurationSec` | integer | 0–86400 | 0 | |
| `filters.maxDurationSec` | integer or `null` | 1–86400, ≥ min | `null` = no limit | |
| `filters.excludeCreators` | string[] | ≤ 256 handles `name@host` | `[]` | case-insensitive |

`filters` itself is optional; so are all of its keys.

`maxPerTasteList` was added to v1 after the simulation (Exp 5), before any client shipped; it is optional so v1 recipes without it stay valid. Receivers built before it reject recipes that carry it, which is the usual "new field" rule. Treat it as part of v1 from now on.

### Ranking semantics (`rank`)

1. Candidates for the same video merge. Each distinct source (kind + `via`) adds
   `weight[kind] × strength × 0.5^(ageDays / recencyHalfLifeDays)`, with `strength` clamped to [0, 1] (default 1). A repeated source counts once, at its highest strength.
2. Filters, the viewer's `seen` set and `maxPerCreator` apply to every slot, explore included.
   - **Taste-list cap.** Each taste list (one `via`; unnamed taste sources count as one list) contributes to at most `maxPerTasteList` videos (default 2): the ones with the highest total score, so items the viewer's matches also like go first. Other videos lose that list's contribution but keep any other sources. Simulation Exp 5: the cap cut the reach of a Sybil-inflated list from 54% of its subscribers to 2%, and raised precision under a list-heavy mix.
   - **List strength = track record.** A taste source's `strength` should come from the list's track record with this viewer (`tasteListStrength`: the list's smoothed endorse rate over the viewer's baseline rate, clamped to [0, 1], starting at 0.5), never from its subscriber count, which Sybils can inflate.
3. The chip (`primary`) is the kind with the largest summed contribution; ties go to `follow`, `match`, `circle`, `taste`, `second`, in that order.
4. **Explore slots.** With `exploreShare > 0` and `weights.explore > 0`:
   - period `p = max(2, round(1 / exploreShare))`; slot `i` (0-based) is an explore slot when `i mod p = floor(p / 2)`. At the default 0.05 that is slots 10, 30, 50, …; at 0.10, slots 5, 15, 25, …
   - eligible: videos whose **only** source is `explore`, by a creator the viewer doesn't follow, at most 14 days old
   - explore items compete only with each other. They are **ranked by on-device relevance** whenever a relevance signal exists: the caller's `exploreRelevance(video)` scorer (e.g. `tagRelevance(tagProfile(history))`, the cosine between the viewer's tag profile and the video's tags), or else an explicit `strength` on explore sources. Ties break by a seeded random draw. The relevance signal never leaves the device.
   - with no relevance signal at all, explore falls back to a seeded random pick among the newest `max(8, 4 × slots)` eligible videos. Simulation Exp 2: random explore cost about 0.7% P@20 per point of share; relevance-ranked explore cost about nothing up to 10%.
   - if one pool runs dry, the other fills its slots
5. Ties in score break by newer `publishedAt`, then by id. Given the same RNG state the output is deterministic.

### Explanations

Every ranked item carries `why` lines (THREAT_MODEL principle 3). Second-degree and circle lines **never name a person**: the ranker ignores `via` on `second` sources, and circle sources name only the circle.

### Example (the built-in default)

```json
{
  "version": 1,
  "name": "Following + matches",
  "author": "Match Feed",
  "weights": { "follow": 4, "taste": 0.9, "match": 6, "circle": 6, "second": 6, "explore": 1 },
  "recencyHalfLifeDays": 14,
  "exploreShare": 0.05,
  "maxPerCreator": 2
}
```

How the weights follow the simulation (details in `recipe.ts`). The simulator scaled each signal to [0, 1] and mixed `peer + 0.15 × lists + 0.1 × follows`. Recipe weights multiply strengths in [0, 1], so a simulator weight maps to that weight × the match weight:
- `taste` 0.9 = 0.15 × 6. The taste-heavy mix (lists 0.6, i.e. 3.6 here; the old default was 3) lost 16% P@20 and concentrated exposure (Exp 1).
- `second` 6 = the match weight. The 0.3 decay is applied once, inside the trust walk (section 5), which reports trust on the scale of match similarity. A lower recipe weight would apply the decay twice.
- `follow` 4 is a product choice, not from the simulator (whose synthetic follows don't predict endorsements).
- `exploreShare` 0.05 (Exp 2).

The other built-in recipe, "Following only, newest first", sets only `follow: 1`, with no decay and no explore share.

### Distribution

Community recipes are public. Publish them as signed Nostr events with the recipe JSON as `content`. The event kind is not assigned yet; use an addressable kind (30000–39999) so authors can update a recipe in place. Clients show the author and a diff before applying an update.

## 2. Taste sketch

What one match sends the other: video ids from the sender's local history, filtered by that sender's consent settings for this match.

```json
{
  "v": 1,
  "epoch": 7,
  "issuedAt": 1792411200,
  "expiresAt": 1793620800,
  "nonce": "<64 hex chars>",
  "items": ["https://tube.example/videos/watch/…", "<64 hex chars>", "…"],
  "padding": "<hex>"
}
```

| Field | Rule |
|---|---|
| `v` | `1` |
| `epoch` | integer ≥ 1, strictly increasing per sender and match |
| `issuedAt`, `expiresAt` | Unix seconds; `0 < expiresAt − issuedAt ≤ 30 days` (default 14) |
| `nonce` | 32 random bytes, lowercase hex |
| `items` | length is exactly **64 or 128** over NIP-17, or **64, 128 or 256** over MLS (the bucket); unique; each is a real id (`http(s)://…`, ≤ 512 chars) or a padding nonce |
| `padding` | lowercase hex; sized so the encoded sketch is exactly the bucket's byte size |

The encoding is `JSON.stringify` with keys in the order above (`encodeSketch`).

### Padding

The goal is that a sketch shows only its bucket on the wire, not how many items it holds or how long their URLs are (T5).

- **Item padding.** `items` is filled up to the bucket size with nonces: 64 lowercase hex characters (32 random bytes). A nonce can't collide with a real id, because real ids are URLs. Receivers drop nonces (`sketchItems`). The list is then shuffled, so position reveals nothing.
- **Byte padding.** `padding` brings the UTF-8 encoding to exactly `512 + 120 × bucket` bytes:

  | Bucket | Encoded size |
  |---|---|
  | 64 | 8,192 bytes |
  | 128 | 15,872 bytes |
  | 256 | 31,232 bytes (MLS / circle transport only) |

  If long URLs overflow a bucket, the sender moves to the next one. If the transport's largest bucket (128 for NIP-17, 256 for MLS) still overflows, it drops its oldest items.
- After encryption, NIP-44's own padding rounds again; that's fine, because the input sizes are already fixed.
- What still leaks: the bucket (0–64 or 65–128 items; over MLS also 129–256), and the send schedule unless clients send on a fixed one.

### Building (sender)

Inputs: the local history (`{videoId, at, kind: "endorse" | "finish", tags}`) and the per-match consent (DESIGN.md, Match protocol step 2):

| Consent | Default | Effect |
|---|---|---|
| `windowDays` | 60 | only events in the rolling window |
| `includeFinished` | false | endorsements only, unless the user opts in to finished watches (≥ 80%) |
| `excludedTags` | `[]` | one matching event withholds the video entirely |
| `excludedHours` | `[]` | local hours of day; one event in those hours withholds the video entirely |
| `excludedVideos` | `[]` | per-match exclusions |
| `paused` | false | quiet pause, below |

Items are ordered newest first before the transport's cap (128 over NIP-17, 256 over MLS), then shuffled. `buildSketch` takes `transport: "nip17" | "mls"`, default `nip17`.

**Quiet pause (D2).** While paused, the client keeps sending on its normal schedule. Each sketch carries the *same real items* as the last one sent (minus any newly excluded videos), in a fresh envelope: new epoch, expiry, nonce, padding and shuffle. A peer sees on-schedule sketches whose content has stopped changing, and nothing on the wire says "paused". Re-sending the old sketch byte for byte would fail the receiver's epoch check and then expire, which would be a tell. A paused match that has never sent anything sends all-padding sketches.

### Validating (receiver)

`validateSketch` / `decodeSketch` reject a sketch when:
- the text is larger than the transport's largest sketch (15,872 bytes for `transport: "nip17"`, 31,232 for `mls` or when the transport is not given; checked before parsing), or the encoding exceeds its bucket's size
- `items` is the 256 bucket and the transport is `nip17`
- keys are missing or unknown, or the version isn't 1
- `items` isn't a bucket size, has duplicates, or holds anything other than a URL or a nonce
- `issuedAt` is more than 300 s in the future, or `expiresAt` is past, not after `issuedAt`, or more than 30 days after it
- `epoch` ≤ the last epoch accepted from this sender (replay, T15)

### Transport: 1:1 over NIP-17

Per DESIGN.md, Match protocol step 3:

- **Wrapping.** The encoded sketch is the `content` of an unsigned rumor, sealed (kind 13) and gift-wrapped (kind 1059) per NIP-59, with NIP-44 v2 encryption. The rumor kind is application-specific and not assigned yet.
- **Expiry.** The gift wrap carries a NIP-40 `expiration` tag equal to `expiresAt`.
- **Keys.**
  - Sketches go to a per-match key, not the identity key.
  - NIP-44 has no forward secrecy, so per-match keys rotate at least every 90 days (match expiry), and at once on revocation (T10).
- **Schedule and relays.**
  - Send on a fixed schedule (weekly by default) whether or not anything changed.
  - Pick relays at random from the peer's inbox relays.
  - Use Oblivious HTTP to relays where available (T5).
- **Size check.** NIP-44 v2 plaintext is limited to 65,535 bytes, and many relays default to a 64 KiB event limit.
  - **NIP-17 sketches stop at the 128 bucket** (15,872 bytes, a gift wrap of about 33 KB). Senders keep the newest 128 items; receivers pass `transport: "nip17"` and reject the 256 bucket.
  - The 256 bucket (31,232 bytes) would gift-wrap to about 66 KB, over that relay limit, so it is used only over MLS (circle transport), where message size is the group's own concern.
  - Why not the alternatives: splitting a sketch into two fixed-size parts doubles the events and adds a reassembly state machine; shrinking the per-item byte budget for 256 would force long-URL senders down to fewer items anyway. The newest 128 endorsements carry most of the similarity signal, and nothing in `SIMULATION_RESULTS.md` argues for larger 1:1 sketches (simulated viewers average about 18 endorsements).
- **Receiving.**
  - Unwrap, check the seal's author is the expected per-match key, then `decodeSketch`.
  - Score with `sketchSimilarity` (Jaccard or set cosine over the real items).

## 3. Circles

### Transport

- Circles run over MLS (RFC 9420) via the Marmot protocol (MLS over Nostr) [DESIGN N2, N3]. MLS gives circles forward secrecy and post-compromise security.
- NIP-17 is not used for groups. It advises against groups larger than about 10, and circles need k ≥ 8.

### Rounds

1. A round binds to one MLS epoch, so membership is fixed for the round. **Each epoch is released once** (`releaseCircleEpoch`).
2. **Epoch freeze.** After a membership change, a past epoch is never recomputed or re-released: asking again returns the stored result, and an epoch older than the newest released one is refused. The new epoch pools only endorsements made during it, and items released in earlier epochs are not evaluated again. Simulation Exp 3: an epoch delay with sticky noise but no freeze still let differencing expose 15–22% of a leaving member's endorsements at k = 8–12; with the freeze, differencing and averaging reduce to a single release.
3. Members contribute their endorsement sets **through secure aggregation** [DESIGN A12]. No member, and no server, sees another member's raw set. The aggregation protocol is not chosen yet (research item). `circlePicks` in `packages/core` is the post-aggregation policy layer: simulations call it on raw sets, while deployments call it on the aggregate, ideally with the noise added inside the aggregation.
4. Members who drop out count as absent. If fewer than `minMembers` are present, the round publishes nothing.

### Circle policy

Agreed in the MLS group context; every client validates it and refuses to take part if it's out of range.

```json
{ "v": 1, "minMembers": 8, "epsilon": 1, "maxItemsPerMember": 64 }
```

| Field | Range | Meaning |
|---|---|---|
| `minMembers` | integer 8–10000 | present members needed for a round. **The floor of 8 can't be lowered.** Recommended circle size is **12–30** (`CIRCLE_RECOMMENDED_SIZE`) |
| `revealThreshold` | integer 2–`minMembers`, **optional** | a pick is shown only if its *noised* count reaches this. Absent: derived from the present member count, **3 for k = 8–15, 4 for k ≥ 16** (`revealThresholdFor`; Exp 3 tested up to 30) |
| `epsilon` | 0.01–5 | per-item, per-epoch discrete-Laplace noise parameter. **Recommended 1**: at ε ≤ 2 colluders never reach 90% confidence; ε = 0.5 costs too much precision at k = 8–12 |
| `maxItemsPerMember` | integer 1–256 | a member's contribution per round is truncated to this many items |

### Output

- Each item's count gets two-sided geometric noise with `P(k) ∝ exp(−ε·|k|)`.
- **Sticky noise.** The noise for an item is derived from a secret per-epoch seed and the video id (SHA-256 in counter mode, `keyedRng`), so the same item gets the same draw for the whole epoch and repeated releases can't be averaged. The seed must stay inside the secure aggregation: a member who knows it can recompute and subtract the noise.
- **Picks only, never counts.** The output is the set of video ids whose noised count reaches the threshold, sorted by id (so order carries no count information). Simulation Exp 3: noisy counts plus one membership change expose 49–94% of a member's endorsements whatever ε is, because the noise cancels in the difference. `CirclePick.noisedCount` is deprecated and never populated.
- Privacy: ε is per item per epoch. Each member's loss per epoch is at most `ε × maxItemsPerMember` under basic composition.
- Thresholding happens on the noised count, so a one-person pick can still appear, with small probability: about 10% per item at ε = 1 and threshold 3. That is deliberate: it is what makes any shown pick deniable.
- In the feed, circle picks become `circle` candidates, all with the same `strength` (`CIRCLE_PICK_STRENGTH`, 0.5). `via` names the circle and member count, never a member.

## 4. Match previews (PSI-cardinality)

A preview tells a requester roughly how many videos they have in common with a target (DESIGN.md, Match protocol step 1). Simulation Exp 4 changed this from the draft:

- One **exact** cardinality answers "did they watch X?" with certainty, so the requester never sees the exact count.
- The **minimum set size is not a defense**: the catalog is open, so a prober pads any probe with its own never-watched uploads. `minSetSize` stays only as hygiene.
- Floors and buckets alone fail against a prober who knows 4 of the target's items.
- What bounds the attack: **DP noise (discrete Laplace, ε = 0.5) with a floor of 5**, plus a **target-side budget of at most 8 accepted previews per rolling year, from all requesters together**. After 8 such previews the prober's AUC is 0.68–0.83 and nothing is inferred at ≥ 90% confidence, even with 4 known items.

The crypto is OpenMined PSI behind the `PsiCardinality` interface. The **target** is the party that learns the cardinality, so it can noise it before anything leaves its device:

1. The target calls `createRequest(targetItems)` and sends the request.
2. The requester calls `answerRequest(request, requesterItems)`, which returns `{setup, response}`.
3. The target calls `intersectionSize(setup, response)`, then `noisyPreviewCardinality(size, cryptoRng(), policy)`, and sends back only that result.

The requester learns `{belowFloor, value?, bucket, label}`: "<5" below the floor, otherwise the noised value and a coarse bucket ("a few" 5–9, "some" 10–19, "a lot" 20+). UIs show the bucket. The target learns the exact |A ∩ B| for a probe it did not choose, plus |B|.

### Flow

1. The requester sends a preview request (id, requester, target).
2. The target's device checks the limits, then asks the user. **Acceptance is mandatory**, and accepting is refused (`target-budget`) once the target has accepted `maxAcceptedPerTargetPerYear` previews in the last 365 days, from anyone (`previewBudgetRemaining`).
3. On acceptance, both devices check set sizes. Then a single PSI run happens, the target noises the result, and the request is marked `done`.

The **target's device** enforces acceptance, the yearly budget, the noise, minimum set size and the per-pair limit, because it simply refuses to answer. The budget must be counted there: requesters are cheap to create, so per-requester and per-pair limits don't stop Sybils. The per-requester limit can only be enforced by an honest requester client. Request and response messages travel like sketches (NIP-17); their schemas will be fixed when PSI is integrated.

### Preview policy

```json
{ "v": 1, "minSetSize": 20, "maxPerPairPerWeek": 1, "maxPerRequesterPerWeek": 5, "acceptWindowSec": 604800,
  "maxAcceptedPerTargetPerYear": 8, "epsilon": 0.5, "floor": 5 }
```

| Field | Range | Meaning |
|---|---|---|
| `minSetSize` | integer ≥ 20 | both sets need at least this many items. **The floor of 20 can't be lowered.** Hygiene only, not a privacy defense (Exp 4) |
| `maxPerPairPerWeek` | 1–7 | requests per *unordered* pair per rolling 7 days, whatever their outcome (declines count) |
| `maxPerRequesterPerWeek` | 1–50 | requests a requester may start per rolling 7 days |
| `acceptWindowSec` | 60 – 30 days | a request must be accepted, and run, within this window |
| `maxAcceptedPerTargetPerYear` | integer 1–8, optional (absent = 8) | accepted previews per target per rolling 365 days, across all requesters. **Can't be raised above 8** |
| `epsilon` | 0.05–0.5, optional (absent = 0.5) | discrete-Laplace parameter of the cardinality noise. **Can't be raised above 0.5** |
| `floor` | integer 5–100, optional (absent = 5) | noised values below this are reported only as `<floor`. **Can't be lowered below 5** |

The last three fields were added to v1 after the simulation, before any client shipped; they are optional so earlier v1 policies stay valid, and `parsePreviewPolicy` always fills them.

State is a list of `{id, requester, target, requestedAt, status, acceptedAt?}`, where `status` is `pending`, `accepted`, `declined` or `done`. Records older than 7 days are pruned, except accepted ones, which count against the target's budget and are kept for 365 days after `acceptedAt`. All transitions are pure functions (`requestPreview`, `respondToPreview`, `startPreviewRun`, `prunePreviews`, `previewBudgetRemaining`).

## 5. Second degree

- Second-degree weights come from `trustWalk`: a personalized, decaying, **row-normalized** trust walk seeded from the viewer [DESIGN A14, A15]. Defaults (`TRUST_WALK_DEFAULTS`) follow simulation Exp 5, policy P1: **decay 0.3, 2 hops, per-node cap 0.05 of the viewer's trust mass**. Under naive 3-hop path counting, 200 attack edges reached 779 bystanders; under this walk, 0–3.
  - A direct match's trust is its similarity (edge weight).
  - Each further hop multiplies by `damping` (0.3) and splits a node's trust across its outgoing edges in proportion to their weights, so a node with many matches (or a Sybil front) can't multiply its influence.
  - No node beyond the first hop holds more than `perNodeCap` (0.05) of the viewer's total trust mass (the sum of the viewer's edge weights). Direct matches count once.
  - Only nodes that opted in to relaying (`relays`) pass trust onward.
  - `normalize: false` restores the pre-simulation walk (damping and cap then apply as before).
  - Because the walk already applies the decay, the default recipe weighs `second` equal to `match`.
- Videos endorsed by nodes two or more hops out become `second` candidates with `strength` = summed trust, capped at 1. They are never attributed.
- How a match relays its matches' picks on the wire (an aggregated, unattributed list inside the sketch channel) is not specified yet.

## Open questions

- ~~**Relay size limits.**~~ Resolved: NIP-17 sketches are capped at the 128 bucket (about 33 KB wraps); the 256 bucket is for MLS / circle transport only (section 2, "Size check").
- **First-hop Sybils.** A viewer who matches a mirroring Sybil sees its picks almost every time (Exp 5). Candidate mitigations, not simulated: per-source trust learned from feedback, a per-match cap on items per feed, attribution and one-tap unmatch.
- **Circle DP accounting across epochs** (not simulated): ε is per item per epoch.
- **Event kinds** for recipes, sketch rumors and preview messages.
- **Circle secure aggregation**: which protocol, and whether the DP noise is added inside it (preferred) or after.
- **Wire format for second-degree relay lists.**

---

<!-- BEGIN section added by packages/match (2026-10-19). PROVISIONAL. -->
## 6. Match messages (provisional; added by `packages/match`)

This section fixes the event kinds and the message schemas that sections 2 and 4 left open. Design and key scheme: `MATCH.md`. Code: `packages/match/src/messages.ts`, `kinds.ts`, `wrap.ts`.

### Kinds

Rumor kinds, **provisional and unregistered**. The NIP registry listed no kinds in 3000–3999 on 2026-10-19. They are regular kinds (NIP-01), and they never appear outside a gift wrap.

| Kind | Message | Sealed by | Wrapped to (`p`) |
|---|---|---|---|
| 3470 | match-request | requester identity | target identity |
| 3471 | match-accept | target identity | requester match key |
| 3472 | preview-request | requester match key | target identity (or match key once known) |
| 3473 | preview-response | target identity (match key once active) | requester match key |
| 3474 | preview-answer | requester match key | target identity (or match key once known) |
| 3475 | preview-result | target identity (match key once active) | requester match key |
| 3476 | sketch (§2 format, unchanged) | sender match key | peer match key |
| 3477 | renew | sender's current match key | peer's current match key |
| 3478 | revoke | sender match key (identity if the sender never announced one) | peer match key (identity if unknown) |

Rule: seal with my match key once I've announced it; send to the peer's match key once I know it; otherwise use the identity. Receivers accept a control message sealed by the peer's identity, current match key, or previous match key (for 14 days after a rotation). They accept sketches only from the peer's match keys, and only at their own match keys.

### Envelope

- Rumor: `{kind, created_at = now, tags: [], content, pubkey = seal key}`, with `id` = NIP-01 hash.
- Seal: kind 13, `tags: []`, `content` = NIP-44 v2 encryption of the rumor JSON to the recipient, `created_at` = now minus up to 2 days (random).
- Gift wrap: kind 1059, signed by a one-time key, `tags: [["p", recipient], ["expiration", t]]`, `created_at` jittered the same way.
  - `t` = the sketch's `expiresAt` for sketches, `now + 14 days` for control messages. Both are 14 days by default.
- The wrap's JSON must be ≤ 65,536 bytes. NIP-44 plaintexts ≤ 65,535 bytes.

### Control-message rules

- UTF-8 JSON, `v: 1`, keys exactly as listed and in that order, then `padding`.
- `padding` is a string of `"0"` that makes the encoding **exactly 8,192 bytes** (the 64-bucket sketch size). Receivers check the size before parsing.
- Unknown or missing keys are rejected.
- Ids (`matchId`, `previewId`, `renewId`) and keys are 64 lowercase hex characters; ids are random 32-byte values.
- `issuedAt`: integer Unix seconds. Receivers reject messages older than 14 days or more than 300 s in the future.

| Message | Fields after `v`, `matchId`, `issuedAt` | Rules |
|---|---|---|
| match-request | `matchKey`, `durationDays` | `durationDays` 1–90. `matchId` is new to the target. The target may hold only one live match per peer |
| match-accept | `matchKey`, `expiresAt` | `issuedAt < expiresAt ≤ issuedAt + durationDays × 86,400` (and ≤ 90 days). Must arrive within 7 days of the request |
| preview-request | `previewId` | only while the match is pending; checked with core `requestPreview` on the target |
| preview-response | `previewId`, `accept`, `psiRequest` | `psiRequest`: base64 PSI request when `accept`, `""` when not. A spent target budget is sent as `accept: false` |
| preview-answer | `previewId`, `setSize`, `psiSetup`, `psiResponse` | base64; `setSize` = requester's real item count (self-reported, hygiene only) |
| preview-result | `previewId`, `floor`, `belowFloor`, `value` | `floor` 5–100. `value` is `null` when `belowFloor`, else an integer ≥ `floor`. It is the **noised** count (`noisyPreviewCardinality`); the exact count is never sent |
| renew | `renewId`, `role`, `matchKey`, `expiresAt` | `role` is `propose` or `accept`. A proposal's `expiresAt` ≤ `issuedAt` + 90 days. An accept echoes the proposal's `renewId` and `expiresAt`. `matchKey` is the sender's *next* key. If both sides propose at once, the smaller `renewId` wins |
| revoke | — | ends the match or withdraws a request; carries no reason |

### PSI messages (§4)

- PSI is OpenMined PSI, cardinality-only (`reveal_intersection = false`), GCS setup with fpr 1e-9.
- **Both sets are padded to exactly 128 items** with random 64-hex nonces (the newest 128 real items are kept). So the PSI messages reveal no set sizes, and each fits one control message.
- Order of play:
  1. The target creates the request (it is the PSI client).
  2. The requester answers with setup and response (the PSI server). It refuses requests with more than 128 elements, or with `reveal_intersection` set.
  3. The target computes |A ∩ B|, runs core `startPreviewRun`, then sends `noisyPreviewCardinality`'s output.
<!-- END section added by packages/match -->
