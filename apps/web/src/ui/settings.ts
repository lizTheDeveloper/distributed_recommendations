import type { App } from "../app.ts";
import type { SourceKind } from "../lib/core.ts";
import { CHIP_LABELS } from "../lib/core.ts";
import { DEFAULT_INSTANCES } from "../lib/settings.ts";
import { parseInstance } from "../lib/handles.ts";
import { h, toggle } from "./dom.ts";
import { LEGEND } from "./home.ts";

function ledger(app: App): HTMLElement {
  const { s } = app;
  const hosts = s.settings.instances.map((o) => new URL(o).host);
  const followHosts = [...new Set(s.follows.map((f) => f.handle.split("@")[1]))].filter((x) => !hosts.includes(x));
  const row = (peer: string, shares: string, status: HTMLElement) => h("tr", null, h("td", null, peer), h("td", null, shares), h("td", null, status));
  const total = LEGEND.reduce((n, k) => n + s.tally[k], 0);
  const max = Math.max(1, ...LEGEND.map((k) => s.tally[k]));
  return h(
    "section",
    { class: "panel", style: { gap: "10px" }, "aria-labelledby": "ledger-h" },
    h("h2", { id: "ledger-h" }, "What you share, and with whom"),
    h(
      "div",
      { class: "tablewrap" },
      h(
        "table",
        null,
        h("thead", null, h("tr", null, h("th", null, "Who"), h("th", null, "What they get"), h("th", null, "Status"))),
        h(
          "tbody",
          null,
          row(
            hosts.join(", ") || "No instances",
            app.mode === "snapshot" ? "Nothing: this offline build makes no requests." : "Requests for public video lists: your IP and the time. No account, cookies or referrer, and never your history.",
            h("span", { class: "pill ok" }, app.mode === "snapshot" ? "offline" : "catalog only"),
          ),
          followHosts.length
            ? row(followHosts.join(", "), "Requests for the public video list of each channel you follow, so the host can tell someone at your IP follows it.", h("span", { class: "pill ok" }, "catalog only"))
            : null,
          row("Video hosts, when you press play", s.settings.p2p ? "The embedded player streams from the host and from other viewers. Other viewers can see your IP." : "The embedded player streams from the host only. Your IP is visible to the host, not to other viewers.", h("span", { class: "pill " + (s.settings.p2p ? "exp" : "ok") }, s.settings.p2p ? "P2P on" : "P2P off")),
          row("Matches", "Nothing yet.", h("span", { class: "pill next" }, "coming next")),
          row("Circles", "Nothing yet.", h("span", { class: "pill next" }, "coming next")),
          row(
            "Creators (discovery stats)",
            s.settings.analytics.contribute ? "Nothing sent yet: aggregation isn't live. Your device keeps the tally below until it is." : "Nothing. You turned contribution off.",
            h("span", { class: "pill " + (s.settings.analytics.contribute ? "next" : "ok") }, s.settings.analytics.contribute ? "on, not yet sent" : "off"),
          ),
        ),
      ),
    ),
    h("p", { class: "note" }, "Once Match ships, revoking stops future sketches. It can't recall what a peer already received; the app will say so at the moment you share."),
    h("h3", null, "Discovery stats your device would contribute"),
    h("p", { class: "muted small", style: { "margin-top": "-6px" } }, `${total} view${total === 1 ? "" : "s"} counted by how you found them. When the privacy-preserving aggregation (DAP) ships, only totals like these go to creators, split between two servers so neither sees your report. Kept on this device until then.`),
    h(
      "div",
      { class: "stack" },
      LEGEND.map((k) =>
        h(
          "div",
          null,
          h("div", { class: "row small", style: { "justify-content": "space-between" } }, h("span", null, CHIP_LABELS[k], s.settings.analytics.perKind[k] ? "" : " (off)"), h("span", { class: "mono" }, String(s.tally[k]))),
          h("div", { class: "bar" }, h("i", { style: { width: `${(s.tally[k] / max) * 100}%`, background: `var(--${k})` } })),
        ),
      ),
    ),
  );
}

