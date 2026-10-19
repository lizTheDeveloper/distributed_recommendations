# @match-feed/core

The on-device library for Match Feed: ranking, explanations, taste sketches and the
privacy policies around matches, circles and previews. Design: `docs/DESIGN.md`,
threats: `docs/THREAT_MODEL.md`, wire formats: `docs/PROTOCOL.md`.

- TypeScript with zero runtime dependencies. It runs in browsers, and in Node 22+ directly (`--experimental-strip-types`).
- All randomness is injectable: pass `seededRng(n)` in tests and simulations, and `cryptoRng()` in production.

| Module | What it does |
|---|---|
| `recipe.ts` | declarative feed recipes (D1): strict `parseRecipe`, `DEFAULT_RECIPE`, `FOLLOWING_CHRONOLOGICAL_RECIPE` |
| `rank.ts` | `rank(candidates, recipe, {now, limit, rng, seen})`: merge, decay, filter, per-creator cap, explore slots |
| `explain.ts` | "Why am I seeing this?" lines and chip labels |
| `similarity.ts` | Jaccard, cosine, sketch similarity |
| `trust.ts` | personalized decaying trust walk for second-degree weights |
| `sketch.ts` | build, pad, encode and validate taste sketches; quiet pause (D2) |
| `circle.ts` | circle reveal policy: k ≥ 8, threshold, discrete-Laplace noise |
| `preview.ts` | PSI-cardinality preview policy, and the `PsiCardinality` interface |
| `peertube.ts` | minimal PeerTube REST client (injectable `fetch`) |

```ts
import { DEFAULT_RECIPE, rank, seededRng } from "@match-feed/core";

const feed = rank(candidates, DEFAULT_RECIPE, { now: new Date(), limit: 20, rng: seededRng(1) });
for (const item of feed) console.log(item.primary, item.video.title, item.why);
```

```sh
npm test       # node:test, no network
npm run demo   # ranks live videos from framatube.org with invented follows and matches
               # flags: --instance https://… --seed N --limit N
```

`circle.ts` is the policy applied **after** secure aggregation. Real circles must never give any member the other members' raw sets.

License: Apache-2.0.
