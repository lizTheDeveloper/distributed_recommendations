// Opt-in telemetry UI: the one-time question (consent card), the Settings panel
// with "what gets sent", and the bug report / feedback form. docs/TELEMETRY.md.

import type { App } from "../app.ts";
import type { TelemetryConsent, TelemetryToggle } from "../lib/telemetry/consent.ts";
import { answer, decline, setToggle, snooze } from "../lib/telemetry/consent.ts";
import type { FeedbackCategory } from "../lib/telemetry/feedback.ts";
import { FEEDBACK_CATEGORIES, MAX_FEEDBACK_TEXT, feedbackEvent, validEmail } from "../lib/telemetry/feedback.ts";
import { USAGE_EVENTS } from "../lib/telemetry/usage.ts";
import { h } from "./dom.ts";

interface ToggleCopy {
  key: TelemetryToggle;
  label: string;
  hint: string;
  sends: string[];
}

const COPY: ToggleCopy[] = [
  {
    key: "crash",
    label: "Crash & error reports",
    hint: "When something breaks, send what went wrong and on which screen. Never which videos, people, links or keys.",
    sends: [
      "The error type and message, with links, handles, keys, ids, host names, file paths and anything in quotes replaced by placeholders",
      "Where in the app's code it happened (function names and line numbers in app.js)",
      "The screen's name (for example \"home-reels\" or \"settings\")",
      "App version, browser and OS family (\"Firefox\", \"Android\") and a screen size class (small, medium, large)",
      "Not sent: your IP address (the server is set up not to store it), any user id, videos, titles, creators, PeerTube or relay links, npub/nsec keys, taste lists, recipes, history",
    ],
  },
  {
    key: "diagnostics",
    label: "Bug reports & feedback",
    hint: "Nothing goes until you write a report and tap Send. With this on, reports include diagnostics unless you untick it.",
    sends: [
      "Only when you tap Send: your text (with links, handles and keys replaced), the category, and an email address if you give one",
      "Diagnostics, if attached: app version, browser and OS family, screen size class, up to 5 recent errors (scrubbed as above), and which switches are on (private watching, P2P, theme, history window, whether relays or a passphrase are set). Never your history, follows, lists, matches or relays",
      "You see the exact report before you send it",
    ],
  },
  {
    key: "usage",
    label: "Usage analytics",
    hint: "Which screens and features get used, counted without cookies. Never which videos, creators or people.",
    sends: [
      "Screen names when you switch screens",
      `Feature names from a fixed list: ${Object.keys(USAGE_EVENTS).join(", ")}. Some carry one fixed value, such as reels or grid, or a built-in recipe name`,
      "Browser and OS family and a device class (mobile, tablet, desktop)",
      "Not sent: page address, referrer, page title, language, exact screen size, any id, cookies, videos, creators, searches",
    ],
  },
];

/** Which switches this build can offer (a feature without an endpoint is hidden). */
function offered(app: App): ToggleCopy[] {
  const c = app.telemetryConfig;
  return COPY.filter((t) => (t.key === "usage" ? !!c.umami : !!c.glitchtip));
}

const DISCOVERY_LINE =
  "Separate from discovery stats for creators: those count only how you found videos, for creators, and are set under Sharing & privacy.";

// ---- the one-time question ----

/** Show or remove the consent card. Built once per showing, so checkbox state survives re-renders. */
export function syncConsentCard(app: App, host: HTMLElement): void {
  const { s } = app;
  if (!s.consentAsk) {
    if (host.firstChild) host.replaceChildren();
    return;
  }
  if (host.firstChild) return;
  const items = offered(app);
  const chosen: Partial<Record<TelemetryToggle, boolean>> = {};
  const close = (next: TelemetryConsent, msg: string) => {
    s.consentAsk = false;
    app.setTelemetry(next, msg);
  };
  host.replaceChildren(
    h(
      "section",
      { class: "consent-card", id: "telemetry-card", role: "region", "aria-labelledby": "tc-h" },
      h("h2", { id: "tc-h" }, "Help fix bugs and improve the app?"),
      h("p", { class: "small" }, "You can choose to send some information to the people who make this app. Everything is off unless you turn it on, and you can change it any time in Sharing & privacy."),
      h(
        "div",
        { class: "stack" },
        items.map((t) => {
          const id = `tc-${t.key}`;
          return h(
            "div",
            { class: "tc-item" },
            h(
              "div",
              { class: "switch" },
              h("label", { for: id }, t.label),
              h("input", { type: "checkbox", id, "aria-describedby": id + "-hint", onchange: (e: Event) => (chosen[t.key] = (e.target as HTMLInputElement).checked) }),
            ),
            h("p", { class: "hint", id: id + "-hint" }, t.hint),
          );
        }),
      ),
      h("p", { class: "hint", style: { "margin-top": "0" } }, DISCOVERY_LINE),
      h(
        "div",
        { class: "row end" },
        h("button", { class: "btn sm", id: "tc-never", onclick: () => close(decline(s.settings.telemetry, Date.now()), "Okay. We won't ask again") }, "No thanks"),
        h("button", { class: "btn sm", id: "tc-later", onclick: () => close(snooze(s.settings.telemetry, Date.now()), "Okay. We'll ask again in a month") }, "Not now"),
        h(
          "button",
          {
            class: "btn sm match",
            id: "tc-yes",
            onclick: () => {
              const any = Object.values(chosen).some(Boolean);
              close(answer(s.settings.telemetry, chosen, Date.now()), any ? "Thanks. Change it any time in Sharing & privacy" : "Nothing turned on. Change it any time in Sharing & privacy");
            },
          },
          "Turn on selected",
        ),
      ),
    ),
  );
}

