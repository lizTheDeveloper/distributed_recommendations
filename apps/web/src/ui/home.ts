import type { App } from "../app.ts";
import type { RankedItem, SourceKind } from "../lib/core.ts";
import { CHIP_LABELS } from "../lib/core.ts";
import { disclosureIndex } from "../lib/candidates.ts";
import { parseChannelInput } from "../lib/handles.ts";
import { BUILTIN_RECIPES, recipePillText } from "../lib/recipes.ts";
import { formatDuration, placeholderGradient, videoHost } from "../lib/videos.ts";
import { h } from "./dom.ts";
import { icon } from "./icons.ts";
import { reelsScreen } from "./reels.ts";

export const LEGEND: SourceKind[] = ["follow", "taste", "match", "circle", "second", "explore"];

export function chip(kind: SourceKind): HTMLElement {
  return h("span", { class: `chip c-${kind}` }, CHIP_LABELS[kind]);
}

export function recipePicker(app: App, id: string): HTMLElement {
  const sel = h(
    "select",
    {
      id,
      onchange: (e: Event) => app.setRecipe((e.target as HTMLSelectElement).value),
    },
    BUILTIN_RECIPES.map((b) => h("option", { value: b.id, selected: app.s.recipe.id === b.id }, b.recipe.name)),
    app.s.recipe.custom ? h("option", { value: "custom", selected: app.s.recipe.id === "custom" }, `Custom: ${app.s.recipe.custom.name}`) : null,
  );
  return sel;
}

function card(app: App, item: RankedItem, disclosures: ReturnType<typeof disclosureIndex>): HTMLElement {
  const v = item.video;
  const whyId = "why-" + hashId(v.id);
  const open = app.s.openWhy.has(v.id);
  const host = videoHost(v);
  const following = app.isFollowing(v.creator);
  const d = disclosures.get(v.id);
  const thumb = h(
    "button",
    {
      class: "thumb",
      style: { background: placeholderGradient(v.creator + v.title) },
      "aria-label": `Play ${v.title}`,
      onclick: () => app.watch(v, item.primary),
    },
    v.thumbnailUrl && app.mode === "live"
      ? h("img", {
          src: v.thumbnailUrl,
          alt: "",
          loading: "lazy",
          decoding: "async",
          referrerpolicy: "no-referrer",
          onerror: (e: Event) => ((e.target as HTMLElement).hidden = true),
        })
      : h("span", { class: "ph", "aria-hidden": "true" }, v.title),
    h("span", { class: "host" }, host),
    v.durationSec ? h("span", { class: "dur" }, formatDuration(v.durationSec)) : null,
  );
  return h(
    "article",
    { class: "card", "data-vid": v.id },
    thumb,
    h("h3", null, h("button", { onclick: () => app.watch(v, item.primary) }, v.title)),
    h(
      "div",
      { class: "byline" },
      h("span", { title: v.creator }, v.creatorName ?? v.creator),
      following
        ? h("span", { class: "pill ok" }, "Following")
        : h(
            "button",
            {
              class: "linkbtn",
              "aria-label": `Follow ${v.creatorName ?? v.creator}`,
              onclick: () => {
                const ref = parseChannelInput(v.creator);
                if (ref) app.follow(ref, v.creatorName);
              },
            },
            "+ Follow",
          ),
      cardMenu(app, item),
    ),
    h(
      "div",
      { class: "chips" },
      chip(item.primary),
      d?.sponsored.length ? h("span", { class: "pill spon", title: `Marked sponsored in ${d.sponsored.join(", ")}` }, "Sponsored") : null,
      d?.affiliated.length ? h("span", { class: "pill spon", title: `Marked affiliated in ${d.affiliated.join(", ")}` }, "Affiliated") : null,
    ),
    h(
      "button",
      {
        class: "why",
        "aria-expanded": String(open),
        "aria-controls": whyId,
        id: whyId + "-btn",
        onclick: () => {
          if (open) app.s.openWhy.delete(v.id);
          else app.s.openWhy.add(v.id);
          app.rerender();
        },
      },
      "Why am I seeing this?",
    ),
    h(
      "div",
      { class: "whybox", id: whyId, hidden: !open },
      item.why.map((line) => h("span", null, line)),
      d?.sponsored.length ? h("span", null, `Sponsored placement, disclosed by ${d.sponsored.join(", ")}`) : null,
      d?.affiliated.length ? h("span", null, `The curator of ${d.affiliated.join(", ")} has a connection to this creator`) : null,
      h("span", { class: "mono", style: { opacity: "0.75" } }, `score ${item.score.toFixed(3)} · ranked on this device`),
    ),
  );
}

