// window.MatchFeedNative for the desktop shell (Tauri v2). Same contract as mobile
// (apps/mobile/bridge/types.ts); desktop provides `secrets` only. Bundled into
// www/native-bridge.js by scripts/sync-web.mjs.
//
// IPC goes through @tauri-apps/api `invoke` (withGlobalTauri is off, so window.__TAURI__ isn't
// exposed to page scripts). The page's meta CSP has no `ipc:` in connect-src, so Tauri falls
// back to its postMessage transport, which works under the CSP.

import { invoke } from "@tauri-apps/api/core";
import { MAX_SECRET_LENGTH, SECRET_NAMES, type MatchFeedNative, type SecretName } from "../../mobile/bridge/types.ts";

declare global {
  interface Window {
    MatchFeedNative?: MatchFeedNative;
    __TAURI_INTERNALS__?: unknown;
  }
}

const check = (name: string): SecretName => {
  if (!(SECRET_NAMES as readonly string[]).includes(name)) throw new Error(`Unknown secret name: ${name}`);
  return name as SecretName;
};

if (window.__TAURI_INTERNALS__) {
  const api: MatchFeedNative = Object.freeze({
    version: 1 as const,
    platform: "desktop" as const,
    secrets: Object.freeze({
      get: (name: SecretName) => invoke<string | null>("secret_get", { name: check(name) }),
      set: async (name: SecretName, value: string) => {
        if (typeof value !== "string" || value.length === 0 || value.length > MAX_SECRET_LENGTH) throw new Error("Secret must be a non-empty string of at most 4096 characters");
        await invoke<void>("secret_set", { name: check(name), value });
      },
      remove: (name: SecretName) => invoke<void>("secret_remove", { name: check(name) }),
    }),
  });
  Object.defineProperty(window, "MatchFeedNative", { value: api, writable: false, configurable: false, enumerable: false });
}
