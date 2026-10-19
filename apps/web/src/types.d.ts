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
