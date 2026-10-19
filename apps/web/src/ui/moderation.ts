// Moderation UI over packages/moderation: Report (with a confirmation step), Block
// and Mute, the "N hidden" sheet, blur overlays, and Settings → Moderation.
// Nothing is sent without the viewer pressing a button on the confirmation screen.

import type { App } from "../app.ts";
import type { Video } from "../lib/core.ts";
import type { BlockKind, HiddenVideo, ReportType, SensitiveMode, Verdict } from "../lib/moderation/pkg.ts";
import { BLOCK_LIMITS, REPORT_TYPES, REPORT_TYPE_LABELS, buildReport, planReport, toNpub } from "../lib/moderation/pkg.ts";
import { BLOCK_KIND_LABEL, blockChoices, chooseNsfw, nsfwSwitchAllowed, reasonText, undoableBlock } from "../lib/modstate.ts";
import { parseRelayUrl } from "../lib/settings.ts";
import { shortNpub } from "../lib/bech32.ts";
import { videoHost } from "../lib/videos.ts";
import { APP_NAME } from "../brand.ts";
import { h, toggle } from "./dom.ts";
import { openDialog } from "./dialog.ts";

/** Where the app's own moderation contact lives (Apple 1.2: published contact information). */
export const MODERATION_CONTACT = "https://github.com/lizthedotdev/distributed_recommendations/issues";

const labelerName = (app: App) => (pk: string) => app.modPolicy().settings.labelers.find((l) => l.pubkey === pk)?.name ?? shortNpub(pk);

// ---------------------------------------------------------------- report

interface ReportState {
  step: 1 | 2;
  type: ReportType;
  target: "video" | "creator";
  details: string;
  labelers: Set<string>;
  hide: boolean;
  sending: boolean;
  result: string;
  copied: boolean;
}

