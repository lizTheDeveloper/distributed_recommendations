// "Follow taste" UI: the small sheet (what will be added, from where, and the
// Follow taste / Unfollow toggle), the management list (Follow & taste, and the
// feed settings sheet's Sources), and the "look up a creator's taste" form.

import type { App, TasteState } from "../app.ts";
import type { SourceAttempt, TasteFollow } from "../lib/creatortaste.ts";
import { SOURCE_LABEL, SOURCE_ORDER, newestPicks } from "../lib/creatortaste.ts";
import { handleOf, parseChannelInput } from "../lib/handles.ts";
import { h } from "./dom.ts";
import { icon } from "./icons.ts";
import { hashId } from "./home.ts";

const OUTCOME: Record<SourceAttempt["outcome"], string> = { found: "used", none: "nothing", skipped: "skipped", error: "failed" };

const ago = (ms: number, now: number) => {
  const m = Math.max(0, Math.round((now - ms) / 60000));
  if (m < 2) return "just now";
  if (m < 90) return `${m} min ago`;
  const hr = Math.round(m / 60);
  return hr < 36 ? `${hr} h ago` : `${Math.round(hr / 24)} days ago`;
};

/** Label and accessible name for a Taste button in a given state. */
export function tasteButtonText(state: TasteState, name: string): { label: string; aria: string; disabled: boolean; on: boolean } {
  switch (state) {
    case "following":
      return { label: "Taste", aria: `Following ${name}'s taste. Manage`, disabled: false, on: true };
    case "unavailable":
      return { label: "No public picks yet", aria: `No public picks yet from ${name}`, disabled: true, on: false };
    case "loading":
      return { label: "Taste", aria: `Follow ${name}'s taste (looking for public picks)`, disabled: false, on: false };
    default:
      return { label: "Taste", aria: `Follow ${name}'s taste`, disabled: false, on: false };
  }
}

/** A plain button that opens the taste sheet (grid card menu, studio, Follow screen). */
export function tasteButton(app: App, creator: string, name: string, id: string, cls = "btn sm"): HTMLElement {
  const st = app.tasteState(creator);
  const t = tasteButtonText(st, name);
  return h(
    "button",
    {
      class: cls + (t.on ? " on" : ""),
      id,
      disabled: t.disabled,
      "aria-label": t.aria,
      title: t.disabled ? "No public picks yet" : undefined,
      onclick: () => app.openTaste(creator, name, id),
    },
    icon("taste", 16),
    h("span", null, st === "following" ? "Following taste" : st === "unavailable" ? "No public picks yet" : "Follow taste…"),
  );
}

function attemptsList(attempts: SourceAttempt[], used: string | undefined): HTMLElement {
  return h(
    "ol",
    { class: "taste-attempts small" },
    SOURCE_ORDER.map((src) => {
      const a = attempts.find((x) => x.source === src);
      return h(
        "li",
        { class: a?.outcome === "found" ? "is-used" : "" },
        h("strong", null, SOURCE_LABEL[src]),
        " · ",
        a ? h("span", { class: "muted" }, src === used ? "used" : OUTCOME[a.outcome], a.note ? `: ${a.note}` : "") : h("span", { class: "muted" }, "not checked"),
      );
    }),
  );
}

let lastSig = "";

