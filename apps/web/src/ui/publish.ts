// Creator studio → "Publish my picks" (packages/taste, README "Hooks for apps/web's
// Creator studio"). Pick from your endorsed videos (or paste a watch URL), mark
// sponsored/affiliated, preview the NIP-51 event and the taste-list v1 JSON, and:
// - a dry run by default (build, optionally sign, send nothing);
// - publish only to the relays you configured, signed by your own signer (the Match
//   identity's key in the vault/keystore, or a NIP-07 extension);
// - download the JSON to host anywhere.

import type { App } from "../app.ts";
import type { PickReport, PublishPicksResult, Signer } from "../lib/taste/pkg.ts";
import { MemoryRelay, nip07Signer, publishPicks, relayPublisher, relaysQuery, resolvePicks } from "../lib/taste/pkg.ts";
import { verifyNostrEvent } from "../lib/moderation/pkg.ts";
import { signerFor } from "../lib/match/identity.ts";
import { npubEncode } from "../lib/bech32.ts";
import { descriptionHint, editPick, endorsedChoices, togglePick } from "../lib/picks.ts";
import { watchId } from "../lib/videos.ts";
import { h } from "./dom.ts";
import { icon } from "./icons.ts";
import { openDialog } from "./dialog.ts";

interface PanelState {
  busy: string;
  error: string;
  result: PublishPicksResult | null;
  report: Map<string, PickReport>;
  url: string;
}
const ui: PanelState = { busy: "", error: "", result: null, report: new Map(), url: "" };
/** The offline artifact publishes to an in-page relay (labelled as such). */
let demoRelay: MemoryRelay | null = null;

const verify = (e: unknown) => verifyNostrEvent(e as Parameters<typeof verifyNostrEvent>[0]);

function signer(app: App): { signer: Signer; label: string } | null {
  const id = app.match.identity;
  if (id?.kind === "local") return { signer: signerFor(id) as unknown as Signer, label: "your Match identity's key (stored encrypted on this device)" };
  if (id?.kind === "nip07") {
    try {
      return { signer: nip07Signer(), label: "your NIP-07 browser extension" };
    } catch {
      return null;
    }
  }
  try {
    return { signer: nip07Signer(), label: "your NIP-07 browser extension" };
  } catch {
    return null;
  }
}

