// Feed settings: a bottom sheet on phones (slides up, full height), a side drawer on
// desktop. Opened from the gear in the header, the bottom bar's Settings, the menu,
// or the current-recipe pill. Closes with the close button, Escape or the scrim.

import type { App } from "../app.ts";
import { LANGUAGE_HINT, filtersText } from "../lib/recipes.ts";
import { DURATION_CHOICES, durationChoice, sheetLayout, splitList, trapFocus } from "../lib/sheet.ts";
import { cryptoRng } from "../lib/core.ts";
import { parseChannelInput, handleOf } from "../lib/handles.ts";
import type { Settings } from "../lib/settings.ts";
import { h, toggle } from "./dom.ts";
import { icon } from "./icons.ts";
import { recipeControls } from "./recipe.ts";

function section(id: string, title: string, ...children: (HTMLElement | HTMLElement[] | null)[]): HTMLElement {
  return h("section", { class: "sheet-sec", id: `sh-sec-${id}`, "aria-labelledby": `sh-sec-${id}-h` }, h("h3", { id: `sh-sec-${id}-h` }, title), ...children.flat().filter(Boolean));
}

function filters(app: App): HTMLElement[] {
  const r = app.recipe();
  const f = r.filters;
  const err = app.s.ui.filterError;
  const apply = (patch: Parameters<App["editRecipe"]>[0]) => {
    const e = app.editRecipe(patch);
    app.s.ui.filterError = e ?? undefined;
    app.sheetChanged();
  };
  const tags = h("input", { type: "text", id: "sh-f-tags", value: f.excludeTags.join(", "), placeholder: "e.g. politics, crypto", "aria-describedby": "sh-f-tags-hint", onchange: (e: Event) => apply({ filters: { excludeTags: splitList((e.target as HTMLInputElement).value) } }) });
  const langs = h("input", { type: "text", id: "sh-f-langs", value: f.includeLanguages.join(", "), placeholder: "any", "aria-describedby": "sh-f-langs-hint", onchange: (e: Event) => apply({ filters: { includeLanguages: splitList((e.target as HTMLInputElement).value, 32) } }) });
  const dur = h(
    "select",
    {
      id: "sh-f-dur",
      onchange: (e: Event) => {
        const c = DURATION_CHOICES.find((x) => x.id === (e.target as HTMLSelectElement).value);
        if (c) apply({ filters: { minDurationSec: c.min, maxDurationSec: c.max } });
      },
    },
    DURATION_CHOICES.map((c) => h("option", { value: c.id, selected: durationChoice(f.minDurationSec, f.maxDurationSec) === c.id }, c.label)),
    durationChoice(f.minDurationSec, f.maxDurationSec) === "custom" ? h("option", { value: "custom", selected: true }, "Custom (from imported JSON)") : null,
  );
  const creatorInput = h("input", { type: "text", id: "sh-f-creator", placeholder: "name@host", value: app.s.ui.creatorInput ?? "", oninput: (e: Event) => (app.s.ui.creatorInput = (e.target as HTMLInputElement).value) });
  const addCreator = (e: Event) => {
    e.preventDefault();
    const ref = parseChannelInput(creatorInput.value);
    if (!ref) {
      app.s.ui.filterError = "Enter a channel as name@host";
      return app.sheetChanged();
    }
    app.s.ui.creatorInput = "";
    apply({ filters: { excludeCreators: [...new Set([...f.excludeCreators, handleOf(ref)])] } });
  };
  const summary = filtersText(r);
  return [
    h("p", { class: "muted small" }, summary ? `Active: ${summary}.` : "No filters. Filters apply to every source, Reels and the grid alike."),
    h("div", { class: "field" }, h("label", { for: "sh-f-tags" }, "Hide videos tagged"), tags, h("p", { class: "hint", id: "sh-f-tags-hint" }, "Comma-separated. Many PeerTube videos have no tags, so this is best-effort.")),
    h("div", { class: "field" }, h("label", { for: "sh-f-langs" }, "Only these languages"), langs, h("p", { class: "hint", id: "sh-f-langs-hint" }, LANGUAGE_HINT)),
    h("div", { class: "field" }, h("label", { for: "sh-f-dur" }, "Length"), dur),
    h(
      "div",
      { class: "field" },
      h("label", { for: "sh-f-creator" }, "Hidden creators"),
      f.excludeCreators.length
        ? h(
            "ul",
            { class: "list small" },
            f.excludeCreators.map((c) =>
              h("li", null, h("span", { class: "mono" }, c), h("button", { class: "btn sm", "aria-label": `Show ${c} again`, onclick: () => apply({ filters: { excludeCreators: f.excludeCreators.filter((x) => x !== c) } }) }, "Remove")),
            ),
          )
        : null,
      h("form", { class: "row", onsubmit: addCreator }, creatorInput, h("button", { class: "btn sm", type: "submit" }, "Hide")),
    ),
    err ? h("p", { class: "err", role: "alert" }, err) : null,
  ].filter(Boolean) as HTMLElement[];
}

