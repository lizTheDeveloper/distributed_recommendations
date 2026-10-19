import type { App } from "../app.ts";
import type { Recipe, SourceKind } from "../lib/core.ts";
import { CHIP_LABELS, EXPLORE_SHARE, RECIPE_LIMITS, parseRecipeJson } from "../lib/core.ts";
import type { RecipePatch } from "../lib/recipes.ts";
import { describeRecipe, listCap, recipeText } from "../lib/recipes.ts";
import { errorText } from "../lib/tastelist.ts";
import { h } from "./dom.ts";
import { recipePicker } from "./home.ts";

const KIND_NOTES: Record<SourceKind, string> = {
  follow: "Channels you follow.",
  taste: "Taste lists you subscribe to. Each list's strength comes from its track record with you.",
  match: "People you matched with: their endorsements, weighted by how much your tastes overlap.",
  circle: "No source yet: Circle is coming next.",
  second: "No source yet: needs matches of matches.",
  explore: "New creators you have no tie to, in reserved slots.",
};

function slider(
  app: App,
  id: string,
  label: string,
  hint: string,
  value: number,
  min: number,
  max: number,
  step: number,
  fmt: (n: number) => string,
  patch: (n: number) => RecipePatch,
): HTMLElement {
  const out = h("span", { class: "mono" }, fmt(value));
  const apply = (n: number) => {
    const err = app.editRecipe(patch(n));
    if (err) {
      app.s.ui.recipeError = errorText(new Error(err));
      app.sheetChanged();
    } else {
      out.textContent = fmt(n);
      app.s.ui.recipeError = undefined;
    }
  };
  return h(
    "div",
    { class: "slider" },
    h("label", { for: id }, h("span", null, label), out),
    h("input", {
      type: "range",
      id,
      min: String(min),
      max: String(max),
      step: String(step),
      value: String(value),
      "aria-describedby": id + "-hint",
      oninput: (e: Event) => apply(Number((e.target as HTMLInputElement).value)),
      // Rebuild once the drag ends so the picker and summary show the custom recipe.
      onchange: () => app.sheetChanged(),
    }),
    h("p", { class: "hint", id: id + "-hint" }, hint),
  );
}

/** Recipe picker, weights and shape: the core of the feed settings sheet. */
export function recipeControls(app: App, prefix = "sh"): { picker: HTMLElement[]; weights: HTMLElement[]; shape: HTMLElement[] } {
  const r = app.recipe();
  const nameInput = h("input", {
    type: "text",
    id: `${prefix}-recipe-name`,
    value: r.name,
    maxlength: String(RECIPE_LIMITS.maxName),
    onchange: (e: Event) => {
      const err = app.editRecipe({ name: (e.target as HTMLInputElement).value.trim() });
      app.s.ui.recipeError = err ? errorText(new Error(err)) : undefined;
      app.sheetChanged();
    },
  });
  return {
    picker: [
      h(
        "div",
        { class: "field" },
        h("label", { for: `${prefix}-recipe-pick` }, "Active recipe"),
        recipePicker(app, `${prefix}-recipe-pick`),
        h("p", { class: "muted small", id: `${prefix}-recipe-desc` }, describeRecipe(r)),
      ),
      h("div", { class: "field" }, h("label", { for: `${prefix}-recipe-name` }, "Name"), nameInput),
      app.s.ui.recipeError ? h("p", { class: "err", role: "alert" }, app.s.ui.recipeError) : null,
    ].filter(Boolean) as HTMLElement[],
    weights: (Object.keys(KIND_NOTES) as SourceKind[]).map((k) =>
      slider(app, `${prefix}-w-${k}`, `${CHIP_LABELS[k]} weight`, KIND_NOTES[k], r.weights[k], 0, 10, 0.1, (n) => n.toFixed(1), (n) => ({ weights: { [k]: n } })),
    ),
    shape: [
      slider(
        app,
        `${prefix}-explore-share`,
        "Explore share",
        `Slots reserved for new creators; they compete only with each other. Recommended ${EXPLORE_SHARE.recommendedMin * 100}–${EXPLORE_SHARE.recommendedMax * 100}% (default ${EXPLORE_SHARE.default * 100}%): below 2% new creators rarely get seen, above 10% adds little. 0 = off.`,
        r.exploreShare,
        0,
        Math.max(EXPLORE_SHARE.recommendedMax, r.exploreShare),
        0.01,
        (n) => (n === 0 ? "off" : `${Math.round(n * 100)}%`),
        (n) => ({ exploreShare: n }),
      ),
      slider(app, `${prefix}-half-life`, "Recency half-life", "A video's score halves every this many days. 0 = no decay.", r.recencyHalfLifeDays, 0, 90, 1, (n) => (n === 0 ? "off" : `${n} days`), (n) => ({ recencyHalfLifeDays: n })),
      slider(app, `${prefix}-per-list`, "Max per taste list", "Most videos any one taste list can place in your feed. Keeps one list (or a list inflated by fake accounts) from taking over.", listCap(r), 1, 10, 1, (n) => String(n), (n) => ({ maxPerTasteList: n })),
      slider(app, `${prefix}-per-creator`, "Max per creator", "Most videos any one creator can hold in the feed.", r.maxPerCreator, 1, 10, 1, (n) => String(n), (n) => ({ maxPerCreator: n })),
    ],
  };
}

