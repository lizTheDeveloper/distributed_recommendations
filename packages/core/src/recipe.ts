import type { SourceKind } from "./types.ts";
import { SOURCE_KINDS } from "./types.ts";
import {
  ValidationError,
  boolean,
  fail,
  has,
  number,
  plainObject,
  string,
  stringArray,
} from "./validate.ts";

// Decision D1 (THREAT_MODEL.md, T1): recipes are declarative data only. Nothing in a
// recipe is ever evaluated as code, and the ranker applies it to candidate lists,
// never to raw history.

/** Filters applied to every candidate before scoring. */
export interface RecipeFilters {
  /** Lowercased tags; a video carrying any of them is dropped. */
  excludeTags: string[];
  /** Lowercased language codes; empty means any. Videos with no language pass. */
  includeLanguages: string[];
  minDurationSec: number;
  /** `null` means no upper bound. */
  maxDurationSec: number | null;
  /** Lowercased `name@host` handles. */
  excludeCreators: string[];
}

/** A validated feed recipe (wire format: docs/PROTOCOL.md, "Feed recipe"). */
export interface Recipe {
  version: 1;
  name: string;
  author?: string;
  /** Weight per source kind, 0..10. A weight of 0 turns that source off. */
  weights: Record<SourceKind, number>;
  /** Half-life of the recency decay, in days. 0 disables decay. */
  recencyHalfLifeDays: number;
  /**
   * Share of feed slots reserved for explore (new, untied creators), 0..0.5.
   * Recommended 0.02–0.10, default 0.05 (`EXPLORE_SHARE`); 0 turns explore off.
   */
  exploreShare: number;
  /** Most items any one creator may occupy in one ranked page. */
  maxPerCreator: number;
  /**
   * Most items any one taste list (one `via`) may contribute to one ranked page.
   * Optional on the wire; absent means `RECIPE_DEFAULTS.maxPerTasteList` (2).
   * Items past the cap lose that list's contribution (they can still rank on
   * other sources). See docs/SIMULATION_RESULTS.md, Exp 5 (P2).
   */
  maxPerTasteList?: number;
  filters: RecipeFilters;
}

/**
 * Explore-share guidance from docs/SIMULATION_RESULTS.md, Exp 2: 5% finds 66% of new
 * creators in their first week at no measurable viewer cost; below 2% leaves creators
 * locked out; above 10% buys little. Validation still accepts 0..0.5 (0 = off) so
 * existing recipes keep parsing; UIs should offer `recommendedMin`..`recommendedMax`.
 */
export const EXPLORE_SHARE = {
  default: 0.05,
  recommendedMin: 0.02,
  recommendedMax: 0.1,
} as const;

/** Defaults applied by the ranker when an optional recipe field is absent. */
export const RECIPE_DEFAULTS = {
  /** Exp 5: capping each list at 2 items per feed cut list-lure reach from 54% to 2%. */
  maxPerTasteList: 2,
} as const;

/** Limits enforced by `parseRecipe`. Recipes are untrusted community input. */
export const RECIPE_LIMITS = {
  maxJsonBytes: 16 * 1024,
  maxName: 80,
  maxAuthor: 120,
  maxWeight: 10,
  maxHalfLifeDays: 3650,
  maxExploreShare: 0.5,
  maxPerCreator: 100,
  maxPerTasteList: 100,
  maxDurationSec: 86_400,
  maxTags: 64,
  maxTagLength: 64,
  maxLanguages: 32,
  maxCreators: 256,
  maxHandleLength: 255,
} as const;

const HANDLE = /^[A-Za-z0-9_.\-]{1,100}@[A-Za-z0-9.\-]{1,150}(:[0-9]{1,5})?$/;
const LANGUAGE = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8}){0,3}$/;

const TOP_KEYS = [
  "version",
  "name",
  "author",
  "weights",
  "recencyHalfLifeDays",
  "exploreShare",
  "maxPerCreator",
  "maxPerTasteList",
  "filters",
] as const;
const FILTER_KEYS = [
  "excludeTags",
  "includeLanguages",
  "minDurationSec",
  "maxDurationSec",
  "excludeCreators",
] as const;