// ---- Settings → Sharing & privacy ----

export function telemetryPanel(app: App): HTMLElement | null {
  const { s } = app;
  const items = offered(app);
  if (app.mode === "snapshot" || !items.length) return null;
  const c = s.settings.telemetry;
  const st = app.telemetry.state();
  return h(
    "section",
    { class: "panel", id: "telemetry-panel", "aria-labelledby": "tp-h" },
    h("h2", { id: "tp-h" }, "Crash reports, feedback and usage stats"),
    h("p", { class: "small" }, "Optional, and off unless you turn it on. This goes to the app's developers on their own servers (GlitchTip for errors and reports, Umami for usage), kept for 30 days."),
    h("p", { class: "hint", style: { "margin-top": "-6px" } }, DISCOVERY_LINE),
    items.map((t) =>
      h(
        "div",
        { class: "stack tp-item" },
        h(
          "div",
          { class: "switch" },
          h("label", { for: `tp-${t.key}` }, t.label),
          h("input", {
            type: "checkbox",
            id: `tp-${t.key}`,
            checked: c[t.key],
            "aria-describedby": `tp-${t.key}-hint`,
            onchange: (e: Event) => {
              const on = (e.target as HTMLInputElement).checked;
              app.setTelemetry(setToggle(c, t.key, on, Date.now()), `${t.label}: ${on ? "on" : "off"}`);
            },
          }),
        ),
        h("p", { class: "hint", id: `tp-${t.key}-hint` }, t.hint),
        h("details", { class: "tp-what" }, h("summary", null, "What gets sent"), h("ul", { class: "small" }, t.sends.map((x) => h("li", null, x)))),
      ),
    ),
    h(
      "p",
      { class: "note", id: "tp-status" },
      app.telemetryConfig.glitchtip ? (st.crashRunning ? "Crash reporter loaded and on. " : st.crashLoaded ? "Crash reporter loaded, now off. " : "Crash reporter not loaded. ") : "",
      app.telemetryConfig.umami ? (st.usageOn ? "Usage analytics on." : "Usage analytics off: nothing is sent.") : "",
    ),
    app.telemetryConfig.glitchtip ? feedbackSection(app) : null,
  );
}

// ---- bug report / feedback form ----

