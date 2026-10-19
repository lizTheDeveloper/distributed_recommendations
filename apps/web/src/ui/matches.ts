// Matches: identity, relays, requests (with the preview flow), the consent sheet,
// active matches and the sharing ledger. Follows mockups/match-feed.html (creator
// page "Request match…" modal, preview box, and the ledger screen).

import type { App, ConsentDialog, MatchTarget } from "../app.ts";
import type { SketchConsent } from "../lib/core.ts";
import { PREVIEW_MIN_SET_SIZE, previewDisplay } from "../lib/core.ts";
import type { MatchRecord } from "../lib/match/pkg.ts";
import { DEFAULT_CONSENT, MATCH_TIMING } from "../lib/match/pkg.ts";
import { parseNpub, shortNpub } from "../lib/bech32.ts";
import { generateIdentity, importIdentity, nip07Support, useExtension } from "../lib/match/identity.ts";
import { loadPsi, psiStatus } from "../lib/match/psi.ts";
import { errorText } from "../lib/match/service.ts";
import { DEMO_NAME } from "../lib/match/demo.ts";
import { MAX_RELAYS, parseRelayUrl } from "../lib/settings.ts";
import { splitList } from "../lib/sheet.ts";
import { h } from "./dom.ts";
import { icon } from "./icons.ts";

const DAY = 86_400;
const LATE_NIGHT = [22, 23, 0, 1, 2, 3, 4, 5];

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

function inDays(t: number | undefined): string {
  if (t === undefined) return "";
  const d = Math.round((t - nowSec()) / DAY);
  return d <= 0 ? "today" : d === 1 ? "in 1 day" : `in ${d} days`;
}

function ago(t: number): string {
  const s = nowSec() - t;
  if (s < 90) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < DAY) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / DAY)} days ago`;
}

function avatar(name: string, pubkey: string): HTMLElement {
  const hue = parseInt(pubkey.slice(0, 4), 16) % 360;
  const letters = name.replace(/[^A-Za-z0-9 ]/g, "").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";
  return h("span", { class: "av", style: { background: `hsl(${hue} 45% 32%)` }, "aria-hidden": "true" }, letters);
}

function consentSummary(c: SketchConsent): string {
  const parts = [c.includeFinished ? "Endorsements + finished watches" : "Endorsements"];
  const ex: string[] = [];
  if (c.excludedTags.length) ex.push(`#${c.excludedTags.join(", #")}`);
  if (c.excludedHours.length) ex.push("late-night");
  if (c.excludedVideos?.length) ex.push(`${c.excludedVideos.length} video${c.excludedVideos.length === 1 ? "" : "s"}`);
  return parts.join("") + (ex.length ? `; not ${ex.join(", ")}` : "");
}

async function act(app: App, key: string, fn: () => Promise<unknown>, ok?: string): Promise<void> {
  app.s.ui.matchBusy = key;
  app.s.ui.matchError = undefined;
  app.rerender();
  try {
    await fn();
    if (ok) app.toast(ok);
  } catch (e) {
    app.s.ui.matchError = errorText(e);
  }
  app.s.ui.matchBusy = undefined;
  app.rerender();
}

// ---- identity ----

function identityPanel(app: App): HTMLElement {
  const { s } = app;
  const m = app.match;
  if (!m.identity) {
    const ext = nip07Support();
    const nsec = h("input", { type: "password", id: "nsec-input", placeholder: "nsec1…", autocomplete: "off", spellcheck: "false", value: s.ui.nsecInput ?? "", oninput: (e: Event) => (s.ui.nsecInput = (e.target as HTMLInputElement).value) });
    return h(
      "section",
      { class: "panel tier t2", "aria-labelledby": "id-h" },
      h("h2", { id: "id-h" }, "Set up Match"),
      h("p", { class: "muted small" }, "A match is a mutual, private exchange of recent taste with one person. Both of you send an encrypted sketch of what you endorsed; each device scores the overlap and recommends from the other's picks. You need a Nostr key to send and receive requests."),
      h(
        "div",
        { class: "row" },
        h("button", { class: "btn match", id: "id-generate", onclick: () => act(app, "id", () => app.setIdentity(generateIdentity()), "New key created and stored encrypted on this device") }, "Create a new key"),
        ext === "ok"
          ? h("button", { class: "btn", id: "id-nip07", onclick: () => act(app, "id", async () => app.setIdentity(await useExtension()), "Using your browser extension's key") }, "Use browser extension (NIP-07)")
          : null,
      ),
      ext === "no-nip44" ? h("p", { class: "note" }, "Your Nostr extension doesn't support NIP-44 encryption, which Match needs. Update it, or create a key here.") : null,
      h(
        "form",
        { class: "row", onsubmit: (e: Event) => { e.preventDefault(); void act(app, "id", async () => { await app.setIdentity(await importIdentity(nsec.value)); s.ui.nsecInput = ""; }, "Key imported and stored encrypted on this device"); } },
        h("label", { for: "nsec-input", class: "muted small", style: { flex: "1 0 100%" } }, "Or import an existing key"),
        nsec,
        h("button", { class: "btn sm", type: "submit" }, "Import"),
      ),
      h("p", { class: "hint", style: { "margin-top": "0" } }, "A key made or imported here is kept only in this browser's encrypted storage (with your passphrase, if you set one). An extension keeps it outside the page entirely."),
    );
  }
  const npub = m.npub!;
  const confirming = s.ui.idRemove === "1";
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(npub);
      app.toast("npub copied");
    } catch {
      const el = document.getElementById("my-npub") as HTMLInputElement | null;
      el?.focus();
      el?.select();
      app.toast("Selected. Copy with your keyboard");
    }
  };
  return h(
    "section",
    { class: "panel", "aria-labelledby": "id-h" },
    h("div", { class: "row", style: { "justify-content": "space-between" } }, h("h2", { id: "id-h" }, "Your Match identity"), h("span", { class: "pill " + (m.ready ? "ok" : m.state === "error" ? "bad" : "") }, m.ready ? "ready" : m.state)),
    h(
      "div",
      { class: "row" },
      h("input", { type: "text", id: "my-npub", readonly: true, value: npub, class: "mono", "aria-label": "Your npub", style: { flex: "1 1 220px" } }),
      h("button", { class: "btn sm", id: "copy-npub", onclick: copy }, icon("copy", 16), "Copy"),
    ),
    h("p", { class: "muted small" }, m.identity.kind === "nip07" ? "Signing with your browser extension (NIP-07). The secret key never enters this page." : "Secret key stored encrypted on this device. Share the npub with people you want to match with; never share the nsec."),
    m.error ? h("p", { class: "err", role: "alert" }, m.error) : null,
    confirming
      ? h(
          "div",
          { class: "confirm", role: "alertdialog", "aria-labelledby": "idrm-q" },
          h("strong", { id: "idrm-q" }, "Remove this identity?"),
          h("p", null, m.identity.kind === "local" ? "This deletes the key and every match on this device. Matches can't continue without it, and peers keep what you already sent." : "This forgets the extension's key and every match on this device."),
          h(
            "div",
            { class: "row end" },
            h("button", { class: "btn sm", id: "idrm-cancel", onclick: () => { s.ui.idRemove = undefined; app.rerender(); } }, "Cancel"),
            h("button", { class: "btn sm warn solid", onclick: () => { s.ui.idRemove = undefined; void app.setIdentity(null); } }, "Remove identity and matches"),
          ),
        )
      : h("button", { class: "linkbtn", onclick: () => { s.ui.idRemove = "1"; app.rerender(); requestAnimationFrame(() => document.getElementById("idrm-cancel")?.focus()); } }, "Remove identity…"),
  );
}

