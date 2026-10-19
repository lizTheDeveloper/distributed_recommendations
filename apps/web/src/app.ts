// App shell: state, persistence, data loading and screen routing.

import type { Recipe, RankedItem, SourceKind, Video } from "./lib/core.ts";
import { cryptoRng, parseRecipe, rank, recipeToJson, seededRng } from "./lib/core.ts";
import type { Catalog, ChannelStats } from "./lib/catalog.ts";
import { mapLimit } from "./lib/catalog.ts";
import type { InstanceFeed, ResolvedTasteList } from "./lib/candidates.ts";
import { buildCandidates } from "./lib/candidates.ts";
import type { ChannelRef } from "./lib/handles.ts";
import { handleOf, parseChannelInput } from "./lib/handles.ts";
import type { WatchEvent } from "./lib/history.ts";
import { isEndorsed, loadHistory, record, seenSet, unendorse } from "./lib/history.ts";
import type { Tally } from "./lib/analytics.ts";
import { countView, emptyTally, loadTally } from "./lib/analytics.ts";
import { BUILTIN_RECIPES } from "./lib/recipes.ts";
import type { Settings } from "./lib/settings.ts";
import { loadSettings } from "./lib/settings.ts";
import type { KV } from "./lib/storage.ts";
import { readJson, writeJson } from "./lib/storage.ts";
import type { TasteList } from "./lib/tastelist.ts";
import { parseTasteList } from "./lib/tastelist.ts";
import { loadVideo, storeVideo } from "./lib/videos.ts";
import { h } from "./ui/dom.ts";
import { homeScreen } from "./ui/home.ts";
import { followScreen } from "./ui/follow.ts";
import { recipeScreen } from "./ui/recipe.ts";
import { settingsScreen } from "./ui/settings.ts";
import { studioScreen } from "./ui/studio.ts";
import { openWatch } from "./ui/watch.ts";

export type Load<T> = { status: "loading" } | { status: "ok"; value: T } | { status: "error"; error: string };

export interface FollowEntry {
  handle: string;
  name?: string;
  addedAt: number;
}

export interface TasteSub {
  key: string;
  source: "url" | "paste" | "example";
  url?: string;
  list: TasteList;
  addedAt: number;
}

export type ScreenId = "home" | "follow" | "recipe" | "settings" | "studio";

export const SCREENS: { id: ScreenId; label: string }[] = [
  { id: "home", label: "Home feed" },
  { id: "follow", label: "Follow & taste" },
  { id: "recipe", label: "Recipe" },
  { id: "settings", label: "Sharing & settings" },
  { id: "studio", label: "Creator studio" },
];

export interface State {
  settings: Settings;
  follows: FollowEntry[];
  taste: TasteSub[];
  recipe: { id: string; custom: Recipe | null };
  history: WatchEvent[];
  tally: Tally;
  screen: ScreenId;
  seed: number;
  instances: Map<string, Load<InstanceFeed>>;
  followVideos: Map<string, Load<Video[]>>;
  tasteRes: Map<string, Load<{ videos: Video[]; missing: number }>>;
  videoCache: Map<string, Video>;
  openWhy: Set<string>;
  studio: { handle: string; load: Load<ChannelStats> | null };
  /** Transient form state (inputs, errors) keyed by form. */
  ui: Record<string, string | undefined>;
}

export interface AppOptions {
  root: HTMLElement;
  catalog: Catalog;
  kv: KV;
  mode: "live" | "snapshot";
  now: () => Date;
  /** Shown as a banner in snapshot mode. */
  snapshotNote?: string;
  /** Bundled example taste lists. */
  examples: { file: string; list: unknown }[];
}

type PersistKey = "settings" | "follows" | "taste" | "recipe" | "history" | "tally" | "videos";

export interface App {
  s: State;
  mode: "live" | "snapshot";
  catalog: Catalog;
  examples: { file: string; list: TasteList }[];
  now(): Date;
  recipe(): Recipe;
  feed(): { items: RankedItem[]; candidates: number };
  resolvedLists(): ResolvedTasteList[];
  persist(...keys: PersistKey[]): void;
  rerender(): void;
  toast(msg: string): void;
  go(screen: ScreenId): void;
  setRecipe(id: string, custom?: Recipe): void;
  isFollowing(creator: string): boolean;
  follow(ref: ChannelRef, name?: string): void;
  unfollow(handle: string): void;
  addTaste(sub: TasteSub): void;
  removeTaste(key: string): void;
  watch(v: Video, via?: SourceKind): void;
  isEndorsed(id: string): boolean;
  toggleEndorse(v: Video, via?: SourceKind): void;
  wipeHistory(): void;
  reloadCatalog(): void;
  loadStudio(handle: string): void;
  setTheme(): void;
}

