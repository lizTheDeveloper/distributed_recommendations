import type { App } from "../app.ts";
import type { SourceKind } from "../lib/core.ts";
import { CHIP_LABELS } from "../lib/core.ts";
import type { RetentionDays } from "../lib/settings.ts";
import { DEFAULT_INSTANCES, RETENTION_CHOICES } from "../lib/settings.ts";
import { MIN_PASSPHRASE } from "../lib/vault.ts";
import { parseInstance } from "../lib/handles.ts";
import { h, toggle } from "./dom.ts";
import { LEGEND } from "./home.ts";
import { telemetryLedgerText, telemetryPanel } from "./telemetry.ts";

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
          row(
            "Creators' instances (Follow taste)",
            app.mode === "snapshot"
              ? "Nothing: playlists come from the snapshot."
              : `Requests for a creator's public profile and playlists when you look at their Taste${s.settings.relays.length ? ", and read-only queries for their signed list on your relays (no AUTH)" : ""}, refreshed daily for the ${s.tasteFollows.length} you follow. The host can tell someone at your IP looked. Nothing goes to the creator.`,
            h("span", { class: "pill ok" }, "public data only"),
          ),
          row("Video hosts, when you press play", s.settings.p2p ? "The embedded player streams from the host and from other viewers. Other viewers can see your IP." : "The embedded player streams from the host only. Your IP is visible to the host, not to other viewers.", h("span", { class: "pill " + (s.settings.p2p ? "exp" : "ok") }, s.settings.p2p ? "P2P on" : "P2P off")),
          matchRows(app),
          row("Circles", "Nothing yet.", h("span", { class: "pill next" }, "coming next")),
          telemetryRow(app),
          row(
            "Creators (discovery stats)",
            s.settings.analytics.contribute ? "Nothing sent yet: aggregation isn't live. Your device keeps the tally below until it is." : "Nothing. You turned contribution off.",
            h("span", { class: "pill " + (s.settings.analytics.contribute ? "next" : "ok") }, s.settings.analytics.contribute ? "on, not yet sent" : "off"),
          ),
        ),
      ),
    ),
    h("p", { class: "note" }, "Revoking a match stops future sketches. It can't recall what a peer already received; the app says so at the moment you share."),
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

function telemetryRow(app: App): HTMLElement | null {
  const t = telemetryLedgerText(app);
  if (!t) return null;
  return h("tr", null, h("td", null, t.who), h("td", null, t.what), h("td", null, h("span", { class: "pill " + (t.ok ? "ok" : "exp") }, t.status)));
}