// ---- relays ----

/** Direct relays or the private relay (OHTTP), when this build has one (docs/TRANSPORT.md). */
function transportChoice(app: App): HTMLElement | null {
  const { s } = app;
  if (!app.ohttp) return null;
  const mode = s.settings.matchTransport;
  return h(
    "fieldset",
    { class: "fieldset", id: "transport" },
    h("legend", null, "How Match reaches relays"),
    h(
      "label",
      { class: "radio" },
      h("input", { type: "radio", name: "transport", id: "tr-ohttp", checked: mode === "ohttp", onchange: () => app.setTransport("ohttp") }),
      h("span", null, h("strong", null, "Private relay (OHTTP)"), h("span", { class: "muted small block" }, `Through ${new URL(app.ohttp.relayUrl).host}, which sees your IP but not what you send; the gateway behind it sees what you send but not your IP. It uses its operator's Nostr relays instead of your list, and relays that require sign-in (NIP-42) can't be used. Checks run every few minutes.`)),
    ),
    mode === "ohttp"
      ? h(
          "label",
          { class: "check indent" },
          h("input", { type: "checkbox", id: "tr-strict", checked: s.settings.ohttpStrict, onchange: (e: Event) => app.setTransport("ohttp", (e.target as HTMLInputElement).checked) }),
          h("span", null, "Strict timing", h("span", { class: "muted small block" }, "Sends same-size requests on a fixed schedule, so not even the timing shows when you're active. Slower delivery and about 30 MB a day.")),
        )
      : null,
    h(
      "label",
      { class: "radio" },
      h("input", { type: "radio", name: "transport", id: "tr-direct", checked: mode === "direct", onchange: () => app.setTransport("direct") }),
      h("span", null, h("strong", null, "Direct"), h("span", { class: "muted small block" }, "Faster, to the relays in your list. They see your IP and when you check.")),
    ),
  );
}

