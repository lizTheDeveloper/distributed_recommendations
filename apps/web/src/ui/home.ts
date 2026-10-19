import type { App } from "../app.ts";
import type { RankedItem, SourceKind } from "../lib/core.ts";
import { CHIP_LABELS, cryptoRng } from "../lib/core.ts";
import { disclosureIndex } from "../lib/candidates.ts";
import { parseChannelInput } from "../lib/handles.ts";
import { BUILTIN_RECIPES } from "../lib/recipes.ts";
import { formatDuration, placeholderGradient, videoHost } from "../lib/videos.ts";
import { h } from "./dom.ts";

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

function sourcesPanel(app: App): HTMLElement {
  const { s } = app;
  const status = (st: { status: string; error?: string } | undefined) =>
    !st || st.status === "loading"
      ? h("span", { class: "pill" }, "loading")
      : st.status === "ok"
        ? h("span", { class: "pill ok" }, "ok")
        : h("span", { class: "pill bad", title: st.error }, "unreachable");
  const instRows = s.settings.instances.map((o) => {
    const st = s.instances.get(o);
    return h("li", null, h("div", null, h("span", { class: "mono small" }, new URL(o).host)), status(st as never));
  });
  const tasteLoaded = s.taste.filter((t) => s.tasteRes.get(t.key)?.status === "ok").length;
  return h(
    "div",
    { class: "stack" },
    h("h3", null, "Sources"),
    h(
      "ul",
      { class: "list small" },
      h(
        "li",
        null,
        h("div", null, `Following ${s.follows.length} channel${s.follows.length === 1 ? "" : "s"}`),
        h("button", { class: "linkbtn", onclick: () => app.go("follow") }, "Manage"),
      ),
      h(
        "li",
        null,
        h("div", null, `${s.taste.length} taste list${s.taste.length === 1 ? "" : "s"}`, s.taste.length > tasteLoaded ? h("span", { class: "muted" }, ` (${s.taste.length - tasteLoaded} loading)`) : null),
        h("button", { class: "linkbtn", onclick: () => app.go("follow") }, "Manage"),
      ),
      h("li", null, h("div", { class: "muted" }, "Matches and circles"), h("span", { class: "pill next" }, "coming next")),
    ),
    h("p", { class: "muted small" }, "Catalog read from:"),
    h("ul", { class: "list" }, instRows),
  );
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
    { class: "card" },
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

export function hashId(s: string): string {
  let h1 = 5381;
  for (let i = 0; i < s.length; i++) h1 = (Math.imul(h1, 33) ^ s.charCodeAt(i)) >>> 0;
  return h1.toString(36);
}

export function homeScreen(app: App): HTMLElement {
  const { s } = app;
  const recipe = app.recipe();
  const { items, candidates } = app.feed();
  const loading = [...s.instances.values()].some((x) => x.status === "loading");
  const allFailed = s.instances.size > 0 && [...s.instances.values()].every((x) => x.status === "error");
  const disclosures = disclosureIndex(app.resolvedLists());
  const exploreCount = items.filter((i) => i.primary === "explore").length;

  const aside = h(
    "aside",
    { class: "panel", "aria-label": "Feed controls" },
    h("h2", null, "Your feed recipe"),
    h(
      "div",
      { class: "field" },
      h("label", { for: "home-recipe", class: "muted" }, "Ranking runs on this device"),
      recipePicker(app, "home-recipe"),
      h(
        "p",
        { class: "muted small" },
        recipe.exploreShare > 0 && recipe.weights.explore > 0
          ? `${Math.round(recipe.exploreShare * 100)}% of slots stay reserved for new creators you have no tie to.`
          : "No explore slots in this recipe.",
      ),
      h("div", { class: "row" }, h("button", { class: "btn sm", onclick: () => app.go("recipe") }, "Edit recipe"),
        recipe.exploreShare > 0
          ? h("button", { class: "btn sm", onclick: () => { s.seed = Math.floor(cryptoRng()() * 2 ** 31); app.rerender(); } }, "Shuffle new creators")
          : null),
    ),
    sourcesPanel(app),
    h("div", { class: "legend", "aria-label": "Chip legend" }, LEGEND.map(chip)),
  );

  let body: HTMLElement;
  if (items.length === 0 && loading) {
    body = h("div", { class: "grid", "aria-busy": "true" }, Array.from({ length: 6 }, () => h("div", { class: "card" }, h("div", { class: "skeleton" }))));
  } else if (items.length === 0) {
    body = h(
      "div",
      { class: "empty" },
      h("h3", null, allFailed ? "Couldn't reach any instance" : "Nothing to show with this recipe yet"),
      h(
        "p",
        { class: "muted small" },
        allFailed
          ? "Check your connection, or add a different PeerTube instance in Sharing & settings."
          : recipe.weights.follow > 0 && s.follows.length === 0 && recipe.weights.taste === 0
            ? "This recipe only shows channels you follow. Follow a channel, or pick another recipe."
            : "Follow a channel or subscribe to a taste list to give the ranker something to work with.",
      ),
      h("div", { class: "row" }, h("button", { class: "btn follow", onclick: () => app.go("follow") }, "Follow & taste"), allFailed ? h("button", { class: "btn", onclick: () => app.reloadCatalog() }, "Retry") : null),
    );
  } else {
    body = h("div", { class: "grid" }, items.map((it) => card(app, it, disclosures)));
  }

  return h(
    "section",
    { class: "home" },
    aside,
    h(
      "div",
      { style: { "min-width": "0" } },
      h(
        "div",
        { class: "feedhead" },
        h("h2", null, recipe.name),
        h(
          "p",
          { class: "muted small mono" },
          loading ? "loading catalog… " : "",
          `${items.length} of ${candidates} candidates · ${exploreCount} new-creator`,
        ),
      ),
      body,
    ),
  );
}
