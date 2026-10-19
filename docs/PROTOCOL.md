# Match Feed: wire formats and protocol

Status: draft v1, 2026-10-19. Companion to `DESIGN.md` and `THREAT_MODEL.md`.
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
| Taste sketch | `v: 1` | exactly 8,192 / 15,872 / 31,232 bytes | `buildSketch`, `decodeSketch`, `validateSketch` |
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
| `exploreShare` | number | 0–0.5 | required | share of slots reserved for explore |
| `maxPerCreator` | integer | 1–100 | required | most items per creator in one page |
| `filters.excludeTags` | string[] | ≤ 64 items, each ≤ 64 chars | `[]` | case-insensitive |
| `filters.includeLanguages` | string[] | ≤ 32 items, BCP 47-like (`en`, `pt-BR`) | `[]` = any | `en` also matches `en-GB`. Videos with no language pass |
| `filters.minDurationSec` | integer | 0–86400 | 0 | |
| `filters.maxDurationSec` | integer or `null` | 1–86400, ≥ min | `null` = no limit | |
| `filters.excludeCreators` | string[] | ≤ 256 handles `name@host` | `[]` | case-insensitive |

`filters` itself is optional; so are all of its keys.

### Ranking semantics (`rank`)

1. Candidates for the same video merge. Each distinct source (kind + `via`) adds
   `weight[kind] × strength × 0.5^(ageDays / recencyHalfLifeDays)`, with `strength` clamped to [0, 1] (default 1). A repeated source counts once, at its highest strength.
2. Filters, the viewer's `seen` set and `maxPerCreator` apply to every slot, explore included.
3. The chip (`primary`) is the kind with the largest summed contribution; ties go to `follow`, `match`, `circle`, `taste`, `second`, in that order.
4. **Explore slots.** With `exploreShare > 0` and `weights.explore > 0`:
   - period `p = max(2, round(1 / exploreShare))`; slot `i` (0-based) is an explore slot when `i mod p = floor(p / 2)`. At 0.10, that is slots 5, 15, 25, …
   - eligible: videos whose **only** source is `explore`, by a creator the viewer doesn't follow, at most 14 days old
   - explore items compete only with each other: a seeded random pick among the newest `max(8, 4 × slots)` eligible videos
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
  "weights": { "follow": 4, "taste": 3, "match": 6, "circle": 6, "second": 1.8, "explore": 1 },
  "recencyHalfLifeDays": 14,
  "exploreShare": 0.1,
  "maxPerCreator": 2
}
```

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
| `items` | length is exactly **64, 128 or 256** (the bucket); unique; each is a real id (`http(s)://…`, ≤ 512 chars) or a padding nonce |
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
  | 256 | 31,232 bytes |

  If long URLs overflow a bucket, the sender moves to the next one. If 256 still overflows, it drops its oldest items.
- After encryption, NIP-44's own padding rounds again; that's fine, because the input sizes are already fixed.
- What still leaks: the bucket (0–64, 65–128 or 129–256 items), and the send schedule unless clients send on a fixed one.

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

Items are ordered newest first before the cap of 256, then shuffled.

**Quiet pause (D2).** While paused, the client keeps sending on its normal schedule. Each sketch carries the *same real items* as the last one sent (minus any newly excluded videos), in a fresh envelope: new epoch, expiry, nonce, padding and shuffle. A peer sees on-schedule sketches whose content has stopped changing, and nothing on the wire says "paused". Re-sending the old sketch byte for byte would fail the receiver's epoch check and then expire, which would be a tell. A paused match that has never sent anything sends all-padding sketches.

### Validating (receiver)

`validateSketch` / `decodeSketch` reject a sketch when:
- the text is larger than 31,232 bytes (checked before parsing), or the encoding exceeds its bucket's size
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
- **Size check.** NIP-44 v2 plaintext is limited to 65,535 bytes.
  - With 120 bytes per item, the largest sketch (31,232 bytes) gives a seal of about 44.1 KB, so it fits under double wrapping.
  - The resulting gift-wrap event is about 66 KB. That is above the 64 KiB event limit some relays default to (see open questions).
- **Receiving.**
  - Unwrap, check the seal's author is the expected per-match key, then `decodeSketch`.
  - Score with `sketchSimilarity` (Jaccard or set cosine over the real items).

## 3. Circles

### Transport

- Circles run over MLS (RFC 9420) via the Marmot protocol (MLS over Nostr) [DESIGN N2, N3]. MLS gives circles forward secrecy and post-compromise security.
- NIP-17 is not used for groups. It advises against groups larger than about 10, and circles need k ≥ 8.

### Rounds