function relaysPanel(app: App): HTMLElement {
  const { s } = app;
  if (app.mode === "snapshot") {
    return h(
      "section",
      { class: "panel", "aria-labelledby": "relays-h" },
      h("h2", { id: "relays-h" }, "Relay"),
      h("p", { class: "small" }, h("span", { class: "pill exp" }, "offline"), " In-memory demo relay in this page. This build has no network, so nothing leaves the page."),
    );
  }
  const relays = s.settings.relays;
  const statuses = new Map((app.match.relay && "statuses" in app.match.relay ? (app.match.relay as { statuses(): { url: string; state: string; message?: string; authed: boolean }[] }).statuses() : []).map((x) => [x.url, x]));
  const input = h("input", { type: "text", id: "relay-input", placeholder: "wss://relay.example", value: s.ui.relayInput ?? "", spellcheck: "false", oninput: (e: Event) => (s.ui.relayInput = (e.target as HTMLInputElement).value) });
  const add = (e: Event) => {
    e.preventDefault();
    const u = parseRelayUrl(input.value);
    if (!u) s.ui.relayError = "Use a wss:// address (plain ws:// only for this computer, e.g. ws://127.0.0.1:7777).";
    else if (relays.includes(u)) s.ui.relayError = "Already in the list.";
    else if (relays.length >= MAX_RELAYS) s.ui.relayError = `Up to ${MAX_RELAYS} relays.`;
    else {
      s.ui.relayError = undefined;
      s.ui.relayInput = "";
      app.setRelays([...relays, u]);
      return;
    }
    app.rerender();
  };
  return h(
    "section",
    { class: "panel", "aria-labelledby": "relays-h" },
    h("h2", { id: "relays-h" }, "Relays"),
    transportChoice(app),
    h("p", { class: "muted small" }, app.ohttp && s.settings.matchTransport === "ohttp" ? "Your relay list below is used for direct mode, and by features that read public data (creators' signed picks, labelers, publishing your picks)." : "Match messages travel as encrypted, padded gift wraps through Nostr relays you choose. None are set by default, so nothing is sent until you add one. Relays see your IP, when you check for messages, and that some key receives traffic; never what's inside."),
    relays.length
      ? h(
          "ul",
          { class: "list" },
          relays.map((u) => {
            const st = statuses.get(u);
            return h(
              "li",
              null,
              h("div", null, h("span", { class: "mono small" }, u), st ? h("div", null, h("span", { class: "pill " + (st.state === "open" ? "ok" : st.state === "error" ? "bad" : ""), title: st.message }, st.state + (st.authed ? " · authed" : ""))) : null),
              h("button", { class: "btn sm", "aria-label": `Remove ${u}`, onclick: () => app.setRelays(relays.filter((x) => x !== u)) }, "Remove"),
            );
          }),
        )
      : h("p", { class: "note" }, "No relays yet. For local testing run ", h("code", null, "npm run dev-relay"), " and add ws://127.0.0.1:7777. Don't test against public relays."),
    h("form", { class: "row", onsubmit: add }, h("label", { for: "relay-input", class: "muted small", style: { flex: "1 0 100%" } }, "Add a relay"), input, h("button", { class: "btn sm", type: "submit" }, "Add")),
    s.ui.relayError ? h("p", { class: "err", role: "alert" }, s.ui.relayError) : null,
  );
}

// ---- demo (offline artifact only) ----

function demoPanel(app: App): HTMLElement | null {
  const demo = app.demo;
  if (app.mode !== "snapshot") return null;
  const m = app.match;
  const live = demo ? m.liveWith(demo.pubkey) : undefined;
  const mine = m.shareable(DEFAULT_CONSENT).length;
  return h(
    "section",
    { class: "panel demo", "aria-labelledby": "demo-h" },
    h("div", { class: "row", style: { "justify-content": "space-between" } }, h("h2", { id: "demo-h" }, DEMO_NAME), h("span", { class: "pill exp" }, "simulated")),
    h("p", { class: "small" }, "This offline build can't reach real people, so a ", h("strong", null, "simulated peer"), " runs the real protocol inside this page: its own key, 30 made-up endorsements of snapshot videos, real PSI previews and real encrypted sketches over an in-memory relay. It accepts previews and matches automatically. It isn't a person."),
    !m.identity ? h("p", { class: "note" }, "Create a key above to start.") : null,
    demo && m.ready
      ? h(
          "div",
          { class: "stack" },
          h(
            "div",
            { class: "row" },
            h("button", { class: "btn match", id: "demo-request", disabled: !!live, onclick: () => app.requestMatchWith({ pubkey: demo.pubkey, name: DEMO_NAME, source: "demo" }) }, "Request a match with the demo peer…"),
            h("button", { class: "btn", id: "demo-incoming", disabled: !!live, onclick: () => act(app, "demo", async () => { await demo.requestViewer(m.book!.self, true); await m.sync(); }) }, "Have the demo peer ask you"),
          ),
          live
            ? h("p", { class: "muted small" }, `You have a ${live.status === "active" ? "match" : "pending request"} with the demo peer; end it below, or start over with a new one.`)
            : null,
          h("p", { class: "muted small" }, "Previews are limited to one per pair per week, so to try the preview again (or the other side of it), ", h("button", { class: "linkbtn", id: "demo-new", onclick: () => act(app, "demo", () => app.newDemoPeer(), "New demo peer ready") }, "start over with a new demo peer"), "."),
          h(
            "p",
            { class: "muted small" },
            `Previews need ${PREVIEW_MIN_SET_SIZE}+ shareable endorsements on each side; you have ${mine}. `,
            mine < PREVIEW_MIN_SET_SIZE
              ? h("button", { class: "linkbtn", id: "demo-fill", onclick: () => fillDemoHistory(app) }, "Add 24 demo endorsements to my history")
              : null,
          ),
        )
      : null,
  );
}

/** Demo only: endorse 24 snapshot videos (half shared with the simulated peer). */
function fillDemoHistory(app: App) {
  const demo = app.demo;
  if (!demo) return;
  const theirs = new Set(demo.items);
  const pool = new Map<string, import("../lib/core.ts").Video>();
  for (const r of app.s.instances.values()) if (r.status === "ok") for (const v of [...r.value.recent, ...r.value.trending]) pool.set(v.id, v);
  const shared = [...pool.values()].filter((v) => theirs.has(v.id)).slice(0, 12);
  const other = [...pool.values()].filter((v) => !theirs.has(v.id)).slice(0, 24 - shared.length);
  let n = 0;
  for (const v of [...shared, ...other]) {
    if (app.isEndorsed(v.id)) continue;
    app.s.history = [...app.s.history, { videoId: v.id, at: Date.now() - n * 60_000, kind: "endorse", tags: v.tags }];
    n++;
  }
  app.persist("history");
  app.toast(`Added ${n} demo endorsements (${shared.length} the demo peer also endorsed)`);
  app.rerender();
}

// ---- request by npub ----