/** The card's ⋯ menu: Follow taste, Creator studio, Not interested. */
function cardMenu(app: App, item: RankedItem): HTMLElement {
  const v = item.video;
  const name = v.creatorName ?? v.creator;
  const id = "cm-" + hashId(v.id);
  const st = app.tasteState(v.creator);
  const details = h("details", { class: "cardmenu", id }) as HTMLDetailsElement;
  const close = () => (details.open = false);
  const tasteLabel = st === "following" ? `Following ${name}'s taste…` : st === "unavailable" ? `${name}: no public picks yet` : `Follow ${name}'s taste…`;
  details.append(
    h("summary", { "aria-label": `More for ${v.title}`, id: id + "-btn" }, h("span", { "aria-hidden": "true" }, "⋯")),
    h(
      "div",
      { class: "menu", role: "menu" },
      h("button", { role: "menuitem", disabled: st === "unavailable", onclick: () => (close(), app.openTaste(v.creator, name, id + "-btn")) }, icon("taste", 18), tasteLabel),
      h("button", { role: "menuitem", onclick: () => (close(), (app.s.ui.studioInput = undefined), app.loadStudio(v.creator), app.go("studio")) }, icon("studio", 18), "Creator studio"),
      h("button", { role: "menuitem", onclick: () => (close(), app.notInterested(v)) }, icon("eyeoff", 18), "Not interested"),
    ),
  );
  // Look up whether the creator publishes picks only when the menu opens.
  details.addEventListener("toggle", () => {
    if (details.open) void app.lookupCreatorTaste(v.creator, v.creatorName);
  });
  details.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Escape" && details.open) {
      e.stopPropagation();
      close();
      (details.querySelector("summary") as HTMLElement).focus();
    }
  });
  return details;
}

/** Feed cards seen at least half on screen feed each taste list's track record. */
function observeShown(app: App, grid: HTMLElement) {
  const IO = (globalThis as { IntersectionObserver?: typeof IntersectionObserver }).IntersectionObserver;
  if (!IO) return;
  const io = new IO(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const id = (e.target as HTMLElement).dataset.vid;
        if (id) app.markShown(id);
        io.unobserve(e.target);
      }
    },
    { threshold: 0.5 },
  );
  for (const c of grid.querySelectorAll<HTMLElement>(".card")) io.observe(c);
}

export function hashId(s: string): string {
  let h1 = 5381;
  for (let i = 0; i < s.length; i++) h1 = (Math.imul(h1, 33) ^ s.charCodeAt(i)) >>> 0;
  return h1.toString(36);
}

/** View switch (Reels / Grid) and the current-recipe pill: all Home keeps on screen. */
export function feedBar(app: App, overlay: boolean): HTMLElement {
  const { s } = app;
  const recipe = app.recipe();
  const seg = (v: "reels" | "grid", label: string) =>
    h(
      "button",
      { class: "seg", id: `view-${v}`, "aria-pressed": String(s.view === v), onclick: () => app.setView(v) },
      icon(v, 16),
      h("span", null, label),
    );
  return h(
    "div",
    { class: "feedbar" + (overlay ? " overlay" : ""), role: "toolbar", "aria-label": "Feed view" },
    h("div", { class: "segs", role: "group", "aria-label": "View" }, seg("reels", "Reels"), seg("grid", "Grid")),
    h(
      "button",
      {
        class: "recipe-pill",
        id: "recipe-pill",
        "aria-label": `Recipe: ${recipe.name}. Open feed settings`,
        onclick: () => app.sheet({ type: "open", section: "recipe", from: "recipe-pill" }),
      },
      icon("sliders", 15),
      h("span", null, recipePillText(recipe)),
    ),
  );
}