function feedbackSection(app: App): HTMLElement {
  const { s } = app;
  if (s.ui.fbOpen !== "1")
    return h(
      "div",
      { class: "row" },
      h("button", { class: "btn sm", id: "fb-open", onclick: () => app.openFeedback() }, "Report a bug or send feedback…"),
    );
  const category = (s.ui.fbCategory as FeedbackCategory | undefined) ?? "bug";
  const attach = s.ui.fbAttach === undefined ? s.settings.telemetry.diagnostics : s.ui.fbAttach === "1";
  const busy = s.ui.fbBusy === "1";
  const preview = h("pre", { id: "fb-preview", "aria-live": "off", tabindex: "0", "aria-label": "Exactly what will be sent" });
  const update = () => {
    const ev = feedbackEvent({ category, text: s.ui.fbText ?? "", email: s.ui.fbEmail, diagnostics: attach ? app.diagnostics() : null }, app.telemetryConfig.appVersion);
    preview.textContent = JSON.stringify(ev, null, 2);
  };
  const text = h("textarea", {
    id: "fb-text",
    rows: "5",
    maxlength: String(MAX_FEEDBACK_TEXT),
    required: true,
    value: s.ui.fbText ?? "",
    "aria-describedby": "fb-text-hint",
    oninput: (e: Event) => ((s.ui.fbText = (e.target as HTMLTextAreaElement).value), update()),
  });
  const email = h("input", {
    type: "text",
    inputmode: "email",
    autocomplete: "email",
    id: "fb-email",
    value: s.ui.fbEmail ?? "",
    placeholder: "you@example.org",
    oninput: (e: Event) => ((s.ui.fbEmail = (e.target as HTMLInputElement).value), update()),
  });
  update();
  const submit = async (e: Event) => {
    e.preventDefault();
    const em = (s.ui.fbEmail ?? "").trim();
    if (!(s.ui.fbText ?? "").trim()) s.ui.fbError = "Write a few words first.";
    else if (em && !validEmail(em)) s.ui.fbError = "That email address doesn't look right. Leave it empty to stay anonymous.";
    else {
      s.ui.fbError = undefined;
      s.ui.fbBusy = "1";
      app.rerender();
      try {
        await app.sendFeedback({ category, text: s.ui.fbText ?? "", email: em || undefined, diagnostics: attach ? app.diagnostics() : null });
        for (const k of ["fbOpen", "fbText", "fbEmail", "fbCategory", "fbAttach"]) s.ui[k] = undefined;
        app.toast("Sent. Thank you!");
        requestAnimationFrame(() => document.getElementById("fb-open")?.focus());
      } catch (err) {
        s.ui.fbError = `Not sent. ${err instanceof Error ? err.message : String(err)}`;
      }
      s.ui.fbBusy = undefined;
    }
    app.rerender();
  };
  return h(
    "form",
    { class: "stack fb-form", id: "fb-form", onsubmit: submit, "aria-labelledby": "fb-h" },
    h("h3", { id: "fb-h" }, "Report a bug or send feedback"),
    h(
      "fieldset",
      { class: "row fb-cats" },
      h("legend", { class: "small" }, "What is it?"),
      FEEDBACK_CATEGORIES.map((c) =>
        h(
          "label",
          { class: "small fb-cat" },
          h("input", { type: "radio", name: "fb-cat", value: c.id, checked: c.id === category, onchange: () => ((s.ui.fbCategory = c.id), app.rerender()) }),
          c.label,
        ),
      ),
    ),
    h("label", { for: "fb-text" }, "What happened, or what would you like?"),
    text,
    h("p", { class: "hint", id: "fb-text-hint" }, "Links, handles, keys and anything in quotes are replaced before sending. Please don't name videos or people."),
    h("label", { for: "fb-email" }, "Email, if you'd like a reply (optional)"),
    email,
    h(
      "div",
      { class: "switch" },
      h("label", { for: "fb-attach" }, "Attach diagnostics"),
      h("input", { type: "checkbox", id: "fb-attach", checked: attach, onchange: (e: Event) => ((s.ui.fbAttach = (e.target as HTMLInputElement).checked ? "1" : "0"), app.rerender()) }),
    ),
    h("p", { class: "hint" }, "App version, browser and OS family, screen size class, recent errors (scrubbed) and which switches are on. Nothing about what you watch."),
    h("details", { class: "fb-preview", open: true }, h("summary", null, "Exactly what will be sent"), preview),
    s.ui.fbError ? h("p", { class: "err", role: "alert" }, s.ui.fbError) : null,
    h(
      "div",
      { class: "row end" },
      h("button", { class: "btn sm", type: "button", onclick: () => { s.ui.fbOpen = undefined; s.ui.fbError = undefined; app.rerender(); } }, "Cancel"),
      h("button", { class: "btn sm match", type: "submit", id: "fb-send", disabled: busy }, busy ? "Sending…" : "Send"),
    ),
  );
}

/** One ledger row for Sharing & privacy's "What you share, and with whom". */
export function telemetryLedgerText(app: App): { who: string; what: string; status: string; ok: boolean } | null {
  const items = offered(app);
  if (app.mode === "snapshot" || !items.length) return null;
  const c = app.s.settings.telemetry;
  const on = items.filter((t) => c[t.key]).map((t) => t.label.toLowerCase());
  return {
    who: "App developers (crash reports, feedback, usage)",
    what: on.length
      ? `You turned on: ${on.join(", ")}. Scrubbed reports and coarse counts, without your IP stored; bug reports only when you tap Send.`
      : "Nothing, unless you send a bug report yourself.",
    status: on.length ? "on" : "off",
    ok: !on.length,
  };
}