export function openReport(app: App, v: Video, from?: string | HTMLElement | null): void {
  const st: ReportState = { step: 1, type: "spam", target: "video", details: "", labelers: new Set(), hide: true, sending: false, result: "", copied: false };
  const creatorPk = app.s.creatorNpub.get(v.creator.toLowerCase()) ?? null;
  const labelers = app.modPolicy().settings.labelers;
  const name = v.creatorName ?? v.creator;
  const host = videoHost(v);
  const d = openDialog({
    id: "report-dialog",
    title: st.target === "creator" ? `Report ${name}` : "Report video",
    returnFocus: from ?? null,
    body: () => (st.step === 1 ? step1() : step2()),
  });

  function step1() {
    const typeOptions = REPORT_TYPES.filter((t) => st.target === "creator" || t !== "impersonation").map((t) =>
      h(
        "label",
        { class: "radio" },
        h("input", { type: "radio", name: "rep-type", value: t, checked: st.type === t, id: `rep-t-${t}`, onchange: () => ((st.type = t), d.update()) }),
        REPORT_TYPE_LABELS[t],
      ),
    );
    return [
      h("p", { class: "muted small" }, `"${v.title}" by ${name}, hosted on ${host}.`),
      h(
        "fieldset",
        { class: "fieldset" },
        h("legend", null, "What are you reporting?"),
        h("label", { class: "radio" }, h("input", { type: "radio", name: "rep-target", id: "rep-target-video", checked: st.target === "video", onchange: () => ((st.target = "video"), st.type === "impersonation" && (st.type = "other"), d.update()) }), "This video"),
        h("label", { class: "radio" }, h("input", { type: "radio", name: "rep-target", id: "rep-target-creator", checked: st.target === "creator", onchange: () => ((st.target = "creator"), d.update()) }), `The creator, ${name}`),
      ),
      h("fieldset", { class: "fieldset" }, h("legend", null, "What's wrong?"), typeOptions),
      h(
        "div",
        { class: "field" },
        h("label", { for: "rep-details" }, "Details (optional)"),
        h("textarea", { id: "rep-details", rows: 3, maxlength: 2000, oninput: (e: Event) => (st.details = (e.target as HTMLTextAreaElement).value) }, st.details),
        h("p", { class: "hint", id: "rep-details-hint" }, "Describe the problem, e.g. a timestamp. Don't include anyone's personal details."),
      ),
      labelers.length
        ? h(
            "fieldset",
            { class: "fieldset" },
            h("legend", null, "Also send to your labelers"),
            labelers.map((l) =>
              h(
                "label",
                { class: "check" },
                h("input", { type: "checkbox", id: `rep-lab-${l.pubkey.slice(0, 8)}`, checked: st.labelers.has(l.pubkey), onchange: (e: Event) => ((e.target as HTMLInputElement).checked ? st.labelers.add(l.pubkey) : st.labelers.delete(l.pubkey)) }),
                l.name ?? shortNpub(l.pubkey),
              ),
            ),
            h("p", { class: "hint" }, "Only for the public Nostr report, when there is one. The labeler's reviewers can label it for everyone who subscribes."),
          )
        : null,
      h("label", { class: "check" }, h("input", { type: "checkbox", id: "rep-hide", checked: st.hide, onchange: (e: Event) => (st.hide = (e.target as HTMLInputElement).checked) }), st.target === "creator" ? `Also block ${name} on this device` : "Also hide this video on this device"),
      h("div", { class: "row end" }, h("button", { class: "btn", type: "button", onclick: () => d.close() }, "Cancel"), h("button", { class: "btn match", id: "rep-next", type: "button", onclick: () => ((st.step = 2), d.update(), document.getElementById("rep-confirm-h")?.focus()) }, "Next: review")),
    ];
  }

  function step2() {
    const labels = [...st.labelers];
    const plan =
      st.target === "video"
        ? planReport({ video: v, meta: app.catalog.modMeta(v.id), type: st.type, details: st.details, labelers: labels })
        : {
            peertube: undefined,
            nostr: creatorPk ? buildReport({ type: "creator", pubkey: creatorPk }, st.type, { content: st.details, labelers: labels }) : undefined,
            notes: [creatorPk ? "A public Nostr report (NIP-56) about the creator's key is prepared. It is signed by you and visible to anyone." : `${name} doesn't publish a Nostr key, so the report goes to ${v.creator.split("@")[1] ?? host} only.`],
          };
    const channelUrl = (() => {
      const [n, hh] = v.creator.split("@");
      return n && hh ? `https://${hh}/c/${encodeURIComponent(n)}` : null;
    })();
    const reportText = `${REPORT_TYPE_LABELS[st.type]}${st.details.trim() ? `: ${st.details.trim()}` : ""}\n${st.target === "video" ? (v.url ?? v.id) : (channelUrl ?? v.creator)}`;
    const openUrl = st.target === "video" ? (v.url ?? v.id) : channelUrl;
    const canSign = !!app.match.identity && (app.s.settings.relays.length > 0 || st.labelers.size > 0) && app.mode === "live";
    const labelerRelays = app.modPolicy().settings.labelers.filter((l) => st.labelers.has(l.pubkey)).flatMap((l) => l.relays ?? []);
    const finish = () => {
      if (st.hide) {
        if (st.target === "video") app.block("video", v.id, "Video hidden");
        else app.block("creator", v.creator, `Blocked ${name}`);
      }
      d.close();
      if (!st.hide) app.toast("Thanks. Nothing else changes on this device");
    };
    return [
      h("h3", { id: "rep-confirm-h", tabindex: "-1" }, "Review and send"),
      h("p", { class: "small" }, h("strong", null, REPORT_TYPE_LABELS[st.type]), st.details.trim() ? `: ${st.details.trim()}` : ""),
      h(
        "section",
        { class: "panel inset", "aria-labelledby": "rep-pt-h" },
        h("h4", { id: "rep-pt-h" }, `1. To ${st.target === "video" ? host : (v.creator.split("@")[1] ?? host)}, which hosts it`),
        h("p", { class: "small" }, "Only the hosting instance can take content down. PeerTube accepts reports from signed-in accounts, and this app has no PeerTube sign-in yet, so open it there and use its Report button. Paste the text below."),
        h("pre", { class: "mono small reportbox", tabindex: "0", id: "rep-text" }, reportText),
        h(
          "div",
          { class: "row" },
          openUrl && app.mode === "live" ? h("a", { class: "btn", href: openUrl, target: "_blank", rel: "noopener noreferrer", id: "rep-open" }, `Open on ${new URL(openUrl).host} ↗`) : h("span", { class: "muted small" }, app.mode === "snapshot" ? "Offline snapshot: opening the instance needs the network." : ""),
          h(
            "button",
            {
              class: "btn",
              type: "button",
              id: "rep-copy",
              onclick: () => {
                void navigator.clipboard?.writeText(reportText).then(
                  () => ((st.copied = true), d.update()),
                  () => app.toast("Select the text and copy it"),
                );
              },
            },
            st.copied ? "Copied ✓" : "Copy report text",
          ),
        ),
      ),
      plan.nostr
        ? h(
            "section",
            { class: "panel inset", "aria-labelledby": "rep-nostr-h" },
            h("h4", { id: "rep-nostr-h" }, "2. Public Nostr report (optional)"),
            h("p", { class: "small" }, labels.length ? `Addressed to ${labels.map(labelerName(app)).join(", ")} with a "p" tag, and sent to your relays${labelerRelays.length ? " and the labelers' relays" : ""}. Anyone can read it, and it is signed with your Match identity.` : "Sent to your relays. Anyone can read it, and it is signed with your Match identity."),
            h("details", null, h("summary", null, "Show the event"), h("pre", { class: "mono small reportbox", tabindex: "0" }, JSON.stringify(plan.nostr, null, 2))),
            canSign
              ? h(
                  "button",
                  {
                    class: "btn warn",
                    type: "button",
                    id: "rep-send",
                    disabled: st.sending,
                    onclick: async () => {
                      st.sending = true;
                      d.update();
                      try {
                        const r = await app.publishSigned(plan.nostr!, labelerRelays);
                        const ok = r.results.filter((x) => x.ok).length;
                        st.result = `Sent to ${ok} of ${r.results.length} relay${r.results.length === 1 ? "" : "s"}.`;
                      } catch (e) {
                        st.result = e instanceof Error ? e.message : String(e);
                      }
                      st.sending = false;
                      d.update();
                    },
                  },
                  st.sending ? "Sending…" : "Sign and send the Nostr report",
                )
              : h("p", { class: "hint" }, app.mode === "snapshot" ? "Offline snapshot: nothing can be sent." : !app.match.identity ? "Needs a Nostr identity (Matches) to sign it." : "Needs a relay (Matches → Relays) to send it."),
            st.result ? h("p", { class: "small", role: "status" }, st.result) : null,
          )
        : null,
      h("ul", { class: "small notes" }, plan.notes.map((n) => h("li", null, n))),
      h("div", { class: "row end" }, h("button", { class: "btn", type: "button", onclick: () => ((st.step = 1), d.update()) }, "Back"), h("button", { class: "btn match", type: "button", id: "rep-done", onclick: finish }, "Done")),
    ];
  }
}