const FEED_LIMIT = 60;
const VIDEO_CACHE_CAP = 600;

export function startApp(opts: AppOptions): App {
  const { kv, catalog } = opts;
  const examples = opts.examples.map((e) => ({ file: e.file, list: parseTasteList(e.list) }));

  const storedRecipe = readJson<{ id?: unknown; custom?: unknown }>(kv, "recipe", {});
  let custom: Recipe | null = null;
  try {
    if (storedRecipe.custom) custom = parseRecipe(storedRecipe.custom);
  } catch {
    custom = null;
  }
  const recipeId =
    typeof storedRecipe.id === "string" && (BUILTIN_RECIPES.some((b) => b.id === storedRecipe.id) || (storedRecipe.id === "custom" && custom))
      ? storedRecipe.id
      : "default";

  const videoCache = new Map<string, Video>();
  for (const sv of readJson<unknown[]>(kv, "videos", [], (x) => (Array.isArray(x) ? x : []))) {
    const v = loadVideo(sv);
    if (v) videoCache.set(v.id, v);
  }

  const storedTab = kv.get("mf.v1.tab");
  const s: State = {
    settings: readJson(kv, "settings", loadSettings(null), loadSettings),
    follows: readJson<FollowEntry[]>(kv, "follows", [], (x) =>
      Array.isArray(x) ? x.filter((f) => f && typeof f.handle === "string" && parseChannelInput(f.handle)) : [],
    ),
    taste: readJson<TasteSub[]>(kv, "taste", [], (x) => {
      if (!Array.isArray(x)) return [];
      const out: TasteSub[] = [];
      for (const t of x) {
        try {
          out.push({ key: String(t.key), source: t.source, url: t.url, list: parseTasteList(t.list), addedAt: Number(t.addedAt) || 0 });
        } catch {
          /* drop invalid */
        }
      }
      return out;
    }),
    recipe: { id: recipeId, custom },
    history: readJson(kv, "history", [], loadHistory),
    tally: readJson(kv, "tally", emptyTally(), loadTally),
    screen: SCREENS.some((x) => x.id === storedTab) ? (storedTab as ScreenId) : "home",
    seed: Math.floor(cryptoRng()() * 2 ** 31),
    instances: new Map(),
    followVideos: new Map(),
    tasteRes: new Map(),
    videoCache,
    openWhy: new Set(),
    studio: { handle: "", load: null },
    ui: {},
  };

  // ---- shell ----
  const tabs = h("nav", { class: "tabs", role: "tablist", "aria-label": "Screens" });
  const main = h("main", { id: "screen", role: "tabpanel" });
  const toastEl = h("div", { class: "toast", role: "status", hidden: true });
  const themeSel = h(
    "select",
    { "aria-label": "Theme", onchange: (e: Event) => {
      s.settings.theme = (e.target as HTMLSelectElement).value as Settings["theme"];
      app.persist("settings");
      app.setTheme();
    } },
    h("option", { value: "auto" }, "Theme: system"),
    h("option", { value: "light" }, "Theme: light"),
    h("option", { value: "dark" }, "Theme: dark"),
  );
  for (const sc of SCREENS) {
    tabs.appendChild(
      h("button", { role: "tab", id: `tab-${sc.id}`, "data-screen": sc.id, "aria-controls": "screen", onclick: () => app.go(sc.id) }, sc.label),
    );
  }
  opts.root.replaceChildren(
    h(
      "div",
      { class: "wrap" },
      h(
        "header",
        { class: "intro" },
        h(
          "div",
          null,
          h("h1", null, "Match Feed"),
          h("p", { class: "muted" }, "Federated video, ranked on this device by a recipe you control. Every pick says why it's here."),
        ),
        themeSel,
      ),
      opts.mode === "snapshot" && opts.snapshotNote
        ? h("div", { class: "banner-note", role: "note" }, h("div", null, h("strong", null, "Offline snapshot. "), opts.snapshotNote))
        : null,
      tabs,
      main,
    ),
    toastEl,
  );

  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  let renderQueued = false;

  function render() {
    renderQueued = false;
    const active = document.activeElement as HTMLElement | null;
    const focusId = active && main.contains(active) ? active.id : "";
    for (const b of tabs.querySelectorAll("button")) b.setAttribute("aria-selected", String(b.dataset.screen === s.screen));
    main.setAttribute("aria-labelledby", `tab-${s.screen}`);
    const screen = { home: homeScreen, follow: followScreen, recipe: recipeScreen, settings: settingsScreen, studio: studioScreen }[s.screen];
    main.replaceChildren(screen(app));
    if (focusId) document.getElementById(focusId)?.focus({ preventScroll: true });
  }

  // ---- data loading ----
  const errText = (e: unknown) =>
    e instanceof TypeError ? "couldn't reach it (offline, blocked, or no CORS)" : e instanceof Error ? e.message : String(e);

  async function loadInstance(origin: string) {
    s.instances.set(origin, { status: "loading" });
    try {
      const [trending, recent] = await Promise.all([catalog.instanceVideos(origin, "trending", 50), catalog.instanceVideos(origin, "recent", 50)]);
      s.instances.set(origin, { status: "ok", value: { origin, trending, recent } });
    } catch (e) {
      s.instances.set(origin, { status: "error", error: errText(e) });
    }
    app.rerender();
  }

  async function loadFollow(handle: string) {
    const ref = parseChannelInput(handle);
    if (!ref) return;
    s.followVideos.set(handle, { status: "loading" });
    try {
      const vids = await catalog.channelVideos(ref, 15);
      s.followVideos.set(handle, { status: "ok", value: vids });
      const f = s.follows.find((x) => x.handle === handle);
      if (f && !f.name && vids[0]?.creatorName) {
        f.name = vids[0].creatorName;
        app.persist("follows");
      }
    } catch (e) {
      s.followVideos.set(handle, { status: "error", error: errText(e) });
    }
    app.rerender();
  }

  async function loadTaste(sub: TasteSub) {
    s.tasteRes.set(sub.key, { status: "loading" });
    app.rerender();
    let missing = 0;
    const vids = await mapLimit(sub.list.items, 4, async (it) => {
      const cached = s.videoCache.get(it.id);
      if (cached) return cached;
      try {
        const v = await catalog.resolveVideo(it.id);
        if (v) s.videoCache.set(v.id, v);
        return v;
      } catch {
        return null;
      }
    });
    const videos = vids.filter((v): v is Video => {
      if (!v) missing++;
      return !!v;
    });
    // Ignore the result if the list was removed meanwhile.
    if (!s.taste.some((t) => t.key === sub.key)) return;
    s.tasteRes.set(sub.key, { status: "ok", value: { videos, missing } });
    app.persist("videos");
    app.rerender();
  }

  const app: App = {
    s,
    mode: opts.mode,
    catalog,
    examples,
    now: opts.now,
    recipe() {
      if (s.recipe.id === "custom" && s.recipe.custom) return s.recipe.custom;
      return (BUILTIN_RECIPES.find((b) => b.id === s.recipe.id) ?? BUILTIN_RECIPES[0]).recipe;
    },
    resolvedLists() {
      const out: ResolvedTasteList[] = [];
      for (const t of s.taste) {
        const r = s.tasteRes.get(t.key);
        if (r?.status === "ok") out.push({ list: t.list, videos: r.value.videos });
      }
      return out;
    },
    feed() {
      const instances: InstanceFeed[] = [];
      for (const r of s.instances.values()) if (r.status === "ok") instances.push(r.value);
      const followVideos: Video[] = [];
      for (const r of s.followVideos.values()) if (r.status === "ok") followVideos.push(...r.value);
      const candidates = buildCandidates({
        instances,
        follows: new Set(s.follows.map((f) => f.handle)),
        followVideos,
        tasteLists: app.resolvedLists(),
        trendingAsTaste: s.settings.trendingAsTaste,
      });
      const items = rank(candidates, app.recipe(), { now: opts.now(), limit: FEED_LIMIT, rng: seededRng(s.seed), seen: seenSet(s.history) });
      return { items, candidates: new Set(candidates.map((c) => c.video.id)).size };
    },
    persist(...keys) {
      for (const k of keys) {
        if (k === "recipe") writeJson(kv, "recipe", { id: s.recipe.id, custom: s.recipe.custom ? recipeToJson(s.recipe.custom) : null });
        else if (k === "videos") writeJson(kv, "videos", [...s.videoCache.values()].slice(-VIDEO_CACHE_CAP).map(storeVideo));
        else writeJson(kv, k, s[k]);
      }
    },
    rerender() {
      if (renderQueued) return;
      renderQueued = true;
      (globalThis.requestAnimationFrame ?? ((f: () => void) => setTimeout(f, 0)))(render);
    },
    toast(msg) {
      toastEl.textContent = msg;
      toastEl.hidden = false;
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => (toastEl.hidden = true), 2600);
    },
    go(screen) {
      s.screen = screen;
      kv.set("mf.v1.tab", screen);
      render();
      window.scrollTo?.({ top: 0 });
    },
    setRecipe(id, customRecipe) {
      s.recipe = { id, custom: customRecipe ?? s.recipe.custom };
      app.persist("recipe");
      app.rerender();
    },
    isFollowing(creator) {
      return s.follows.some((f) => f.handle === creator.toLowerCase());
    },
    follow(ref, name) {
      const handle = handleOf(ref);
      if (s.follows.some((f) => f.handle === handle)) return;
      s.follows = [...s.follows, { handle, name, addedAt: Date.now() }];
      app.persist("follows");
      app.toast(`Following ${name ?? handle}`);
      void loadFollow(handle);
      app.rerender();
    },
    unfollow(handle) {
      const f = s.follows.find((x) => x.handle === handle);
      s.follows = s.follows.filter((x) => x.handle !== handle);
      s.followVideos.delete(handle);
      app.persist("follows");
      app.toast(`Unfollowed ${f?.name ?? handle}`);
      app.rerender();
    },
    addTaste(sub) {
      s.taste = [...s.taste.filter((t) => t.key !== sub.key), sub];
      app.persist("taste");
      app.toast(`Subscribed to "${sub.list.name}"`);
      void loadTaste(sub);
    },
    removeTaste(key) {
      const t = s.taste.find((x) => x.key === key);
      s.taste = s.taste.filter((x) => x.key !== key);
      s.tasteRes.delete(key);
      app.persist("taste");
      if (t) app.toast(`Removed "${t.list.name}"`);
      app.rerender();
    },
    watch(v, via) {
      const before = s.history;
      s.history = record(s.history, { videoId: v.id, at: Date.now(), kind: "watch", tags: v.tags, via }, s.settings);
      if (s.history !== before) app.persist("history");
      if (via) {
        s.tally = countView(s.tally, via, s.settings);
        app.persist("tally");
      }
      openWatch(app, v, via, () => app.rerender());
    },
    isEndorsed(id) {
      return isEndorsed(s.history, id);
    },
    toggleEndorse(v, via) {
      if (isEndorsed(s.history, v.id)) {
        s.history = unendorse(s.history, v.id);
        app.toast("Endorsement removed");
      } else {
        const before = s.history;
        s.history = record(s.history, { videoId: v.id, at: Date.now(), kind: "endorse", tags: v.tags, via }, s.settings);
        app.toast(s.history === before ? "Private watching is on: not recorded" : "Endorsed. Kept on this device only");
      }
      app.persist("history");
    },
    wipeHistory() {
      s.history = [];
      s.tally = emptyTally();
      app.persist("history", "tally");
      app.toast("Local history wiped");
      app.rerender();
    },
    reloadCatalog() {
      for (const k of [...s.instances.keys()]) if (!s.settings.instances.includes(k)) s.instances.delete(k);
      for (const o of s.settings.instances) void loadInstance(o);
      for (const f of s.follows) void loadFollow(f.handle);
      app.rerender();
    },
    loadStudio(handle) {
      const ref = parseChannelInput(handle);
      if (!ref) {
        s.studio = { handle, load: { status: "error", error: "Enter a channel as name@host, e.g. blender@video.blender.org" } };
        app.rerender();
        return;
      }
      s.studio = { handle: handleOf(ref), load: { status: "loading" } };
      app.rerender();
      catalog.channelStats(ref).then(
        (value) => {
          if (s.studio.handle === handleOf(ref)) s.studio.load = { status: "ok", value };
          app.rerender();
        },
        (e) => {
          if (s.studio.handle === handleOf(ref)) s.studio.load = { status: "error", error: errText(e) };
          app.rerender();
        },
      );
    },
    setTheme() {
      const t = s.settings.theme;
      if (t === "auto") document.documentElement.removeAttribute("data-theme");
      else document.documentElement.setAttribute("data-theme", t);
      themeSel.value = t;
    },
  };

  app.setTheme();
  render();
  app.reloadCatalog();
  for (const t of s.taste) void loadTaste(t);
  return app;
}