/** The taste sheet: rebuilt only when what it shows changes (keeps focus stable). */
export function renderTasteSheet(app: App, host: HTMLElement): void {
  const { s } = app;
  const ts = s.tasteSheet;
  if (!ts) {
    if (host.childElementCount) {
      host.replaceChildren();
      lastSig = "";
    }
    return;
  }
  const key = ts.handle;
  const look = s.tasteLookup.get(key);
  const follow = s.tasteFollows.find((f) => f.handle === key);
  const sig = JSON.stringify([key, look?.status, look?.status === "ok" ? look.value.checkedAt : 0, follow?.enabled, follow?.checkedAt, !!follow]);
  if (sig === lastSig && host.childElementCount) return;
  lastSig = sig;
  const focusId = (document.activeElement as HTMLElement | null)?.id;
  const first = !host.childElementCount;

  const r = look?.status === "ok" ? look.value : null;
  const taste = r?.taste ?? follow?.taste ?? null;
  const name = r?.name ?? follow?.name ?? ts.name;
  const close = () => app.closeTaste();
  const now = Date.now();
  const picks = taste ? newestPicks(taste, (id) => app.tasteVideo(id), 3) : [];

  let body: (HTMLElement | null)[];
  if (!r && !follow) {
    body = [h("p", { class: "muted", "aria-busy": "true" }, `Looking for ${name}'s public picks…`)];
  } else {
    body = [
      taste
        ? h(
            "div",
            { class: "stack", style: { gap: "6px" } },
            h("p", { class: "taste-src" }, h("span", { class: "pill taste-pill" }, SOURCE_LABEL[taste.source]), taste.detail ? h("span", { class: "small muted" }, " ", taste.detail) : null),
            h("p", null, h("strong", null, `${taste.items.length} pick${taste.items.length === 1 ? "" : "s"}`), h("span", { class: "muted small" }, ` · from other creators, not ${name}'s own uploads`)),
            picks.length
              ? h(
                  "ul",
                  { class: "taste-newest small" },
                  picks.map((p) => h("li", null, h("span", { class: "taste-t" }, p.title), p.creator ? h("span", { class: "muted" }, ` · ${p.creator}`) : null)),
                )
              : null,
            taste.items.some((i) => i.sponsored || i.affiliated) ? h("p", { class: "small" }, h("span", { class: "pill spon" }, "Sponsored / affiliated"), " labels come from the list and are shown on each card") : null,
          )
        : h("p", null, h("strong", null, "No public picks yet. "), h("span", { class: "muted small" }, follow ? "You still follow this taste; it comes back if they publish picks." : `${name} hasn't published picks this app can read.`)),
      h("details", { class: "taste-how" }, h("summary", { class: "small" }, "Where the app looked"), r ? attemptsList(r.attempts, taste?.source) : h("p", { class: "small muted" }, "Saved result; refresh to check again.")),
      follow?.error ? h("p", { class: "err small", role: "status" }, `Last refresh failed (${follow.error}); keeping the previous picks.`) : null,
      h(
        "p",
        { class: "note small" },
        "Public data: picks the creator published themselves. Following adds them to the ranking on this device. Nothing about you is shared: no account, history or follow list leaves this device, and who you follow is stored encrypted here. To refresh, the app reads the list from ",
        taste?.source === "nostr" ? "your relays" : taste?.source === "url" ? "the list's host" : "the creator's instance",
        ", which sees a request from your IP address, like opening the channel page.",
      ),
      follow ? h("p", { class: "small muted" }, `Checked ${ago(follow.checkedAt, now)}; refreshed daily.`) : null,
    ];
  }

  const canFollow = !!taste;
  const actions = h(
    "div",
    { class: "row end" },
    follow ? h("button", { class: "btn", id: "taste-refresh", onclick: () => app.refreshTastes(key) }, "Refresh") : null,
    follow
      ? h("button", { class: "btn", id: "taste-toggle", onclick: () => app.unfollowTaste(key) }, "Unfollow taste")
      : h("button", { class: "btn taste", id: "taste-toggle", disabled: !canFollow, "aria-describedby": canFollow ? undefined : "taste-none", onclick: () => app.followTaste(key) }, canFollow ? "Follow taste" : "No public picks yet"),
  );
  const closeBtn = h("button", { class: "iconbtn", id: "taste-close", "aria-label": "Close", onclick: close }, icon("close"));
  const dialog = h(
    "div",
    { class: "modal consent taste-sheet", role: "dialog", "aria-modal": "true", "aria-labelledby": "taste-title" },
    h("div", { class: "head" }, h("div", null, h("h2", { id: "taste-title" }, `${name}'s taste`), h("p", { class: "mono small muted" }, key)), closeBtn),
    ...body.filter(Boolean),
    actions,
  );
  const scrim = h("div", { class: "scrim", onclick: (e: Event) => e.target === scrim && close() }, dialog);
  scrim.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
      return;
    }
    if (e.key !== "Tab") return;
    const els = [...dialog.querySelectorAll<HTMLElement>("button, a[href], summary")].filter((x) => !x.hasAttribute("disabled"));
    const i = els.indexOf(document.activeElement as HTMLElement);
    if (e.shiftKey && i <= 0) {
      e.preventDefault();
      els[els.length - 1]?.focus();
    } else if (!e.shiftKey && i === els.length - 1) {
      e.preventDefault();
      els[0]?.focus();
    }
  });
  host.replaceChildren(scrim);
  if (first) closeBtn.focus({ preventScroll: true });
  else if (focusId) (document.getElementById(focusId) ?? closeBtn).focus({ preventScroll: true });
}