// ---------------------------------------------------------------- block / mute

export function openBlock(app: App, v: Video, from?: string | HTMLElement | null): void {
  const choices = blockChoices(v);
  let pick = 0;
  let keyword = "";
  let err = "";
  const d = openDialog({
    id: "block-dialog",
    title: "Block or mute",
    returnFocus: from ?? null,
    body: () => [
      h("p", { class: "muted small" }, "Hidden on this device only, everywhere in the app (Reels, grid, popular, links). Nobody is told. Undo any of it in Settings → Moderation."),
      h(
        "fieldset",
        { class: "fieldset" },
        h("legend", null, "What to hide"),
        choices.map((c, i) => h("label", { class: "radio" }, h("input", { type: "radio", name: "blk", id: `blk-${i}`, checked: pick === i, onchange: () => ((pick = i), d.update()) }), c.label)),
        h("label", { class: "radio" }, h("input", { type: "radio", name: "blk", id: "blk-kw", checked: pick === choices.length, onchange: () => ((pick = choices.length), d.update(), document.getElementById("blk-kw-text")?.focus()) }), "Mute a word or phrase"),
        pick === choices.length
          ? h(
              "div",
              { class: "field indent" },
              h("label", { for: "blk-kw-text" }, "Word or phrase"),
              h("input", { type: "text", id: "blk-kw-text", value: keyword, maxlength: BLOCK_LIMITS.maxKeyword, "aria-describedby": "blk-kw-hint", oninput: (e: Event) => (keyword = (e.target as HTMLInputElement).value) }),
              h("p", { class: "hint", id: "blk-kw-hint" }, "Whole words, matched in titles, channel names, tags and descriptions."),
            )
          : null,
      ),
      err ? h("p", { class: "err", role: "alert" }, err) : null,
      h(
        "div",
        { class: "row end" },
        h("button", { class: "btn", type: "button", onclick: () => d.close() }, "Cancel"),
        h(
          "button",
          {
            class: "btn warn solid",
            type: "button",
            id: "blk-yes",
            onclick: () => {
              if (pick === choices.length) {
                if (keyword.trim().length < BLOCK_LIMITS.minKeyword) {
                  err = `Enter at least ${BLOCK_LIMITS.minKeyword} characters.`;
                  return d.update();
                }
                d.close();
                app.block("keyword", keyword.trim(), `Muted "${keyword.trim()}"`);
                return;
              }
              const c = choices[pick];
              d.close();
              app.block(c.kind, c.value, c.kind === "tag" ? `Muted #${c.value}` : c.kind === "instance" ? `Blocked ${c.value}` : `Blocked ${v.creatorName ?? v.creator}`);
            },
          },
          pick === choices.length || choices[pick]?.kind === "tag" ? "Mute" : "Block",
        ),
      ),
    ],
  });
}

