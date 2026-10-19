// App shell: state, persistence, data loading and screen routing.

import type { Candidate, Recipe, RankedItem, SourceKind, Video } from "./lib/core.ts";
import { cryptoRng, parseRecipe, rank, recipeToJson, seededRng, tagProfile, tagRelevance } from "./lib/core.ts";
import type { Catalog, ChannelProfile, ChannelStats } from "./lib/catalog.ts";
import { mapLimit } from "./lib/catalog.ts";
import type { InstanceFeed, ResolvedTasteList } from "./lib/candidates.ts";
import { buildCandidates, buildPopularCandidates, listMembership, popularRecipe } from "./lib/candidates.ts";
import type { Impressions } from "./lib/trackrecord.ts";
import { emptyImpressions, listStrength, loadImpressions, recordImpression } from "./lib/trackrecord.ts";
import type { ChannelRef } from "./lib/handles.ts";
import { handleOf, parseChannelInput } from "./lib/handles.ts";
import type { WatchEvent } from "./lib/history.ts";
import { DAY_MS, hasFinished, isEndorsed, loadHistory, pruneHistory, record, seenSet, toSketchHistory, unendorse } from "./lib/history.ts";
import type { Tally } from "./lib/analytics.ts";
import { countView, emptyTally, loadTally } from "./lib/analytics.ts";
import { BUILTIN_RECIPES, editRecipe } from "./lib/recipes.ts";
import type { FeedView, RetentionDays, Settings } from "./lib/settings.ts";
import { loadSettings } from "./lib/settings.ts";
import type { KV } from "./lib/storage.ts";
import { readJson, writeJson } from "./lib/storage.ts";
import type { SensitiveData, SensitiveKey } from "./lib/localdata.ts";
import { removeLegacy } from "./lib/localdata.ts";
import type { Vault } from "./lib/vault.ts";
import type { TasteList } from "./lib/tastelist.ts";
import { parseTasteList } from "./lib/tastelist.ts";
import { loadVideo, storeVideo } from "./lib/videos.ts";
import type { Pager, ReelItem, ReelSection } from "./lib/reels.ts";
import { REELS_MAX_PAGES, applyPage, extendReels, newPager, nextPages, pagerExhausted, removeReel } from "./lib/reels.ts";
import type { SheetAction, SheetSection, SheetState } from "./lib/sheet.ts";
import { closedSheet, sheetReduce } from "./lib/sheet.ts";
import { findNpub } from "./lib/bech32.ts";
import type { TasteFollow, TasteResolution } from "./lib/creatortaste.ts";
import { applyResolution, creatorTasteList, creatorVias, loadTasteFollows, refreshDue, resolveCreatorTaste, rewriteWhy, trackKey } from "./lib/creatortaste.ts";
import { tasteDeps } from "./lib/tastesources.ts";
import { renderTasteSheet } from "./ui/taste.ts";
import type { StoredIdentity } from "./lib/match/identity.ts";
import { loadIdentity, signerFor } from "./lib/match/identity.ts";
import type { PeerSource } from "./lib/match/service.ts";
import { MatchService, loadBook, loadMeta } from "./lib/match/service.ts";
import { WsRelay } from "./lib/match/wsRelay.ts";
import { configurePsi, lazyPsi, onPsiStatus } from "./lib/match/psi.ts";
import { framePsi } from "./lib/match/psiFrame.ts";
import type { DemoSaved } from "./lib/match/demo.ts";
import { DEMO_NAME, DemoPeer, loadDemoSaved, pickDemoItems } from "./lib/match/demo.ts";
import { InMemoryRelay } from "./lib/match/pkg.ts";
import { h } from "./ui/dom.ts";
import { icon } from "./ui/icons.ts";
import { homeScreen } from "./ui/home.ts";
import { followScreen } from "./ui/follow.ts";
import { recipeScreen } from "./ui/recipe.ts";
import { settingsScreen } from "./ui/settings.ts";
import { studioScreen } from "./ui/studio.ts";
import { matchesScreen } from "./ui/matches.ts";
import { renderSheet } from "./ui/sheet.ts";
import { openWatch } from "./ui/watch.ts";
import { syncConsentCard } from "./ui/telemetry.ts";
import type { TelemetryConfig } from "./lib/telemetry/config.ts";
import { available as telemetryAvailable, resolveConfig } from "./lib/telemetry/config.ts";
import type { TelemetryConsent } from "./lib/telemetry/consent.ts";
import { askDelay, noteLaunch } from "./lib/telemetry/consent.ts";
import type { Telemetry, CrashReporter } from "./lib/telemetry/controller.ts";
import { createTelemetry } from "./lib/telemetry/controller.ts";
import type { Diagnostics, FeedbackInput } from "./lib/telemetry/feedback.ts";
import { sendFeedback } from "./lib/telemetry/feedback.ts";
import { createErrorLog, deviceFacts } from "./lib/telemetry/diagnostics.ts";
import type { Route } from "./lib/telemetry/scrub.ts";

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

/** A creator's taste, as the Taste button shows it. */
export type TasteState = "following" | "available" | "unavailable" | "loading" | "unknown";

export type ScreenId = "home" | "follow" | "matches" | "studio" | "settings" | "recipe";

/** Header tabs (desktop). Mobile shows the same screens in a bottom bar, plus Settings. */
export const SCREENS: { id: ScreenId; label: string; short: string; icon: string }[] = [
  { id: "home", label: "Home", short: "Home", icon: "home" },
  { id: "follow", label: "Follow & taste", short: "Following", icon: "users" },
  { id: "matches", label: "Matches", short: "Matches", icon: "match" },
  { id: "studio", label: "Creator studio", short: "Studio", icon: "studio" },
  { id: "settings", label: "Sharing & privacy", short: "Privacy", icon: "shield" },
];
const ALL_SCREENS: ScreenId[] = ["home", "follow", "matches", "studio", "settings", "recipe"];

/** Someone the viewer could match with: a creator or curator who published an npub, or a typed npub. */
export interface MatchTarget {
  pubkey: string;
  name: string;
  source: PeerSource;
  ref?: string;
}

/** The consent sheet (Matches): what to share when requesting, accepting or editing. */
export type ConsentDialog =
  | { mode: "request"; target: MatchTarget }
  | { mode: "accept"; matchId: string }
  | { mode: "edit"; matchId: string };

