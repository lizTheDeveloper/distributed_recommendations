// App shell: state, persistence, data loading and screen routing.

import type { Recipe, RankedItem, SourceKind, Video } from "./lib/core.ts";
import { cryptoRng, parseRecipe, rank, recipeToJson, seededRng, tagProfile, tagRelevance } from "./lib/core.ts";
import type { Catalog, ChannelStats } from "./lib/catalog.ts";
import { mapLimit } from "./lib/catalog.ts";
import type { InstanceFeed, ResolvedTasteList } from "./lib/candidates.ts";
import { buildCandidates, buildPopularCandidates, listMembership, popularRecipe } from "./lib/candidates.ts";
import type { Impressions } from "./lib/trackrecord.ts";
import { emptyImpressions, listStrength, loadImpressions, recordImpression } from "./lib/trackrecord.ts";
import type { ChannelRef } from "./lib/handles.ts";
import { handleOf, parseChannelInput } from "./lib/handles.ts";
import type { WatchEvent } from "./lib/history.ts";
import { DAY_MS, isEndorsed, loadHistory, pruneHistory, record, seenSet, unendorse } from "./lib/history.ts";
import type { Tally } from "./lib/analytics.ts";
import { countView, emptyTally, loadTally } from "./lib/analytics.ts";
import { BUILTIN_RECIPES } from "./lib/recipes.ts";
import type { RetentionDays, Settings } from "./lib/settings.ts";
import { loadSettings } from "./lib/settings.ts";
import type { KV } from "./lib/storage.ts";
import { readJson, writeJson } from "./lib/storage.ts";
import type { SensitiveData, SensitiveKey } from "./lib/localdata.ts";
import { removeLegacy } from "./lib/localdata.ts";
import type { Vault } from "./lib/vault.ts";
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
  /** Feed items actually seen, for taste-list track records (local only). */
  impressions: Impressions;
  /** Tags fetched from video detail endpoints (list endpoints omit tags). */
  tagCache: Map<string, string[]>;
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
  /** Encrypted store for sensitive state (a memory vault when unavailable). */
  vault: Vault;
  /** Decrypted sensitive state, loaded before the app starts. */
  sensitive: SensitiveData;
  /** Plaintext from an older version remains in localStorage (memory vault only). */
  legacyLeft?: boolean;
}

type PersistKey = "settings" | "follows" | "taste" | "recipe" | "history" | "tally" | "videos" | "impressions" | "tags";

export interface App {
  s: State;
  mode: "live" | "snapshot";
  catalog: Catalog;
  vault: Vault;
  /** Plaintext from an older version remains in localStorage (memory vault only). */
  legacyLeft: boolean;
  examples: { file: string; list: TasteList }[];
  now(): Date;
  recipe(): Recipe;
  feed(): { items: RankedItem[]; candidates: number; popular: RankedItem[]; personalizedExplore: boolean };
  /** Note that a feed item scrolled into view (track record). */
  markShown(id: string): void;
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
  /** Wipe history and crypto-shred the vault key. */
  wipeHistory(): Promise<void>;
  setRetention(days: RetentionDays): void;
  /** Delete history outside the sharing window. */
  pruneNow(): void;
  reloadCatalog(): void;
  loadStudio(handle: string): void;
  setTheme(): void;
}

const FEED_LIMIT = 60;
const TAG_CACHE_CAP = 1500;
/** Explore candidates whose tags are fetched for on-device relevance. */
const TAG_FETCH_LIMIT = 40;
const VIDEO_CACHE_CAP = 600;

/** How often the retention sweep checks whether a day has passed. */
const PRUNE_CHECK_MS = 60 * 60 * 1000;