// ---------------------------------------------------------------- "N hidden"

export function hiddenLink(app: App, hidden: readonly HiddenVideo[], id: string): HTMLElement | null {
  if (!hidden.length) return null;
  return h("button", { class: "linkbtn hiddenlink", id, "aria-haspopup": "dialog", onclick: () => openHidden(app, id) }, `${hidden.length} hidden by your moderation settings`);
}

export function openHidden(app: App, from?: string): void {
  const d = openDialog({
    id: "hidden-dialog",
    title: `${app.s.modHidden.length} hidden`,
    returnFocus: from ?? null,
    body: () => {
      const items = app.s.modHidden;
      if (!items.length) return [h("p", { class: "muted" }, "Nothing is hidden right now.")];
      return [
        h("p", { class: "muted small" }, "From the current feed and Reels. Hidden on this device only."),
        h(
          "ul",
          { class: "hiddenlist" },
          items.slice(0, 100).map((x, i) =>
            h(
              "li",
              null,
              h("strong", null, x.reasons.some((r) => r.kind === "label" && r.title) ? "Hidden video" : x.video.title),
              h("span", { class: "muted small" }, ` · ${x.video.creatorName ?? x.video.creator}`),
              h("ul", { class: "small" }, x.reasons.slice(0, 4).map((r) => h("li", null, reasonText(r, labelerName(app))))),
              (() => {
                const u = x.reasons.map(undoableBlock).find(Boolean);
                return u
                  ? h("button", { class: "btn sm", id: `hid-undo-${i}`, onclick: () => (app.unblock(u.kind, u.value), d.update()) }, `Unblock ${u.kind === "npub" ? shortNpub(u.value) : u.value}`)
                  : null;
              })(),
            ),
          ),
        ),
      ];
    },
  });
}

