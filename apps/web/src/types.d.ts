// Ambient types for the parts of packages/match that target Node (its PSI adapter).
// In the browser build these are provided by shims/ (see scripts/build.mjs).
declare module "node:module" {
  export function createRequire(url: string | undefined): (id: string) => unknown;
}
declare var Buffer: {
  from(x: Uint8Array | ArrayLike<number> | string, encoding?: string): Uint8Array & { toString(encoding?: string): string };
};

/** Set by scripts/build.mjs: true for `npm run dev` and the offline artifact. */
declare const __MF_DEV__: boolean;

/** Set by scripts/build.mjs from MF_GLITCHTIP_DSN, MF_UMAMI_HOST, MF_UMAMI_WEBSITE_ID (empty: telemetry hidden). */
declare const __MF_TELEMETRY__: { glitchtipDsn?: string; umamiHost?: string; umamiWebsiteId?: string; appVersion?: string } | undefined;

/** Set by scripts/build.mjs from MF_DAP_HELPERS: independent DAP helper origins this build trusts (empty: Tier 2 uploads off). */
declare const __MF_DAP_HELPERS__: string | undefined;

/** Set by scripts/build.mjs from MF_OHTTP_RELAY_URL / MF_OHTTP_PINS / MF_OHTTP_TARGET_ORIGIN (null: the private-relay option is hidden). */
declare const __MF_OHTTP__: { relayUrl: string; pins: string[]; targetOrigin?: string } | null | undefined;
