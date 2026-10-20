import type { App, TasteSub } from "../app.ts";
import { handleOf, parseChannelInput } from "../lib/handles.ts";
import { TASTE_LIST_LIMITS, errorText, parseTasteListJson } from "../lib/tastelist.ts";
import { h } from "./dom.ts";
import { hashId } from "./home.ts";
import { creatorTastePanel, tasteButton } from "./taste.ts";

const FORMAT_EXAMPLE = `{
  "v": 1,
  "name": "Slow craft picks",
  "author": "hearth@craft.tube",
  "description": "Optional, up to 500 chars",
  "updatedAt": 1792411200,
  "items": [
    { "id": "https://tube.example/videos/watch/<uuid>",
      "note": "optional, up to 280 chars",
      "sponsored": false, "affiliated": false }
  ]
}`;

function followPanel(app: App): HTMLElement {
  const { s } = app;
  const input = h("input", {
    type: "text",
    id: "follow-input",
    placeholder: "name@host or channel URL",
    value: s.ui.followInput ?? "",
    autocomplete: "off",
    spellcheck: "false",
    oninput: (e: Event) => (s.ui.followInput = (e.target as HTMLInputElement).value),
  });
  const submit = (e: Event) => {
    e.preventDefault();
    const ref = parseChannelInput(input.value);
    if (!ref) {
      s.ui.followError = "That doesn't look like a channel. Use name@host (e.g. blender@video.blender.org) or a channel URL.";
    } else if (app.isFollowing(handleOf(ref))) {
      s.ui.followError = "You already follow that channel.";
    } else {
      s.ui.followError = undefined;
      s.ui.followInput = "";
      app.follow(ref);
    }
    app.rerender();
  };
  const rows = s.follows.map((f) => {
    const st = s.followVideos.get(f.handle);
    const status =
      !st || st.status === "loading"
        ? h("span", { class: "pill" }, "loading")
        : st.status === "ok"
          ? h("span", { class: "pill ok" }, `${st.value.length} recent videos`)
          : h("span", { class: "pill bad", title: st.error }, "unreachable");
    return h(
      "li",
      null,
      h("div", { class: "stack", style: { gap: "2px" } }, h("strong", null, f.name ?? f.handle), h("span", { class: "mono small muted" }, f.handle), h("div", null, status)),
      h(
        "div",
        { class: "row", style: { gap: "6px" } },
        tasteButton(app, f.handle, f.name ?? f.handle, "ft-" + hashId(f.handle)),
        h("button", { class: "btn sm", "aria-label": `Unfollow ${f.name ?? f.handle}`, onclick: () => app.unfollow(f.handle) }, "Unfollow"),
      ),
    );
  });
  return h(
    "section",
    { class: "panel tier t0", "aria-labelledby": "follow-h" },
    h("h2", { id: "follow-h" }, "Follow channels"),
    h("p", { class: "muted small" }, "Their uploads feed the Following source; Follow taste adds what they recommend. You share nothing: the list lives on this device, and the app reads each channel's public video list from its home instance."),
    h("form", { class: "row", onsubmit: submit }, h("label", { for: "follow-input", class: "muted small", style: { flex: "1 0 100%" } }, "Channel"), input, h("button", { class: "btn follow", type: "submit" }, "Follow")),
    s.ui.followError ? h("p", { class: "err", role: "alert" }, s.ui.followError) : null,
    app.mode === "snapshot" ? h("p", { class: "note" }, "Offline snapshot: only channels that appear in the snapshot have videos.") : null,
    rows.length ? h("ul", { class: "list" }, rows) : h("p", { class: "muted small" }, "Not following anyone yet. Use + Follow on any card in the feed, or add a handle above."),
  );
}