// ---------------------------------------------------------------- blur and labels on items

/** Verdict to show for an item, unless the viewer revealed it this session. */
export function shownVerdict(app: App, id: string, v: Verdict | undefined): Verdict | undefined {
  if (!v || v.action === "allow") return undefined;
  if (v.action === "blur" && app.isRevealed(id)) return { ...v, action: "label" };
  return v;
}

export function blurCover(app: App, id: string, v: Verdict, compact = false): HTMLElement {
  return h(
    "div",
    { class: "blurcover" + (compact ? " compact" : "") },
    h("strong", null, "Sensitive content"),
    h("span", { class: "small" }, v.titles.slice(0, 3).join(" · ") || "Flagged"),
    h("button", { class: "btn sm", id: `reveal-${hashLite(id)}`, onclick: (e: Event) => (e.stopPropagation(), app.reveal(id)) }, "Show anyway"),
  );
}

export function labelChips(v: Verdict | undefined): HTMLElement[] {
  if (!v || v.action !== "label") return [];
  return v.titles.slice(0, 3).map((t) => h("span", { class: "pill modlabel" }, t));
}

function hashLite(s: string): string {
  let x = 5381;
  for (let i = 0; i < s.length; i++) x = (Math.imul(x, 33) ^ s.charCodeAt(i)) >>> 0;
  return x.toString(36);
}

// ---------------------------------------------------------------- settings panel

const MODES: { id: SensitiveMode; label: string }[] = [
  { id: "hide", label: "Hide" },
  { id: "blur", label: "Blur (default)" },
  { id: "show", label: "Show" },
];

function confirmAdult(app: App, from: string) {
  const d = openDialog({
    id: "nsfw-confirm",
    title: "Show sensitive videos?",
    returnFocus: from,
    body: () => [
      h("p", null, "Videos their creators, instances or your labelers marked as sexual or nude will play without a warning."),
      h("p", { class: "small muted" }, "This is the second of two steps. You can go back to Blur or Hide at any time."),
      h(
        "div",
        { class: "row end" },
        h("button", { class: "btn", type: "button", id: "nsfw-no", onclick: () => d.close() }, "Keep blurred"),
        h(
          "button",
          {
            class: "btn warn solid",
            type: "button",
            id: "nsfw-yes",
            onclick: () => {
              const next = chooseNsfw(app.s.mod.policy.settings, "show", true, Math.floor(Date.now() / 1000));
              if (next !== "confirm") app.setModeration({ ...app.s.mod.policy, settings: next }, "Sensitive videos are shown");
              d.close();
            },
          },
          "I'm 18 or older: show them",
        ),
      ),
    ],
  });
}

