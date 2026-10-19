// Confirmation for things handed to the app from outside (native deep links and
// shares, the PWA share target). Nothing happens until the viewer confirms, and a
// video host that isn't one of the catalog instances is named before it's contacted
// (the request shows it the viewer's IP).

import type { App } from "../app.ts";
import type { IncomingAction } from "../lib/incoming.ts";
import { npubEncode, shortNpub } from "../lib/bech32.ts";
import { h } from "./dom.ts";
import { openDialog } from "./dialog.ts";

export function openIncoming(app: App, a: IncomingAction): void {
  let busy = false;
  let err = "";
  const known = a.kind === "video" && app.s.settings.instances.some((o) => new URL(o).host === a.host);
  const d = openDialog({
    id: "incoming-dialog",
    title: a.kind === "match" ? "Request a match?" : "Open a shared video?",
    body: () =>
      a.kind === "match"
        ? [
            h("p", null, `A link asked to request a match with `, h("span", { class: "mono" }, shortNpub(a.pubkey)), "."),
            h("p", { class: "muted small mono", style: { "overflow-wrap": "anywhere" } }, npubEncode(a.pubkey)),
            h("p", { class: "small" }, "Next you choose what to share, if anything. Nothing is sent until you confirm there."),
            h(
              "div",
              { class: "row end" },
              h("button", { class: "btn", id: "inc-no", onclick: () => d.close() }, "Not now"),
              h("button", { class: "btn match", id: "inc-yes", onclick: () => (d.close(), app.requestMatchWith({ pubkey: a.pubkey, name: shortNpub(a.pubkey), source: "manual" })) }, "Continue…"),
            ),
          ]
        : [
            h("p", { class: "mono small", style: { "overflow-wrap": "anywhere" } }, a.url),
            h("p", { class: "small" }, known ? `${a.host} is one of your catalog instances.` : `Opening it asks ${a.host} for the video's details. That server sees your IP address; it isn't one of your catalog instances.`),
            app.mode === "snapshot" ? h("p", { class: "note" }, "Offline snapshot: opening shared videos needs the network.") : null,
            err ? h("p", { class: "err", role: "alert" }, err) : null,
            h(
              "div",
              { class: "row end" },
              h("button", { class: "btn", id: "inc-no", onclick: () => d.close() }, "Cancel"),
              h(
                "button",
                {
                  class: "btn match",
                  id: "inc-yes",
                  disabled: busy || app.mode === "snapshot",
                  onclick: async () => {
                    busy = true;
                    err = "";
                    d.update();
                    try {
                      const v = await app.catalog.resolveVideo(a.url);
                      if (!v) throw new Error("That isn't a PeerTube video link.");
                      d.close();
                      app.watch(v);
                    } catch (e) {
                      busy = false;
                      err = e instanceof TypeError ? `Couldn't reach ${a.host}.` : e instanceof Error ? e.message : String(e);
                      d.update();
                    }
                  },
                },
                busy ? "Opening…" : `Open from ${a.host}`,
              ),
            ),
          ],
  });
}