1. A round binds to one MLS epoch, so membership is fixed for the round.
2. Membership changes take effect only after an epoch delay. Members can't diff consecutive rounds around a join or leave (T3).
3. Members contribute their endorsement sets **through secure aggregation** [DESIGN A12]. No member, and no server, sees another member's raw set. The aggregation protocol is not chosen yet (research item). `circlePicks` in `packages/core` is the post-aggregation policy layer: simulations call it on raw sets, while deployments call it on the aggregate, ideally with the noise added inside the aggregation.
4. Members who drop out count as absent. If fewer than `minMembers` are present, the round publishes nothing.

### Circle policy

Agreed in the MLS group context; every client validates it and refuses to take part if it's out of range.

```json
{ "v": 1, "minMembers": 8, "revealThreshold": 3, "epsilon": 1, "maxItemsPerMember": 64 }
```

| Field | Range | Meaning |
|---|---|---|
| `minMembers` | integer 8–10000 | present members needed for a round. **The floor of 8 can't be lowered** |
| `revealThreshold` | integer 2–`minMembers` | a pick is shown only if its *noised* count reaches this |
| `epsilon` | 0.01–5 | per-item discrete-Laplace noise parameter |
| `maxItemsPerMember` | integer 1–256 | a member's contribution per round is truncated to this many items |

### Output

- Each item's count gets two-sided geometric noise with `P(k) ∝ exp(−ε·|k|)`.
- Items whose noised count reaches the threshold are published, highest first, with noised counts clamped to the member count.
- Privacy: each member's loss per round is at most `ε × maxItemsPerMember` under basic composition.
- Thresholding happens on the noised count, so a one-person pick can still appear, with small probability: about 10% per item at ε = 1 and threshold 3. That is deliberate: it is what makes any shown pick deniable.
- In the feed, circle picks become `circle` candidates with `strength = noisedCount / members`. `via` names the circle and member count, never a member.

## 4. Match previews (PSI-cardinality)

A preview tells two people only how many videos they have in common (DESIGN.md, Match protocol step 1). The crypto is OpenMined PSI behind the `PsiCardinality` interface:

1. The requester calls `createRequest(items)`.
2. The target calls `answerRequest(request, items)`, which returns `{setup, response}`.
3. The requester calls `intersectionSize(setup, response)`.

The requester learns |A ∩ B|; the target learns |A|.

### Flow

1. The requester sends a preview request (id, requester, target).
2. The target's device checks the limits, then asks the user. **Acceptance is mandatory.**
3. On acceptance, both devices check set sizes. Then a single PSI run happens, and the request is marked `done`.

The **target's device** enforces acceptance, minimum set size and the per-pair limit, because it simply refuses to answer. The per-requester limit can only be enforced by an honest requester client. Request and response messages travel like sketches (NIP-17); their schemas will be fixed when PSI is integrated.

### Preview policy

```json
{ "v": 1, "minSetSize": 20, "maxPerPairPerWeek": 1, "maxPerRequesterPerWeek": 5, "acceptWindowSec": 604800 }
```

| Field | Range | Meaning |
|---|---|---|
| `minSetSize` | integer ≥ 20 | both sets need at least this many items. **The floor of 20 can't be lowered** |
| `maxPerPairPerWeek` | 1–7 | requests per *unordered* pair per rolling 7 days, whatever their outcome (declines count) |
| `maxPerRequesterPerWeek` | 1–50 | requests a requester may start per rolling 7 days |
| `acceptWindowSec` | 60 – 30 days | a request must be accepted, and run, within this window |

State is a list of `{id, requester, target, requestedAt, status}`, where `status` is `pending`, `accepted`, `declined` or `done`. Records older than 7 days are pruned. All transitions are pure functions (`requestPreview`, `respondToPreview`, `startPreviewRun`, `prunePreviews`).

## 5. Second degree

- Second-degree weights come from `trustWalk`: a personalized, decaying trust walk seeded from the viewer [DESIGN A14, A15].
  - A direct match's trust is its similarity.
  - Each further hop multiplies by `damping` (default 0.5) and splits across outgoing edges.
  - Any one node passes on at most `perNodeCap` (default 0.5).
  - Only nodes that opted in to relaying (`relays`) pass trust onward.
- Videos endorsed by nodes two or more hops out become `second` candidates with `strength` = summed trust, capped at 1. They are never attributed.
- How a match relays its matches' picks on the wire (an aggregated, unattributed list inside the sketch channel) is not specified yet.

## Open questions

- **Relay size limits.** A 256-bucket sketch gift-wraps to about 66 KB, above the 64 KiB event limit some relays default to. Options:
  - cap NIP-17 sketches at 128 items (about 33 KB wraps)
  - lower the per-item budget for the 256 bucket
  - split large sketches into two fixed-size parts
- **Event kinds** for recipes, sketch rumors and preview messages.
- **Circle secure aggregation**: which protocol, and whether the DP noise is added inside it (preferred) or after.
- **Wire format for second-degree relay lists.**
