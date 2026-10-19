import type { Recipe, SourceKind } from "./core.ts";
import { DEFAULT_RECIPE, FOLLOWING_CHRONOLOGICAL_RECIPE, parseRecipe, recipeToJson } from "./core.ts";

export interface BuiltinRecipe {
  id: string;
  recipe: Recipe;
  blurb: string;
}

export const DISCOVERY_RECIPE: Recipe = parseRecipe({
  version: 1,
  name: "Discovery: taste lists + new creators",
  author: "Match Feed",
  weights: { follow: 3, taste: 5, match: 6, circle: 6, second: 1.8, explore: 2 },
  recencyHalfLifeDays: 30,
  exploreShare: 0.2,
  maxPerCreator: 1,
});

export const BUILTIN_RECIPES: BuiltinRecipe[] = [
  { id: "default", recipe: DEFAULT_RECIPE, blurb: "Follows and taste lists, decaying over two weeks; 10% of slots for new creators." },
  { id: "following", recipe: FOLLOWING_CHRONOLOGICAL_RECIPE, blurb: "Only channels you follow, newest first. No explore slots." },
  { id: "discovery", recipe: DISCOVERY_RECIPE, blurb: "Leans on taste lists; one video per creator; 20% new-creator slots." },
];

/** Apply edits and re-validate through core, so the UI can never hold an invalid recipe. */
export function editRecipe(
  base: Recipe,
  patch: Partial<Pick<Recipe, "name" | "recencyHalfLifeDays" | "exploreShare" | "maxPerCreator">> & {
    weights?: Partial<Record<SourceKind, number>>;
  },
): Recipe {
  const json = recipeToJson(base) as Record<string, unknown>;
  const { weights, ...rest } = patch;
  Object.assign(json, rest);
  if (weights) json.weights = { ...(json.weights as object), ...weights };
  return parseRecipe(json);
}

export function recipeText(r: Recipe): string {
  return JSON.stringify(recipeToJson(r), null, 2);
}
