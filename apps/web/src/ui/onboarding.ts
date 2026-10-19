// First run: three short, skippable steps so a new viewer doesn't land on a thin
// feed. 1. instances and topics; 2. follow some creators' tastes (or an example
// list); 3. what Reels and Grid are. A modal dialog: focus stays inside, Escape or
// "Skip" ends it at any step, every control is a native button or input.

import type { App, State } from "../app.ts";
import { APP_NAME } from "../brand.ts";
import { DEFAULT_INSTANCES, ONBOARDING_TOPICS } from "../lib/settings.ts";
import { parseChannelInput } from "../lib/handles.ts";
import { h } from "./dom.ts";
import { openDialog } from "./dialog.ts";

/** Public PeerTube instances offered at onboarding (all send CORS headers; checked 2026-10-19). */
export const SUGGESTED_INSTANCES = ["https://framatube.org", "https://tilvids.com", "https://video.blender.org", "https://peertube.tv", "https://tube.tchncs.de", "https://spectra.video"];

/**
 * Creators known to keep public playlists of other creators' videos (Follow taste
 * source 3). The same curators the offline snapshot captures.
 */
export const SUGGESTED_CURATORS = ["wex_channel@tilvids.com", "puppuccino_channel@tilvids.com", "the_tech_beast_channel@tilvids.com"];

/** A brand-new viewer: nothing followed, subscribed or watched yet. */
export function shouldOnboard(s: Pick<State, "follows" | "taste" | "tasteFollows" | "history">): boolean {
  return !s.follows.length && !s.taste.length && !s.tasteFollows.length && !s.history.length;
}

