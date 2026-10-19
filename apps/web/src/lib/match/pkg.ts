// Single import point for packages/match, imported from source the way core is
// (src/lib/core.ts). In the browser build, `node:module` and `Buffer` (used only by
// match's PSI adapter) are shimmed: see scripts/build.mjs and src/shims/.
export * from "../../../../../packages/match/src/index.ts";
