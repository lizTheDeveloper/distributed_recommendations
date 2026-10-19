// Startup shared by both entries: open the encrypted vault (asking for the passphrase
// when one is set), decrypt sensitive state, migrate old plaintext, then start the app.

import type { AppOptions } from "./app.ts";
import { startApp } from "./app.ts";
import { loadSensitive } from "./lib/localdata.ts";
import type { Vault } from "./lib/vault.ts";
import { openBrowserVault } from "./lib/vault.ts";
import { h } from "./ui/dom.ts";
import { APP_NAME } from "./brand.ts";
import type { MatchFeedNative } from "./lib/native.ts";
import { nativeBridge } from "./lib/native.ts";

export type BootOptions = Omit<AppOptions, "vault" | "sensitive" | "legacyLeft" | "native">;

/**
 * The native shell's bridge, if its keystore answers. On Linux desktops without a
 * Secret Service the keychain fails: then the vault keeps its browser key instead
 * of falling back to memory, and the app says where the key lives.
 */
async function usableNative(): Promise<{ native: MatchFeedNative | undefined; keystore: boolean }> {
  const native = nativeBridge();
  if (!native) return { native, keystore: false };
  try {
    await native.secrets.get("vault-key");
    return { native, keystore: true };
  } catch {
    return { native, keystore: false };
  }
}

export async function boot(opts: BootOptions): Promise<void> {
  const { native, keystore } = await usableNative();
  const opened = await openBrowserVault(keystore && native ? native.secrets : null);
  const vault = opened.kind === "ready" ? opened.vault : await unlockScreen(opts.root, opened.unlock, opened.reset);
  const { data, legacyLeft } = await loadSensitive(vault, opts.kv);
  startApp({ ...opts, vault, sensitive: data, legacyLeft, native: native ? { bridge: native, keystore } : undefined });
}

/** Passphrase prompt. Resolves once unlocked, or after a confirmed fresh start. */
function unlockScreen(root: HTMLElement, unlock: (p: string) => Promise<Vault | null>, reset: () => Promise<Vault>): Promise<Vault> {
  return new Promise((resolve) => {
    let confirming = false;
    let busy = false;
    let error = "";
    const render = () => {
      const pass = h("input", { type: "password", id: "unlock-pass", autocomplete: "current-password", required: true, disabled: busy, "aria-describedby": "unlock-hint" });
      const submit = async (e: Event) => {
        e.preventDefault();
        if (!pass.value) return;
        busy = true;
        error = "";
        render();
        let v: Vault | null = null;
        try {
          v = await unlock(pass.value);
        } catch {
          v = null;
        }
        busy = false;
        if (v) return resolve(v);
        error = "That passphrase didn't unlock your history.";
        render();
      };
      root.replaceChildren(
        h(
          "div",
          { class: "wrap" },
          h(
            "section",
            { class: "panel unlock", "aria-labelledby": "unlock-h" },
            h("h1", { id: "unlock-h" }, `Unlock ${APP_NAME}`),
            h("p", { class: "muted", id: "unlock-hint" }, "Your history, follows and taste lists on this device are encrypted with your passphrase."),
            h(
              "form",
              { onsubmit: submit },
              h("label", { for: "unlock-pass" }, "Passphrase"),
              pass,
              h("button", { class: "btn match", type: "submit", disabled: busy }, busy ? "Unlocking…" : "Unlock"),
            ),
            error ? h("p", { class: "err", role: "alert" }, error) : null,
            confirming
              ? h(
                  "div",
                  { class: "confirm", role: "alertdialog", "aria-labelledby": "reset-q" },
                  h("strong", { id: "reset-q" }, "Start fresh?"),
                  h("p", null, "Without the passphrase the encrypted data can't be recovered. Starting fresh deletes it and its key: history, follows and taste lists. Settings and recipes stay."),
                  h(
                    "div",
                    { class: "row end" },
                    h("button", { class: "btn sm", onclick: () => ((confirming = false), render()) }, "Cancel"),
                    h("button", { class: "btn sm warn solid", id: "reset-yes", onclick: async () => resolve(await reset()) }, "Delete and start fresh"),
                  ),
                )
              : h("button", { class: "linkbtn", onclick: () => ((confirming = true), render()) }, "Forgot the passphrase?"),
          ),
        ),
      );
      if (!busy) pass.focus();
    };
    render();
  });
}