function io(app: App, r: Recipe): HTMLElement {
  const { s } = app;
  const text = recipeText(r);
  const exportArea = h("textarea", { id: "recipe-export", rows: "12", readonly: true, value: text, "aria-label": "Recipe JSON" });
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      app.toast("Recipe JSON copied");
    } catch {
      exportArea.focus();
      exportArea.select();
      app.toast("Selected. Copy with your keyboard");
    }
  };
  const download = () => {
    try {
      const url = URL.createObjectURL(new Blob([text + "\n"], { type: "application/json" }));
      const a = h("a", { href: url, download: (r.name.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "") || "recipe") + ".json" });
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      app.toast("Download isn't available here. Use Copy");
    }
  };
  const importArea = h("textarea", {
    id: "recipe-import",
    rows: "8",
    spellcheck: "false",
    placeholder: '{ "version": 1, "name": "…", "weights": { … }, … }',
    value: s.ui.recipeImport ?? "",
    oninput: (e: Event) => (s.ui.recipeImport = (e.target as HTMLTextAreaElement).value),
  });
  const doImport = (e: Event) => {
    e.preventDefault();
    try {
      const rec = parseRecipeJson(importArea.value);
      s.recipe = { id: "custom", custom: rec };
      app.persist("recipe");
      s.ui.recipeImport = "";
      s.ui.importError = undefined;
      s.ui.importOk = `Applied "${rec.name}". It's now your custom recipe.`;
    } catch (err) {
      s.ui.importOk = undefined;
      s.ui.importError = "Not applied. " + errorText(err);
    }
    app.sheetChanged();
  };
  return h(
    "div",
    { class: "cols2" },
    h(
      "section",
      { class: "panel", "aria-labelledby": "export-h" },
      h("h2", { id: "export-h" }, "Export"),
      h("p", { class: "muted small" }, `"${r.name}": ${describeRecipe(r)}`),
      exportArea,
      h("div", { class: "row" }, h("button", { class: "btn sm", onclick: copy }, "Copy"), h("button", { class: "btn sm", onclick: download }, "Download .json")),
    ),
    h(
      "section",
      { class: "panel", "aria-labelledby": "import-h" },
      h("h2", { id: "import-h" }, "Import"),
      h("p", { class: "muted small" }, "Paste a recipe someone shared. It is checked strictly (unknown keys, ranges, sizes) before it's applied. Filters (tags, languages, durations, creators) come along."),
      h("form", { class: "stack", onsubmit: doImport }, importArea, h("div", { class: "row end" }, h("button", { class: "btn match", type: "submit" }, "Validate and apply"))),
      s.ui.importError ? h("p", { class: "err", role: "alert" }, s.ui.importError) : null,
      s.ui.importOk ? h("p", { class: "okmsg", role: "status" }, s.ui.importOk) : null,
    ),
  );
}

export function recipeScreen(app: App): HTMLElement {
  const r = app.recipe();
  return h(
    "section",
    { class: "stack", style: { gap: "16px" } },
    h(
      "div",
      { class: "feedhead" },
      h("h2", null, "Recipe import & export"),
      h("button", { class: "btn sm", onclick: () => app.sheet({ type: "open", section: "recipe" }) }, "Edit weights and filters in Feed settings"),
    ),
    h("p", { class: "muted small" }, "A recipe is plain data (weights and filters), never code. Your device applies it to candidate videos; nothing about it is sent anywhere."),
    io(app, r),
  );
}
