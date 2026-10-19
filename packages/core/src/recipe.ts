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
  /** Share of feed slots reserved for explore (new, untied creators), 0..0.5. */
  exploreShare: number;
  /** Most items any one creator may occupy in one ranked page. */
  maxPerCreator: number;
  filters: RecipeFilters;
}

/** Limits enforced by `parseRecipe`. Recipes are untrusted community input. */
export const RECIPE_LIMITS = {
  maxJsonBytes: 16 * 1024,
  maxName: 80,
  maxAuthor: 120,
  maxWeight: 10,
  maxHalfLifeDays: 3650,
  maxExploreShare: 0.5,
  maxPerCreator: 100,
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
  if (Object.keys(filters).length) out.filters = filters;
  return out;
}

/**
 * The default mix from the mockup: following 40 / matches 60, second degree at 0.3x
 * the match weight, and 10% of slots reserved for explore.
 */
export const DEFAULT_RECIPE: Recipe = parseRecipe({
  version: 1,
  name: "Following + matches",
  author: "Match Feed",
  weights: { follow: 4, taste: 3, match: 6, circle: 6, second: 1.8, explore: 1 },
  recencyHalfLifeDays: 14,
  exploreShare: 0.1,
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