/**
 * Strictly validate an untrusted recipe object. Rejects unknown keys, wrong types,
 * out-of-range numbers and oversized strings or arrays. Missing weights default to
 * 0; missing filters default to "no filter". Throws `ValidationError`.
 */
export function parseRecipe(json: unknown): Recipe {
  const L = RECIPE_LIMITS;
  const o = plainObject(json, "recipe", TOP_KEYS, [
    "version",
    "name",
    "weights",
    "recencyHalfLifeDays",
    "exploreShare",
    "maxPerCreator",
  ]);
  if (o.version !== 1) fail("recipe.version", "must be 1");
  const name = string(o.name, "recipe.name", L.maxName);
  const author = has(o, "author") ? string(o.author, "recipe.author", L.maxAuthor) : undefined;

  const w = plainObject(o.weights, "recipe.weights", SOURCE_KINDS);
  const weights = {} as Record<SourceKind, number>;
  for (const kind of SOURCE_KINDS) {
    weights[kind] = has(w, kind) ? number(w[kind], `recipe.weights.${kind}`, 0, L.maxWeight) : 0;
  }

  const recencyHalfLifeDays = number(o.recencyHalfLifeDays, "recipe.recencyHalfLifeDays", 0, L.maxHalfLifeDays);
  const exploreShare = number(o.exploreShare, "recipe.exploreShare", 0, L.maxExploreShare);
  const maxPerCreator = number(o.maxPerCreator, "recipe.maxPerCreator", 1, L.maxPerCreator, true);
  const maxPerTasteList = has(o, "maxPerTasteList")
    ? number(o.maxPerTasteList, "recipe.maxPerTasteList", 1, L.maxPerTasteList, true)
    : undefined;

  const f = has(o, "filters") ? plainObject(o.filters, "recipe.filters", FILTER_KEYS) : {};
  const lower = (xs: string[]) => [...new Set(xs.map((x) => x.toLowerCase()))];
  const filters: RecipeFilters = {
    excludeTags: has(f, "excludeTags")
      ? lower(stringArray(f.excludeTags, "recipe.filters.excludeTags", L.maxTags, L.maxTagLength))
      : [],
    includeLanguages: has(f, "includeLanguages")
      ? lower(stringArray(f.includeLanguages, "recipe.filters.includeLanguages", L.maxLanguages, 35, LANGUAGE))
      : [],
    minDurationSec: has(f, "minDurationSec")
      ? number(f.minDurationSec, "recipe.filters.minDurationSec", 0, L.maxDurationSec, true)
      : 0,
    maxDurationSec:
      has(f, "maxDurationSec") && f.maxDurationSec !== null
        ? number(f.maxDurationSec, "recipe.filters.maxDurationSec", 1, L.maxDurationSec, true)
        : null,
    excludeCreators: has(f, "excludeCreators")
      ? lower(
          stringArray(f.excludeCreators, "recipe.filters.excludeCreators", L.maxCreators, L.maxHandleLength, HANDLE),
        )
      : [],
  };
  if (filters.maxDurationSec !== null && filters.maxDurationSec < filters.minDurationSec) {
    fail("recipe.filters.maxDurationSec", "must be at least minDurationSec");
  }

  const recipe: Recipe = { version: 1, name, weights, recencyHalfLifeDays, exploreShare, maxPerCreator, filters };
  if (author !== undefined) recipe.author = author;
  if (maxPerTasteList !== undefined) recipe.maxPerTasteList = maxPerTasteList;
  return recipe;
}

/** Parse recipe JSON text, enforcing the size limit before parsing. */
export function parseRecipeJson(text: string): Recipe {
  if (typeof text !== "string") fail("recipe", "must be JSON text");
  if (new TextEncoder().encode(text).length > RECIPE_LIMITS.maxJsonBytes) {
    fail("recipe", `must be at most ${RECIPE_LIMITS.maxJsonBytes} bytes`);
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new ValidationError("recipe", "is not valid JSON");
  }
  return parseRecipe(json);
}

