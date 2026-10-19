import type { App } from "../app.ts";
import { formatDuration, statsUrl } from "../lib/videos.ts";
import { h, toggle } from "./dom.ts";
import { tasteButton } from "./taste.ts";
import { publishPanel } from "./publish.ts";
import { openDialog } from "./dialog.ts";
import { CONFIG_D_TAG, CONFIG_KIND, parseTaskConfig } from "../lib/analytics/pkg.ts";

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
      h("div", { class: "row" }, tasteButton(app, st.handle, st.displayName ?? name, "studio-taste", "btn"), matchButton(app, st.displayName ?? name, st.handle)),
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
            { class: "tablewrap", tabindex: "0", role: "region", "aria-label": "Table (scrolls sideways)" },
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
  return h("button", { class: "btn match", id: "studio-match", title: "This channel publishes a Nostr identity (npub)", onclick: () => app.requestMatchWith({ pubkey: pk, name, source: "creator", ref: handle }) }, "Request match…");
}

/**
 * Tier 2, creator side (ANALYTICS.md decisions: creator opt-in, off by default;
 * private to the creator unless they choose to publish). Opting in = publishing the
 * public task config your instance's operator made with infra/janus new-task.mjs,
 * as a signed Nostr event (kind 30078) or a file linked from the channel description.
 */
/** The config's own helper, so its structure can be checked here; the build's allowlist is shown separately. */
function declaredHelper(text: string): string[] {
  try {
    const h = (JSON.parse(text) as { helper?: unknown }).helper;
    return typeof h === "string" ? [h] : [];
  } catch {
    return [];
  }
}

function tier2(app: App): HTMLElement {
  const { s } = app;
  const handle = s.studio.handle;
  const text = s.ui.t2Config ?? "";
  let parsed: ReturnType<typeof parseTaskConfig> | null = null;
  if (text.trim() && handle) parsed = parseTaskConfig(text.trim(), { creator: handle.toLowerCase(), now: new Date(), allowedHelpers: declaredHelper(text) });
  const cfg = parsed?.ok ? parsed.config : null;
  const helperOk = !!cfg && app.dapHelpers.includes(new URL(cfg.helper).origin);
  const publish = s.ui.t2Publish === "1";
  const finalCfg = cfg ? { ...cfg, publish } : null;
  const json = finalCfg ? JSON.stringify(finalCfg) : "";
  const sendNostr = () => {
    const d = openDialog({
      id: "t2-confirm",
      title: "Publish your discovery-stats config?",
      returnFocus: "t2-nostr",
      body: () => [
        h("p", { class: "small" }, "Signs a public event (kind 30078) with your Match identity and sends it to your relays. Viewers' devices that find it start sending one encrypted, noised report about you per 28 days."),
        h("div", { class: "row end" }, h("button", { class: "btn", onclick: () => d.close() }, "Cancel"), h("button", { class: "btn warn solid", id: "t2-confirm-yes", onclick: async () => {
          d.close();
          try {
            const r = await app.publishSigned({ kind: CONFIG_KIND, created_at: Math.floor(Date.now() / 1000), tags: [["d", CONFIG_D_TAG], ["alt", "Discovery-stats task config"]], content: json });
            app.toast(`Sent to ${r.results.filter((x) => x.ok).length} of ${r.results.length} relays`);
          } catch (e) {
            app.toast(e instanceof Error ? e.message : String(e));
          }
        } }, "Sign and publish")),
      ],
    });
  };
  return h(
    "aside",
    { class: "panel tier t2", "aria-labelledby": "t2-h" },
    h("div", { class: "row", style: { "justify-content": "space-between" } }, h("h2", { id: "t2-h" }, "How people found you"), h("span", { class: "pill next" }, "opt-in")),
    h("p", { class: "muted small" }, "Tier 2: the share of your viewers who found you through Follow, Taste lists, Match, Circle, Explore, 2nd degree, search or elsewhere. Two independent servers add up encrypted reports (DAP), and nobody, you included, sees who watched."),
    h("h3", null, "Decided defaults"),
    h(
      "ul",
      { class: "small", style: { margin: "0", "padding-left": "18px", display: "flex", "flex-direction": "column", gap: "4px" } },
      h("li", null, "Off until you opt in by publishing your task config."),
      h("li", null, "Private to you by default; you can choose to publish your numbers, with the same thresholds and noise."),
      h("li", null, "Viewers contribute by default and can turn off any signal."),
      h("li", null, "Channel totals only, never per video; 28-day windows; counts under 20 show as \"<20\"; totals are noised."),
    ),
    h("h3", null, "Opt in"),
    h("p", { class: "small" }, "Your instance's operator makes a task for you (infra/janus, new-task.mjs) and gives you task-config.json. The collector key stays with you. Paste the config to check it:"),
    h("label", { for: "t2-config", class: "small" }, "task-config.json"),
    h("textarea", { id: "t2-config", rows: 4, placeholder: '{"v":1,"kind":"discovery-channels",…}', oninput: (e: Event) => ((s.ui.t2Config = (e.target as HTMLTextAreaElement).value), app.rerender()) }, text),
    !handle ? h("p", { class: "hint" }, "Load your channel above first: the config must name it.") : null,
    parsed && !parsed.ok ? h("p", { class: "err", role: "alert" }, `Not accepted: ${parsed.reason}`) : null,
    cfg
      ? h(
          "div",
          { class: "stack" },
          h("p", { class: "okmsg" }, `Valid for ${cfg.creator}. Leader ${new URL(cfg.leader).host}, helper ${new URL(cfg.helper).host} (${cfg.helperOperator}), ε = ${cfg.dp.epsilon}.`),
          helperOk ? null : h("p", { class: "note" }, `This build doesn't list ${new URL(cfg.helper).host} as an approved independent helper, so viewers of this build won't send reports for it.`),
          ...toggle("t2-publish", "Publish my numbers on my channel", publish, (on) => ((s.ui.t2Publish = on ? "1" : undefined), app.rerender()), { hint: "Off: only you can collect and read them. On: the config says you publish them (same thresholds and noise)." }),
          h(
            "div",
            { class: "row" },
            h("button", { class: "btn sm", id: "t2-nostr", disabled: !app.match.identity || !s.settings.relays.length || app.mode !== "live", onclick: sendNostr }, "Publish config on Nostr…"),
            h("button", { class: "btn sm", id: "t2-download", onclick: () => {
              const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
              const a = h("a", { href: url, download: "task-config.json", hidden: true });
              document.body.appendChild(a);
              a.click();
              a.remove();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            } }, "Download for my instance"),
          ),
          h("p", { class: "hint" }, `Hosting it yourself: put it on ${handle.split("@")[1] ?? "your instance"} and add a line "discovery-stats: https://…/task-config.json" to your channel description.`),
        )
      : null,
    h("p", { class: "note" }, "Reading your numbers: collect at least 7 days after a window ends (infra/janus README, \"collect\"); counts under 20 show as \"<20\". Showing them here is coming next."),
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
      publishPanel(app),
    ),
    tier2(app),
  );
}