export function publishPanel(app: App): HTMLElement {
  const { s } = app;
  const draft = s.picks;
  const set = draft.set;
  const sg = signer(app);
  const relays = app.mode === "live" ? s.settings.relays : [];
  const choices = endorsedChoices(s.history, (id) => app.knownVideo(id));
  const picked = new Set(set.items.map((p) => p.url));
  const save = (next: typeof set) => {
    s.picks = { ...draft, set: next };
    ui.result = null;
    app.savePicks();
    app.rerender();
  };
  const safe = (fn: () => void) => {
    try {
      ui.error = "";
      fn();
    } catch (e) {
      ui.error = e instanceof Error ? e.message : String(e);
      app.rerender();
    }
  };
  const titleOf = (url: string) => choices.find((c) => c.id === url)?.video?.title ?? app.knownVideo(url)?.title ?? url;

  const run = async (label: string, fn: () => Promise<void>) => {
    ui.busy = label;
    ui.error = "";
    app.rerender();
    try {
      await fn();
    } catch (e) {
      ui.error = e instanceof Error ? e.message : String(e);
    }
    ui.busy = "";
    app.rerender();
  };

  const checkBridged = () =>
    run("check", async () => {
      const r = await resolvePicks(set, { query: relaysQuery(relays), verify, ...(sg ? { bridgePubkeys: [await sg.signer.getPublicKey()] } : {}) });
      ui.report = new Map(r.report.map((x) => [x.url, x]));
      save(r.set);
    });
  const preview = (sign: boolean) =>
    run(sign ? "sign" : "preview", async () => {
      ui.result = await publishPicks(set, { signer: sg?.signer, dryRun: true, signInDryRun: sign && !!sg, verify });
    });
  const publishNow = () => {
    const target = app.mode === "snapshot" ? ["in-page demo relay (offline)"] : relays;
    const d = openDialog({
      id: "publish-confirm",
      title: "Publish your picks?",
      returnFocus: "pk-publish",
      body: () => [
        h("p", null, `Signs a public list of ${set.items.length} pick${set.items.length === 1 ? "" : "s"} with ${sg?.label ?? "your signer"} and sends it to:`),
        h("ul", { class: "small mono" }, target.map((r) => h("li", null, r))),
        h("p", { class: "small" }, "Anyone can read it, and relays may keep copies even if you unpublish later. Sponsored and affiliated marks are shown to viewers."),
        h(
          "div",
          { class: "row end" },
          h("button", { class: "btn", id: "pk-cancel", onclick: () => d.close() }, "Cancel"),
          h(
            "button",
            {
              class: "btn warn solid",
              id: "pk-confirm",
              onclick: () => {
                d.close();
                void run("publish", async () => {
                  const publish =
                    app.mode === "snapshot"
                      ? async (_r: string[], e: Parameters<MemoryRelay["publish"]>[0]) => [await (demoRelay ??= new MemoryRelay(verify, "memory://demo-relay")).publish(e)]
                      : relayPublisher({ authSigner: sg!.signer });
                  ui.result = await publishPicks(set, { signer: sg!.signer, relays: app.mode === "snapshot" ? ["memory://demo-relay"] : relays, dryRun: false, publish, verify });
                  const ok = ui.result.results?.filter((r) => r.ok).length ?? 0;
                  app.toast(`Published to ${ok} of ${ui.result.results?.length ?? 0} relay${(ui.result.results?.length ?? 0) === 1 ? "" : "s"}`);
                });
              },
            },
            "Sign and publish",
          ),
        ),
      ],
    });
  };
  const download = () => {
    void publishPicks(set, { signer: undefined, dryRun: true }).then((r) => {
      const url = URL.createObjectURL(new Blob([r.json], { type: "application/json" }));
      const a = h("a", { href: url, download: "taste.json", hidden: true });
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  };

  const urlInput = h("input", { type: "url", id: "pk-url", placeholder: "https://instance/videos/watch/…", value: ui.url, oninput: (e: Event) => (ui.url = (e.target as HTMLInputElement).value) });
  const addUrl = (e: Event) => {
    e.preventDefault();
    if (!watchId(ui.url.trim())) {
      ui.error = "Paste a PeerTube watch URL (…/videos/watch/… or …/w/…).";
      return app.rerender();
    }
    safe(() => {
      save(togglePick(set, ui.url.trim(), Date.now()));
      ui.url = "";
    });
  };
  const status = (url: string) => {
    const r = ui.report.get(url);
    const p = set.items.find((x) => x.url === url);
    if (p?.video) return h("span", { class: "pill ok" }, "On Nostr ✓");
    if (!r) return null;
    return h("span", { class: "pill" }, r.status === "not-bridged" ? "Not bridged: JSON list only" : r.status === "ambiguous" ? "Several bridges: JSON only" : r.status === "error" ? "Check failed" : r.status);
  };

  const pickRows = set.items.map((p, i) => {
    const pid = `pk-${i}`;
    return h(
      "li",
      { class: "pickrow" },
      h("div", { class: "row", style: { "justify-content": "space-between" } }, h("span", { class: "small", style: { "overflow-wrap": "anywhere" } }, titleOf(p.url)), status(p.url)),
      h(
        "div",
        { class: "row small" },
        h("label", { class: "check" }, h("input", { type: "checkbox", id: `${pid}-spon`, checked: p.sponsored, onchange: (e: Event) => safe(() => save(editPick(set, p.url, { sponsored: (e.target as HTMLInputElement).checked }))) }), "Sponsored (paid)"),
        h("label", { class: "check" }, h("input", { type: "checkbox", id: `${pid}-aff`, checked: p.affiliated, onchange: (e: Event) => safe(() => save(editPick(set, p.url, { affiliated: (e.target as HTMLInputElement).checked }))) }), "Affiliated (a connection)"),
        h("button", { class: "linkbtn", id: `${pid}-rm`, "aria-label": `Remove ${titleOf(p.url)} from picks`, onclick: () => save(togglePick(set, p.url, Date.now())) }, "Remove"),
      ),
      h("label", { class: "sr-only", for: `${pid}-note` }, `Note for ${titleOf(p.url)}`),
      h("input", { type: "text", id: `${pid}-note`, maxlength: 280, placeholder: "Note (optional, shown with the pick)", value: p.note ?? "", onchange: (e: Event) => safe(() => save(editPick(set, p.url, { note: (e.target as HTMLInputElement).value.trim() || undefined }))) }),
    );
  });

  const pk = ui.result?.pubkey;
  const npub = pk ? npubEncode(pk) : app.match.npub;
  return h(
    "section",
    { class: "panel", id: "publish-picks", "aria-labelledby": "pk-h" },
    h("h2", { id: "pk-h" }, "Publish my picks"),
    h(
      "p",
      { class: "muted small" },
      "Recommend other creators' videos you endorsed. Viewers who \"Follow your taste\" get them in their feed. One set of picks goes out two ways: a signed Nostr list (NIP-51, for videos bridged to Nostr) and a JSON file you host and link from your channel description.",
    ),
    h(
      "p",
      { class: "small", id: "pk-signer" },
      sg ? `Signer: ${sg.label}.` : "No signer yet: create or import a key on the Matches screen, or install a NIP-07 extension. Previews and the JSON download work without one.",
      " ",
      relays.length ? `Relays: ${relays.map((r) => new URL(r).host).join(", ")}.` : app.mode === "snapshot" ? "Offline snapshot: publishing goes to an in-page demo relay." : "No relays: add one on the Matches screen to publish to Nostr.",
    ),
    h(
      "div",
      { class: "cols2 tight" },
      h("div", { class: "field" }, h("label", { for: "pk-title" }, "List name"), h("input", { type: "text", id: "pk-title", maxlength: 80, value: set.title, onchange: (e: Event) => safe(() => save({ ...set, title: (e.target as HTMLInputElement).value.trim() || "My picks" })) })),
      h("div", { class: "field" }, h("label", { for: "pk-desc" }, "Description (optional)"), h("input", { type: "text", id: "pk-desc", maxlength: 500, value: set.description ?? "", onchange: (e: Event) => safe(() => save({ ...set, description: (e.target as HTMLInputElement).value.trim() || undefined })) })),
    ),
    h("h3", null, `From your endorsements (${choices.length})`),
    choices.length
      ? h(
          "ul",
          { class: "list picklist" },
          choices.slice(0, 40).map((c, i) =>
            h(
              "li",
              null,
              h(
                "label",
                { class: "check" },
                h("input", { type: "checkbox", id: `pk-c-${i}`, checked: picked.has(c.id), onchange: () => safe(() => save(togglePick(set, c.id, Date.now()))) }),
                h("span", { class: "small", style: { "overflow-wrap": "anywhere" } }, c.video?.title ?? c.id, c.video ? h("span", { class: "muted" }, ` · ${c.video.creatorName ?? c.video.creator}`) : null),
              ),
            ),
          ),
        )
      : h("p", { class: "muted small" }, "Endorse videos (the heart in Reels) and they show up here."),
    h("form", { class: "row", onsubmit: addUrl }, h("label", { for: "pk-url", class: "sr-only" }, "Add a watch URL"), urlInput, h("button", { class: "btn sm", type: "submit" }, "Add URL")),
    h("h3", null, `Your picks (${set.items.length})`),
    set.items.length ? h("ul", { class: "list picks" }, pickRows) : h("p", { class: "muted small" }, "None yet."),
    ui.error ? h("p", { class: "err", role: "alert" }, ui.error) : null,
    h(
      "div",
      { class: "row" },
      relays.length && set.items.length ? h("button", { class: "btn sm", id: "pk-check", disabled: !!ui.busy, onclick: checkBridged }, ui.busy === "check" ? "Checking…" : "Check which are on Nostr") : null,
      h("button", { class: "btn sm", id: "pk-preview", disabled: !!ui.busy, onclick: () => preview(false) }, ui.busy === "preview" ? "Building…" : "Preview"),
      h("button", { class: "btn sm", id: "pk-download", onclick: download }, icon("download", 16), "Download taste.json"),
    ),
    h(
      "div",
      { class: "switch" },
      h("label", { for: "pk-dry" }, "Dry run: send nothing"),
      h("input", { type: "checkbox", id: "pk-dry", checked: draft.dryRun, onchange: (e: Event) => ((s.picks = { ...draft, dryRun: (e.target as HTMLInputElement).checked }), app.savePicks(), app.rerender()) }),
    ),
    draft.dryRun
      ? h("button", { class: "btn", id: "pk-sign-dry", disabled: !!ui.busy || !sg, onclick: () => preview(true) }, ui.busy === "sign" ? "Signing…" : "Sign without sending (dry run)")
      : h("button", { class: "btn match", id: "pk-publish", disabled: !!ui.busy || !sg || (!relays.length && app.mode === "live") || !set.items.length, onclick: publishNow }, ui.busy === "publish" ? "Publishing…" : app.mode === "snapshot" ? "Publish to the demo relay…" : `Publish to ${relays.length} relay${relays.length === 1 ? "" : "s"}…`),
    ui.result ? resultView(ui.result) : null,
    h("details", { class: "small" }, h("summary", null, "Make Follow taste find them"), h("p", null, "Put this in your PeerTube channel description:"), h("pre", { class: "mono small reportbox", tabindex: "0" }, descriptionHint(npub, null))),
  );
}

function resultView(r: PublishPicksResult): HTMLElement {
  return h(
    "div",
    { class: "stack", id: "pk-result", role: "status" },
    h("p", { class: "small strong" }, r.dryRun ? (r.event ? "Dry run: signed, not sent." : "Dry run: nothing signed or sent.") : `Published: ${r.results?.filter((x) => x.ok).length ?? 0} of ${r.results?.length ?? 0} relays accepted it.`),
    r.warnings.length ? h("ul", { class: "small notes" }, r.warnings.map((w) => h("li", null, w))) : null,
    r.skipped.length ? h("p", { class: "small muted" }, `${r.skipped.length} pick${r.skipped.length === 1 ? " isn't" : "s aren't"} bridged to Nostr, so ${r.skipped.length === 1 ? "it's" : "they're"} only in the JSON list.`) : null,
    r.results?.length ? h("ul", { class: "small mono" }, r.results.map((x) => h("li", null, `${x.relay}: ${x.ok ? "ok" : "refused"}${x.message ? ` (${x.message})` : ""}`))) : null,
    h("details", { open: true }, h("summary", null, "NIP-51 event (kind 30005)"), h("pre", { class: "mono small reportbox", tabindex: "0", id: "pk-event" }, JSON.stringify(r.event ?? r.template, null, 2))),
    h("details", null, h("summary", null, "Taste list v1 JSON"), h("pre", { class: "mono small reportbox", tabindex: "0", id: "pk-json" }, r.json)),
  );
}
