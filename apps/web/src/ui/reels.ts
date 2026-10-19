// Reels: a vertical, swipeable short-video feed. One video per screen with CSS
// scroll-snap on phones; a centered 9:16 column with keyboard control on desktop.
//
// The view is a persistent element: re-renders update it in place, so players and
// the scroll position survive. Only the visible reel plays; the next one is mounted
// (preloaded) but paused; the previous one is paused; anything further away is torn
// down to keep memory flat (`playerPlan`).

import type { App } from "../app.ts";
import type { ReelItem } from "../lib/reels.ts";
import { playerPlan, reelKey, shouldLoadMore } from "../lib/reels.ts";
import type { PlayerMode } from "../lib/reels.ts";
import { disclosureIndex } from "../lib/candidates.ts";
import { parseChannelInput } from "../lib/handles.ts";
import { formatDuration, placeholderGradient, videoHost } from "../lib/videos.ts";
import { h } from "./dom.ts";
import { icon } from "./icons.ts";
import { chip, emptyFeed, feedBar, hashId } from "./home.ts";
import { EmbedPlayer } from "./player.ts";

const WATCH_AFTER_MS = 3000;
const NPUB_LOOKUP_AFTER_MS = 1200;
const FINISH_SHARE = 0.8;

interface ReelNode {
  id: string;
  item: ReelItem;
  el: HTMLElement;
  media: HTMLElement;
  tap: HTMLButtonElement;
  rail: HTMLElement;
  info: HTMLElement;
  player: EmbedPlayer | null;
  playerMuted: boolean;
  mode: PlayerMode;
  watched: boolean;
  timers: ReturnType<typeof setTimeout>[];
}