function requestPanel(app: App): HTMLElement {
  const { s } = app;
  const npub = h("input", { type: "text", id: "req-npub", placeholder: "npub1…", spellcheck: "false", autocomplete: "off", value: s.ui.reqNpub ?? "", oninput: (e: Event) => (s.ui.reqNpub = (e.target as HTMLInputElement).value) });
  const name = h("input", { type: "text", id: "req-name", placeholder: "Name (only you see it)", maxlength: "60", value: s.ui.reqName ?? "", oninput: (e: Event) => (s.ui.reqName = (e.target as HTMLInputElement).value) });
  const submit = (e: Event) => {
    e.preventDefault();
    const pk = parseNpub(npub.value);
    if (!pk) s.ui.reqError = "That isn't an npub. It starts with npub1 and is 63 characters long.";
    else if (pk === app.match.identity?.pubkey) s.ui.reqError = "That's your own key.";
    else if (app.match.liveWith(pk)) s.ui.reqError = "You already have a match or request with them.";
    else {
      s.ui.reqError = undefined;
      s.ui.reqNpub = "";
      s.ui.reqName = "";
      const nm = name.value.trim() || app.match.meta.names[pk]?.name || shortNpub(pk);
      s.consent = { mode: "request", target: { pubkey: pk, name: nm, source: "manual" } };
    }
    app.rerender();
  };
  return h(
    "section",
    { class: "panel", "aria-labelledby": "req-h" },
    h("h2", { id: "req-h" }, "Request a match"),
    h("p", { class: "muted small" }, "Paste someone's npub, or use Match on a creator's reel or Creator studio page when they publish one."),
    h(
      "form",
      { class: "stack", onsubmit: submit },
      h("label", { for: "req-npub", class: "small" }, "Their npub"),
      npub,
      h("label", { for: "req-name", class: "small" }, "What to call them"),
      name,
      h("div", { class: "row end" }, h("button", { class: "btn match", type: "submit", id: "req-next" }, "Next: what you share…")),
    ),
    s.ui.reqError ? h("p", { class: "err", role: "alert" }, s.ui.reqError) : null,
  );
}

// ---- preview box ----

function psiNote(): HTMLElement | null {
  const st = psiStatus();
  if (st.state === "unavailable") return h("p", { class: "note", role: "note" }, h("strong", null, "Preview unavailable in this browser. "), `${st.reason}. Matching still works without a preview.`);
  if (st.state === "loading") return h("p", { class: "muted small" }, "Loading the private set intersection module…");
  return null;
}

function previewBox(app: App, rec: MatchRecord): HTMLElement | null {
  const p = rec.preview;
  const name = app.match.nameOf(rec.peer);
  const busy = app.s.ui.matchBusy === rec.matchId;
  if (rec.role === "requester") {
    if (!p) {
      if (rec.status !== "requested") return null;
      const mine = app.match.shareable(rec.consent).length;
      return h(
        "div",
        { class: "preview small" },
        h("div", { style: { flex: "1", "min-width": "200px" } }, h("strong", null, "No preview yet"), h("p", { class: "muted small" }, `Ask ${name} how many videos you have in common before they decide. Needs ${PREVIEW_MIN_SET_SIZE}+ shareable videos on each side (you have ${mine}).`)),
        h("button", { class: "btn sm match", disabled: busy || mine < PREVIEW_MIN_SET_SIZE || psiStatus().state === "unavailable", onclick: () => act(app, rec.matchId, () => app.match.requestPreview(rec.matchId), "Preview requested") }, "Request preview"),
      );
    }
    if (p.stage === "done" && p.result) {
      const d = previewDisplay(p.result.belowFloor, p.result.value ?? null, p.result.floor);
      return h(
        "div",
        { class: "preview", "aria-live": "polite", id: `preview-${rec.matchId.slice(0, 8)}` },
        h("span", { class: "big mono" }, d.belowFloor ? `<${p.result.floor}` : String(d.value)),
        h(
          "div",
          { style: { flex: "1", "min-width": "200px" } },
          h("strong", null, `${d.label} · videos in common, roughly`),
          h("p", { class: "muted small" }, `Noised on ${name}'s device before it was sent (counts under ${p.result.floor} show only as "<${p.result.floor}"), so it can't confirm any single video. Neither of you learned which videos.`),
        ),
      );
    }
    const text: Record<string, string> = {
      requested: `Waiting for ${name} to accept the preview`,
      accepted: "Accepted: answering their private set intersection…",
      answered: `Answered. ${name}'s device is computing the noised count…`,
      running: `${name}'s device is computing…`,
      declined: `${name} declined the preview (or has no previews left this year)`,
      failed: "The preview didn't run",
    };
    return h("div", { class: "preview small" }, h("p", null, text[p.stage] ?? p.stage));
  }
  // Target side.
  if (!p) return null;
  const budget = app.match.previewBudget();
  if (p.stage === "requested") {
    const mine = app.match.shareable(DEFAULT_CONSENT).length;
    const enough = mine >= PREVIEW_MIN_SET_SIZE && (p.requesterSetSize ?? PREVIEW_MIN_SET_SIZE) >= 0;
    void loadPsi();
    return h(
      "div",
      { class: "preview stack", style: { "align-items": "stretch" } },
      h("strong", null, `${name} asked for a preview`),
      h("p", { class: "small" }, `If you accept, they learn roughly how many videos you have in common, noised on your device ("<5" below five), never which ones. You don't see their list either.`),
      h("p", { class: "small", id: `budget-${rec.matchId.slice(0, 8)}` }, h("strong", { class: "mono" }, `${budget} of 8`), " previews left for you to grant this year (from everyone together). Accepting uses one."),
      !enough ? h("p", { class: "note" }, `You have ${mine} shareable endorsements; a preview needs ${PREVIEW_MIN_SET_SIZE}. Accepting now would use up a preview and fail.`) : null,
      psiNote(),
      h(
        "div",
        { class: "row" },
        h("button", { class: "btn sm match", id: `pv-accept-${rec.matchId.slice(0, 8)}`, disabled: busy || budget <= 0 || !enough || psiStatus().state === "unavailable", onclick: () => act(app, rec.matchId, () => app.match.respondToPreview(rec.matchId, true), "Preview answered: they get a noised count") }, "Accept preview"),
        h("button", { class: "btn sm", disabled: busy, onclick: () => act(app, rec.matchId, () => app.match.respondToPreview(rec.matchId, false), "Preview declined") }, "Decline preview"),
      ),
    );
  }
  const text: Record<string, string> = {
    accepted: "Preview accepted. Waiting for their answer…",
    answered: "Computing…",
    running: "Computing…",
    done: `Preview answered: ${name} got a noised count. ${budget} of 8 previews left this year.`,
    declined: "You declined the preview.",
    failed: "The preview didn't run.",
  };
  return h("div", { class: "preview small" }, h("p", null, text[p.stage] ?? p.stage));
}

