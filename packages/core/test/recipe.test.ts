import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_RECIPE,
  FOLLOWING_CHRONOLOGICAL_RECIPE,
  parseRecipe,
  parseRecipeJson,
  recipeToJson,
} from "../src/recipe.ts";
import { ValidationError } from "../src/validate.ts";

const base = () => ({
  version: 1,
  name: "Slow Craft",
  author: "@hearth@craft.tube",
  weights: { follow: 3, match: 5, explore: 1 },
  recencyHalfLifeDays: 30,
  exploreShare: 0.15,
  maxPerCreator: 2,
  filters: {
    excludeTags: ["Gaming"],
    includeLanguages: ["en", "pt-BR"],
    minDurationSec: 300,
    maxDurationSec: 7200,
    excludeCreators: ["spam@bad.example"],
  },
});

test("parses a valid recipe and fills defaults", () => {
  const r = parseRecipe(base());
  assert.equal(r.name, "Slow Craft");
  assert.deepEqual(r.weights, { follow: 3, match: 5, circle: 0, taste: 0, second: 0, explore: 1 });
  assert.deepEqual(r.filters.excludeTags, ["gaming"]);
  assert.deepEqual(r.filters.includeLanguages, ["en", "pt-br"]);
  const minimal = parseRecipe({ version: 1, name: "x", weights: {}, recencyHalfLifeDays: 0, exploreShare: 0, maxPerCreator: 1 });
  assert.equal(minimal.filters.maxDurationSec, null);
  assert.equal(minimal.author, undefined);
});

test("round-trips through recipeToJson", () => {
  const r = parseRecipe(base());
  assert.deepEqual(parseRecipe(JSON.parse(JSON.stringify(recipeToJson(r)))), r);
  assert.deepEqual(parseRecipe(recipeToJson(DEFAULT_RECIPE)), DEFAULT_RECIPE);
});

const bad: Array<[string, (o: any) => void]> = [
  ["unknown top-level key", (o) => (o.code = "fetch('https://evil')")],
  ["unknown weight kind", (o) => (o.weights.trending = 1)],
  ["unknown filter key", (o) => (o.filters.script = "x")],
  ["wrong version", (o) => (o.version = 2)],
  ["weight out of range", (o) => (o.weights.match = 11)],
  ["negative weight", (o) => (o.weights.match = -1)],
  ["NaN-like weight", (o) => (o.weights.match = "5")],
  ["exploreShare too high", (o) => (o.exploreShare = 0.6)],
  ["fractional maxPerCreator", (o) => (o.maxPerCreator = 1.5)],
  ["zero maxPerCreator", (o) => (o.maxPerCreator = 0)],
  ["name too long", (o) => (o.name = "x".repeat(81))],
  ["empty name", (o) => (o.name = "")],
  ["control chars in name", (o) => (o.name = "a‮b")],
  ["too many tags", (o) => (o.filters.excludeTags = Array.from({ length: 65 }, (_, i) => `t${i}`))],
  ["tag not a string", (o) => (o.filters.excludeTags = [1])],
  ["bad language", (o) => (o.filters.includeLanguages = ["english!"])],
  ["bad handle", (o) => (o.filters.excludeCreators = ["not a handle"])],
  ["max < min duration", (o) => (o.filters.maxDurationSec = 100)],
  ["weights is an array", (o) => (o.weights = [1, 2])],
  ["missing exploreShare", (o) => delete o.exploreShare],
];
for (const [name, mutate] of bad) {
  test(`rejects: ${name}`, () => {
    const o = base();
    mutate(o);
    assert.throws(() => parseRecipe(o), ValidationError);
  });
}

test("rejects non-objects and prototype tricks", () => {
  assert.throws(() => parseRecipe(null), ValidationError);
  assert.throws(() => parseRecipe("recipe"), ValidationError);
  assert.throws(() => parseRecipeJson('{"__proto__": {"x": 1}, "version": 1}'), ValidationError);
  class Fake {}
  assert.throws(() => parseRecipe(Object.assign(new Fake(), base())), ValidationError);
});

test("parseRecipeJson enforces size and syntax", () => {
  assert.throws(() => parseRecipeJson("{"), /not valid JSON/);
  assert.throws(() => parseRecipeJson(" ".repeat(17 * 1024)), /bytes/);
  assert.equal(parseRecipeJson(JSON.stringify(base())).name, "Slow Craft");
});

test("built-in recipes", () => {
  assert.equal(DEFAULT_RECIPE.exploreShare, 0.1);
  assert.ok(DEFAULT_RECIPE.weights.match > DEFAULT_RECIPE.weights.follow);
  assert.equal(FOLLOWING_CHRONOLOGICAL_RECIPE.weights.match, 0);
  assert.equal(FOLLOWING_CHRONOLOGICAL_RECIPE.exploreShare, 0);
});
