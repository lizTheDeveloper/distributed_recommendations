import type { App } from "../app.ts";
import { formatDuration, statsUrl } from "../lib/videos.ts";
import { h, toggle } from "./dom.ts";

const fmtN = (n: number) => n.toLocaleString("en-US");

function tier1(app: App): HTMLElement | null {
  const { s } = app;
  const load = s.studio.load;
  if (!load) return null;
  if (load.status === "loading") return h("p", { class: "muted", "aria-busy": "true" }, "Loading public counts…");
  if (load.status === "error") return h("p", { class: "err", role: "alert" }, load.error);
  const st = load.value;
  const [name, host] = st.handle.split("@");
  const handle = st.handle.toLowerCase();
  const lists = app.resolvedLists().filter((l) => l.videos.some((v) => v.creator.toLowerCase() === handle));
  const picks = app.resolvedLists().reduce((n, l) => n + l.videos.filter((v) => v.creator.toLowerCase() === handle).length, 0);
  const top = st.videos.slice(0, 12);
  return h(
    "div",
    { class: "stack", style: { gap: "16px" } },
    h(
      "div",
      { class: "row", style: { "justify-content": "space-between" } },
      h("div", null, h("h2", null, st.displayName ?? name), h("p", { class: "mono small muted" }, st.handle)),
      matchButton(app, st.displayName ?? name, st.handle),
    ),
    h(
      "section",
      { class: "panel tier t0", "aria-labelledby": "t0-h" },
      h("h3", { id: "t0-h" }, "Tier 0 · Host-side stats"),
      h("p", { class: "muted small" }, "Views, watch time, retention and peak viewers are already collected by your PeerTube instance, which serves the video. Nothing new is gathered. Sign in there to see them."),
      h(
        "div",
        { class: "row" },
        h("a", { class: "btn", href: `https://${host}/c/${encodeURIComponent(name)}/videos`, target: "_blank", rel: "noopener noreferrer" }, "Channel on ", host, " ↗"),
        top[0] && statsUrl(top[0].video) ? h("a", { class: "btn", href: statsUrl(top[0].video)!, target: "_blank", rel: "noopener noreferrer" }, "Latest video's stats ↗") : null,
      ),
    ),
    h(
      "section",
      { class: "panel tier t1", "aria-labelledby": "t1-h" },
      h("h3", { id: "t1-h" }, "Tier 1 · Public counts"),
      h("p", { class: "muted small" }, `Already public, so counting them costs no one privacy. Views and likes are summed over the ${st.videos.length} most recent videos.`),
      h(
        "div",
        { class: "stats" },
        h("div", { class: "stat" }, h("b", { class: "mono" }, st.followers === undefined ? "–" : fmtN(st.followers)), h("span", null, "followers")),
        h("div", { class: "stat" }, h("b", { class: "mono" }, fmtN(st.views)), h("span", null, "views")),
        h("div", { class: "stat" }, h("b", { class: "mono" }, fmtN(st.likes)), h("span", null, "likes")),
        h("div", { class: "stat" }, h("b", { class: "mono" }, `${picks}`), h("span", null, `picks in ${lists.length} taste list${lists.length === 1 ? "" : "s"} you loaded`)),
        h("div", { class: "stat" }, h("b", null, h("span", { class: "pill next" }, "coming next")), h("span", null, "taste-list subscribers")),
      ),
      st.followers === undefined ? h("p", { class: "hint", style: { "margin-top": "0" } }, app.mode === "snapshot" ? "Follower counts aren't in the offline snapshot." : "The instance didn't report a follower count.") : null,
      top.length
        ? h(
            "div",
            { class: "tablewrap" },
            h(
              "table",
              null,
              h("thead", null, h("tr", null, h("th", null, "Video"), h("th", { class: "num" }, "Views"), h("th", { class: "num" }, "Likes"), h("th", null, "Stats"))),
              h(
                "tbody",
                null,
                top.map((x) => {
                  const su = statsUrl(x.video);
                  return h(
                    "tr",
                    null,
                    h("td", null, h("button", { class: "linkbtn", style: { "font-size": ".88rem", "text-align": "left" }, onclick: () => app.watch(x.video) }, x.video.title), h("div", { class: "muted small mono" }, x.video.publishedAt.toISOString().slice(0, 10), " · ", formatDuration(x.video.durationSec))),
                    h("td", { class: "num mono" }, fmtN(x.views)),
                    h("td", { class: "num mono" }, fmtN(x.likes)),
                    h("td", null, su ? h("a", { href: su, target: "_blank", rel: "noopener noreferrer", class: "small" }, "Tier 0 ↗") : "–"),
                  );
                }),
              ),
            ),
          )
        : h("p", { class: "muted small" }, "No public videos found."),
    ),
  );
}