/** Serialize a recipe to its canonical wire form (omits default filters). */
export function recipeToJson(recipe: Recipe): object {
  const f = recipe.filters;
  const filters: Record<string, unknown> = {};
  if (f.excludeTags.length) filters.excludeTags = f.excludeTags;
  if (f.includeLanguages.length) filters.includeLanguages = f.includeLanguages;
  if (f.minDurationSec) filters.minDurationSec = f.minDurationSec;
  if (f.maxDurationSec !== null) filters.maxDurationSec = f.maxDurationSec;
  if (f.excludeCreators.length) filters.excludeCreators = f.excludeCreators;
  const out: Record<string, unknown> = { version: 1, name: recipe.name };
  if (recipe.author !== undefined) out.author = recipe.author;
  out.weights = { ...recipe.weights };
  out.recencyHalfLifeDays = recipe.recencyHalfLifeDays;
  out.exploreShare = recipe.exploreShare;
  out.maxPerCreator = recipe.maxPerCreator;
  if (recipe.maxPerTasteList !== undefined) out.maxPerTasteList = recipe.maxPerTasteList;
  if (Object.keys(filters).length) out.filters = filters;
  return out;
}

/**
 * The default mix: follows and matches, a little taste list, explore at 5%.
 *
 * How the weights map from docs/SIMULATION_RESULTS.md. The simulator scaled each
 * signal to [0, 1] per viewer and mixed them as `peer + 0.15·lists + 0.1·follows`,
 * where "peer" is first- plus second-degree match CF. A recipe weight multiplies a
 * strength that is also in [0, 1], so the simulator's relative weights map onto this
 * scale by multiplying with the match weight (6):
 *
 * - `taste: 0.9` = 0.15 × 6. Exp 1: a taste-heavy mix (lists 0.6 relative, i.e. 3.6
 *   here, close to the old default of 3) lost 16% P@20 and concentrated exposure;
 *   at 0.15 lists are neutral for warm users and help newcomers with no matches.
 *   Lists are further capped at `RECIPE_DEFAULTS.maxPerTasteList` items per page.
 * - `second: 6` = 1.0 × match. The simulator applied the 0.3 decay once, inside the
 *   trust walk, and then added second-degree trust to first-degree at equal weight.
 *   `trustWalk` now applies that decay (damping 0.3) and reports trust on the same
 *   scale as match similarity, so a recipe weight below the match weight would apply
 *   the decay twice (the old 1.8 = 0.3 × 6 plus the walk's own damping).
 * - `follow: 4` is kept as a product choice, not taken from the simulator (0.1, i.e.
 *   0.6 here): follows are explicit user intent, and the synthetic follow graph is
 *   popularity-driven, which the simulator's endorsement model does not reward.
 * - `circle: 6` is unchanged (circles were simulated for privacy, not mix quality).
 * - `exploreShare: 0.05` (Exp 2; see `EXPLORE_SHARE`). `explore` only sets the score
 *   explore items display: they compete with each other, not with the rest.
 */
export const DEFAULT_RECIPE: Recipe = parseRecipe({
  version: 1,
  name: "Following + matches",
  author: "Match Feed",
  weights: { follow: 4, taste: 0.9, match: 6, circle: 6, second: 6, explore: 1 },
  recencyHalfLifeDays: 14,
  exploreShare: EXPLORE_SHARE.default,
  maxPerCreator: 2,
});

/** Only creators you follow, newest first, no explore slots. */
export const FOLLOWING_CHRONOLOGICAL_RECIPE: Recipe = parseRecipe({
  version: 1,
  name: "Following only, newest first",
  author: "Match Feed",
  weights: { follow: 1 },
  recencyHalfLifeDays: 0,
  exploreShare: 0,
  maxPerCreator: 100,
});