export interface ReelsState {
  items: ReelItem[];
  active: number;
  muted: boolean;
  paused: boolean;
  pager: Pager | null;
  loading: boolean;
  /** Extra catalog pages fetched for Reels, per instance. */
  pages: Map<string, { recent: Video[]; trending: Video[] }>;
  /** Bumped when the list changes, so the view knows to sync. */
  version: number;
}

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
  /** "Not interested" (Reels): never shown again. */
  hidden: Set<string>;
  screen: ScreenId;
  view: FeedView;
  sheet: SheetState;
  /** Bumped whenever the sheet's contents must be rebuilt. */
  sheetStamp: number;
  seed: number;
  instances: Map<string, Load<InstanceFeed>>;
  followVideos: Map<string, Load<Video[]>>;
  tasteRes: Map<string, Load<{ videos: Video[]; missing: number }>>;
  videoCache: Map<string, Video>;
  openWhy: Set<string>;
  studio: { handle: string; load: Load<ChannelStats> | null; npub?: string | null };
  reels: ReelsState;
  /** Creator handle → published npub (hex), null = none found. Memory only. */
  creatorNpub: Map<string, string | null>;
  consent: ConsentDialog | null;
  /** Followed creator tastes (vault: who you follow is sensitive). */
  tasteFollows: TasteFollow[];
  /** Creator handle → where their public picks were found (memory; refreshed on demand). */
  tasteLookup: Map<string, Load<TasteResolution>>;
  /** The open "Follow taste" sheet. */
  tasteSheet: { handle: string; name: string; returnFocus?: string } | null;
  /** Transient form state (inputs, errors) keyed by form. */
  ui: Record<string, string | undefined>;
  /** The one-time telemetry question is showing. */
  consentAsk: boolean;
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
  /** Dev tools: on-demand sketches. On in `npm run dev` and the offline demo. */
  devTools?: boolean;
  /** Offline artifact: channels whose public playlists are in the snapshot. */
  snapshotTasteChannels?: string[];
  /** Opt-in telemetry endpoints compiled into this build (none: hidden). Never used in snapshot mode. */
  telemetry?: TelemetryConfig | null;
  /** Loads the crash reporter bundle (only called after opt-in). */
  loadCrashReporter?: () => Promise<CrashReporter>;
}

type PersistKey = "settings" | "follows" | "taste" | "tastefollows" | "recipe" | "history" | "tally" | "videos" | "impressions" | "tags" | "hidden" | "identity";

export interface App {
  s: State;
  mode: "live" | "snapshot";
  catalog: Catalog;
  vault: Vault;
  match: MatchService;
  /** The offline demo's simulated peer (snapshot build only). */
  demo: DemoPeer | null;
  /** Demo: replace the simulated peer with a fresh one (new key, no history with you). */
  newDemoPeer(): Promise<void>;
  devTools: boolean;
  /** Plaintext from an older version remains in localStorage (memory vault only). */
  legacyLeft: boolean;
  examples: { file: string; list: TasteList }[];
  now(): Date;
  recipe(): Recipe;
  feed(): { items: RankedItem[]; candidates: number; popular: RankedItem[]; personalizedExplore: boolean };
  /** Reels list (extends itself from the ranked feed as needed). */
  reelItems(): ReelItem[];
  loadMoreReels(): void;
  /** Note that a feed item scrolled into view (track record). */
  markShown(id: string): void;
  resolvedLists(): ResolvedTasteList[];
  persist(...keys: PersistKey[]): void;
  rerender(): void;
  toast(msg: string, action?: { label: string; run: () => void }): void;
  go(screen: ScreenId): void;
  setView(v: FeedView): void;
  sheet(a: SheetAction): void;
  sheetChanged(): void;
  setRecipe(id: string, custom?: Recipe): void;
  /** Edit the active recipe (saves a custom copy), re-validated by core. */
  editRecipe(patch: Parameters<typeof editRecipe>[1]): string | null;
  isFollowing(creator: string): boolean;
  follow(ref: ChannelRef, name?: string): void;
  unfollow(handle: string): void;
  addTaste(sub: TasteSub): void;
  removeTaste(key: string): void;
  /** Follow taste: state of a creator's public picks for the Taste button. */
  tasteState(creator: string): TasteState;
  /** Find a creator's public picks (memoized; `force` refetches). */
  lookupCreatorTaste(creator: string, name?: string, force?: boolean): Promise<void>;
  openTaste(creator: string, name?: string, from?: string): void;
  closeTaste(): void;
  followTaste(handle: string): void;
  unfollowTaste(handle: string): void;
  setTasteEnabled(handle: string, on: boolean): void;
  /** Refetch followed tastes now (one, or all). */
  refreshTastes(handle?: string): void;
  /** A video known from a followed taste or the local cache. */
  tasteVideo(id: string): Video | undefined;
  snapshotTasteChannels: string[];
  watch(v: Video, via?: SourceKind): void;
  /** Record a watch without opening the player (a reel that played). */
  noteWatch(v: Video, via?: SourceKind): void;
  noteFinish(v: Video, via?: SourceKind): void;
  isEndorsed(id: string): boolean;
  toggleEndorse(v: Video, via?: SourceKind): void;
  notInterested(v: Video): void;
  share(v: Video): void;
  /** A creator or curator with a published npub for this item, if any. */
  matchTarget(item: RankedItem): MatchTarget | null;
  lookupCreatorNpub(creator: string): void;
  /** Start the request flow (opens Matches with the consent sheet). */
  requestMatchWith(t: MatchTarget): void;
  setIdentity(id: StoredIdentity | null): Promise<void>;
  setRelays(urls: string[]): void;
  /** Wipe history and crypto-shred the vault key. */
  wipeHistory(): Promise<void>;
  setRetention(days: RetentionDays): void;
  /** Delete history outside the sharing window. */
  pruneNow(): void;
  reloadCatalog(): void;
  loadStudio(handle: string): void;
  setTheme(): void;
  /** Opt-in crash reports, bug-report diagnostics and usage analytics. */
  telemetry: Telemetry;
  telemetryConfig: TelemetryConfig;
  /** Save new telemetry choices and start or stop reporters accordingly. */
  setTelemetry(next: TelemetryConsent, msg?: string): void;
  /** What "attach diagnostics" would add to a bug report right now. */
  diagnostics(): Diagnostics;
  sendFeedback(input: FeedbackInput): Promise<void>;
  /** Open the bug report form (Sharing & privacy). */
  openFeedback(): void;
}