export function openOnboarding(app: App): void {
  const { s } = app;
  let step = 1;
  const instances = new Set(s.settings.instances);
  const topics = new Set(s.settings.topics);
  let view = s.settings.defaultView;
  const offline = app.mode === "snapshot";
  const curators = offline ? [...SUGGESTED_CURATORS.filter((c) => app.snapshotTasteChannels.includes(c)), ...app.snapshotTasteChannels.filter((c) => !SUGGESTED_CURATORS.includes(c))].slice(0, 4) : SUGGESTED_CURATORS;

  const finish = (apply: boolean) => {
    if (apply) {
      const next = SUGGESTED_INSTANCES.filter((o) => instances.has(o));
      const chosen = next.length ? next : [...DEFAULT_INSTANCES];
      const changed = !offline && chosen.join() !== s.settings.instances.join();
      if (!offline) s.settings.instances = chosen;
      s.settings.topics = [...topics];
      s.settings.defaultView = view;
      app.setView(view);
      if (changed) app.reloadCatalog();
    }
    app.finishOnboarding();
  };

  const stepper = () => h("p", { class: "muted small", id: "onb-step" }, `Step ${step} of 3`);
  const nav = (next: () => void, nextLabel: string) =>
    h(
      "div",
      { class: "row onb-nav" },
      h("button", { class: "linkbtn", type: "button", id: "onb-skip", onclick: () => (d.close(), finish(false)) }, "Skip"),
      h("span", { style: { flex: "1" } }),
      step > 1 ? h("button", { class: "btn", type: "button", id: "onb-back", onclick: () => ((step -= 1), d.update(), focusHead()) }, "Back") : null,
      h("button", { class: "btn match", type: "button", id: "onb-next", onclick: next }, nextLabel),
    );
  const focusHead = () => requestAnimationFrame(() => document.getElementById("onb-h")?.focus());
  const go = (n: number) => () => {
    step = n;
    d.update();
    focusHead();
  };

  const d = openDialog({
    id: "onboarding",
    title: `Welcome to ${APP_NAME}`,
    className: "onboarding",
    initialFocus: "onb-h",
    onClose: () => {
      if (!s.settings.onboarded) app.finishOnboarding();
    },
    body: () => {
      if (step === 1)
        return [
          stepper(),
          h("h3", { id: "onb-h", tabindex: "-1" }, "Where should videos come from?"),
          h("p", { class: "small" }, "Videos come from PeerTube instances: independent servers run by communities. Your feed is ranked on this device; nobody else decides it."),
          h(
            "fieldset",
            { class: "fieldset" },
            h("legend", null, "Instances"),
            offline ? h("p", { class: "hint", style: { "margin-top": "0" } }, "Offline snapshot: only framatube.org and tilvids.com are available.") : null,
            SUGGESTED_INSTANCES.map((o) => {
              const id = "onb-i-" + new URL(o).host.replace(/\W/g, "-");
              return h(
                "label",
                { class: "check" },
                h("input", { type: "checkbox", id, checked: instances.has(o), disabled: offline, onchange: (e: Event) => ((e.target as HTMLInputElement).checked ? instances.add(o) : instances.delete(o)) }),
                new URL(o).host,
              );
            }),
          ),
          h(
            "fieldset",
            { class: "fieldset" },
            h("legend", null, "Topics you like (optional)"),
            h("p", { class: "hint", style: { "margin-top": "0" } }, "Used on this device to pick new creators for you until you endorse something. Never sent anywhere."),
            h(
              "div",
              { class: "topicgrid" },
              ONBOARDING_TOPICS.map((t) =>
                h(
                  "button",
                  { type: "button", class: "topic", id: `onb-t-${t}`, "aria-pressed": String(topics.has(t)), onclick: () => (topics.has(t) ? topics.delete(t) : topics.add(t), d.update()) },
                  `#${t}`,
                ),
              ),
            ),
          ),
          nav(go(2), "Next"),
        ];
      if (step === 2)
        return [
          stepper(),
          h("h3", { id: "onb-h", tabindex: "-1" }, "Follow someone's taste"),
          h("p", { class: "small" }, "Following a creator's taste adds the videos they recommend (their public picks), not their own uploads. Reading them is public data; nothing about you is shared."),
          h(
            "ul",
            { class: "list onb-list" },
            curators.map((c) => {
              const st = app.tasteState(c);
              const name = s.tasteLookup.get(c)?.status === "ok" ? (s.tasteLookup.get(c) as { value: { name: string } }).value.name : (parseChannelInput(c)?.name ?? c);
              const id = "onb-c-" + c.replace(/\W/g, "-");
              return h(
                "li",
                null,
                h("span", null, h("strong", null, name), h("span", { class: "muted small mono" }, ` ${c}`)),
                st === "following"
                  ? h("span", { class: "pill ok" }, "Following taste")
                  : h(
                      "button",
                      {
                        class: "btn sm taste",
                        id,
                        disabled: st === "loading" || st === "unavailable",
                        onclick: async () => {
                          await app.lookupCreatorTaste(c);
                          app.followTaste(c);
                          d.update();
                        },
                      },
                      st === "loading" ? "Checking…" : st === "unavailable" ? "No public picks" : "Follow taste",
                    ),
              );
            }),
          ),
          h("p", { class: "small" }, "Or start from an example list (generated from popular videos, not picked by a person):"),
          h(
            "div",
            { class: "row" },
            app.examples.map((ex) => {
              const key = "example:" + ex.file;
              const on = s.taste.some((t) => t.key === key);
              return h("button", { class: "btn sm", id: "onb-ex-" + ex.file.replace(/\W/g, "-"), disabled: on, onclick: () => (app.addTaste({ key, source: "example", list: ex.list, addedAt: Date.now() }), d.update()) }, on ? `Subscribed: ${ex.list.name}` : `Subscribe: ${ex.list.name}`);
            }),
          ),
          nav(go(3), "Next"),
        ];
      return [
        stepper(),
        h("h3", { id: "onb-h", tabindex: "-1" }, "Reels or Grid"),
        h(
          "ul",
          { class: "small onb-points" },
          h("li", null, h("strong", null, "Reels: "), "one short video at a time. Swipe up, or use ↑ ↓ (j k) on a keyboard; space pauses, m mutes. The buttons on the right endorse, follow, follow taste, hide, share and report."),
          h("li", null, h("strong", null, "Grid: "), "the same ranking as cards, plus a separate \"Popular on your instances\" section."),
          h("li", null, "Every video has \"Why am I seeing this?\". The feed settings (the sliders button) change the recipe."),
        ),
        h(
          "fieldset",
          { class: "fieldset" },
          h("legend", null, "Open Home with"),
          (["reels", "grid"] as const).map((v) =>
            h("label", { class: "radio" }, h("input", { type: "radio", name: "onb-view", id: `onb-v-${v}`, checked: view === v, onchange: () => (view = v) }), v === "reels" ? "Reels" : "Grid"),
          ),
        ),
        nav(() => (d.close(), finish(true), app.toast("You're set. Change any of this in Settings")), "Start watching"),
      ];
    },
  });
  // Find out which suggested curators publish picks (public profile and playlists).
  for (const c of curators) void app.lookupCreatorTaste(c).then(() => step === 2 && d.update());
}
