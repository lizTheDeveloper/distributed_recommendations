// The one place this package imports @match-feed/core. Core is not published yet,
// so it is imported by relative path (as packages/match does); switch to the package
// name once it is.
export type { RankedItem, Rng, SourceKind } from "../../core/src/index.ts";
export { SOURCE_KINDS, cryptoRng, discreteLaplace, seededRng } from "../../core/src/index.ts";