// ---- lists ----

function card(app: App, rec: MatchRecord, body: (HTMLElement | null)[], actions: (HTMLElement | null)[]): HTMLElement {
  const name = app.match.nameOf(rec.peer);
  return h(
    "li",
    { class: "mcard", "data-match": rec.matchId },
    h(
      "div",
      { class: "mcard-head" },
      avatar(name, rec.peer),
      h("div", { class: "stack", style: { gap: "0" } }, h("strong", null, name), h("span", { class: "mono small muted" }, shortNpub(rec.peer))),
    ),
    ...body,
    actions.some(Boolean) ? h("div", { class: "row" }, ...actions) : null,
  );
}

function incoming(app: App, recs: MatchRecord[]): HTMLElement | null {
  if (!recs.length) return null;
  return h(
    "section",
    { class: "panel", "aria-labelledby": "in-h" },
    h("h2", { id: "in-h" }, "Requests for you"),
    h(
      "ul",
      { class: "mlist" },
      recs.map((rec) => {
        const busy = app.s.ui.matchBusy === rec.matchId;
        const p = rec.preview?.stage;
        const previewOpen = p === "requested" || p === "accepted" || p === "answered" || p === "running";
        return card(
          app,
          rec,
          [h("p", { class: "muted small" }, `Asked ${ago(rec.requestedAt)} · ${rec.durationDays} days if you accept · expires ${inDays(rec.requestedAt + MATCH_TIMING.requestTtlSec)} if you don't answer`), previewBox(app, rec)],
          [
            h("button", { class: "btn match sm", id: `accept-${rec.matchId.slice(0, 8)}`, disabled: busy || previewOpen, title: previewOpen ? "Answer the preview first" : undefined, onclick: () => { app.s.consent = { mode: "accept", matchId: rec.matchId }; app.rerender(); } }, "Accept match…"),
            h("button", { class: "btn sm", disabled: busy, onclick: () => act(app, rec.matchId, () => app.match.decline(rec.matchId), "Declined") }, "Decline"),
            blockPersonButton(app, rec),
          ],
        );
      }),
    ),
  );
}

function outgoing(app: App, recs: MatchRecord[]): HTMLElement | null {
  if (!recs.length) return null;
  return h(
    "section",
    { class: "panel", "aria-labelledby": "out-h" },
    h("h2", { id: "out-h" }, "Your requests"),
    h(
      "ul",
      { class: "mlist" },
      recs.map((rec) =>
        card(
          app,
          rec,
          [h("p", { class: "muted small" }, `Sent ${ago(rec.requestedAt)} · waiting for ${app.match.nameOf(rec.peer)} to accept`), previewBox(app, rec), psiNote()],
          [revokeControl(app, rec, "Withdraw")],
        ),
      ),
    ),
  );
}

/** Block: declines or revokes the match and drops anything from this key (sketches, lists, requests). */
function blockPersonButton(app: App, rec: MatchRecord): HTMLElement {
  return h(
    "button",
    {
      class: "btn sm warn",
      id: `block-${rec.matchId.slice(0, 8)}`,
      title: "Ends the match, declines future requests from this key and hides what it recommends",
      onclick: () => void app.blockPerson(rec.peer, app.match.nameOf(rec.peer)),
    },
    "Block",
  );
}

function revokeControl(app: App, rec: MatchRecord, label = "Revoke…"): HTMLElement {
  const { s } = app;
  const key = `revoke-${rec.matchId}`;
  const name = app.match.nameOf(rec.peer);
  if (s.ui.revokeConfirm === key) {
    return h(
      "div",
      { class: "confirm", role: "alertdialog", "aria-labelledby": `${key}-q`, style: { flex: "1 0 100%" } },
      h("strong", { id: `${key}-q` }, rec.status === "active" ? `End the match with ${name}?` : `Withdraw your request to ${name}?`),
      h("p", null, rec.status === "active" ? `Your device stops sending sketches and deletes this match's keys and ${name}'s sketch. It can't recall what ${name} already received.` : "They'll be told it was withdrawn."),
      h(
        "div",
        { class: "row end" },
        h("button", { class: "btn sm", id: `${key}-cancel`, onclick: () => { s.ui.revokeConfirm = undefined; app.rerender(); } }, "Cancel"),
        h("button", { class: "btn sm warn solid", id: `${key}-yes`, onclick: () => { s.ui.revokeConfirm = undefined; void act(app, rec.matchId, () => app.match.revoke(rec.matchId), rec.status === "active" ? `Match with ${name} ended` : "Request withdrawn"); } }, rec.status === "active" ? "End match" : "Withdraw"),
      ),
    );
  }
  return h(
    "button",
    { class: "btn sm warn", id: key, onclick: () => { s.ui.revokeConfirm = key; app.rerender(); requestAnimationFrame(() => document.getElementById(`${key}-cancel`)?.focus()); } },
    label,
  );
}