function controls(app: App): HTMLElement {
  const { s } = app;
  const set = (fn: () => void, msg?: string) => {
    fn();
    app.persist("settings");
    if (msg) app.toast(msg);
    app.rerender();
  };
  const a = s.settings.analytics;
  const watches = s.history.filter((e) => e.kind === "watch").length;
  const endorses = s.history.filter((e) => e.kind === "endorse").length;
  const confirming = s.ui.wipeConfirm === "1";

  const instInput = h("input", { type: "text", id: "inst-input", placeholder: "peertube.example", disabled: app.mode === "snapshot", value: s.ui.instInput ?? "", oninput: (e: Event) => (s.ui.instInput = (e.target as HTMLInputElement).value) });
  const addInstance = (e: Event) => {
    e.preventDefault();
    const o = parseInstance(instInput.value);
    if (!o) s.ui.instError = "Enter an https PeerTube instance, e.g. framatube.org";
    else if (s.settings.instances.includes(o)) s.ui.instError = "Already in the list.";
    else if (s.settings.instances.length >= 8) s.ui.instError = "Up to 8 instances.";
    else {
      s.ui.instError = undefined;
      s.ui.instInput = "";
      s.settings.instances = [...s.settings.instances, o];
      app.persist("settings");
      app.reloadCatalog();
      return;
    }
    app.rerender();
  };

  return h(
    "aside",
    { class: "panel", "aria-label": "Controls" },
    h("h2", null, "Controls"),
    ...toggle("sw-private", "Private watching", s.settings.privateWatching, (on) => set(() => (s.settings.privateWatching = on), on ? "Private watching on: nothing is recorded" : "Private watching off"), {
      hint: "Nothing you watch or endorse is recorded while this is on, and nothing is counted for discovery stats.",
    }),
    ...toggle("sw-p2p", "Peer-to-peer streaming", s.settings.p2p, (on) => set(() => (s.settings.p2p = on)), {
      hint: "Saves the host bandwidth, but other viewers of the same video can see your IP address. Off by default.",
    }),
    ...toggle("sw-analytics", "Contribute anonymous discovery stats", a.contribute, (on) => set(() => (a.contribute = on)), {
      hint: "Helps creators learn which ways of finding videos work. On by default; you can turn off any signal.",
    }),
    h(
      "div",
      { class: "indent", role: "group", "aria-label": "Per-signal switches" },
      LEGEND.map((k: SourceKind) =>
        toggle(`sw-a-${k}`, `Report views from ${CHIP_LABELS[k]}`, a.perKind[k], (on) => set(() => (a.perKind[k] = on)), { disabled: !a.contribute }),
      ),
    ),
    ...toggle("sw-trending", "Use instance trending as a taste list", s.settings.trendingAsTaste, (on) => set(() => (s.settings.trendingAsTaste = on)), {
      hint: "Each instance's trending videos count as a weak public taste list (half strength).",
    }),
    h("h3", null, "Coming next"),
    ...toggle("sw-endorse-only", "Share endorsements only, not passive watches", true, () => {}, { disabled: true }),
    ...toggle("sw-circle8", "Join circles only if they have 8+ people", true, () => {}, { disabled: true }),
    ...toggle("sw-pause", "Pause sharing quietly", false, () => {}, { disabled: true }),
    h("p", { class: "hint", style: { "margin-top": "-6px" } }, "These apply to Match and Circle, which aren't in this version. Shown with their planned defaults."),
    h("h3", null, "Catalog instances"),
    h(
      "ul",
      { class: "list" },
      s.settings.instances.map((o) =>
        h(
          "li",
          null,
          h("span", { class: "mono small" }, new URL(o).host),
          h("button", { class: "btn sm", disabled: app.mode === "snapshot" || s.settings.instances.length <= 1, "aria-label": `Remove ${new URL(o).host}`, onclick: () => { s.settings.instances = s.settings.instances.filter((x) => x !== o); app.persist("settings"); app.reloadCatalog(); } }, "Remove"),
        ),
      ),
    ),
    h("form", { class: "row", onsubmit: addInstance }, instInput, h("button", { class: "btn sm", type: "submit", disabled: app.mode === "snapshot" }, "Add")),
    s.ui.instError ? h("p", { class: "err", role: "alert" }, s.ui.instError) : null,
    app.mode === "live" && s.settings.instances.join() !== DEFAULT_INSTANCES.join()
      ? h("button", { class: "linkbtn", onclick: () => { s.settings.instances = [...DEFAULT_INSTANCES]; app.persist("settings"); app.reloadCatalog(); } }, "Reset to defaults")
      : null,
    h("h3", null, "Local history"),
    h("p", { class: "small" }, `${watches} watch${watches === 1 ? "" : "es"} and ${endorses} endorsement${endorses === 1 ? "" : "s"} stored in this browser only.`),
    confirming
      ? h(
          "div",
          { class: "confirm", role: "alertdialog", "aria-labelledby": "wipe-q" },
          h("strong", { id: "wipe-q" }, "Wipe all local history?"),
          h("p", null, `This deletes ${watches + endorses} events and the discovery tally from this browser. Follows, taste lists and recipes stay. It can't be undone.`),
          h(
            "div",
            { class: "row end" },
            h("button", { class: "btn sm", id: "wipe-cancel", onclick: () => { s.ui.wipeConfirm = undefined; app.rerender(); } }, "Cancel"),
            h("button", { class: "btn sm warn solid", id: "wipe-yes", onclick: () => { s.ui.wipeConfirm = undefined; app.wipeHistory(); } }, "Wipe history"),
          ),
        )
      : h("button", { class: "btn warn", id: "btn-wipe", onclick: () => { s.ui.wipeConfirm = "1"; app.rerender(); requestAnimationFrame(() => document.getElementById("wipe-cancel")?.focus()); } }, "Wipe local history…"),
  );
}

export function settingsScreen(app: App): HTMLElement {
  return h("section", { class: "cols" }, ledger(app), controls(app));
}