export function gridView(app: App): HTMLElement {
  const { s } = app;
  const recipe = app.recipe();
  const { items, candidates, popular, personalizedExplore } = app.feed();
  const loading = [...s.instances.values()].some((x) => x.status === "loading");
  const allFailed = s.instances.size > 0 && [...s.instances.values()].every((x) => x.status === "error");
  const disclosures = disclosureIndex(app.resolvedLists());
  const exploreCount = items.filter((i) => i.primary === "explore").length;
  const matchCount = items.filter((i) => i.primary === "match").length;

  let body: HTMLElement;
  if (items.length === 0 && loading) {
    body = h("div", { class: "grid", "aria-busy": "true" }, Array.from({ length: 6 }, () => h("div", { class: "card" }, h("div", { class: "skeleton" }))));
  } else if (items.length === 0) {
    body = emptyFeed(app, allFailed);
  } else {
    body = h("div", { class: "grid" }, items.map((it) => card(app, it, disclosures)));
    observeShown(app, body);
  }
  const popularSection = popular.length
    ? h(
        "section",
        { class: "popular", "aria-labelledby": "popular-h" },
        h(
          "div",
          { class: "feedhead" },
          h("h2", { id: "popular-h" }, "Popular on your instances"),
          h("p", { class: "muted small" }, "Each instance's trending list, kept out of your feed so it can't crowd out the lists you chose. Not personalized."),
        ),
        h("div", { class: "grid" }, popular.map((it) => card(app, it, disclosures))),
      )
    : null;

  return h(
    "section",
    { class: "home" },
    feedBar(app, false),
    h(
      "div",
      { class: "feedhead" },
      h("h2", null, recipe.name),
      h(
        "p",
        { class: "muted small mono" },
        loading ? "loading catalog… " : "",
        `${items.length} of ${candidates} candidates · ${exploreCount} new-creator${exploreCount ? (personalizedExplore ? " (fit to your endorsements)" : " (not personalized)") : ""}${matchCount ? ` · ${matchCount} from matches` : ""}`,
      ),
    ),
    body,
    popularSection,
    h("div", { class: "legend", "aria-label": "Chip legend" }, LEGEND.map(chip)),
  );
}

export function emptyFeed(app: App, allFailed: boolean): HTMLElement {
  const recipe = app.recipe();
  return h(
    "div",
    { class: "empty" },
    h("h3", null, allFailed ? "Couldn't reach any instance" : "Nothing to show with this recipe yet"),
    h(
      "p",
      { class: "muted small" },
      allFailed
        ? "Check your connection, or add a different PeerTube instance in Sharing & privacy."
        : recipe.weights.follow > 0 && app.s.follows.length === 0 && recipe.weights.taste === 0
          ? "This recipe only shows channels you follow. Follow a channel, or pick another recipe."
          : "Follow a channel or subscribe to a taste list to give the ranker something to work with.",
    ),
    h(
      "div",
      { class: "row" },
      h("button", { class: "btn follow", onclick: () => app.go("follow") }, "Follow & taste"),
      h("button", { class: "btn", onclick: () => app.sheet({ type: "open", section: "recipe" }) }, "Feed settings"),
      allFailed ? h("button", { class: "btn", onclick: () => app.reloadCatalog() }, "Retry") : null,
    ),
  );
}

export function homeScreen(app: App): HTMLElement {
  return app.s.view === "reels" ? reelsScreen(app) : gridView(app);
}