function tastePanel(app: App): HTMLElement {
  const { s } = app;
  const showErr = (msg: string | undefined, ok?: string) => {
    s.ui.tasteError = msg;
    s.ui.tasteOk = ok;
    app.rerender();
  };

  const urlInput = h("input", {
    type: "url",
    id: "taste-url",
    placeholder: "https://…/list.json",
    value: s.ui.tasteUrl ?? "",
    disabled: app.mode === "snapshot",
    oninput: (e: Event) => (s.ui.tasteUrl = (e.target as HTMLInputElement).value),
  });
  const importUrl = async (e: Event) => {
    e.preventDefault();
    let url: URL;
    try {
      url = new URL(urlInput.value.trim(), location.href);
      if (url.protocol !== "https:" && url.origin !== location.origin) throw new Error("Use an https:// URL.");
    } catch (err) {
      return showErr(err instanceof Error && err.message.startsWith("Use") ? err.message : "That isn't a valid URL.");
    }
    showErr(undefined, "Fetching…");
    try {
      const res = await fetch(url.toString(), { credentials: "omit", referrerPolicy: "no-referrer", headers: { accept: "application/json" } });
      if (!res.ok) throw new Error(`The server returned ${res.status}.`);
      const len = Number(res.headers.get("content-length") ?? 0);
      if (len > TASTE_LIST_LIMITS.maxJsonBytes) throw new Error(`The list is larger than ${TASTE_LIST_LIMITS.maxJsonBytes / 1024} KiB.`);
      const list = parseTasteListJson(await res.text());
      s.ui.tasteUrl = "";
      app.addTaste({ key: "url:" + url.toString(), source: "url", url: url.toString(), list, addedAt: Date.now() });
      showErr(undefined, `Imported "${list.name}" (${list.items.length} items).`);
    } catch (err) {
      showErr(err instanceof TypeError ? "Couldn't fetch it. The host may be offline or may not allow cross-site requests (CORS)." : "Not imported. " + errorText(err));
    }
  };

  const paste = h("textarea", {
    id: "taste-paste",
    rows: "6",
    placeholder: "Paste taste-list JSON here",
    value: s.ui.tastePaste ?? "",
    spellcheck: "false",
    oninput: (e: Event) => (s.ui.tastePaste = (e.target as HTMLTextAreaElement).value),
  });
  const importPaste = (e: Event) => {
    e.preventDefault();
    try {
      const list = parseTasteListJson(paste.value);
      s.ui.tastePaste = "";
      app.addTaste({ key: "paste:" + hashId(list.name + JSON.stringify(list.items)), source: "paste", list, addedAt: Date.now() });
      showErr(undefined, `Imported "${list.name}" (${list.items.length} items).`);
    } catch (err) {
      showErr("Not imported. " + errorText(err));
    }
  };

  const rows = s.taste.map((t: TasteSub) => {
    const r = s.tasteRes.get(t.key);
    const sponsored = t.list.items.filter((i) => i.sponsored).length;
    const status =
      !r || r.status === "loading"
        ? h("span", { class: "pill" }, `resolving ${t.list.items.length} videos`)
        : r.status === "ok"
          ? h("span", { class: "pill ok" }, `${r.value.videos.length} of ${t.list.items.length} videos found`)
          : h("span", { class: "pill bad" }, r.error);
    return h(
      "li",
      null,
      h(
        "div",
        { class: "stack", style: { gap: "3px" } },
        h("strong", null, t.list.name),
        t.list.author ? h("span", { class: "small muted" }, "by ", t.list.author) : null,
        t.list.description ? h("span", { class: "small" }, t.list.description) : null,
        h(
          "div",
          { class: "row" },
          status,
          t.source === "example" ? h("span", { class: "pill exp" }, "example data") : null,
          t.source === "editorial" ? h("span", { class: "pill ok" }, "editors' collection") : null,
          sponsored ? h("span", { class: "pill spon" }, `${sponsored} sponsored`) : null,
          t.url ? h("span", { class: "mono small muted", style: { "overflow-wrap": "anywhere" } }, t.url) : null,
        ),
      ),
      h("button", { class: "btn sm", "aria-label": `Unsubscribe from ${t.list.name}`, onclick: () => app.removeTaste(t.key) }, "Remove"),
    );
  });

  const editorialButtons = app.editorial.map((ed) => {
    const key = "editorial:" + ed.slug;
    const added = s.taste.some((t) => t.key === key);
    return h(
      "button",
      { class: "btn sm taste", disabled: added, title: ed.list.description, onclick: () => app.addTaste({ key, source: "editorial", list: ed.list, addedAt: Date.now() }) },
      added ? "Added: " : "Add: ",
      ed.list.name,
    );
  });

  const exampleButtons = app.examples.map((ex) => {
    const key = "example:" + ex.file;
    const added = s.taste.some((t) => t.key === key);
    return h(
      "button",
      {
        class: "btn sm",
        disabled: added,
        onclick: () => app.addTaste({ key, source: "example", list: ex.list, addedAt: Date.now() }),
      },
      added ? "Added: " : "Add: ",
      ex.list.name,
    );
  });

  return h(
    "section",
    { class: "panel tier t1", "aria-labelledby": "taste-h" },
    h("h2", { id: "taste-h" }, "Subscribe to taste"),
    h("p", { class: "muted small" }, "A taste list is someone's public picks. Its videos become a Taste list source in your feed. You share nothing; the list is public by design."),
    h(
      "div",
      { class: "stack" },
      app.editorial.length ? h("h3", null, "Editors' collections") : null,
      app.editorial.length ? h("p", { class: "muted small" }, "Picked and reviewed by people, each with a reason. Every pick links to its original creator; nothing is copied.") : null,
      app.editorial.length ? h("div", { class: "row" }, editorialButtons) : null,
      h("h3", null, "Example lists"),
      h("p", { class: "muted small" }, "Example data, generated automatically from instances' most-viewed recent uploads. Not picked by a person."),
      h("div", { class: "row" }, exampleButtons),
    ),
    h(
      "form",
      { class: "row", onsubmit: importUrl },
      h("label", { for: "taste-url", class: "muted small", style: { flex: "1 0 100%" } }, "Import from a URL"),
      urlInput,
      h("button", { class: "btn taste", type: "submit", disabled: app.mode === "snapshot" }, "Import"),
    ),
    app.mode === "snapshot" ? h("p", { class: "note" }, "URL import needs the network; it's off in this offline snapshot. Pasting JSON works.") : null,
    h(
      "form",
      { class: "stack", onsubmit: importPaste },
      h("label", { for: "taste-paste", class: "muted small" }, "…or paste JSON"),
      paste,
      h("div", { class: "row end" }, h("button", { class: "btn taste", type: "submit" }, "Import pasted list")),
    ),
    s.ui.tasteError ? h("p", { class: "err", role: "alert" }, s.ui.tasteError) : null,
    s.ui.tasteOk ? h("p", { class: "okmsg", role: "status" }, s.ui.tasteOk) : null,
    h("details", null, h("summary", null, "Taste-list format (v1, provisional)"), h("p", { class: "small muted", style: { "margin-top": "6px" } }, `Unknown keys are rejected; at most ${TASTE_LIST_LIMITS.maxItems} items and ${TASTE_LIST_LIMITS.maxJsonBytes / 1024} KiB. Ids are canonical PeerTube watch URLs. Sponsored and affiliated items get a visible label.`), h("pre", null, FORMAT_EXAMPLE)),
    h("h3", null, "Your taste lists"),
    rows.length ? h("ul", { class: "list" }, rows) : h("p", { class: "muted small" }, "No taste lists yet."),
  );
}

export function followScreen(app: App): HTMLElement {
  return h(
    "section",
    { class: "cols2" },
    followPanel(app),
    tastePanel(app),
    creatorTastePanel(app),
    h(
      "section",
      { class: "panel tier t2", style: { "grid-column": "1 / -1" } },
      h("div", { class: "row", style: { "justify-content": "space-between" } }, h("h2", null, "Match and Circle"), h("span", { class: "pill next" }, "coming next")),
      h("p", { class: "muted small" }, "Match: a mutual, private, expiring exchange of recent endorsements, end-to-end encrypted. Circle: pooled picks from a group of 8 or more, shown only above a noised threshold. Neither is in this version; nothing about your history leaves this device."),
    ),
  );
}