function view(app: App): HTMLElement[] {
  const { s } = app;
  const setSetting = (fn: () => void) => {
    fn();
    app.persist("settings");
    app.sheetChanged();
  };
  const radio = (v: Settings["defaultView"], label: string, hint: string) =>
    h(
      "label",
      { class: "opt" },
      h("input", { type: "radio", name: "sh-view", value: v, checked: s.settings.defaultView === v, onchange: () => setSetting(() => ((s.settings.defaultView = v), (s.view = v))) }),
      h("span", null, h("strong", null, label), h("span", { class: "muted small block" }, hint)),
    );
  return [
    h(
      "fieldset",
      null,
      h("legend", null, "Home opens with"),
      radio("reels", "Reels", "One short video per screen, swipe for the next. Prefers videos under 3 minutes or in portrait."),
      radio("grid", "Grid", "The full ranked feed as cards, with Popular on your instances below."),
    ),
    ...toggle("sh-popular", 'Show "Popular on your instances"', s.settings.showPopular, (on) => setSetting(() => (s.settings.showPopular = on)), {
      hint: "Each instance's trending list, after your feed (and after your picks in Reels). It never takes slots from your feed and isn't personalized.",
    }),
    h(
      "div",
      { class: "switch" },
      h("label", { for: "sh-theme" }, "Theme"),
      h(
        "select",
        { id: "sh-theme", onchange: (e: Event) => setSetting(() => ((s.settings.theme = (e.target as HTMLSelectElement).value as Settings["theme"]), app.setTheme())) },
        h("option", { value: "auto", selected: s.settings.theme === "auto" }, "System"),
        h("option", { value: "light", selected: s.settings.theme === "light" }, "Light"),
        h("option", { value: "dark", selected: s.settings.theme === "dark" }, "Dark"),
      ),
    ),
  ];
}

function sources(app: App): HTMLElement {
  const { s } = app;
  const status = (st: { status: string; error?: string } | undefined) =>
    !st || st.status === "loading"
      ? h("span", { class: "pill" }, "loading")
      : st.status === "ok"
        ? h("span", { class: "pill ok" }, "ok")
        : h("span", { class: "pill bad", title: st.error }, "unreachable");
  const active = app.match.records().filter((r) => r.status === "active").length;
  return h(
    "ul",
    { class: "list small" },
    h("li", null, h("div", null, `Following ${s.follows.length} channel${s.follows.length === 1 ? "" : "s"} · ${s.taste.length} taste list${s.taste.length === 1 ? "" : "s"}`)),
    h("li", null, h("div", null, `${active} active match${active === 1 ? "" : "es"}`), h("span", { class: "pill " + (active ? "ok" : "") }, app.match.ready ? app.match.relayLabel : "not set up")),
    s.settings.instances.map((o) => h("li", null, h("span", { class: "mono" }, new URL(o).host), status(s.instances.get(o) as never))),
  );
}