function active(app: App, recs: MatchRecord[]): HTMLElement | null {
  if (!recs.length) return null;
  const mine = new Set(app.s.history.filter((e) => e.kind === "endorse" || e.kind === "finish").map((e) => e.videoId));
  const sims = new Map(app.match.similarities(mine).map((x) => [x.matchId, x]));
  return h(
    "section",
    { class: "panel", "aria-labelledby": "act-h" },
    h("h2", { id: "act-h" }, "Active matches"),
    h(
      "ul",
      { class: "mlist" },
      recs.map((rec) => {
        const sim = sims.get(rec.matchId);
        const busy = app.s.ui.matchBusy === rec.matchId;
        const paused = rec.consent.paused;
        const renew = rec.renew;
        return card(
          app,
          rec,
          [
            sim
              ? h("div", null, h("div", { class: "row small", style: { "justify-content": "space-between" } }, h("span", null, "Overlap (Jaccard, on this device)"), h("span", { class: "mono", id: `sim-${rec.matchId.slice(0, 8)}` }, sim.similarity.toFixed(2))), h("div", { class: "bar" }, h("i", { style: { width: `${Math.min(100, sim.similarity * 100)}%` } })), h("p", { class: "muted small" }, `${sim.items.size} videos in their last sketch`))
              : h("p", { class: "muted small" }, "No sketch from them yet. Sketches arrive on a weekly schedule."),
            h(
              "p",
              { class: "small" },
              h("span", { class: "pill " + (paused ? "exp" : "ok") }, paused ? "Paused quietly" : "Active"),
              ` Ends ${inDays(rec.expiresAt)} unless you both renew · you share: ${consentSummary(rec.consent)}, last ${rec.consent.windowDays} days`,
              rec.lastSketchSentAt ? ` · last sketch sent ${ago(rec.lastSketchSentAt)}` : "",
            ),
            rec.preview?.stage === "done" && rec.preview.result
              ? h("p", { class: "small" }, "Preview before matching: ", h("strong", null, rec.preview.result.belowFloor ? `<${rec.preview.result.floor}` : `${rec.preview.result.value} (${rec.preview.result.label})`), " videos in common, noised")
              : null,
            renew ? h("p", { class: "note" }, renew.proposedBy === "peer" ? `${app.match.nameOf(rec.peer)} proposed renewing for another 90 days.` : "Renewal proposed. Waiting for them.") : null,
          ],
          [
            h("button", { class: "btn sm", disabled: busy || renew?.proposedBy === "me", onclick: () => act(app, rec.matchId, () => app.match.renew(rec.matchId), renew?.proposedBy === "peer" ? "Renewed for 90 days" : "Renewal proposed") }, renew?.proposedBy === "peer" ? "Accept renewal" : "Renew"),
            h("button", { class: "btn sm", "aria-pressed": String(paused), disabled: busy, onclick: () => act(app, rec.matchId, () => app.match.setPaused(rec.matchId, !paused), paused ? "Sharing resumed" : "Paused quietly: they keep getting your last sketch") }, paused ? "Resume sharing" : "Pause quietly"),
            h("button", { class: "btn sm", onclick: () => { app.s.consent = { mode: "edit", matchId: rec.matchId }; app.rerender(); } }, "What I share…"),
            app.devTools ? h("button", { class: "btn sm", id: `sketch-${rec.matchId.slice(0, 8)}`, disabled: busy, title: "Dev builds only: off the weekly schedule", onclick: () => act(app, rec.matchId, () => app.match.sendSketchNow(rec.matchId), "Sketch sent") }, "Send sketch now (dev)") : null,
            revokeControl(app, rec),
            blockPersonButton(app, rec),
          ],
        );
      }),
    ),
  );
}

function ledger(app: App, recs: MatchRecord[]): HTMLElement {
  const rows = recs.filter((r) => r.status === "active" || r.status === "requested" || r.status === "incoming");
  const status = (r: MatchRecord) =>
    r.status === "active"
      ? r.consent.paused
        ? h("span", { class: "pill exp" }, "Paused quietly")
        : (r.expiresAt ?? 0) - nowSec() < 14 * DAY
          ? h("span", { class: "pill exp" }, `Expires ${inDays(r.expiresAt)}`)
          : h("span", { class: "pill ok" }, `Active, ends ${inDays(r.expiresAt)}`)
      : r.status === "requested"
        ? h("span", { class: "pill" }, "Requested")
        : h("span", { class: "pill next" }, "Waiting for you");
  return h(
    "section",
    { class: "panel", "aria-labelledby": "ledger-h" },
    h("h2", { id: "ledger-h" }, "What you share, and with whom"),
    rows.length
      ? h(
          "div",
          { class: "tablewrap", tabindex: "0", role: "region", "aria-label": "Table (scrolls sideways)" },
          h(
            "table",
            null,
            h("thead", null, h("tr", null, h("th", null, "Peer"), h("th", null, "Shares"), h("th", null, "Window"), h("th", null, "Status"))),
            h(
              "tbody",
              null,
              rows.map((r) =>
                h(
                  "tr",
                  null,
                  h("td", null, app.match.nameOf(r.peer)),
                  h("td", null, r.status === "active" ? consentSummary(r.consent) : r.status === "requested" ? `Nothing yet (${consentSummary(r.consent).toLowerCase()} once accepted)` : "Nothing yet"),
                  h("td", { class: "mono" }, `${r.consent.windowDays} days`),
                  h("td", null, status(r)),
                ),
              ),
            ),
          ),
        )
      : h("p", { class: "muted small" }, "You share nothing with anyone. Matches you accept appear here."),
    h("p", { class: "note" }, "Revoking stops future sketches. It can't recall what a peer already received. Quiet pause keeps re-sending your last sketch on schedule, so they aren't told."),
  );
}