function matchRows(app: App): HTMLElement[] {
  const m = app.match;
  const recs = m.records().filter((r) => r.status === "active" || r.status === "requested" || r.status === "incoming");
  const row = (peer: string, shares: string, status: HTMLElement) => h("tr", null, h("td", null, peer), h("td", null, shares), h("td", null, status));
  const out: HTMLElement[] = [];
  if (!m.identity) {
    out.push(row("Matches", "Nothing. Match isn't set up.", h("span", { class: "pill ok" }, "off")));
    return out;
  }
  out.push(
    row(
      app.mode === "snapshot" ? "Relay (in-memory demo)" : app.s.settings.relays.length ? app.s.settings.relays.map((u) => new URL(u).host).join(", ") : "Relays: none",
      app.mode === "snapshot"
        ? "Nothing leaves this page."
        : "Encrypted, padded gift wraps addressed to one-time keys; your IP and when you check. Never their contents.",
      h("span", { class: "pill ok" }, app.mode === "snapshot" ? "offline" : "encrypted"),
    ),
  );
  for (const r of recs) {
    const c = r.consent;
    out.push(
      row(
        m.nameOf(r.peer),
        r.status === "active" ? `${c.includeFinished ? "Endorsements + finished watches" : "Endorsements"}, last ${c.windowDays} days, as an encrypted sketch, weekly` : "Nothing yet (request pending)",
        h("span", { class: "pill " + (r.status === "active" ? (c.paused ? "exp" : "ok") : "next") }, r.status === "active" ? (c.paused ? "paused quietly" : "active") : r.status === "requested" ? "requested" : "waiting for you"),
      ),
    );
  }
  if (!recs.length) out.push(row("Matches", "Nothing: no active matches.", h("span", { class: "pill ok" }, "none")));
  if (app.mode === "live" && recs.some((r) => r.status === "active"))
    out.push(row("Video hosts of your matches' picks", "A lookup of each new video in a match's sketch at its home instance, so it can be ranked: your IP and the video link.", h("span", { class: "pill ok" }, "catalog only")));
  return out;
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
    ...toggle("sw-private", "Private watching", s.settings.privateWatching, (on) => (set(() => (s.settings.privateWatching = on), on ? "Private watching on: nothing is recorded" : "Private watching off"), app.telemetry.event("private-watching", { on })), {
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
    ...toggle("sw-popular", "Show \"Popular on your instances\"", s.settings.showPopular, (on) => set(() => (s.settings.showPopular = on)), {
      hint: "A separate section after your feed with each instance's trending videos. It never takes slots from your feed.",
    }),
    h("h3", null, "Match"),
    h("p", { class: "small" }, "What each match gets (endorsements only, or with finished watches; window; exclusions) and quiet pause are set per match. Passive watches are never shared."),
    h("div", { class: "row" }, h("button", { class: "btn sm", onclick: () => app.go("matches") }, "Open Matches")),
    h("h3", null, "Coming next"),
    ...toggle("sw-circle8", "Join circles only if they have 8+ people", true, () => {}, { disabled: true }),
    h("p", { class: "hint", style: { "margin-top": "-6px" } }, "Circle isn't in this version. Shown with its planned default."),
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
    h(
      "p",
      { class: "small" },
      `${watches} watch${watches === 1 ? "" : "es"} and ${endorses} endorsement${endorses === 1 ? "" : "s"} `,
      app.vault.status === "memory" ? "in memory for this tab only." : "stored in this browser only.",
    ),
    storageStatus(app),
    h(
      "div",
      { class: "switch" },
      h("label", { for: "retention" }, "Keep history for"),
      h(
        "select",
        {
          id: "retention",
          "aria-describedby": "retention-hint",
          onchange: (e: Event) => {
            const days = Number((e.target as HTMLSelectElement).value) as RetentionDays;
            app.setRetention(days);
            app.toast(`History older than ${days} days is deleted`);
          },
        },
        RETENTION_CHOICES.map((d) => h("option", { value: String(d), selected: s.settings.retentionDays === d }, `${d} days`)),
      ),
    ),
    h("p", { class: "hint", id: "retention-hint" }, "Your sharing window. Older watches and endorsements are deleted from this device when the app starts and once a day."),
    passphrase(app),
    confirming
      ? h(
          "div",
          { class: "confirm", role: "alertdialog", "aria-labelledby": "wipe-q" },
          h("strong", { id: "wipe-q" }, "Wipe all local history?"),
          h("p", null, `This deletes ${watches + endorses} events, the discovery tally and feed impressions, and destroys the encryption key they were stored under. Follows, taste lists and recipes stay (re-encrypted under a new key). It can't be undone.`),
          h(
            "div",
            { class: "row end" },
            h("button", { class: "btn sm", id: "wipe-cancel", onclick: () => { s.ui.wipeConfirm = undefined; app.rerender(); } }, "Cancel"),
            h("button", { class: "btn sm warn solid", id: "wipe-yes", onclick: () => { s.ui.wipeConfirm = undefined; void app.wipeHistory(); } }, "Wipe history"),
          ),
        )
      : h("button", { class: "btn warn", id: "btn-wipe", onclick: () => { s.ui.wipeConfirm = "1"; app.rerender(); requestAnimationFrame(() => document.getElementById("wipe-cancel")?.focus()); } }, "Wipe local history…"),
  );
}

function storageStatus(app: App): HTMLElement {
  const v = app.vault;
  if (v.status === "memory")
    return h(
      "p",
      { class: "note", id: "storage-status", role: "note" },
      h("strong", null, "Not saved. "),
      `${v.reason ?? ""} History, follows and taste lists stay in memory until you close this tab; nothing is written unencrypted.`,
      app.legacyLeft ? " Unencrypted history from an older version is still in this browser: wiping removes it." : "",
    );
  return h(
    "p",
    { class: "note", id: "storage-status" },
    h("strong", null, v.status === "passphrase" ? "Encrypted with your passphrase. " : "Encrypted on this device. "),
    v.status === "passphrase"
      ? "History, follows and taste lists are stored as AES-256-GCM ciphertext under a key derived from your passphrase. It isn't stored anywhere."
      : "History, follows and taste lists are stored as AES-256-GCM ciphertext under a key this browser keeps and page scripts can't export. That keeps them out of plaintext site data, backups and sync of it, and other browser profiles. It doesn't protect against malware, anyone using this browser profile, or a full copy of the profile (a passphrase helps there).",
  );
}

function passphrase(app: App): HTMLElement | null {
  const { s } = app;
  if (app.vault.status === "memory") return null;
  const busy = s.ui.passBusy === "1";
  const run = async (fn: () => Promise<void>, ok: string) => {
    s.ui.passBusy = "1";
    s.ui.passError = undefined;
    app.rerender();
    try {
      await fn();
      s.ui.passOpen = undefined;
      app.toast(ok);
    } catch (e) {
      s.ui.passError = e instanceof Error ? e.message : String(e);
    }
    s.ui.passBusy = undefined;
    app.rerender();
  };
  if (app.vault.status === "passphrase")
    return h(
      "div",
      { class: "stack" },
      h("p", { class: "hint", style: { "margin-top": "0" } }, "Passphrase on: you'll type it each time the app opens."),
      h("div", { class: "row" }, h("button", { class: "btn sm", id: "pass-off", disabled: busy, onclick: () => run(() => app.vault.clearPassphrase(), "Passphrase removed; a device key protects your history") }, busy ? "Working…" : "Turn off passphrase")),
      s.ui.passError ? h("p", { class: "err", role: "alert" }, s.ui.passError) : null,
    );
  if (s.ui.passOpen !== "1")
    return h(
      "div",
      { class: "stack" },
      h("div", { class: "row" }, h("button", { class: "btn sm", id: "pass-open", onclick: () => { s.ui.passOpen = "1"; app.rerender(); requestAnimationFrame(() => document.getElementById("pass-1")?.focus()); } }, "Add a passphrase (optional)…")),
    );
  const p1 = h("input", { type: "password", id: "pass-1", autocomplete: "new-password", disabled: busy, "aria-describedby": "pass-hint" });
  const p2 = h("input", { type: "password", id: "pass-2", autocomplete: "new-password", disabled: busy });
  const submit = (e: Event) => {
    e.preventDefault();
    if (p1.value.length < MIN_PASSPHRASE) s.ui.passError = `Use at least ${MIN_PASSPHRASE} characters.`;
    else if (p1.value !== p2.value) s.ui.passError = "The two passphrases don't match.";
    else return void run(() => app.vault.setPassphrase(p1.value), "Passphrase set");
    app.rerender();
  };
  return h(
    "form",
    { class: "confirm", onsubmit: submit, "aria-labelledby": "pass-h" },
    h("strong", { id: "pass-h" }, "Passphrase (optional)"),
    h(
      "p",
      { id: "pass-hint" },
      "Adds protection if someone copies this browser profile: the key is derived from your passphrase (PBKDF2, 600,000 rounds) instead of being stored. You'll type it each time the app opens. ",
      h("strong", null, "If you forget it, your history, follows and taste lists can't be recovered."),
    ),
    h("label", { for: "pass-1" }, "Passphrase"),
    p1,
    h("label", { for: "pass-2" }, "Repeat it"),
    p2,
    s.ui.passError ? h("p", { class: "err", role: "alert" }, s.ui.passError) : null,
    h(
      "div",
      { class: "row end" },
      h("button", { class: "btn sm", type: "button", onclick: () => { s.ui.passOpen = undefined; s.ui.passError = undefined; app.rerender(); } }, "Cancel"),
      h("button", { class: "btn sm match", type: "submit", disabled: busy }, busy ? "Working…" : "Set passphrase"),
    ),
  );
}

export function settingsScreen(app: App): HTMLElement {
  const cols = h("section", { class: "cols" }, ledger(app), controls(app));
  const tel = telemetryPanel(app);
  return tel ? h("div", { class: "stack", style: { gap: "20px" } }, cols, tel) : cols;
}