function followRow(app: App, f: TasteFollow, compact: boolean): HTMLElement {
  const t = f.taste;
  const id = "tf-" + hashId(f.handle);
  const status = !t ? h("span", { class: "pill" }, "no picks right now") : h("span", { class: "pill ok" }, `${t.items.length} picks`);
  return h(
    "li",
    { class: "taste-follow" },
    h(
      "div",
      { class: "stack", style: { gap: "2px", "min-width": "0" } },
      h("strong", null, `${f.name}'s taste`),
      compact ? null : h("span", { class: "mono small muted" }, f.handle),
      h("div", { class: "row", style: { gap: "6px" } }, status, t ? h("span", { class: "pill taste-pill" }, SOURCE_LABEL[t.source]) : null, f.error ? h("span", { class: "pill bad", title: f.error }, "refresh failed") : null),
      !compact && t?.detail ? h("span", { class: "small muted" }, t.detail) : null,
    ),
    h(
      "div",
      { class: "row", style: { gap: "6px", "flex-wrap": "nowrap" } },
      h("label", { class: "mini-switch", for: id + "-on", title: "Use in ranking" }, h("input", { type: "checkbox", id: id + "-on", checked: f.enabled, "aria-label": `Use ${f.name}'s taste in ranking`, onchange: (e: Event) => app.setTasteEnabled(f.handle, (e.target as HTMLInputElement).checked) }), h("span", { "aria-hidden": "true" }, "On")),
      compact ? null : h("button", { class: "btn sm", id: id + "-open", "aria-label": `Details for ${f.name}'s taste`, onclick: () => app.openTaste(f.handle, f.name, id + "-open") }, "Details"),
      h("button", { class: "btn sm", "aria-label": `Remove ${f.name}'s taste`, onclick: () => app.unfollowTaste(f.handle) }, "Remove"),
    ),
  );
}

/** Followed tastes with per-list on/off and remove. */
export function tasteFollowList(app: App, compact = false): HTMLElement {
  const { s } = app;
  if (!s.tasteFollows.length) return h("p", { class: "muted small" }, compact ? "No creator tastes followed." : "None yet. Use Taste on a reel, or the ⋯ menu on a card.");
  return h("ul", { class: "list" + (compact ? " small" : "") }, s.tasteFollows.map((f) => followRow(app, f, compact)));
}

/** Follow & taste: the creator-taste section. */
export function creatorTastePanel(app: App): HTMLElement {
  const { s } = app;
  const input = h("input", { type: "text", id: "ctaste-input", placeholder: "name@host or channel URL", value: s.ui.ctasteInput ?? "", spellcheck: "false", autocomplete: "off", oninput: (e: Event) => (s.ui.ctasteInput = (e.target as HTMLInputElement).value) });
  const submit = (e: Event) => {
    e.preventDefault();
    const ref = parseChannelInput(input.value);
    if (!ref) {
      s.ui.ctasteError = "Use name@host (e.g. wex_channel@tilvids.com) or a channel URL.";
      return app.rerender();
    }
    s.ui.ctasteError = undefined;
    s.ui.ctasteInput = "";
    app.openTaste(handleOf(ref), ref.name, "ctaste-input");
  };
  return h(
    "section",
    { class: "panel tier t1", style: { "grid-column": "1 / -1" }, "aria-labelledby": "ctaste-h" },
    h("div", { class: "row", style: { "justify-content": "space-between" } }, h("h2", { id: "ctaste-h" }, "Creators' taste"), s.tasteFollows.length ? h("button", { class: "btn sm", onclick: () => app.refreshTastes() }, "Refresh all") : null),
    h(
      "p",
      { class: "muted small" },
      "Follow what a creator recommends, not just what they upload. The app looks, in order, for a signed Nostr list from the creator's npub (only on relays you added), a taste list linked in their channel description, then their public PeerTube playlists without their own uploads. Their picks join your feed as a Taste source, capped per list like any other.",
    ),
    h("form", { class: "row", onsubmit: submit }, h("label", { for: "ctaste-input", class: "muted small", style: { flex: "1 0 100%" } }, "Look up a creator"), input, h("button", { class: "btn taste", type: "submit" }, "Look up")),
    s.ui.ctasteError ? h("p", { class: "err", role: "alert" }, s.ui.ctasteError) : null,
    app.mode === "snapshot" ? h("p", { class: "note" }, `Offline snapshot: public playlists were captured for ${app.snapshotTasteChannels.length || "a few"} channels${app.snapshotTasteChannels.length ? ` (${app.snapshotTasteChannels.slice(0, 4).join(", ")})` : ""}. Nostr and linked lists need the network.`) : null,
    tasteFollowList(app),
  );
}
