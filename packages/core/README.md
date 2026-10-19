# @match-feed/core

The on-device library for Match Feed: ranking, explanations, taste sketches and the
privacy policies around matches, circles and previews. Design: `docs/DESIGN.md`,
threats: `docs/THREAT_MODEL.md`, wire formats: `docs/PROTOCOL.md`.

- TypeScript with zero runtime dependencies. It runs in browsers, and in Node 22+ directly (`--experimental-strip-types`).
- All randomness is injectable: pass `seededRng(n)` in tests and simulations, and `cryptoRng()` in production.

| Module | What it does |
|---|---|
| `recipe.ts` | declarative feed recipes (D1): strict `parseRecipe`, `DEFAULT_RECIPE`, `FOLLOWING_CHRONOLOGICAL_RECIPE`, `EXPLORE_SHARE`, `RECIPE_DEFAULTS` |
| `rank.ts` | `rank(candidates, recipe, {now, limit, rng, seen, exploreRelevance})`: merge, decay, filter, per-creator and per-taste-list caps, explore slots |
| `explain.ts` | "Why am I seeing this?" lines and chip labels |
| `similarity.ts` | Jaccard, cosine, sketch similarity; `tagProfile` / `tagRelevance` for on-device explore ranking |
| `trust.ts` | row-normalized, decaying trust walk for second-degree weights; `tasteListStrength` (track record) |
| `sketch.ts` | build, pad, encode and validate taste sketches; quiet pause (D2); per-transport bucket cap |
| `circle.ts` | circle reveal policy: k ≥ 8, derived threshold, sticky discrete-Laplace noise, epoch freeze, picks only |
| `preview.ts` | PSI-cardinality preview policy: DP-noised cardinality with a floor, target-side yearly budget, the `PsiCardinality` interface |
| `peertube.ts` | minimal PeerTube REST client (injectable `fetch`) |

## Defaults from the simulation

`docs/SIMULATION_RESULTS.md` (synthetic; compares mechanisms, not absolute quality) set these:

| What | Default | Where |
|---|---|---|
| Explore share | **5%**; offer users 2–10% (`EXPLORE_SHARE`); 0 = off | `DEFAULT_RECIPE.exploreShare` |
| Explore ranking | relevance-ranked on device (`exploreRelevance`, or explore `strength`), seeded tie-break; random only with no signal | `rank` |
| Taste lists | weight 0.9 (0.15 × match), **≤ 2 items per list per page** (`maxPerTasteList`), strength from track record (`tasteListStrength`) | `DEFAULT_RECIPE`, `rank` |
| Second degree | decay 0.3, 2 hops, per-node cap 0.05 of your trust mass, row-normalized; recipe weight = match weight (decay applied once, in the walk) | `TRUST_WALK_DEFAULTS` |
| Circles | k ≥ 8 (recommended 12–30); threshold 3 for k ≤ 15, 4 above, derived when absent; ε = 1 per item per epoch; sticky noise; epoch freeze; **picks only, never counts** | `DEFAULT_CIRCLE_POLICY`, `releaseCircleEpoch` |
| Previews | noised cardinality (discrete Laplace ε = 0.5, floor 5 → "<5"), **≤ 8 accepted previews per target per year**, enforced on the target's device. `minSetSize` (20) is hygiene, not a defense | `DEFAULT_PREVIEW_POLICY`, `noisyPreviewCardinality` |
| Sketches | NIP-17 capped at the 128 bucket; 256 only over MLS | `buildSketch({transport})` |

```ts
import { DEFAULT_RECIPE, rank, seededRng, tagProfile, tagRelevance } from "@match-feed/core";

const exploreRelevance = tagRelevance(tagProfile(myEndorsedVideos)); // on-device only
const feed = rank(candidates, DEFAULT_RECIPE, { now: new Date(), limit: 20, rng: seededRng(1), exploreRelevance });
for (const item of feed) console.log(item.primary, item.video.title, item.why);
```

```sh
npm test       # node:test, no network
npm run demo   # ranks live videos from framatube.org with invented follows and matches
               # flags: --instance https://… --seed N --limit N
```

`circle.ts` is the policy applied **after** secure aggregation. Real circles must never give any member the other members' raw sets, nor the epoch's noise seed (a member who knows it can subtract the noise). Use `releaseCircleEpoch` rather than `circlePicks` directly: it releases each epoch once and never recomputes it.

## Compatibility notes (post-simulation revision)

The public API only grew; nothing was renamed or removed. Behaviour that changed:
- `DEFAULT_RECIPE`: `exploreShare` 0.1 → 0.05, `taste` 3 → 0.9, `second` 1.8 → 6.
- `rank`: taste lists capped at 2 items per page unless the recipe sets `maxPerTasteList`; explore is relevance-ranked when a signal exists.
- `trustWalk`: defaults damping 0.5 → 0.3, maxHops 3 → 2, perNodeCap 0.5 → 0.05, normalized; pass `normalize: false` for the old walk.
- `circlePicks`: picks sorted by id, `noisedCount` no longer populated (deprecated); `revealThreshold` optional (derived); `circleCandidates` strength is a constant.
- Previews: `respondToPreview` can refuse with `target-budget`; `prunePreviews` keeps accepted records for a year; the policy gained optional `maxAcceptedPerTargetPerYear`, `epsilon`, `floor`.
- `buildSketch` defaults to `transport: "nip17"` (max 128 items); pass `"mls"` for 256.

License: Apache-2.0.
