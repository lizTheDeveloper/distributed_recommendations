// Player overlay. Uses the PeerTube embed on the video's origin instance: the
// simplest robust option (the instance handles formats, HLS and captions). P2P is
// passed as a URL flag and is off unless the viewer enabled it.

import type { App } from "../app.ts";
import type { SourceKind, Video } from "../lib/core.ts";
import { parseChannelInput } from "../lib/handles.ts";
import { embedUrl } from "../lib/videos.ts";
import { h } from "./dom.ts";
import { chip } from "./home.ts";

export function openWatch(app: App, v: Video, via: SourceKind | undefined, onClose: () => void): void {
  const { s } = app;
  const prevFocus = document.activeElement as HTMLElement | null;
  const src = app.mode === "live" ? embedUrl(v, { p2p: s.settings.p2p }) : null;
  const watchUrl = v.url ?? v.id;

  const player = src
    ? h("iframe", {
        class: "player",
        src,
        title: v.title,
        allow: "fullscreen; picture-in-picture; autoplay",
        referrerpolicy: "no-referrer",
        sandbox: "allow-scripts allow-same-origin allow-popups allow-presentation",
      })
    : h(
        "div",
        { class: "player ph", style: { background: "linear-gradient(135deg,#1b1e29,#3a2a17)" } },
        h("div", { class: "stack", style: { "align-items": "center" } }, h("strong", null, app.mode === "snapshot" ? "Playback needs the network" : "This video can't be embedded"), h("span", { class: "small" }, app.mode === "snapshot" ? "This offline snapshot can't reach PeerTube. The watch is still recorded locally, as it would be in the app." : "Open it on its instance instead.")),
      );

  const endorseBtn = h("button", { class: "btn" });
  const followBtn = h("button", { class: "btn" });
  const refresh = () => {
    const on = app.isEndorsed(v.id);
    endorseBtn.textContent = on ? "Endorsed ✓" : "Endorse";
    endorseBtn.className = on ? "btn on" : "btn match";
    endorseBtn.setAttribute("aria-pressed", String(on));
    const f = app.isFollowing(v.creator);
    followBtn.textContent = f ? "Following" : `Follow ${v.creatorName ?? v.creator}`;
    followBtn.className = f ? "btn on" : "btn follow";
    followBtn.disabled = f;
  };
  endorseBtn.onclick = () => {
    app.toggleEndorse(v, via);
    refresh();
  };
  followBtn.onclick = () => {
    const ref = parseChannelInput(v.creator);
    if (ref) app.follow(ref, v.creatorName);
    refresh();
  };
  refresh();

  const close = () => {
    scrim.remove();
    document.removeEventListener("keydown", onKey);
    onClose();
    prevFocus?.focus?.({ preventScroll: true });
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") close();
  };
  const closeBtn = h("button", { class: "btn sm", "aria-label": "Close player", onclick: close }, "Close");
  const recorded = s.settings.privateWatching
    ? "Private watching is on: this isn't recorded."
    : "Recorded on this device only. Endorsements are what a future Match would share, and only if you consent.";

  const scrim = h(
    "div",
    { class: "scrim", onclick: (e: Event) => e.target === scrim && close() },
    h(
      "div",
      { class: "modal", role: "dialog", "aria-modal": "true", "aria-labelledby": "watch-title" },
      h("div", { class: "head" }, h("h2", { id: "watch-title", style: { "overflow-wrap": "anywhere" } }, v.title), closeBtn),
      player,
      h("div", { class: "row", style: { "justify-content": "space-between" } }, h("div", { class: "row" }, h("span", { class: "muted small" }, v.creatorName ?? v.creator), via ? chip(via) : null), h("span", { class: "muted small mono" }, v.publishedAt.toISOString().slice(0, 10))),
      h("div", { class: "row" }, endorseBtn, followBtn, h("a", { class: "btn", href: watchUrl, target: "_blank", rel: "noopener noreferrer" }, "Open on PeerTube ↗")),
      h("p", { class: "muted small" }, recorded),
      h("p", { class: "muted small" }, s.settings.p2p ? "P2P streaming is on: other viewers can see your IP." : "P2P streaming is off: other viewers can't see your IP. Change it in Sharing & settings."),
    ),
  );
  document.body.appendChild(scrim);
  document.addEventListener("keydown", onKey);
  closeBtn.focus();
}
