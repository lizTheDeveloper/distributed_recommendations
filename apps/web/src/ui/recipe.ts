import type { App } from "../app.ts";
import type { Recipe, SourceKind } from "../lib/core.ts";
import { CHIP_LABELS, EXPLORE_SHARE, RECIPE_LIMITS, parseRecipeJson } from "../lib/core.ts";
import { describeRecipe, editRecipe, listCap, recipeText } from "../lib/recipes.ts";
import { errorText } from "../lib/tastelist.ts";
import { h } from "./dom.ts";
import { recipePicker } from "./home.ts";

const KIND_NOTES: Record<SourceKind, string> = {
  follow: "Channels you follow.",
  taste: "Taste lists you subscribe to. Each list's strength comes from its track record with you.",
  match: "No source yet: Match is coming next.",
  circle: "No source yet: Circle is coming next.",
  second: "No source yet: needs Match.",
  explore: "New creators you have no tie to, in reserved slots.",
};

type Patch = Parameters<typeof editRecipe>[1];

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
  patch: (n: number) => Patch,
): HTMLElement {
  const out = h("span", { class: "mono" }, fmt(value));
  const apply = (n: number) => {
    const s = app.s;
    const base = app.recipe();
    const name = s.recipe.id === "custom" ? base.name : `${base.name} (edited)`.slice(0, RECIPE_LIMITS.maxName);
    try {
      const next = editRecipe(base, { name, ...patch(n) });
      s.recipe = { id: "custom", custom: next };
      app.persist("recipe");
      out.textContent = fmt(n);
      s.ui.recipeError = undefined;
    } catch (e) {
      s.ui.recipeError = errorText(e);
      app.rerender();
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
      // Re-render once the drag ends so the picker and export reflect the custom recipe.
      onchange: () => app.rerender(),
    }),
    h("p", { class: "hint", id: id + "-hint" }, hint),
  );
}

function editor(app: App, r: Recipe): HTMLElement {
  const weightSliders = (Object.keys(KIND_NOTES) as SourceKind[]).map((k) =>
    slider(app, `w-${k}`, `${CHIP_LABELS[k]} weight`, KIND_NOTES[k], r.weights[k], 0, 10, 0.1, (n) => n.toFixed(1), (n) => ({ weights: { [k]: n } })),
  );
  const nameInput = h("input", {
    type: "text",
    id: "recipe-name",
    value: r.name,
    maxlength: String(RECIPE_LIMITS.maxName),
    onchange: (e: Event) => {
      const v = (e.target as HTMLInputElement).value.trim();
      try {
        app.s.recipe = { id: "custom", custom: editRecipe(r, { name: v }) };
        app.s.ui.recipeError = undefined;
        app.persist("recipe");
      } catch (err) {
        app.s.ui.recipeError = errorText(err);
      }
      app.rerender();
    },
  });
  return h(
    "section",
    { class: "panel", "aria-labelledby": "recipe-h" },
    h("h2", { id: "recipe-h" }, "Feed recipe"),
    h("p", { class: "muted small" }, "A recipe is plain data (weights and filters), never code. Your device applies it to candidate videos; nothing about it is sent anywhere."),
    h(
      "div",
      { class: "field" },
      h("label", { for: "recipe-pick", class: "muted" }, "Active recipe"),
      recipePicker(app, "recipe-pick"),
      h("p", { class: "muted small" }, describeRecipe(r)),
    ),
    h("div", { class: "field" }, h("label", { for: "recipe-name" }, "Name"), nameInput),
    app.s.ui.recipeError ? h("p", { class: "err", role: "alert" }, app.s.ui.recipeError) : null,
    h("h3", null, "Source weights"),
    h("p", { class: "muted small", style: { "margin-top": "-8px" } }, "Moving any slider saves a custom copy; the built-ins stay as they are. 0 turns a source off."),
    weightSliders,
    h("h3", null, "Shape"),
    slider(
      app,
      "explore-share",
      "Explore share",
      `Slots reserved for new creators; they compete only with each other. Recommended ${EXPLORE_SHARE.recommendedMin * 100}–${EXPLORE_SHARE.recommendedMax * 100}% (default ${EXPLORE_SHARE.default * 100}%): below 2% new creators rarely get seen, above 10% adds little. 0 = off.`,
      r.exploreShare,
      0,
      Math.max(EXPLORE_SHARE.recommendedMax, r.exploreShare),
      0.01,
      (n) => (n === 0 ? "off" : `${Math.round(n * 100)}%`),
      (n) => ({ exploreShare: n }),
    ),
    slider(app, "half-life", "Recency half-life", "A video's score halves every this many days. 0 = no decay.", r.recencyHalfLifeDays, 0, 90, 1, (n) => (n === 0 ? "off" : `${n} days`), (n) => ({ recencyHalfLifeDays: n })),
    slider(app, "per-list", "Max per taste list", "Most videos any one taste list can place in your feed. Keeps one list (or a list inflated by fake accounts) from taking over.", listCap(r), 1, 10, 1, (n) => String(n), (n) => ({ maxPerTasteList: n })),
    slider(app, "per-creator", "Max per creator", "Most videos any one creator can hold in the feed.", r.maxPerCreator, 1, 10, 1, (n) => String(n), (n) => ({ maxPerCreator: n })),
    r.filters.excludeTags.length || r.filters.includeLanguages.length || r.filters.excludeCreators.length || r.filters.minDurationSec || r.filters.maxDurationSec !== null
      ? h("p", { class: "note" }, "This recipe has filters (tags, languages, durations or creators). Edit them in the JSON and re-import.")
      : null,
  );
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
    app.rerender();
  };
  return h(
    "aside",
    { class: "panel", "aria-label": "Import and export" },
    h("h2", null, "Export"),
    exportArea,
    h("div", { class: "row" }, h("button", { class: "btn sm", onclick: copy }, "Copy"), h("button", { class: "btn sm", onclick: download }, "Download .json")),
    h("h2", null, "Import"),
    h("p", { class: "muted small" }, "Paste a recipe someone shared. It is checked strictly (unknown keys, ranges, sizes) before it's applied."),
    h("form", { class: "stack", onsubmit: doImport }, importArea, h("div", { class: "row end" }, h("button", { class: "btn match", type: "submit" }, "Validate and apply"))),
    s.ui.importError ? h("p", { class: "err", role: "alert" }, s.ui.importError) : null,
    s.ui.importOk ? h("p", { class: "okmsg", role: "status" }, s.ui.importOk) : null,
  );
}

export function recipeScreen(app: App): HTMLElement {
  const r = app.recipe();
  return h("section", { class: "cols" }, editor(app, r), io(app, r));
}