function reducedMotion(): boolean {
  return !!globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

class ReelsView {
  readonly root: HTMLElement;
  private readonly scroller: HTMLElement;
  private readonly end: HTMLElement;
  private bar: HTMLElement;
  private readonly hint: HTMLElement;
  private nodes: ReelNode[] = [];
  private active = -1;
  private version = -1;
  private io: IntersectionObserver | null = null;
  private emptyEl: HTMLElement | null = null;

  constructor(readonly app: App) {
    this.scroller = h("div", { class: "reels", id: "reels", role: "feed", "aria-label": "Reels", "aria-busy": "false" });
    this.end = h("div", { class: "reel-end", "aria-live": "polite" });
    this.scroller.appendChild(this.end);
    this.bar = feedBar(app, true);
    this.hint = h("p", { class: "reels-hint muted small" }, "↑ ↓ or j k to move · space to pause · m to mute");
    this.root = h("section", { class: "reels-screen", "aria-label": "Reels" }, this.bar, this.scroller, this.hint);
    const IO = (globalThis as { IntersectionObserver?: typeof IntersectionObserver }).IntersectionObserver;
    if (IO) {
      this.io = new IO(
        (entries) => {
          let best: { i: number; r: number } | null = null;
          for (const e of entries) {
            if (!e.isIntersecting || e.intersectionRatio < 0.6) continue;
            const i = this.nodes.findIndex((n) => n.el === e.target);
            if (i >= 0 && (!best || e.intersectionRatio > best.r)) best = { i, r: e.intersectionRatio };
          }
          if (best) this.setActive(best.i);
        },
        { root: this.scroller, threshold: [0.6, 0.9] },
      );
    }
    document.addEventListener("keydown", (e) => this.onKey(e));
  }

  private get live(): boolean {
    return this.app.mode === "live";
  }

  sync(): void {
    const { app } = this;
    const nextBar = feedBar(app, true);
    this.bar.replaceWith(nextBar);
    this.bar = nextBar;
    const items = app.reelItems();
    const loading = app.s.reels.loading || [...app.s.instances.values()].some((x) => x.status === "loading");
    this.scroller.setAttribute("aria-busy", String(loading));
    if (app.s.reels.version !== this.version) {
      this.version = app.s.reels.version;
      this.reconcile(items);
    }
    for (const n of this.nodes) this.refresh(n);
    if (!items.length) {
      const allFailed = app.s.instances.size > 0 && [...app.s.instances.values()].every((x) => x.status === "error");
      const el = loading ? h("div", { class: "reel reel-skeleton", "aria-label": "Loading" }, h("div", { class: "reel-media" }, h("span", { class: "muted" }, "Loading videos…"))) : h("div", { class: "reel reel-empty" }, emptyFeed(app, allFailed));
      this.emptyEl?.remove();
      this.emptyEl = el;
      this.scroller.insertBefore(el, this.end);
    } else if (this.emptyEl) {
      this.emptyEl.remove();
      this.emptyEl = null;
    }
    this.end.replaceChildren(
      items.length
        ? loading
          ? h("span", { class: "muted small" }, "Loading more…")
          : h(
              "div",
              { class: "stack", style: { "align-items": "center", "text-align": "center" } },
              h("strong", null, "That's everything for now"),
              h("span", { class: "muted small" }, "Follow more channels, subscribe to a taste list, or change the recipe for more."),
              h("div", { class: "row", style: { "justify-content": "center" } }, h("button", { class: "btn sm", onclick: () => app.go("follow") }, "Follow & taste"), h("button", { class: "btn sm", onclick: () => app.sheet({ type: "open", section: "recipe" }) }, "Feed settings")),
            )
        : "",
    );
    if (this.active >= this.nodes.length) this.active = -1;
    if (this.active < 0 && this.nodes.length) {
      // First paint, or the active reel was removed: activate what's on screen.
      requestAnimationFrame(() => this.setActive(this.visibleIndex()));
    }
  }

  private visibleIndex(): number {
    const top = this.scroller.scrollTop;
    let best = 0;
    let dist = Infinity;
    this.nodes.forEach((n, i) => {
      const d = Math.abs(n.el.offsetTop - top);
      if (d < dist) (dist = d), (best = i);
    });
    return best;
  }

  private reconcile(items: ReelItem[]) {
    const want = new Set(items.map((r) => r.item.video.id));
    const activeId = this.nodes[this.active]?.id;
    for (const n of this.nodes) {
      if (!want.has(n.id)) {
        this.teardown(n);
        n.el.remove();
        this.io?.unobserve(n.el);
      }
    }
    const byId = new Map(this.nodes.map((n) => [n.id, n]));
    const next: ReelNode[] = [];
    for (const r of items) {
      const id = r.item.video.id;
      let n = byId.get(id);
      if (!n || !want.has(id)) {
        n = this.build(r);
        this.io?.observe(n.el);
      }
      n.item = r;
      next.push(n);
    }
    // Items only get appended or removed, so DOM order follows `next`.
    for (const n of next) if (n.el.parentNode !== this.scroller || n.el.nextSibling === null) this.scroller.insertBefore(n.el, this.end);
    this.nodes = next;
    const idx = activeId ? next.findIndex((n) => n.id === activeId) : -1;
    if (idx !== this.active) {
      // The active reel was removed (not interested): the one now in its place takes over.
      this.active = -1;
      if (next.length) requestAnimationFrame(() => this.setActive(idx >= 0 ? idx : this.visibleIndex()));
    }
  }

  private build(r: ReelItem): ReelNode {
    const v = r.item.video;
    const poster = h(
      "div",
      { class: "reel-poster", style: { background: placeholderGradient(v.creator + v.title) } },
      v.thumbnailUrl && this.live
        ? h("img", { src: v.thumbnailUrl, alt: "", loading: "lazy", decoding: "async", referrerpolicy: "no-referrer", onerror: (e: Event) => ((e.target as HTMLElement).hidden = true) })
        : h("span", { class: "ph", "aria-hidden": "true" }, v.title),
      this.live ? null : h("span", { class: "reel-offline" }, "Playback needs the network (offline snapshot)"),
    );
    const tap = h("button", { class: "reel-tap", hidden: true, "aria-label": "Pause" }) as HTMLButtonElement;
    tap.onclick = () => this.togglePause();
    const media = h("div", { class: "reel-media" }, poster, tap);
    const info = h("div", { class: "reel-info" });
    const rail = h("div", { class: "reel-rail", role: "group", "aria-label": "Actions" });
    const el = h(
      "article",
      { class: "reel", "data-vid": v.id, "aria-label": `${v.title}, by ${v.creatorName ?? v.creator}` },
      media,
      info,
      rail,
    );
    const n: ReelNode = { id: v.id, item: r, el, media, tap, rail, info, player: null, playerMuted: true, mode: "none", watched: false, timers: [] };
    this.refresh(n);
    return n;
  }

  /** Overlay text and rail buttons, rebuilt in place (cheap; players untouched). */
  private refresh(n: ReelNode) {
    const { app } = this;
    const { item, section, fallback } = n.item;
    const v = item.video;
    const whyId = "rwhy-" + hashId(v.id);
    const focusEl = document.activeElement as HTMLElement | null;
    const refocus = focusEl && focusEl.id && (n.rail.contains(focusEl) || n.info.contains(focusEl)) ? focusEl.id : "";
    const open = app.s.openWhy.has(v.id);
    const d = disclosureIndex(app.resolvedLists()).get(v.id);
    n.info.replaceChildren(
      h(
        "div",
        { class: "reel-meta" },
        h("span", { class: "reel-creator", title: v.creator }, v.creatorName ?? v.creator),
        h("span", { class: "reel-host mono" }, videoHost(v), v.durationSec ? ` · ${formatDuration(v.durationSec)}` : ""),
      ),
      h("h3", { class: "reel-title" }, v.title),
      h(
        "div",
        { class: "chips" },
        chip(item.primary),
        section === "popular" ? h("span", { class: "pill reel-pill" }, "Popular on your instances") : null,
        fallback ? h("span", { class: "pill reel-pill" }, "Longer video") : null,
        d?.sponsored.length ? h("span", { class: "pill spon" }, "Sponsored") : null,
        d?.affiliated.length ? h("span", { class: "pill spon" }, "Affiliated") : null,
      ),
      h(
        "button",
        {
          class: "why",
          id: whyId + "-btn",
          "aria-expanded": String(open),
          "aria-controls": whyId,
          onclick: () => {
            if (app.s.openWhy.has(v.id)) app.s.openWhy.delete(v.id);
            else app.s.openWhy.add(v.id);
            this.refresh(n);
          },
        },
        "Why am I seeing this?",
      ),
      h(
        "div",
        { class: "whybox", id: whyId, hidden: !open },
        item.why.map((line) => h("span", null, line)),
        section === "popular" ? h("span", null, "From this instance's trending list; not personalized") : null,
        fallback ? h("span", null, "Shown because there weren't enough short videos for this recipe") : null,
        h("span", { class: "mono", style: { opacity: "0.75" } }, `score ${item.score.toFixed(3)} · ranked on this device`),
      ),
    );

    const endorsed = app.isEndorsed(v.id);
    const following = app.isFollowing(v.creator);
    const target = app.matchTarget(item);
    const live = target ? app.match.liveWith(target.pubkey) : undefined;
    const muted = app.s.reels.muted;
    const hid = hashId(v.id);
    const btn = (cls: string, ic: string, label: string, aria: string, onclick: () => void, extra: Record<string, unknown> = {}) =>
      h("button", { class: "rail-btn " + cls, id: `rail-${hid}-${ic}`, "aria-label": aria, onclick, ...extra }, icon(ic, 26), h("span", { "aria-hidden": "true" }, label));
    const railButtons: (HTMLElement | null)[] = [
      btn(endorsed ? "on" : "", "heart", endorsed ? "Endorsed" : "Endorse", endorsed ? `Remove endorsement of ${v.title}` : `Endorse ${v.title}`, () => {
        app.toggleEndorse(v, item.primary);
        this.refresh(n);
      }, { "aria-pressed": String(endorsed) }),
      btn(following ? "on" : "", following ? "check" : "plus", following ? "Following" : "Follow", following ? `Following ${v.creatorName ?? v.creator}` : `Follow ${v.creatorName ?? v.creator}`, () => {
        const ref = parseChannelInput(v.creator);
        if (ref && !following) app.follow(ref, v.creatorName);
        this.refresh(n);
      }, { disabled: following }),
      btn("", "eyeoff", "Not interested", `Not interested in ${v.title}`, () => app.notInterested(v)),
      btn("", "share", "Share", `Copy link to ${v.title}`, () => app.share(v)),
      h(
        "a",
        { class: "rail-btn", href: v.url ?? v.id, target: "_blank", rel: "noopener noreferrer", "aria-label": `Open ${v.title} on PeerTube (new tab)` },
        icon("external", 26),
        h("span", { "aria-hidden": "true" }, "PeerTube"),
      ),
      target
        ? live
          ? btn("on", "match", live.status === "active" ? "Matched" : "Requested", `${live.status === "active" ? "Matched" : "Match requested"} with ${target.name}`, () => app.go("matches"))
          : btn("match", "match", "Match", `Request match with ${target.name}`, () => app.requestMatchWith(target))
        : null,
      this.live ? btn("", muted ? "mute" : "volume", muted ? "Muted" : "Sound", muted ? "Unmute" : "Mute", () => this.toggleMute(), { "aria-pressed": String(!muted) }) : null,
    ];
    n.rail.replaceChildren(...(railButtons.filter(Boolean) as HTMLElement[]));
    if (refocus) document.getElementById(refocus)?.focus({ preventScroll: true });
    n.tap.hidden = !(n.player?.ready && n.mode === "play");
    n.tap.setAttribute("aria-label", app.s.reels.paused ? "Play" : "Pause");
  }

  private mount(n: ReelNode, autoplay: boolean) {
    if (!this.live) return;
    const muted = this.app.s.reels.muted;
    const p = new EmbedPlayer(n.item.item.video, { p2p: this.app.s.settings.p2p, muted, autoplay });
    p.onReady = () => {
      if (n.mode !== "play") p.pause();
      this.refresh(n);
    };
    p.onStatus = (st) => {
      if (st.duration > 0 && st.position / st.duration >= FINISH_SHARE && n.mode === "play") this.app.noteFinish(n.item.item.video, n.item.item.primary);
    };
    n.player = p;
    n.playerMuted = muted;
    n.media.insertBefore(p.iframe, n.tap);
  }

  private teardown(n: ReelNode) {
    n.player?.destroy();
    n.player = null;
    for (const t of n.timers) clearTimeout(t);
    n.timers = [];
  }

  private apply(n: ReelNode, mode: PlayerMode) {
    const prev = n.mode;
    n.mode = mode;
    if (mode === "none") return this.teardown(n);
    if (mode === "play") {
      this.app.s.reels.paused = false;
      if (n.player && (!n.player.ready && prev === "preload" || n.playerMuted !== this.app.s.reels.muted && !n.player.ready)) this.teardown(n);
      if (!n.player) this.mount(n, true);
      else {
        n.player.play();
        if (n.player.ready) n.player.setMuted(this.app.s.reels.muted);
      }
      return;
    }
    if (mode === "preload") {
      if (!n.player) this.mount(n, false);
      else n.player.pause();
      return;
    }
    // paused: without the embed API there's no way to pause it, so unload it.
    if (n.player?.ready) n.player.pause();
    else this.teardown(n);
  }

  setActive(i: number) {
    if (i < 0 || i >= this.nodes.length || i === this.active) return;
    this.active = i;
    this.app.s.reels.active = i;
    const plan = playerPlan(i, this.nodes.length);
    this.nodes.forEach((n, k) => {
      if (n.mode !== plan[k] || plan[k] === "play") this.apply(n, plan[k]);
      n.el.classList.toggle("is-active", k === i);
    });
    const n = this.nodes[i];
    const v = n.item.item.video;
    this.app.markShown(v.id);
    n.timers.push(
      setTimeout(() => {
        if (this.nodes[this.active] === n && !n.watched) {
          n.watched = true;
          this.app.noteWatch(v, n.item.item.primary);
        }
      }, WATCH_AFTER_MS),
      setTimeout(() => {
        if (this.nodes[this.active] === n) this.app.lookupCreatorNpub(v.creator);
      }, NPUB_LOOKUP_AFTER_MS),
    );
    if (shouldLoadMore(i, this.nodes.length)) this.app.loadMoreReels();
    this.refresh(n);
  }

  private scrollTo(i: number) {
    const n = this.nodes[Math.max(0, Math.min(this.nodes.length - 1, i))];
    // Scroll only the reels container (scrollIntoView would move the page too).
    if (n) this.scroller.scrollTo({ top: n.el.offsetTop, behavior: reducedMotion() ? "auto" : "smooth" });
  }

  togglePause() {
    const n = this.nodes[this.active];
    if (!n?.player?.ready) {
      if (this.live) this.app.toast("This instance's player doesn't take remote control; use its own controls or open it on PeerTube");
      return;
    }
    const s = this.app.s.reels;
    s.paused = !s.paused;
    if (s.paused) n.player.pause();
    else n.player.play();
    this.refresh(n);
  }

  toggleMute() {
    const s = this.app.s.reels;
    s.muted = !s.muted;
    const n = this.nodes[this.active];
    if (n?.player) {
      if (n.player.ready) {
        n.player.setMuted(s.muted);
        n.playerMuted = s.muted;
      } else {
        this.teardown(n);
        this.mount(n, true);
      }
    }
    for (const x of this.nodes) this.refresh(x);
    this.app.toast(s.muted ? "Muted" : "Sound on");
  }

  private onKey(e: KeyboardEvent) {
    const { s } = this.app;
    if (s.screen !== "home" || s.view !== "reels" || s.sheet.open || s.consent || !this.root.isConnected) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.closest("input, textarea, select, [contenteditable]") || t.closest(".modal, .scrim"))) return;
    const k = reelKey(e);
    if (!k) return;
    if (k === "toggle" && t?.closest("button, a")) return; // space activates the focused button
    e.preventDefault();
    if (k === "next") this.scrollTo(this.active + 1);
    else if (k === "prev") this.scrollTo(this.active - 1);
    else if (k === "toggle") this.togglePause();
    else if (k === "mute") this.toggleMute();
  }
}

let view: ReelsView | null = null;

export function reelsScreen(app: App): HTMLElement {
  if (!view || view.app !== app) view = new ReelsView(app);
  view.sync();
  return view.root;
}