export function moderationPanel(app: App): HTMLElement {
  const { s } = app;
  const policy = app.modPolicy();
  const st = s.mod.policy.settings;
  const platform = app.native?.platform;
  const nsfwOk = nsfwSwitchAllowed(platform);
  const setMode = (cat: "nsfw" | "violence", mode: SensitiveMode, selectId: string) => {
    if (cat === "nsfw") {
      const next = chooseNsfw(st, mode, false, Math.floor(Date.now() / 1000));
      if (next === "confirm") {
        app.rerender();
        return confirmAdult(app, selectId);
      }
      app.setModeration({ ...s.mod.policy, settings: next }, mode === "hide" ? "Sensitive videos are hidden" : "Sensitive videos are blurred");
    } else app.setModeration({ ...s.mod.policy, settings: { ...st, violence: mode } });
  };
  const modeSelect = (cat: "nsfw" | "violence", id: string, label: string, hint: string) =>
    h(
      "div",
      { class: "field" },
      h("label", { for: id }, label),
      h(
        "select",
        { id, "aria-describedby": id + "-hint", onchange: (e: Event) => setMode(cat, (e.target as HTMLSelectElement).value as SensitiveMode, id) },
        MODES.map((m) => h("option", { value: m.id, selected: st[cat] === m.id }, m.label)),
      ),
      h("p", { class: "hint", id: id + "-hint" }, hint),
    );
  const labInput = h("input", { type: "text", id: "lab-npub", placeholder: "npub1…", spellcheck: "false", autocomplete: "off", value: s.ui.labInput ?? "", oninput: (e: Event) => (s.ui.labInput = (e.target as HTMLInputElement).value) });
  const labRelay = h("input", { type: "text", id: "lab-relay", placeholder: "wss://… (optional)", spellcheck: "false", autocomplete: "off", value: s.ui.labRelay ?? "", oninput: (e: Event) => (s.ui.labRelay = (e.target as HTMLInputElement).value) });
  const addLabeler = (e: Event) => {
    e.preventDefault();
    const relays: string[] = [];
    if (labRelay.value.trim()) {
      const r = parseRelayUrl(labRelay.value);
      if (!r) {
        s.ui.labError = "Relay must be a wss:// URL.";
        return app.rerender();
      }
      relays.push(r);
    }
    const err = app.addLabeler(labInput.value, relays);
    s.ui.labError = err ?? undefined;
    if (!err) s.ui.labInput = s.ui.labRelay = undefined;
    app.rerender();
  };
  const kw = h("input", { type: "text", id: "mute-word", placeholder: "word or phrase", value: s.ui.muteWord ?? "", oninput: (e: Event) => (s.ui.muteWord = (e.target as HTMLInputElement).value) });
  const kwKind = h("select", { id: "mute-kind", "aria-label": "Mute as" }, h("option", { value: "keyword" }, "Word"), h("option", { value: "tag" }, "Tag"), h("option", { value: "creator" }, "Creator (name@host)"), h("option", { value: "instance" }, "Instance (host)"));
  const addMute = (e: Event) => {
    e.preventDefault();
    const kind = (kwKind as HTMLSelectElement).value as BlockKind;
    const val = kw.value.trim();
    if (!val) return;
    s.ui.muteWord = undefined;
    app.block(kind, val, kind === "keyword" ? `Muted "${val}"` : kind === "tag" ? `Muted #${val.replace(/^#/, "")}` : `Blocked ${val}`);
  };
  const lists: [BlockKind, string[]][] = [
    ["creator", policy.blocks.creators],
    ["instance", policy.blocks.instances],
    ["npub", policy.blocks.npubs],
    ["tag", policy.blocks.tags],
    ["keyword", policy.blocks.keywords],
    ["video", policy.blocks.videos],
    ["tasteList", policy.blocks.tasteLists.filter((t) => !t.startsWith("creator:"))],
  ];
  const nLabels = s.mod.labelEvents.length;
  return h(
    "section",
    { class: "panel", id: "moderation", "aria-labelledby": "mod-h" },
    h("h2", { id: "mod-h" }, "Moderation"),
    h("p", { class: "muted small" }, "Everything here runs on this device and is stored encrypted with your history. It changes what you see, not what anyone else sees."),
    h("h3", null, "Sensitive videos"),
    nsfwOk
      ? modeSelect("nsfw", "mod-nsfw", "Nudity and sexual content", "Blurred by default. Showing them takes two steps: choose Show, then confirm you're an adult.")
      : h("p", { class: "note", id: "mod-nsfw-ios" }, `Nudity and sexual content are hidden in the iOS app, and there's no switch for it here (App Store rule 1.2).`),
    modeSelect("violence", "mod-violence", "Violence and gore", "Blurred by default."),
    ...toggle("mod-instbl", "Use my instances' own blocklists", st.instanceBlocklists, (on) => app.setModeration({ ...s.mod.policy, settings: { ...st, instanceBlocklists: on } }), {
      hint: "Hides accounts and servers your catalog instances' moderators blocked, when they publish that list.",
    }),
    h("h3", null, "Labelers"),
    h("p", { class: "small" }, "A labeler is a person or service that labels videos, creators and lists (NIP-32). None by default. Subscribe by npub; labels are fetched read-only from your relays and the labeler's, which learn which labelers you follow."),
    st.labelers.length
      ? h(
          "ul",
          { class: "list" },
          st.labelers.map((l) =>
            h("li", null, h("span", { class: "mono small" }, l.name ?? toNpub(l.pubkey).slice(0, 20) + "…"), h("button", { class: "btn sm", "aria-label": `Unsubscribe from ${l.name ?? shortNpub(l.pubkey)}`, onclick: () => app.removeLabeler(l.pubkey) }, "Remove")),
          ),
        )
      : h("p", { class: "muted small", id: "lab-none" }, "No labelers."),
    h(
      "form",
      { class: "stack", onsubmit: addLabeler, "aria-labelledby": "lab-form-h" },
      h("span", { id: "lab-form-h", class: "small strong" }, "Add a labeler"),
      h("label", { for: "lab-npub", class: "small" }, "Labeler npub"),
      labInput,
      h("label", { for: "lab-relay", class: "small" }, "Its relay (optional)"),
      labRelay,
      h("div", { class: "row" }, h("button", { class: "btn sm", type: "submit", id: "lab-add" }, "Subscribe")),
    ),
    s.ui.labError ? h("p", { class: "err", role: "alert" }, s.ui.labError) : null,
    st.labelers.length
      ? h(
          "p",
          { class: "hint" },
          `${nLabels} label event${nLabels === 1 ? "" : "s"} cached${s.mod.labelsAt ? `, last checked ${new Date(s.mod.labelsAt * 1000).toLocaleString()}` : ", not fetched yet"}. `,
          app.mode === "live" ? h("button", { class: "linkbtn", onclick: () => void app.refreshLabels(true) }, "Check now") : "Offline snapshot: labels can't be fetched.",
        )
      : null,
    h("h3", null, "Blocked and muted"),
    lists.some(([, xs]) => xs.length)
      ? h(
          "div",
          { class: "stack" },
          lists
            .filter(([, xs]) => xs.length)
            .map(([kind, xs]) =>
              h(
                "div",
                null,
                h("p", { class: "small strong" }, BLOCK_KIND_LABEL[kind] + "s"),
                h("ul", { class: "chiplist" }, xs.slice(0, 200).map((x) => h("li", null, h("span", { class: "mono small" }, kind === "npub" ? shortNpub(x) : kind === "tag" ? `#${x}` : x), h("button", { class: "iconbtn sm", "aria-label": `Remove ${x}`, onclick: () => app.unblock(kind, x) }, h("span", { "aria-hidden": "true" }, "×"))))),
              ),
            ),
        )
      : h("p", { class: "muted small" }, "Nothing blocked. Use ⋯ → Block or mute on any video."),
    h("form", { class: "row", onsubmit: addMute }, h("label", { for: "mute-word", class: "sr-only" }, "Block or mute"), kwKind, kw, h("button", { class: "btn sm", type: "submit", id: "mute-add" }, "Add")),
    s.modHidden.length ? hiddenLink(app, s.modHidden, "mod-hidden-link") : null,
    h("h3", null, "Reports and contact"),
    h(
      "p",
      { class: "small" },
      "Report a video or creator from its ⋯ menu (Reels: the ⋯ More button). Reports go to the instance that hosts the video, which is the only one that can remove it. For illegal content also contact a hotline (NCMEC CyberTipline in the US, IWF in the UK, an INHOPE member elsewhere). ",
      `Problems with ${APP_NAME} itself: `,
      h("a", { href: MODERATION_CONTACT, target: "_blank", rel: "noopener noreferrer" }, "contact us"),
      ".",
    ),
  );
}
