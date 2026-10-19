// Player overlay. Uses the PeerTube embed on the video's origin instance: the
// simplest robust option (the instance handles formats, HLS and captions). P2P is
// passed as a URL flag and is off unless the viewer enabled it.

import type { App } from "../app.ts";
import type { SourceKind, Video } from "../lib/core.ts";
import { parseChannelInput } from "../lib/handles.ts";
import { embedUrl } from "../lib/videos.ts";
import { h } from "./dom.ts";
import { chip } from "./home.ts";
import { openBlock, openReport } from "./moderation.ts";
import { reasonText } from "../lib/modstate.ts";

export function openWatch(app: App, v: Video, via: SourceKind | undefined, onClose: () => void): void {
  const { s } = app;
  const prevFocus = document.activeElement as HTMLElement | null;
  const src = app.mode === "live" ? embedUrl(v, { p2p: s.settings.p2p }) : null;
  const watchUrl = v.url ?? v.id;
  // Links, search and deep links never went through the feed's pre-filter: judge here.
  const verdict = app.verdict(v);
  const hidden = verdict.action === "hide";
  let blurred = verdict.action === "blur" && !app.isRevealed(v.id);

  const iframe = () =>
    h("iframe", {
      class: "player",
      src: src!,
      title: v.title,
      allow: "fullscreen; picture-in-picture; autoplay",
      referrerpolicy: "no-referrer",
      sandbox: "allow-scripts allow-same-origin allow-popups allow-presentation",
    });
  const player: HTMLElement = hidden
    ? h(
        "div",
        { class: "player ph modcover", id: "watch-hidden" },
        h(
          "div",
          { class: "stack", style: { "align-items": "center", "text-align": "center" } },
          h("strong", null, "Hidden by your moderation settings"),
          h("ul", { class: "small", style: { "text-align": "left" } }, verdict.reasons.slice(0, 4).map((r) => h("li", null, reasonText(r)))),
          h("span", { class: "small" }, "Change this in Sharing & privacy → Moderation."),
        ),
      )
    : blurred
      ? h(
          "div",
          { class: "player ph modcover", id: "watch-blurred" },
          h(
            "div",
            { class: "stack", style: { "align-items": "center", "text-align": "center" } },
            h("strong", null, "Sensitive content"),
            h("span", { class: "small" }, verdict.titles.join(" · ")),
            h(
              "button",
              {
                class: "btn sm",
                id: "watch-reveal",
                onclick: () => {
                  blurred = false;
                  app.reveal(v.id);
                  const next = src ? iframe() : h("div", { class: "player ph" }, h("strong", null, "Playback needs the network"));
                  player.replaceWith(next);
                },
              },
              "Show anyway",
            ),
          ),
        )
      : src
        ? iframe()
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
    if (e.key === "Escape" && !document.body.classList.contains("dialog-open")) close();
    if (e.key === "Tab" && scrim.isConnected && !document.body.classList.contains("dialog-open")) {
      // Keep focus inside the player dialog.
      const els = [...scrim.querySelectorAll<HTMLElement>("button:not([disabled]), a[href], iframe")];
      const i = els.indexOf(document.activeElement as HTMLElement);
      if (e.shiftKey && i <= 0) {
        e.preventDefault();
        els[els.length - 1]?.focus();
      } else if (!e.shiftKey && i === els.length - 1) {
        e.preventDefault();
        els[0]?.focus();
      }
    }
  };
  const closeBtn = h("button", { class: "btn sm", "aria-label": "Close player", onclick: close }, "Close");
  const recorded = s.settings.privateWatching
    ? "Private watching is on: this isn't recorded."
    : "Recorded on this device only. Endorsements are what your matches can get, and only the ones you agreed to share.";

  const scrim = h(
    "div",
    { class: "scrim", onclick: (e: Event) => e.target === scrim && close() },
    h(
      "div",
      { class: "modal", role: "dialog", "aria-modal": "true", "aria-labelledby": "watch-title" },
      h("div", { class: "head" }, h("h2", { id: "watch-title", style: { "overflow-wrap": "anywhere" } }, v.title), closeBtn),
      player,
      h("div", { class: "row", style: { "justify-content": "space-between" } }, h("div", { class: "row" }, h("span", { class: "muted small" }, v.creatorName ?? v.creator), via ? chip(via) : null), h("span", { class: "muted small mono" }, v.publishedAt.toISOString().slice(0, 10))),
      h(
        "div",
        { class: "row" },
        endorseBtn,
        followBtn,
        h("a", { class: "btn", href: watchUrl, target: "_blank", rel: "noopener noreferrer" }, "Open on PeerTube ↗"),
        h("button", { class: "btn", id: "watch-block", onclick: () => openBlock(app, v, "watch-block") }, "Block…"),
        h("button", { class: "btn", id: "watch-report", onclick: () => openReport(app, v, "watch-report") }, "Report…"),
      ),
      h("p", { class: "muted small" }, recorded),
      h("p", { class: "muted small" }, s.settings.p2p ? "P2P streaming is on: other viewers can see your IP." : "P2P streaming is off: other viewers can't see your IP. Change it in Sharing & privacy."),
    ),
  );
  document.body.appendChild(scrim);
  document.addEventListener("keydown", onKey);
  closeBtn.focus();
}