function links(app: App): HTMLElement {
  const link = (label: string, go: () => void) => h("button", { class: "linkrow", onclick: go }, h("span", null, label), h("span", { "aria-hidden": "true" }, "›"));
  return h(
    "nav",
    { class: "linkrows", "aria-label": "More settings" },
    link("Follow & taste", () => app.go("follow")),
    link("Matches: identity, relays, requests", () => app.go("matches")),
    link("Sharing & privacy", () => app.go("settings")),
    link("Creator studio", () => app.go("studio")),
    link("Recipe import & export", () => app.go("recipe")),
  );
}

export function renderSheet(app: App, host: HTMLElement, first: boolean): void {
  const { s } = app;
  const layout = sheetLayout(globalThis.innerWidth ?? 1024);
  const prevBody = host.querySelector(".sheet-body") as HTMLElement | null;
  const keepScroll = !first && prevBody ? prevBody.scrollTop : 0;
  const close = () => app.sheet({ type: "close" });
  const rc = recipeControls(app);
  const recipe = app.recipe();
  const weightsOpen = s.ui.weightsOpen === "1";
  const closeBtn = h("button", { class: "iconbtn", id: "sheet-close", "aria-label": "Close feed settings", onclick: close }, icon("close"));
  const body = h(
    "div",
    { class: "sheet-body" },
    section(
      "recipe",
      "Recipe",
      h("p", { class: "muted small" }, "Ranking runs on this device with the recipe you pick. Moving a slider saves a custom copy; the built-ins stay as they are."),
      rc.picker,
      recipe.exploreShare > 0 && recipe.weights.explore > 0
        ? h("div", { class: "row" }, h("button", { class: "btn sm", onclick: () => { s.seed = Math.floor(cryptoRng()() * 2 ** 31); app.toast("New-creator picks shuffled"); app.rerender(); } }, "Shuffle new creators"))
        : null,
      h(
        "details",
        { open: weightsOpen, ontoggle: (e: Event) => (s.ui.weightsOpen = (e.target as HTMLDetailsElement).open ? "1" : undefined) },
        h("summary", null, "Source weights"),
        h("div", { class: "stack" }, rc.weights),
      ),
      h("h4", null, "Shape"),
      rc.shape,
    ),
    section("filters", "Filters", filters(app)),
    section("view", "View", view(app)),
    section("more", "More", links(app), h("h4", null, "Sources"), sources(app)),
  );
  const panel = h(
    "div",
    { class: `sheet ${layout}`, "data-layout": layout, role: "dialog", "aria-modal": "true", "aria-labelledby": "sheet-h" },
    h("div", { class: "sheet-head" }, h("span", { class: "grabber", "aria-hidden": "true" }), h("h2", { id: "sheet-h" }, "Feed settings"), closeBtn),
    body,
  );
  const scrim = h("div", { class: "sheet-scrim", onclick: close });
  panel.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
      return;
    }
    if (e.key !== "Tab") return;
    const els = [...panel.querySelectorAll<HTMLElement>("button, a[href], input, select, textarea, summary, [tabindex]:not([tabindex='-1'])")].filter((x) => !x.hasAttribute("disabled") && x.offsetParent !== null);
    const idx = els.indexOf(document.activeElement as HTMLElement);
    const atEdge = e.shiftKey ? idx <= 0 : idx === els.length - 1;
    if (atEdge || idx < 0) {
      e.preventDefault();
      els[trapFocus(idx, els.length, e.shiftKey)]?.focus();
    }
  });
  const focusId = (document.activeElement as HTMLElement | null)?.id;
  host.replaceChildren(scrim, panel);
  document.body.classList.add("sheet-open");
  if (first) {
    requestAnimationFrame(() => {
      panel.classList.add("in");
      scrim.classList.add("in");
      if (s.sheet.section !== "recipe") document.getElementById(`sh-sec-${s.sheet.section}`)?.scrollIntoView({ block: "start" });
      closeBtn.focus({ preventScroll: true });
    });
  } else {
    panel.classList.add("in");
    scrim.classList.add("in");
    body.scrollTop = keepScroll;
    if (focusId) document.getElementById(focusId)?.focus({ preventScroll: true });
  }
}