function activity(app: App): HTMLElement | null {
  const log = app.match.meta.log;
  if (!log.length) return null;
  return h(
    "details",
    { class: "panel" },
    h("summary", null, `Activity on this device (${log.length})`),
    h("ul", { class: "list small" }, [...log].reverse().slice(0, 30).map((e) => h("li", null, h("span", null, e.text), h("span", { class: "muted mono" }, ago(Math.floor(e.at / 1000)))))),
  );
}

// ---- consent sheet ----

function consentDialog(app: App, d: ConsentDialog): HTMLElement {
  const { s } = app;
  const m = app.match;
  const rec = d.mode === "request" ? undefined : m.record(d.matchId);
  const target: MatchTarget | undefined = d.mode === "request" ? d.target : rec ? { pubkey: rec.peer, name: m.nameOf(rec.peer), source: "manual" } : undefined;
  const base: SketchConsent = rec?.consent ?? DEFAULT_CONSENT;
  // Draft lives in ui state as JSON so re-renders keep it.
  const draft: SketchConsent & { preview: boolean } = s.ui.consentDraft ? JSON.parse(s.ui.consentDraft) : { ...base, excludedVideos: base.excludedVideos ?? [], preview: d.mode === "request" };
  const save = (patch: Partial<typeof draft>) => {
    s.ui.consentDraft = JSON.stringify({ ...draft, ...patch });
    app.rerender();
  };
  const close = () => {
    s.consent = null;
    s.ui.consentDraft = undefined;
    app.rerender();
  };
  const items = m.shareable(draft);
  const endorsed = app.s.history.filter((e) => e.kind === "endorse");
  const titles = new Map<string, string>();
  for (const r of app.s.instances.values()) if (r.status === "ok") for (const v of [...r.value.recent, ...r.value.trending]) titles.set(v.id, v.title);
  for (const [id, v] of app.s.videoCache) titles.set(id, v.title);
  const name = target?.name ?? "them";
  const retention = app.s.settings.retentionDays;
  const late = LATE_NIGHT.every((x) => draft.excludedHours.includes(x));
  const radio = (group: string, checked: boolean, label: string, on: () => void, id: string) =>
    h("label", { class: "opt", for: id }, h("input", { type: "radio", name: group, id, checked, onchange: on }), label);

  const submit = () => {
    const consent: SketchConsent = { windowDays: draft.windowDays, includeFinished: draft.includeFinished, excludedTags: draft.excludedTags, excludedHours: draft.excludedHours, excludedVideos: draft.excludedVideos, paused: rec?.consent.paused ?? false };
    if (d.mode === "request" && target) {
      if (target.source !== "manual" || !m.meta.names[target.pubkey]) m.setName(target.pubkey, { name: target.name, source: target.source, ref: target.ref });
      close();
      void act(app, "request", () => m.requestMatch(target.pubkey, consent, draft.preview && items.length >= PREVIEW_MIN_SET_SIZE), draft.preview ? `Match and preview requested from ${name}` : `Match request sent to ${name}`);
    } else if (d.mode === "accept" && rec) {
      close();
      void act(app, rec.matchId, () => m.accept(rec.matchId, consent), `You and ${name} are matched`);
    } else if (d.mode === "edit" && rec) {
      close();
      void act(app, rec.matchId, () => m.setConsent(rec.matchId, consent), "Sharing updated. It applies from the next sketch");
    }
  };
  const tagsInput = h("input", { type: "text", id: "cs-tags", value: draft.excludedTags.join(", "), placeholder: "e.g. health", onchange: (e: Event) => save({ excludedTags: splitList((e.target as HTMLInputElement).value) }) });
  const title = d.mode === "request" ? `Match with ${name}` : d.mode === "accept" ? `Accept ${name}'s match` : `What you share with ${name}`;
  const go = d.mode === "request" ? "Send match request" : d.mode === "accept" ? "Accept and match" : "Save";
  if (d.mode === "request" && draft.preview) void loadPsi();
  const dialog = h(
    "div",
    { class: "modal consent", role: "dialog", "aria-modal": "true", "aria-labelledby": "cs-title" },
    h("div", { class: "head" }, h("h2", { id: "cs-title" }, title), h("button", { class: "iconbtn", id: "cs-close", "aria-label": "Close", onclick: close }, icon("close"))),
    target && target.source === "demo" ? h("p", { class: "note" }, `${DEMO_NAME}: a simulated peer in this offline build, not a person.`) : null,
    h("p", { class: "muted small" }, "You'll each send the other a taste sketch: an encrypted, padded list of video links. Each device scores the overlap and recommends from the other's picks."),
    h(
      "fieldset",
      null,
      h("legend", null, "What goes in your sketch"),
      radio("cs-what", !draft.includeFinished, "Videos you endorsed (liked or saved)", () => save({ includeFinished: false }), "cs-w1"),
      radio("cs-what", draft.includeFinished, "Endorsed + finished watching (≥80%, from Reels)", () => save({ includeFinished: true }), "cs-w2"),
    ),
    h(
      "fieldset",
      null,
      h("legend", null, "Window"),
      ...[30, 60, 90].map((w) => radio("cs-win", draft.windowDays === w, `Last ${w} days, rolling`, () => save({ windowDays: w }), `cs-d${w}`)),
      draft.windowDays > retention ? h("p", { class: "hint", style: { "margin-top": "0" } }, `This device keeps only ${retention} days of history (Sharing & privacy), so that's the most it can share.`) : null,
    ),
    h(
      "fieldset",
      null,
      h("legend", null, "Never share"),
      h("label", { for: "cs-tags", class: "small" }, "Videos tagged"),
      tagsInput,
      h("label", { class: "opt", for: "cs-late" }, h("input", { type: "checkbox", id: "cs-late", checked: late, onchange: (e: Event) => save({ excludedHours: (e.target as HTMLInputElement).checked ? LATE_NIGHT : [] }) }), "Anything from 22:00–06:00"),
      endorsed.length
        ? h(
            "details",
            null,
            h("summary", null, `Specific videos (${draft.excludedVideos?.length ?? 0} excluded)`),
            h(
              "div",
              { class: "stack", style: { "max-height": "180px", overflow: "auto" } },
              [...new Map(endorsed.map((e) => [e.videoId, e])).values()].slice(-60).reverse().map((e, i) =>
                h(
                  "label",
                  { class: "opt small", for: `cs-v${i}` },
                  h("input", {
                    type: "checkbox",
                    id: `cs-v${i}`,
                    checked: draft.excludedVideos?.includes(e.videoId),
                    onchange: (ev: Event) => {
                      const on = (ev.target as HTMLInputElement).checked;
                      const set = new Set(draft.excludedVideos ?? []);
                      if (on) set.add(e.videoId);
                      else set.delete(e.videoId);
                      save({ excludedVideos: [...set] });
                    },
                  }),
                  titles.get(e.videoId) ?? e.videoId,
                ),
              ),
            ),
          )
        : null,
    ),
    d.mode === "request"
      ? h(
          "label",
          { class: "opt", for: "cs-preview" },
          h("input", { type: "checkbox", id: "cs-preview", checked: draft.preview, disabled: items.length < PREVIEW_MIN_SET_SIZE || psiStatus().state === "unavailable", onchange: (e: Event) => save({ preview: (e.target as HTMLInputElement).checked }) }),
          h(
            "span",
            null,
            "Ask for a preview first: how many videos you have in common, noised, before they decide.",
            items.length < PREVIEW_MIN_SET_SIZE ? h("span", { class: "muted small block" }, `Needs ${PREVIEW_MIN_SET_SIZE}+ shareable videos; you have ${items.length}.`) : null,
          ),
        )
      : null,
    d.mode === "request" ? psiNote() : null,
    h(
      "dl",
      { class: "kv" },
      h("dt", null, "They'll see"),
      h("dd", null, h("span", { class: "mono", id: "cs-count" }, String(Math.min(128, items.length))), ` video link${items.length === 1 ? "" : "s"}, updated weekly`, items.length > 128 ? " (the newest 128)" : ""),
      h("dt", null, "Expires"),
      h("dd", null, `${MATCH_TIMING.maxDurationDays} days unless you both renew`),
      h("dt", null, "Pause"),
      h("dd", null, "Quietly, any time: they keep getting your last sketch"),
    ),
    h("p", { class: "note" }, "Anything sent can be kept by the recipient. Revoking stops new sketches only."),
    h("div", { class: "row end" }, h("button", { class: "btn", onclick: close }, "Cancel"), h("button", { class: "btn match", id: "cs-go", onclick: submit }, go)),
  );
  const scrim = h("div", { class: "scrim", onclick: (e: Event) => e.target === scrim && close() }, dialog);
  scrim.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      close();
    }
  });
  requestAnimationFrame(() => {
    if (!dialog.contains(document.activeElement)) (document.getElementById("cs-go") as HTMLElement | null)?.focus({ preventScroll: true });
  });
  return scrim;
}

