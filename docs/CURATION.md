# Editorial curation

How the strategy in [`CURATION_STRATEGY.md`](CURATION_STRATEGY.md) runs in this repository.
Status: first collections published, 2026-10-19. Nothing is published until a person approves it.

## Phase 0: what the deployment is

The strategy was written for a PeerTube instance. Multiverse Video is not one:

- `video.multiversegames.ai` serves this repository's web client (`apps/web`) as static files.
- No PeerTube server, database, plugins, or instance follows exist on our side.
- The app reads public PeerTube instances from the viewer's browser and ranks videos on the device.

So the strategy's layers map onto what the app already has:

| Strategy layer (§9.1) | Here |
|---|---|
| Discovery | `curation/scripts/discover.mjs`: Sepia Search query packs, plus listing a known publisher's channel |
| Verification | `curation/scripts/verify.mjs`: each video is fetched from its **origin** instance; creator identity comes from `curation/sources.json`, which a person maintains |
| Federation | None on our side. Following an instance would need a PeerTube server. A viewer's own instance list lives in their settings |
| Editorial index | `curation/records/*.json`, one file per video (§8 schema), kept apart from remote metadata |
| Presentation | `curation/scripts/publish.mjs` turns approved records into **taste lists** (format v1, [`WEB_APP.md`](WEB_APP.md)). The app bundles them as "Editors' collections" in onboarding and on the Follow screen. A public copy of each list is at `/collections/<slug>.json` |
| Distribution | Link-only. Items are canonical watch URLs on the creator's instance and play through the creator's own embed. Nothing is imported or mirrored, and the record schema rejects any other mode for now |

An editorial collection is just a taste list, so the ranking rules already apply. Each list places at most a couple of picks per page, its strength comes from its track record with that viewer, and every pick says why it's there ("In the taste list Hack the Planet", plus the editor's note).

## The pipeline

Statuses follow §8: `discovered → verified → reviewed → approved → published`. `rejected`, `needs-recheck` and `removed` can happen at any stage, and every transition is appended to the record's `audit` log.

```sh
node curation/scripts/discover.mjs --per-query 6                 # query packs → discovered
node curation/scripts/discover.mjs --channel joinpeertube@framatube.org --collection build-your-own-future
node curation/scripts/verify.mjs                                 # discovered → verified (origin fetch)
node curation/scripts/verify.mjs --all                           # refresh: availability, captions, identity
node curation/scripts/propose.mjs proposals.json --by "<who>"    # AI or editor proposals → reviewed
node curation/scripts/approve.mjs --reviewer "<person>" approve <id-prefix>...
node curation/scripts/approve.mjs --reviewer "<person>" reject <id-prefix> --reason "…"
node curation/scripts/approve.mjs --reviewer "<person>" remove <id-prefix> --reason "…"
node curation/scripts/publish.mjs                                # approved → published; writes the lists
node --test curation/test/*.test.mjs
```

Then deploy: the image build runs both test suites, and the web tests refuse any bundled pick that doesn't trace back to an approved record with a human reviewer.

**Who can do what.** AI agents may discover, verify, and propose: tags, ratings, "Why we picked it", learning outcomes, "Try next". A proposal sets `proposed_by` and leaves `reviewer` empty. Only `approve.mjs` with a named person moves a record to `approved`, and it refuses reviewer names that look like an agent or a script. Every AI proposal records `judgment_basis`. For the first pass that is "metadata only; not watched", so substantive claims stay unverified until a reviewer watches the video.

**Editing without code.** Adding, approving, removing, or rewording a pick changes data only: a record file or a script call, then a deploy. No application code changes.

## Scoring

§6 weights: usefulness 25, rigor 25, mission 20, distinctiveness 10, accessibility 10, currency 10. Each is rated 0–5, and the score is `sum(weight × rating / 5)`. Score bands:

| Score | Band |
|---|---|
| 80+ | feature candidate |
| 65–79 | collection candidate |
| 50–64 | editorial review |
| below 50 | reject |

These are proposed defaults.

## Identity

`origin_confirmed` means the origin instance reports the video as its own, published by that channel. It says nothing about who runs the channel.

`identity_status` comes from `curation/sources.json`:

- `official-link-verified`: the publisher's official website links to the instance (§5.3 step 3), with the evidence recorded.
- `unverified`: everything else.

Instances and channels on which the first pass found no official link are listed there as `unverified`, so a reviewer knows to check them.

## First pass (2026-10-19)

| | Count |
|---|---|
| Discovered (60 Sepia queries plus channel listings for Framasoft, PeerTube and Waag) | 382 |
| Origin-confirmed | 378 |
| Rejected, with reasons | 49 |
| Proposed (`reviewed`) | 58 |
| Proposals whose publisher identity is official-link-verified | 14 |
| Approved and published | 57 (Liz delegated approval; recorded in each audit entry) |

The 49 rejections are re-uploads of other publishers' videos, keyword collisions, and one evidence-gate failure.

The 58 proposals split as 25 feature candidates and 32 collection candidates. They cover all six collections, with 10 marked for Start Here.

The rest stay `verified` in the pool, unreviewed.

Liz delegated the first approval ("you can publish what you want"). Every proposal scoring 65 or more was approved under her name, and each audit entry records the delegation and that the picks were judged from metadata only. The 62-point "Phishing" proposal stays in review. Classroom Ready is empty because no pick has captions yet. Playable Futures and Beautifully Unnecessary Machines are under their three-pick threshold.

**CCC:** the only Chaos Computer Club channel on PeerTube calls itself a mirror. The canonical archive, media.ccc.de, isn't PeerTube, so CCC talks are not in any collection yet.

## Reports and removal

See [`curation/moderation.md`](../curation/moderation.md).
