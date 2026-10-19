import type { Recipe, SourceKind } from "./core.ts";
import { DEFAULT_RECIPE, EXPLORE_SHARE, FOLLOWING_CHRONOLOGICAL_RECIPE, RECIPE_DEFAULTS, parseRecipe, recipeToJson } from "./core.ts";

export interface BuiltinRecipe {
  id: string;
  recipe: Recipe;
}

/**
 * Leans further on taste lists than the default, within the simulation's guidance:
 * explore at the recommended maximum (10%), three items per list instead of two, one
 * video per creator. A user choice, not a default (docs/SIMULATION_RESULTS.md, Exp 1:
 * list-heavy mixes cost precision).
 */
export const DISCOVERY_RECIPE: Recipe = parseRecipe({
  version: 1,
  name: "Discovery: taste lists + new creators",
  author: "Match Feed",
  weights: { follow: 3, taste: 2, match: 6, circle: 6, second: 6, explore: 1 },
  recencyHalfLifeDays: 30,
  exploreShare: EXPLORE_SHARE.recommendedMax,
  maxPerCreator: 1,
  maxPerTasteList: 3,
});

export const BUILTIN_RECIPES: BuiltinRecipe[] = [
  { id: "default", recipe: DEFAULT_RECIPE },
  { id: "following", recipe: FOLLOWING_CHRONOLOGICAL_RECIPE },
  { id: "discovery", recipe: DISCOVERY_RECIPE },
];

export const listCap = (r: Recipe) => r.maxPerTasteList ?? RECIPE_DEFAULTS.maxPerTasteList;

/** "10% of slots" etc., from the recipe itself. */
export function exploreText(r: Recipe): string {
  if (!(r.exploreShare > 0 && r.weights.explore > 0)) return "No new-creator slots.";
  const period = Math.max(2, Math.round(1 / r.exploreShare));
  return `${Math.round(r.exploreShare * 100)}% of slots (1 in ${period}) reserved for new creators you have no tie to.`;
}

/** One-line summary of what a recipe does, derived from its fields. */
export function describeRecipe(r: Recipe): string {
  const on = (Object.keys(r.weights) as SourceKind[]).filter((k) => r.weights[k] > 0 && k !== "explore");
  const parts: string[] = [];
  if (on.length === 1 && on[0] === "follow") parts.push("Only channels you follow");
  else parts.push(`Sources: ${on.join(", ")}`);
  parts.push(r.recencyHalfLifeDays > 0 ? `score halves every ${r.recencyHalfLifeDays} days` : "newest first, no decay");
  if (r.weights.taste > 0) parts.push(`at most ${listCap(r)} per taste list`);
  parts.push(`at most ${r.maxPerCreator} per creator`);
  return `${parts.join("; ")}. ${exploreText(r)}`;
}

type Patch = Partial<Pick<Recipe, "name" | "recencyHalfLifeDays" | "exploreShare" | "maxPerCreator" | "maxPerTasteList">> & {
  weights?: Partial<Record<SourceKind, number>>;
};

/** Apply edits and re-validate through core, so the UI can never hold an invalid recipe. */
export function editRecipe(base: Recipe, patch: Patch): Recipe {
  const json = recipeToJson(base) as Record<string, unknown>;
  const { weights, ...rest } = patch;
  Object.assign(json, rest);
  if (weights) json.weights = { ...(json.weights as object), ...weights };
  return parseRecipe(json);
}

export function recipeText(r: Recipe): string {
  return JSON.stringify(recipeToJson(r), null, 2);
}