export function startApp(opts: AppOptions): App {
  const { kv, catalog, vault } = opts;
  /** Read decrypted sensitive state, validated like the plaintext reads. */
  function sens<T>(key: SensitiveKey, fallback: T, check?: (x: unknown) => T): T {
    if (!(key in opts.sensitive)) return fallback;
    try {
      return check ? check(opts.sensitive[key]) : (opts.sensitive[key] as T);
    } catch {
      return fallback;
    }
  }
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
  for (const sv of sens<unknown[]>("videos", [], (x) => (Array.isArray(x) ? x : []))) {
    const v = loadVideo(sv);
    if (v) videoCache.set(v.id, v);
  }

  const storedTab = kv.get("mf.v1.tab");
  const s: State = {
    settings: readJson(kv, "settings", loadSettings(null), loadSettings),
    follows: sens<FollowEntry[]>("follows", [], (x) =>
      Array.isArray(x) ? x.filter((f) => f && typeof f.handle === "string" && parseChannelInput(f.handle)) : [],
    ),
    taste: sens<TasteSub[]>("taste", [], (x) => {
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
    history: sens("history", [], loadHistory),
    tally: sens("tally", emptyTally(), loadTally),
    impressions: sens("impressions", emptyImpressions(), loadImpressions),
    tagCache: new Map(
      sens<[string, string[]][]>("tags", [], (x) =>
        Array.isArray(x) ? x.filter((e) => Array.isArray(e) && typeof e[0] === "string" && Array.isArray(e[1])) : [],
      ),
    ),
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
      vault.status === "memory"
        ? h(
            "div",
            { class: "banner-note", role: "note", id: "memory-note" },
            h(
              "div",
              null,
              h("strong", null, "History isn't saved in this browser. "),
              `${vault.reason ?? ""} Follows, taste lists, watches and endorsements are kept in memory and are gone when you close this tab. Nothing is written unencrypted.`,
            ),
          )
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
    void enrichExploreTags();
  }

  // ---- on-device explore relevance ----
  const withTags = (v: Video): Video => (v.tags.length || !s.tagCache.has(v.id) ? v : { ...v, tags: s.tagCache.get(v.id)! });
  const endorsedIds = () => new Set(s.history.filter((e) => e.kind === "endorse").map((e) => e.videoId));
  function profile() {
    const endorsed = s.history.filter((e) => e.kind === "endorse").map((e) => ({ tags: e.tags.length ? e.tags : (s.tagCache.get(e.videoId) ?? []) }));
    return tagProfile(endorsed);
  }
  let enriching = false;
  /**
   * List endpoints omit tags. Once the viewer has endorsed something with tags, fetch
   * details for the newest explore candidates so core can rank them by relevance.
   * The requests are the same for everyone (newest public uploads), so they reveal
   * nothing about the profile; the profile itself never leaves the device.
   */
  async function enrichExploreTags() {
    if (enriching || profile().size === 0) return;
    enriching = true;
    const recent: { v: Video; origin: string }[] = [];
    for (const r of s.instances.values()) if (r.status === "ok") for (const v of r.value.recent) recent.push({ v, origin: r.value.origin });
    const todo = recent
      .filter(({ v }) => !v.tags.length && !s.tagCache.has(v.id))
      .sort((a, b) => b.v.publishedAt.getTime() - a.v.publishedAt.getTime())
      .slice(0, TAG_FETCH_LIMIT);
    await mapLimit(todo, 4, async ({ v, origin }) => {
      const tags = await catalog.videoTags(v.id, [origin]);
      if (tags) s.tagCache.set(v.id, tags);
    });
    enriching = false;
    if (todo.length) {
      app.persist("tags");
      app.rerender();
    }
  }

  async function fetchTagsFor(v: Video) {
    if (v.tags.length || s.tagCache.has(v.id)) return;
    // Instances that listed this video hold a copy; ask them before the origin.
    const via: string[] = [];
    for (const r of s.instances.values()) {
      if (r.status === "ok" && [...r.value.recent, ...r.value.trending].some((x) => x.id === v.id)) via.push(r.value.origin);
    }
    const tags = await catalog.videoTags(v.id, via);
    if (tags) {
      s.tagCache.set(v.id, tags);
      app.persist("tags");
    }
  }

  let impressionTimer: ReturnType<typeof setTimeout> | undefined;

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

  function sensitiveValue(k: SensitiveKey): unknown {
    if (k === "videos") return [...s.videoCache.values()].slice(-VIDEO_CACHE_CAP).map(storeVideo);
    if (k === "tags") return [...s.tagCache.entries()].slice(-TAG_CACHE_CAP);
    return s[k];
  }

  // ---- retention: drop history outside the sharing window, at start and daily ----
  let lastPrune = 0;
  function maybePrune() {
    if (Date.now() - lastPrune >= DAY_MS) app.pruneNow();
  }

  const app: App = {
    s,
    mode: opts.mode,
    catalog,
    vault,
    legacyLeft: !!opts.legacyLeft,
    examples,
    now: opts.now,
    recipe() {
      if (s.recipe.id === "custom" && s.recipe.custom) return s.recipe.custom;
      return (BUILTIN_RECIPES.find((b) => b.id === s.recipe.id) ?? BUILTIN_RECIPES[0]).recipe;
    },
    resolvedLists() {
      const out: ResolvedTasteList[] = [];
      const endorsed = endorsedIds();
      for (const t of s.taste) {
        const r = s.tasteRes.get(t.key);
        if (r?.status === "ok") out.push({ list: t.list, videos: r.value.videos, strength: listStrength(s.impressions, t.list.name, endorsed) });
      }
      return out;
    },
    feed() {
      const instances: InstanceFeed[] = [];
      for (const r of s.instances.values()) if (r.status === "ok") instances.push(r.value);
      const followVideos: Video[] = [];
      for (const r of s.followVideos.values()) if (r.status === "ok") followVideos.push(...r.value);
      const tagged = instances.map((i) => ({ ...i, recent: i.recent.map(withTags), trending: i.trending.map(withTags) }));
      const candidates = buildCandidates({
        instances: tagged,
        follows: new Set(s.follows.map((f) => f.handle)),
        followVideos,
        tasteLists: app.resolvedLists(),
      });
      const prof = profile();
      const exploreRelevance = prof.size ? tagRelevance(prof) : undefined;
      const recipe = app.recipe();
      const seen = seenSet(s.history);
      const items = rank(candidates, recipe, { now: opts.now(), limit: FEED_LIMIT, rng: seededRng(s.seed), seen, exploreRelevance });
      let popular: RankedItem[] = [];
      if (s.settings.showPopular && recipe.weights.taste > 0 && tagged.length) {
        const shown = new Set([...seen, ...items.map((i) => i.video.id)]);
        popular = rank(buildPopularCandidates(tagged), popularRecipe(recipe), {
          now: opts.now(),
          limit: 6 * tagged.length,
          rng: seededRng(s.seed),
          seen: shown,
        });
      }
      return { items, candidates: new Set(candidates.map((c) => c.video.id)).size, popular, personalizedExplore: !!exploreRelevance };
    },
    markShown(id) {
      if (s.settings.privateWatching) return;
      const lists = listMembership(app.resolvedLists()).get(id) ?? [];
      if (!recordImpression(s.impressions, id, lists)) return;
      clearTimeout(impressionTimer);
      impressionTimer = setTimeout(() => app.persist("impressions"), 1000);
    },
    persist(...keys) {
      for (const k of keys) {
        if (k === "recipe") writeJson(kv, "recipe", { id: s.recipe.id, custom: s.recipe.custom ? recipeToJson(s.recipe.custom) : null });
        else if (k === "settings") writeJson(kv, "settings", s.settings);
        else vault.write(k, sensitiveValue(k));
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
        if (s.history !== before) void fetchTagsFor(v).then(() => enrichExploreTags());
      }
      app.persist("history");
    },
    async wipeHistory() {
      s.history = [];
      s.tally = emptyTally();
      s.impressions = emptyImpressions();
      // Tags were fetched for endorsed videos, so the cache would hint at them.
      s.tagCache.clear();
      removeLegacy(kv);
      app.legacyLeft = false;
      // Crypto-shred: delete every ciphertext and the key, then re-encrypt what stays
      // (follows, taste lists, the taste-list video cache) under a fresh key.
      const keep = { follows: s.follows, taste: s.taste, videos: sensitiveValue("videos") };
      const hadPassphrase = vault.status === "passphrase";
      try {
        await vault.shred(keep);
        app.toast(
          vault.status === "memory"
            ? "Local history wiped"
            : hadPassphrase
              ? "Local history wiped and its key destroyed. The passphrase was removed too; set a new one if you want it"
              : "Local history wiped and its key destroyed",
        );
      } catch {
        app.toast("Wiped from this session, but the browser refused to delete stored data");
      }
      app.rerender();
    },
    setRetention(days) {
      s.settings.retentionDays = days;
      app.persist("settings");
      lastPrune = 0;
      app.pruneNow();
      app.rerender();
    },
    pruneNow() {
      lastPrune = Date.now();
      const kept = pruneHistory(s.history, s.settings.retentionDays, lastPrune);
      if (kept !== s.history) {
        s.history = kept;
        app.persist("history");
        app.rerender();
      }
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
  app.pruneNow();
  setInterval(maybePrune, PRUNE_CHECK_MS);
  document.addEventListener?.("visibilitychange", () => {
    if (document.visibilityState === "visible") maybePrune();
  });
  render();
  app.reloadCatalog();
  for (const t of s.taste) void loadTaste(t);
  return app;
}