const FEED_LIMIT = 60;
const REELS_RANK_LIMIT = 400;
const TAG_CACHE_CAP = 1500;
/** Explore candidates whose tags are fetched for on-device relevance. */
const TAG_FETCH_LIMIT = 40;
const VIDEO_CACHE_CAP = 600;
const HIDDEN_CAP = 2000;
/** Unknown sketch items resolved per sync (one request each to the video's origin). */
const MATCH_RESOLVE_LIMIT = 60;
/** How often Match checks relays while the app is open (sketches go out only when due). */
const MATCH_POLL_MS = 60_000;

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

  const settings = readJson(kv, "settings", loadSettings(null), loadSettings);
  const storedTab = kv.get("mf.v1.tab");
  const s: State = {
    settings,
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
    hidden: new Set(sens<string[]>("hidden", [], (x) => (Array.isArray(x) ? x.filter((i): i is string => typeof i === "string") : []))),
    screen: ALL_SCREENS.includes(storedTab as ScreenId) ? (storedTab as ScreenId) : "home",
    view: settings.defaultView,
    sheet: closedSheet,
    sheetStamp: 0,
    seed: Math.floor(cryptoRng()() * 2 ** 31),
    instances: new Map(),
    followVideos: new Map(),
    tasteRes: new Map(),
    videoCache,
    openWhy: new Set(),
    studio: { handle: "", load: null },
    reels: { items: [], active: 0, muted: true, paused: false, pager: null, loading: false, pages: new Map(), version: 0 },
    creatorNpub: new Map(),
    consent: null,
    tasteFollows: sens<TasteFollow[]>("tastefollows", [], loadTasteFollows),
    tasteLookup: new Map(),
    tasteSheet: null,
    ui: {},
    consentAsk: false,
  };

  // ---- telemetry (opt-in; nothing loads or sends before consent) ----
  const telemetryConfig = opts.mode === "snapshot" ? resolveConfig(null) : (opts.telemetry ?? resolveConfig(null));
  const sessionStart = Date.now();
  const displayMode = () => (globalThis.matchMedia?.("(display-mode: standalone)").matches ? "installed" : "browser");
  const device = deviceFacts();
  // Recent errors, scrubbed, in memory only: offered as bug-report diagnostics.
  const errorLog = createErrorLog();
  const currentRoute = (): Route =>
    s.sheet.open ? "feed-settings" : s.screen === "home" ? (s.view === "reels" ? "home-reels" : "home-grid") : s.screen;
  globalThis.addEventListener?.("error", (e) => errorLog.add((e as ErrorEvent).error ?? (e as ErrorEvent).message, currentRoute(), Date.now() - sessionStart));
  globalThis.addEventListener?.("unhandledrejection", (e) => errorLog.add((e as PromiseRejectionEvent).reason, currentRoute(), Date.now() - sessionStart));

  // ---- shell ----
  const tabs = h("nav", { class: "tabs", "aria-label": "Screens" });
  const bottom = h("nav", { class: "bottombar", "aria-label": "Screens" });
  const main = h("main", { id: "screen" });
  const sheetHost = h("div", { id: "sheet-host" });
  const tasteHost = h("div", { id: "taste-host" });
  const toastEl = h("div", { class: "toast", role: "status", "aria-live": "polite", hidden: true });
  const consentHost = h("div", { id: "consent-host" });
  const gear = h("button", { class: "iconbtn", id: "gear-btn", "aria-label": "Feed settings", title: "Feed settings", onclick: () => app.sheet({ type: "toggle", from: "gear-btn" }) }, icon("gear"));
  for (const sc of SCREENS) {
    tabs.appendChild(h("button", { id: `tab-${sc.id}`, "data-screen": sc.id, onclick: () => app.go(sc.id) }, sc.label));
  }
  for (const sc of SCREENS.filter((x) => x.id !== "settings")) {
    bottom.appendChild(h("button", { id: `bt-${sc.id}`, "data-screen": sc.id, onclick: () => app.go(sc.id) }, icon(sc.icon), h("span", null, sc.short)));
  }
  bottom.appendChild(h("button", { id: "bt-settings", "data-screen": "sheet", "aria-label": "Settings", onclick: () => app.sheet({ type: "toggle", from: "bt-settings" }) }, icon("sliders"), h("span", null, "Settings")));
  const menuBtn = h("button", { class: "iconbtn", id: "menu-btn", "aria-label": "Menu", "aria-haspopup": "true", "aria-expanded": "false", onclick: () => toggleMenu() }, h("span", { "aria-hidden": "true", class: "dots" }, "⋯"));
  const menu = h(
    "div",
    { class: "menu", id: "app-menu", role: "menu", hidden: true },
    h("button", { role: "menuitem", onclick: () => (closeMenu(), app.sheet({ type: "open", from: "menu-btn" })) }, icon("sliders", 18), "Feed settings…"),
    h("button", { role: "menuitem", onclick: () => (closeMenu(), app.go("recipe")) }, "Recipe import & export"),
    h("button", { role: "menuitem", onclick: () => (closeMenu(), app.go("settings")) }, "Sharing & privacy"),
    h("button", { role: "menuitem", onclick: () => (closeMenu(), app.go("matches")) }, "Matches"),
    telemetryConfig.glitchtip ? h("button", { role: "menuitem", onclick: () => (closeMenu(), app.openFeedback()) }, "Report a bug or send feedback…") : null,
  );
  function toggleMenu() {
    const open = menu.hidden;
    menu.hidden = !open;
    menuBtn.setAttribute("aria-expanded", String(open));
    if (open) (menu.querySelector("button") as HTMLElement | null)?.focus();
  }
  function closeMenu() {
    menu.hidden = true;
    menuBtn.setAttribute("aria-expanded", "false");
  }
  document.addEventListener?.("click", (e) => {
    if (!menu.hidden && !menu.contains(e.target as Node) && e.target !== menuBtn && !menuBtn.contains(e.target as Node)) closeMenu();
  });
  menu.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeMenu();
      menuBtn.focus();
    }
  });

  const header = h(
    "header",
    { class: "topbar" },
    h("div", { class: "brand" }, h("h1", null, "Match Feed"), h("p", { class: "muted small tagline" }, "Federated video, ranked on this device by a recipe you control.")),
    tabs,
    h("div", { class: "topactions" }, gear, h("div", { class: "menuwrap" }, menuBtn, menu)),
  );
  opts.root.replaceChildren(
    h(
      "div",
      { class: "wrap" },
      header,
      opts.mode === "snapshot" && opts.snapshotNote
        ? h("details", { class: "banner-note", role: "note" }, h("summary", null, h("strong", null, "Offline snapshot. "), "No network: playback is off and Match runs against a simulated peer."), h("p", null, opts.snapshotNote))
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
      main,
    ),
    bottom,
    sheetHost,
    tasteHost,
    consentHost,
    toastEl,
  );

  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  let renderQueued = false;
  let sheetBuiltStamp = -1;
  let sheetOpenRendered = false;

  function render() {
    renderQueued = false;
    const active = document.activeElement as HTMLElement | null;
    const focusId = active && main.contains(active) ? active.id : "";
    for (const b of [...tabs.querySelectorAll("button"), ...bottom.querySelectorAll("button")] as HTMLElement[]) {
      const on = b.dataset.screen === s.screen || (b.dataset.screen === "sheet" && s.sheet.open);
      if (on) b.setAttribute("aria-current", "page");
      else b.removeAttribute("aria-current");
    }
    const reelsMode = s.screen === "home" && s.view === "reels";
    document.body.classList.toggle("reels-mode", reelsMode);
    const screen = { home: homeScreen, follow: followScreen, recipe: recipeScreen, settings: settingsScreen, studio: studioScreen, matches: matchesScreen }[s.screen];
    const el = screen(app);
    // The Reels view is a persistent element (players, scroll position): don't
    // detach it if it's already there, or every iframe would reload.
    if (main.firstElementChild !== el || main.childElementCount !== 1) main.replaceChildren(el);
    if (focusId && !main.contains(document.activeElement)) document.getElementById(focusId)?.focus({ preventScroll: true });
    // Sheet: rebuilt only when its contents changed, so a background reload doesn't
    // reset a slider mid-drag.
    if (s.sheet.open && (!sheetOpenRendered || sheetBuiltStamp !== s.sheetStamp)) {
      renderSheet(app, sheetHost, !sheetOpenRendered);
      sheetBuiltStamp = s.sheetStamp;
      sheetOpenRendered = true;
    } else if (!s.sheet.open && sheetOpenRendered) {
      sheetHost.replaceChildren();
      sheetOpenRendered = false;
      document.body.classList.remove("sheet-open");
      if (s.sheet.returnFocus) document.getElementById(s.sheet.returnFocus)?.focus({ preventScroll: true });
    }
    renderTasteSheet(app, tasteHost);
    syncConsentCard(app, consentHost);
    app.telemetry.screen(currentRoute());
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
    if (k === "hidden") return [...s.hidden].slice(-HIDDEN_CAP);
    if (k === "identity") return app.match.identity;
    if (k === "matchbook") return app.match.book;
    if (k === "matchmeta") return app.match.meta;
    if (k === "demopeer") return app.demo?.save() ?? null;
    if (k === "tastefollows") return s.tasteFollows;
    return s[k as "history" | "tally" | "impressions" | "follows" | "taste"];
  }

  // ---- every video the app knows about, for resolving match sketch items ----
  function knownVideos(): Map<string, Video> {
    const m = new Map<string, Video>(s.videoCache);
    for (const r of s.instances.values()) if (r.status === "ok") for (const v of [...r.value.recent, ...r.value.trending]) m.set(v.id, v);
    for (const p of s.reels.pages.values()) for (const v of [...p.recent, ...p.trending]) m.set(v.id, v);
    for (const r of s.followVideos.values()) if (r.status === "ok") for (const v of r.value) m.set(v.id, v);
    for (const r of s.tasteRes.values()) if (r.status === "ok") for (const v of r.value.videos) m.set(v.id, v);
    for (const [id, v] of tasteVideos) m.set(id, v);
    return m;
  }

  // ---- Follow taste: creators' public picks ----
  /** Channel profiles, shared by the npub and taste lookups (one request per creator). */
  const profiles = new Map<string, Promise<ChannelProfile>>();
  function profileFor(ref: { name: string; host: string }): Promise<ChannelProfile> {
    const key = handleOf(ref);
    let p = profiles.get(key);
    if (!p) {
      p = catalog.channelProfile(ref, opts.mode === "live" ? s.settings.instances : []);
      p.catch(() => profiles.delete(key));
      profiles.set(key, p);
    }
    return p;
  }
  /** Video data carried by followed tastes (playlists include it). */
  let tasteVideos = new Map<string, Video>();
  function rebuildTasteVideos() {
    const m = new Map<string, Video>();
    for (const f of s.tasteFollows) for (const sv of f.taste?.videos ?? []) {
      const v = loadVideo(sv);
      if (v) m.set(v.id, v);
    }
    tasteVideos = m;
  }
  rebuildTasteVideos();
  /** Picks without video data (Nostr, linked lists) are resolved at their origin, like taste-list items. */
  const TASTE_RESOLVE_LIMIT = 40;
  async function resolveTastePicks(f: TasteFollow) {
    const todo = (f.taste?.items ?? []).map((i) => i.id).filter((id) => !tasteVideos.has(id) && !s.videoCache.has(id)).slice(0, TASTE_RESOLVE_LIMIT);
    if (!todo.length) return;
    await mapLimit(todo, 4, async (id) => {
      try {
        const v = await catalog.resolveVideo(id);
        if (v) s.videoCache.set(v.id, v);
      } catch {
        /* unavailable */
      }
    });
    app.persist("videos");
    app.rerender();
  }
  function saveTasteFollows() {
    rebuildTasteVideos();
    app.persist("tastefollows");
    s.reels.version++;
  }
  function refreshDueTastes() {
    const now = Date.now();
    for (const f of s.tasteFollows) if (refreshDue(f, now)) void app.lookupCreatorTaste(f.handle, f.name, true);
  }

  /** My items for similarity: everything I endorsed or finished. */
  function myMatchItems(): Set<string> {
    return new Set(s.history.filter((e) => e.kind === "endorse" || e.kind === "finish").map((e) => e.videoId));
  }

  function matchCandidates(): Candidate[] {
    if (!app.match.ready) return [];
    const known = knownVideos();
    return app.match.candidates(myMatchItems(), (id) => {
      const v = known.get(id);
      return v ? withTags(v) : undefined;
    });
  }

  let resolving = false;
  /**
   * Sketch items are bare video URLs. Ones the app hasn't seen are resolved at the
   * video's origin instance (like taste-list items), so they can be ranked. This
   * tells that instance someone at this IP looked the video up; it says nothing
   * about who sent the sketch.
   */
  async function resolveMatchItems() {
    if (resolving || !app.match.book) return;
    resolving = true;
    const known = knownVideos();
    const todo: string[] = [];
    for (const rec of Object.values(app.match.book.matches)) {
      if (rec.status !== "active" || !rec.peerSketch) continue;
      for (const id of rec.peerSketch.items) if (/^https?:\/\//.test(id) && !known.has(id) && !todo.includes(id)) todo.push(id);
    }
    const batch = todo.slice(0, MATCH_RESOLVE_LIMIT);
    await mapLimit(batch, 4, async (id) => {
      try {
        const v = await catalog.resolveVideo(id);
        if (v) s.videoCache.set(v.id, v);
      } catch {
        /* skip: unavailable */
      }
    });
    resolving = false;
    if (batch.length) {
      app.persist("videos");
      app.rerender();
    }
  }

  // ---- retention: drop history outside the sharing window, at start and daily ----
  let lastPrune = 0;
  function maybePrune() {
    if (Date.now() - lastPrune >= DAY_MS) app.pruneNow();
  }

  // ---- Reels ranking: same rank() and recipe as the grid, plus a deeper popular pass ----
  function reelsRanked(): { item: RankedItem; section: ReelSection }[] {
    const instances: InstanceFeed[] = [];
    for (const r of s.instances.values()) {
      if (r.status !== "ok") continue;
      const extra = s.reels.pages.get(r.value.origin);
      instances.push({
        origin: r.value.origin,
        recent: [...r.value.recent, ...(extra?.recent ?? [])].map(withTags),
        trending: [...r.value.trending, ...(extra?.trending ?? [])].map(withTags),
      });
    }
    const followVideos: Video[] = [];
    for (const r of s.followVideos.values()) if (r.status === "ok") followVideos.push(...r.value);
    const lists = app.resolvedLists();
    const candidates = [
      ...buildCandidates({ instances, follows: new Set(s.follows.map((f) => f.handle)), followVideos, tasteLists: lists }),
      ...matchCandidates(),
    ];
    const prof = profile();
    const recipe = app.recipe();
    const seen = new Set([...seenSet(s.history), ...s.hidden]);
    // Keep committed reels out of `seen` filtering decisions: they're already placed.
    const items = rewriteWhy(rank(candidates, recipe, { now: opts.now(), limit: REELS_RANK_LIMIT, rng: seededRng(s.seed), seen, exploreRelevance: prof.size ? tagRelevance(prof) : undefined }), lists);
    let popular: RankedItem[] = [];
    if (s.settings.showPopular && recipe.weights.taste > 0 && instances.length) {
      const shown = new Set([...seen, ...items.map((i) => i.video.id)]);
      // Deeper than the grid's 6 per instance: in Reels these come after the personal feed.
      popular = rank(buildPopularCandidates(instances), editRecipe(popularRecipe(recipe), { maxPerTasteList: 100 }), { now: opts.now(), limit: REELS_RANK_LIMIT, rng: seededRng(s.seed), seen: shown });
    }
    return [...items.map((item) => ({ item, section: "feed" as const })), ...popular.map((item) => ({ item, section: "popular" as const }))];
  }

  function extendReelsNow(): boolean {
    const exhausted = !!s.reels.pager && pagerExhausted(s.reels.pager, REELS_MAX_PAGES);
    const r = extendReels(s.reels.items, reelsRanked(), { meta: (id) => catalog.meta(id), exhausted, exclude: s.hidden });
    if (r.added) {
      s.reels.items = r.items;
      s.reels.version++;
    }
    return r.needMore;
  }

  async function fetchReelPages() {
    const instancesReady = [...s.instances.values()].filter((r) => r.status === "ok").map((r) => (r as { value: InstanceFeed }).value.origin);
    if (!instancesReady.length) return;
    if (!s.reels.pager) s.reels.pager = newPager(instancesReady);
    const reqs = nextPages(s.reels.pager);
    if (!reqs.length) return;
    s.reels.loading = true;
    app.rerender();
    await Promise.all(
      reqs.map(async (req) => {
        let got: Video[] = [];
        try {
          got = await catalog.instancePage(req.origin, req.which, req.start, req.count);
        } catch {
          got = [];
        }
        s.reels.pager = applyPage(s.reels.pager!, req, got.length);
        const p = s.reels.pages.get(req.origin) ?? { recent: [], trending: [] };
        p[req.which] = [...p[req.which], ...got];
        s.reels.pages.set(req.origin, p);
      }),
    );
    s.reels.loading = false;
  }

  let reelsBusy = false;

  // ---- Match ----
  const persistMatch = () => {
    vault.write("matchbook", app.match.book);
    vault.write("matchmeta", app.match.meta);
    if (app.demo) vault.write("demopeer", app.demo.save());
  };
  // Live: PSI in a sandboxed frame (the page CSP has no unsafe-eval); artifact: inlined.
  if (opts.mode === "live") configurePsi(() => framePsi());
  const match = new MatchService(
    {
      now: () => new Date(),
      psi: lazyPsi(),
      history: () => toSketchHistory(s.history),
      persist: () => persistMatch(),
      onChange: () => app.rerender(),
      onEvent: (e, text) => {
        app.toast(text);
        if (e.type === "sketch" || e.type === "match-active") void resolveMatchItems();
      },
    },
    sens("matchmeta", undefined, loadMeta),
  );
  onPsiStatus(() => app.rerender());

  function liveRelay(urls: string[]): WsRelay | null {
    if (!urls.length) return null;
    // NIP-42 AUTH, only for relays that demand it, signs with the identity key.
    return new WsRelay({ urls, authSigner: () => (app.match.identity ? signerFor(app.match.identity) : null) });
  }
  function relayLabel(urls: string[]): string {
    return urls.length ? `${urls.length} relay${urls.length === 1 ? "" : "s"}` : "no relays";
  }

  const app: App = {
    s,
    mode: opts.mode,
    catalog,
    vault,
    match,
    demo: null,
    newDemoPeer: async () => {},
    devTools: !!opts.devTools,
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
      // Followed creator tastes: kind taste, via = creator name, own track record.
      const active = s.tasteFollows.filter((f) => f.enabled && f.taste?.items.length);
      const vias = creatorVias(active, s.taste.map((t) => t.list.name));
      for (const f of active) {
        const r = creatorTasteList(f, vias.get(f.handle)!, app.tasteVideo, listStrength(s.impressions, trackKey(f.handle), endorsed));
        if (r) out.push(r);
      }
      return out;
    },
    feed() {
      const instances: InstanceFeed[] = [];
      for (const r of s.instances.values()) if (r.status === "ok") instances.push(r.value);
      const followVideos: Video[] = [];
      for (const r of s.followVideos.values()) if (r.status === "ok") followVideos.push(...r.value);
      const tagged = instances.map((i) => ({ ...i, recent: i.recent.map(withTags), trending: i.trending.map(withTags) }));
      const lists = app.resolvedLists();
      const candidates = [
        ...buildCandidates({
          instances: tagged,
          follows: new Set(s.follows.map((f) => f.handle)),
          followVideos,
          tasteLists: lists,
        }),
        ...matchCandidates(),
      ];
      const prof = profile();
      const exploreRelevance = prof.size ? tagRelevance(prof) : undefined;
      const recipe = app.recipe();
      const seen = new Set([...seenSet(s.history), ...s.hidden]);
      const items = rewriteWhy(rank(candidates, recipe, { now: opts.now(), limit: FEED_LIMIT, rng: seededRng(s.seed), seen, exploreRelevance }), lists);
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
    reelItems() {
      if (!reelsBusy) {
        const needMore = extendReelsNow();
        if (needMore && s.reels.items.length - s.reels.active <= 4) app.loadMoreReels();
      }
      return s.reels.items;
    },
    loadMoreReels() {
      if (reelsBusy) return;
      reelsBusy = true;
      void (async () => {
        try {
          for (let i = 0; i < REELS_MAX_PAGES; i++) {
            const before = s.reels.items.length;
            const needMore = extendReelsNow();
            if (s.reels.items.length > before && !needMore) break;
            if (s.reels.items.length - s.reels.active > 6) break;
            if (s.reels.pager && pagerExhausted(s.reels.pager)) {
              extendReelsNow();
              break;
            }
            await fetchReelPages();
            if ([...s.instances.values()].every((r) => r.status !== "ok")) break;
          }
        } finally {
          reelsBusy = false;
          s.reels.loading = false;
          app.rerender();
        }
      })();
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
    toast(msg, action) {
      toastEl.replaceChildren(h("span", null, msg));
      if (action) toastEl.appendChild(h("button", { class: "linkbtn toast-act", onclick: () => { toastEl.hidden = true; action.run(); } }, action.label));
      toastEl.hidden = false;
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => (toastEl.hidden = true), action ? 5000 : 2600);
    },
    go(screen) {
      s.screen = screen;
      kv.set("mf.v1.tab", screen);
      if (s.sheet.open) s.sheet = sheetReduce(s.sheet, { type: "close" });
      if (screen === "matches") void app.match.sync().catch(() => undefined).then(() => app.match.pump());
      render();
      window.scrollTo?.({ top: 0 });
    },
    setView(v) {
      if (v !== s.view) app.telemetry.event("view-mode", { view: v });
      s.view = v;
      render();
      window.scrollTo?.({ top: 0 });
    },
    sheet(a) {
      const before = s.sheet.open;
      s.sheet = sheetReduce(s.sheet, a);
      if (s.sheet.open && !before) {
        s.sheetStamp++;
        app.telemetry.event("feed-settings-opened");
      }
      render();
    },
    sheetChanged() {
      s.sheetStamp++;
      app.rerender();
    },
    setRecipe(id, customRecipe) {
      s.recipe = { id, custom: customRecipe ?? s.recipe.custom };
      app.persist("recipe");
      app.telemetry.event("recipe-selected", { kind: id === "custom" ? "custom" : "built-in", recipe: ["default", "following", "discovery", "custom"].includes(id) ? id : "other" });
      s.sheetStamp++;
      app.rerender();
    },
    editRecipe(patch) {
      const base = app.recipe();
      const name = s.recipe.id === "custom" ? base.name : `${base.name} (edited)`.slice(0, 80);
      try {
        const next = editRecipe(base, { name, ...patch });
        s.recipe = { id: "custom", custom: next };
        app.persist("recipe");
        app.rerender();
        return null;
      } catch (e) {
        return e instanceof Error ? e.message : String(e);
      }
    },
    isFollowing(creator) {
      return s.follows.some((f) => f.handle === creator.toLowerCase());
    },
    follow(ref, name) {
      const handle = handleOf(ref);
      if (s.follows.some((f) => f.handle === handle)) return;
      s.follows = [...s.follows, { handle, name, addedAt: Date.now() }];
      app.persist("follows");
      app.telemetry.event("follow-creator");
      app.toast(`Following ${name ?? handle}`);
      void loadFollow(handle);
      app.rerender();
    },
    unfollow(handle) {
      const f = s.follows.find((x) => x.handle === handle);
      s.follows = s.follows.filter((x) => x.handle !== handle);
      s.followVideos.delete(handle);
      app.persist("follows");
      app.telemetry.event("unfollow-creator");
      app.toast(`Unfollowed ${f?.name ?? handle}`);
      app.rerender();
    },
    addTaste(sub) {
      s.taste = [...s.taste.filter((t) => t.key !== sub.key), sub];
      app.persist("taste");
      app.telemetry.event("subscribe-taste-list", { source: sub.source });
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
    tasteState(creator) {
      const key = creator.toLowerCase();
      if (s.tasteFollows.some((f) => f.handle === key)) return "following";
      const look = s.tasteLookup.get(key);
      if (!look) return "unknown";
      if (look.status === "loading") return "loading";
      if (look.status === "error") return "unknown";
      return look.value.taste ? "available" : "unavailable";
    },
    async lookupCreatorTaste(creator, name, force = false) {
      const key = creator.toLowerCase();
      const ref = parseChannelInput(key);
      if (!ref) return;
      const cur = s.tasteLookup.get(key);
      if (cur && !force && cur.status !== "error") return;
      if (cur?.status === "loading") return;
      s.tasteLookup.set(key, { status: "loading" });
      app.rerender();
      if (force) profiles.delete(key);
      const deps = tasteDeps({ catalog, ref, profile: () => profileFor(ref), relays: s.settings.relays, live: opts.mode === "live", now: () => Date.now() });
      try {
        const r = await resolveCreatorTaste(key, name ?? ref.name, deps);
        s.tasteLookup.set(key, { status: "ok", value: r });
        const i = s.tasteFollows.findIndex((f) => f.handle === key);
        if (i >= 0) {
          const next = applyResolution(s.tasteFollows[i], r);
          s.tasteFollows = s.tasteFollows.map((f, k) => (k === i ? next : f));
          saveTasteFollows();
          void resolveTastePicks(next);
        }
      } catch (e) {
        s.tasteLookup.set(key, { status: "error", error: errText(e) });
      }
      app.rerender();
    },
    openTaste(creator, name, from) {
      const key = creator.toLowerCase();
      s.tasteSheet = { handle: key, name: name ?? s.tasteFollows.find((f) => f.handle === key)?.name ?? key, returnFocus: from };
      render();
      void app.lookupCreatorTaste(key, name);
    },
    closeTaste() {
      const back = s.tasteSheet?.returnFocus;
      s.tasteSheet = null;
      render();
      if (back) document.getElementById(back)?.focus({ preventScroll: true });
    },
    followTaste(handle) {
      const key = handle.toLowerCase();
      const look = s.tasteLookup.get(key);
      const r = look?.status === "ok" ? look.value : null;
      if (!r?.taste) {
        app.toast("No public picks to follow yet");
        return;
      }
      if (s.tasteFollows.some((f) => f.handle === key)) return;
      const f: TasteFollow = { handle: key, name: r.name, enabled: true, addedAt: Date.now(), checkedAt: r.checkedAt, taste: r.taste };
      s.tasteFollows = [...s.tasteFollows, f];
      saveTasteFollows();
      app.telemetry.event("follow-taste");
      app.toast(`Following ${r.name}'s taste: ${r.taste.items.length} pick${r.taste.items.length === 1 ? "" : "s"}`);
      void resolveTastePicks(f);
      app.rerender();
    },
    unfollowTaste(handle) {
      const key = handle.toLowerCase();
      const f = s.tasteFollows.find((x) => x.handle === key);
      if (!f) return;
      s.tasteFollows = s.tasteFollows.filter((x) => x.handle !== key);
      saveTasteFollows();
      app.toast(`Unfollowed ${f.name}'s taste`, {
        label: "Undo",
        run: () => {
          if (s.tasteFollows.some((x) => x.handle === key)) return;
          s.tasteFollows = [...s.tasteFollows, f];
          saveTasteFollows();
          app.rerender();
        },
      });
      app.rerender();
    },
    setTasteEnabled(handle, on) {
      s.tasteFollows = s.tasteFollows.map((f) => (f.handle === handle ? { ...f, enabled: on } : f));
      saveTasteFollows();
      app.sheetChanged();
    },
    refreshTastes(handle) {
      const list = handle ? s.tasteFollows.filter((f) => f.handle === handle) : s.tasteFollows;
      for (const f of list) void app.lookupCreatorTaste(f.handle, f.name, true);
      if (list.length) app.toast(list.length === 1 ? `Checking ${list[0].name}'s picks…` : `Checking ${list.length} creators' picks…`);
    },
    tasteVideo(id) {
      return tasteVideos.get(id) ?? s.videoCache.get(id);
    },
    snapshotTasteChannels: opts.snapshotTasteChannels ?? [],
    watch(v, via) {
      app.noteWatch(v, via);
      openWatch(app, v, via, () => app.rerender());
    },
    noteWatch(v, via) {
      const before = s.history;
      s.history = record(s.history, { videoId: v.id, at: Date.now(), kind: "watch", tags: v.tags, via }, s.settings);
      if (s.history !== before) app.persist("history");
      if (via && !s.settings.privateWatching) {
        s.tally = countView(s.tally, via, s.settings);
        app.persist("tally");
      }
    },
    noteFinish(v, via) {
      if (hasFinished(s.history, v.id)) return;
      const before = s.history;
      s.history = record(s.history, { videoId: v.id, at: Date.now(), kind: "finish", tags: v.tags, via }, s.settings);
      if (s.history !== before) app.persist("history");
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
        app.telemetry.event("endorse");
        if (s.history !== before) void fetchTagsFor(v).then(() => enrichExploreTags());
      }
      app.persist("history");
      app.rerender();
    },
    notInterested(v) {
      s.hidden.add(v.id);
      s.reels.items = removeReel(s.reels.items, v.id);
      s.reels.version++;
      // Private watching: hide it for this session, but don't store it.
      if (!s.settings.privateWatching) app.persist("hidden");
      app.telemetry.event("not-interested");
      app.toast("Hidden. You won't see it again", {
        label: "Undo",
        run: () => {
          s.hidden.delete(v.id);
          if (!s.settings.privateWatching) app.persist("hidden");
          app.toast("Restored to your feed");
          app.rerender();
        },
      });
      app.rerender();
    },
    share(v) {
      app.telemetry.event("share");
      const url = v.url ?? v.id;
      const fallback = () => {
        const input = h("input", { type: "text", readonly: true, value: url, "aria-label": "Video link", class: "copyfield" });
        toastEl.replaceChildren(h("span", null, "Copy the link:"), input);
        toastEl.hidden = false;
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => (toastEl.hidden = true), 8000);
        input.focus();
        input.select();
      };
      try {
        const p = navigator.clipboard?.writeText(url);
        if (!p) return fallback();
        p.then(() => app.toast("Link copied"), fallback);
      } catch {
        fallback();
      }
    },
    matchTarget(item) {
      if (item.primary === "match") return null;
      const v = item.video;
      const creatorKey = s.creatorNpub.get(v.creator.toLowerCase());
      if (creatorKey) return { pubkey: creatorKey, name: v.creatorName ?? v.creator, source: "creator", ref: v.creator };
      for (const t of s.taste) {
        const pk = findNpub(t.list.author);
        if (pk && t.list.items.some((i) => i.id === v.id)) return { pubkey: pk, name: `Curator of "${t.list.name}"`, source: "curator", ref: t.list.name };
      }
      return null;
    },
    lookupCreatorNpub(creator) {
      const key = creator.toLowerCase();
      if (s.creatorNpub.has(key) || app.mode !== "live") return;
      const ref = parseChannelInput(creator);
      if (!ref) return;
      s.creatorNpub.set(key, null);
      profileFor(ref).then(
        (p) => {
          const pk = findNpub(p.text);
          if (pk) {
            s.creatorNpub.set(key, pk);
            app.rerender();
          }
        },
        () => {},
      );
    },
    requestMatchWith(t) {
      s.consent = { mode: "request", target: t };
      app.go("matches");
    },
    async setIdentity(id) {
      if (!id) {
        app.match.reset();
        vault.write("identity", null);
        app.rerender();
        return;
      }
      vault.write("identity", id);
      if (app.mode === "snapshot") await startDemo(id);
      else await app.match.start(id, liveRelay(s.settings.relays), relayLabel(s.settings.relays), null);
      app.rerender();
    },
    setRelays(urls) {
      s.settings.relays = urls;
      app.persist("settings");
      void app.match.setRelay(liveRelay(urls), relayLabel(urls)).then(() => app.match.sync().catch(() => undefined));
      app.rerender();
    },
    async wipeHistory() {
      s.history = [];
      s.tally = emptyTally();
      s.impressions = emptyImpressions();
      s.hidden.clear();
      // Tags were fetched for endorsed videos, so the cache would hint at them.
      s.tagCache.clear();
      removeLegacy(kv);
      app.legacyLeft = false;
      // Crypto-shred: delete every ciphertext and the key, then re-encrypt what stays
      // (follows, taste lists, the taste-list video cache, and Match: identity and
      // matches) under a fresh key.
      const keep: Record<string, unknown> = { follows: s.follows, taste: s.taste, tastefollows: s.tasteFollows, videos: sensitiveValue("videos") };
      for (const k of ["identity", "matchbook", "matchmeta", "demopeer"] as const) {
        const v = sensitiveValue(k);
        if (v) keep[k] = v;
      }
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
      s.reels.pages.clear();
      s.reels.pager = null;
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
      if (app.mode === "live") {
        catalog.channelProfile(ref, s.settings.instances).then(
          (p) => {
            const pk = findNpub(p.text);
            s.creatorNpub.set(handleOf(ref), pk);
            if (s.studio.handle === handleOf(ref)) s.studio.npub = pk;
            app.rerender();
          },
          () => {
            if (s.studio.handle === handleOf(ref)) s.studio.npub = null;
          },
        );
      }
    },
    telemetry: null as unknown as Telemetry,
    telemetryConfig,
    setTelemetry(next, msg) {
      const before = s.settings.telemetry;
      s.settings.telemetry = next;
      app.persist("settings");
      app.telemetry.apply();
      if (next.usage && !before.usage) app.telemetry.event("app-open", { view: s.view, display: displayMode() });
      if (msg) app.toast(msg);
      app.rerender();
    },
    diagnostics() {
      const st = s.settings;
      return {
        ...device,
        appVersion: telemetryConfig.appVersion,
        recentErrors: errorLog.list(),
        settings: {
          privateWatching: st.privateWatching,
          p2p: st.p2p,
          popularSection: st.showPopular,
          discoveryStats: st.analytics.contribute,
          defaultView: st.defaultView,
          theme: st.theme,
          retentionDays: st.retentionDays,
          passphrase: vault.status === "passphrase",
          storage: vault.status === "memory" ? "memory-only" : "encrypted",
          relaysConfigured: st.relays.length > 0,
          recipe: s.recipe.id === "custom" ? "custom" : s.recipe.id,
          crashReports: st.telemetry.crash,
          usageAnalytics: st.telemetry.usage,
        },
      };
    },
    async sendFeedback(input) {
      if (!telemetryConfig.glitchtip) throw new Error("Bug reports aren't set up in this build.");
      await sendFeedback(telemetryConfig.glitchtip, input, telemetryConfig.appVersion, (u, i) => fetch(u, i));
      app.telemetry.event("bug-report-sent", { category: input.category });
    },
    openFeedback() {
      s.ui.fbOpen = "1";
      if (s.screen !== "settings") app.go("settings");
      else app.rerender();
      setTimeout(() => {
        const el = document.getElementById("fb-form");
        el?.scrollIntoView?.({ block: "start" });
        document.getElementById("fb-text")?.focus({ preventScroll: true });
      }, 50);
    },
    setTheme() {
      const t = s.settings.theme;
      if (t === "auto") document.documentElement.removeAttribute("data-theme");
      else document.documentElement.setAttribute("data-theme", t);
    },
  };

  // ---- offline demo: an in-memory relay and a simulated peer ----
  const demoRelay = opts.mode === "snapshot" ? new InMemoryRelay() : null;
  async function makeDemoPeer(saved: DemoSaved | null) {
    if (!demoRelay) return;
    app.demo = await DemoPeer.create({ relay: demoRelay, psi: lazyPsi(), now: () => new Date(), items: pickDemoItems([...knownVideos().keys()]), saved });
    match.driver = app.demo;
    match.meta.names[app.demo.pubkey] = { name: DEMO_NAME, source: "demo" };
  }
  app.newDemoPeer = async () => {
    await makeDemoPeer(null);
    vault.write("demopeer", app.demo?.save() ?? null);
    vault.write("matchmeta", match.meta);
    app.rerender();
  };
  async function startDemo(id: StoredIdentity) {
    if (!demoRelay) return;
    await makeDemoPeer(sens<DemoSaved | null>("demopeer", null, loadDemoSaved));
    await match.start(id, demoRelay, "in-memory demo relay (offline)", sens("matchbook", null, loadBook));
    await match.pump();
    void resolveMatchItems();
  }

  // ---- telemetry wiring ----
  app.telemetry = createTelemetry({
    config: telemetryConfig,
    consent: () => s.settings.telemetry,
    loadCrashReporter: opts.loadCrashReporter ?? (() => Promise.reject(new Error("no crash reporter in this build"))),
    fetch: (u, i) => fetch(u, i),
    device,
    environment: app.devTools ? "development" : "production",
  });
  // Feature-used events for Match: counts only, never who.
  const countAfter = <A extends unknown[], R>(fn: (...a: A) => Promise<R>, name: string) =>
    async (...a: A): Promise<R> => {
      const r = await fn(...a);
      app.telemetry.event(name);
      return r;
    };
  match.requestMatch = countAfter(match.requestMatch.bind(match), "match-requested");
  match.requestPreview = countAfter(match.requestPreview.bind(match), "preview-requested");
  match.accept = countAfter(match.accept.bind(match), "match-accepted");
  if (telemetryAvailable(telemetryConfig)) {
    s.settings.telemetry = noteLaunch(s.settings.telemetry);
    app.persist("settings");
    // Ask once, later: on the second launch (after a short delay), or after a few
    // minutes of use in the first session. Never on first paint, never as a modal.
    const delay = askDelay(s.settings.telemetry, Date.now(), sessionStart, true);
    if (delay !== null && delay < 2 ** 31 - 1) {
      setTimeout(() => {
        if (askDelay(s.settings.telemetry, Date.now(), sessionStart, true) === null) return;
        s.consentAsk = true;
        app.rerender();
      }, delay);
    }
  }

  app.setTheme();
  app.pruneNow();
  setInterval(() => {
    maybePrune();
    refreshDueTastes();
  }, PRUNE_CHECK_MS);
  document.addEventListener?.("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      maybePrune();
      refreshDueTastes();
      if (app.match.ready && app.match.relay && !app.demo) void app.match.sync().catch(() => undefined);
    }
  });
  document.addEventListener?.("keydown", (e) => {
    if (e.key === "Escape" && s.tasteSheet) {
      app.closeTaste();
    } else if (e.key === "Escape" && s.sheet.open) {
      app.sheet({ type: "key", key: "Escape" });
    }
  });
  render();
  app.telemetry.apply();
  if (s.settings.telemetry.usage) app.telemetry.event("app-open", { view: s.view, display: displayMode() });
  app.reloadCatalog();
  for (const t of s.taste) void loadTaste(t);
  // Followed tastes: use the saved picks now, refetch those older than a day.
  for (const f of s.tasteFollows) void resolveTastePicks(f);
  refreshDueTastes();

  // Match: restore the identity and book, then check relays now and every minute.
  // Sketches go out only when due on the weekly schedule.
  const savedIdentity = sens("identity", null, loadIdentity);
  if (savedIdentity) {
    const startMatch = async () => {
      if (opts.mode === "snapshot") {
        // The demo peer picks its history from the snapshot, so wait for the catalog.
        for (let i = 0; i < 40 && [...s.instances.values()].some((r) => r.status === "loading"); i++) await new Promise((r) => setTimeout(r, 50));
        await startDemo(savedIdentity);
      } else {
        await match.start(savedIdentity, liveRelay(s.settings.relays), relayLabel(s.settings.relays), sens("matchbook", null, loadBook));
        await match.sync().catch(() => undefined);
        void resolveMatchItems();
      }
    };
    void startMatch();
  }
  if (opts.mode === "live") {
    setInterval(() => {
      if (document.visibilityState === "visible" && app.match.ready && app.match.relay) void app.match.sync().catch(() => undefined);
    }, MATCH_POLL_MS);
  }
  return app;
}