/** "Request match…" when the channel publishes an npub in its description or support text. */
function matchButton(app: App, name: string, handle: string): HTMLElement | null {
  const pk = app.s.studio.npub;
  if (!pk) return null;
  const live = app.match.liveWith(pk);
  if (live) return h("button", { class: "btn on", onclick: () => app.go("matches") }, live.status === "active" ? "Matched" : "Match requested");
  return h("button", { class: "btn match", id: "studio-match", title: "This channel publishes a Match Feed identity (npub)", onclick: () => app.requestMatchWith({ pubkey: pk, name, source: "creator", ref: handle }) }, "Request match…");
}

function tier2(): HTMLElement {
  return h(
    "aside",
    { class: "panel tier t2", "aria-labelledby": "t2-h" },
    h("div", { class: "row", style: { "justify-content": "space-between" } }, h("h2", { id: "t2-h" }, "How people found you"), h("span", { class: "pill next" }, "coming next")),
    h("p", { class: "muted small" }, "Tier 2: how many views came from Follow, Taste lists, Match, Circle, Explore and 2nd degree. This is about viewers, so it needs private aggregation: two independent servers add up encrypted reports, and nobody (you included) sees who watched."),
    h("h3", null, "Decided defaults"),
    h(
      "ul",
      { class: "small", style: { margin: "0", "padding-left": "18px", display: "flex", "flex-direction": "column", gap: "4px" } },
      h("li", null, "Creator opt-in: off until you turn it on."),
      h("li", null, "Private to you by default; you can choose to publish your numbers, with the same thresholds and noise."),
      h("li", null, "Viewers contribute by default and can turn off any signal."),
      h("li", null, "Channel totals only, never per video; 28-day windows; counts under 20 show as \"<20\"; totals are lightly noised."),
    ),
    ...toggle("sw-t2", "Collect discovery-channel stats for my channel", false, () => {}, { disabled: true }),
    ...toggle("sw-t2-pub", "Publish them on my channel", false, () => {}, { disabled: true }),
    h("p", { class: "note" }, "Small channels will mostly see \"<20\". That is the honest cost of not identifying individual viewers."),
  );
}

export function studioScreen(app: App): HTMLElement {
  const { s } = app;
  const input = h("input", { type: "text", id: "studio-input", placeholder: "your-channel@your.instance", value: s.ui.studioInput ?? s.studio.handle, spellcheck: "false", oninput: (e: Event) => (s.ui.studioInput = (e.target as HTMLInputElement).value) });
  const creators = [...new Map(app.feed().items.map((i) => [i.video.creator, i.video.creatorName ?? i.video.creator])).entries()].slice(0, 3);
  return h(
    "section",
    { class: "cols" },
    h(
      "div",
      { class: "stack", style: { gap: "16px" } },
      h(
        "section",
        { class: "panel", "aria-labelledby": "studio-h" },
        h("h2", { id: "studio-h" }, "Creator studio"),
        h("p", { class: "muted small" }, "Enter your PeerTube channel. Everything here comes from public endpoints; no sign-in."),
        h(
          "form",
          { class: "row", onsubmit: (e: Event) => { e.preventDefault(); s.ui.studioInput = undefined; app.loadStudio(input.value); } },
          h("label", { for: "studio-input", class: "muted small", style: { flex: "1 0 100%" } }, "Channel"),
          input,
          h("button", { class: "btn follow", type: "submit" }, "Load"),
        ),
        creators.length
          ? h("div", { class: "row small" }, h("span", { class: "muted" }, "Or try one from your feed:"), creators.map(([handle, name]) => h("button", { class: "linkbtn", onclick: () => { s.ui.studioInput = undefined; app.loadStudio(handle); } }, name)))
          : null,
      ),
      tier1(app),
    ),
    tier2(),
  );
}