export function matchesScreen(app: App): HTMLElement {
  const { s } = app;
  const m = app.match;
  const recs = m.records();
  const busy = s.ui.matchBusy !== undefined || m.busy;
  const canSync = m.ready && (m.relay || app.demo);
  return h(
    "section",
    { class: "matches stack", style: { gap: "16px" } },
    h(
      "div",
      { class: "feedhead" },
      h("h2", null, "Matches"),
      canSync
        ? h("button", { class: "btn sm", id: "match-sync", disabled: busy, onclick: () => act(app, "sync", async () => { await m.sync(); await m.pump(); }) }, busy ? "Working…" : "Check for messages")
        : null,
    ),
    h("p", { class: "muted small" }, "Prototype: the Match protocol and OpenMined PSI haven't been audited. Message kinds are provisional."),
    s.ui.matchError ? h("p", { class: "err", role: "alert" }, s.ui.matchError) : null,
    m.ready ? null : identityPanel(app),
    h("div", { class: "cols" }, h("div", { class: "stack", style: { gap: "16px" } }, demoPanel(app), m.ready ? incoming(app, recs.filter((r) => r.status === "incoming")) : null, m.ready ? outgoing(app, recs.filter((r) => r.status === "requested")) : null, m.ready ? active(app, recs.filter((r) => r.status === "active")) : null, m.ready ? ledger(app, recs) : null, activity(app)), h("div", { class: "stack", style: { gap: "16px" } }, m.ready ? identityPanel(app) : null, m.identity ? relaysPanel(app) : null, m.ready ? requestPanel(app) : null)),
    s.consent && m.ready ? consentDialog(app, s.consent) : null,
  );
}

