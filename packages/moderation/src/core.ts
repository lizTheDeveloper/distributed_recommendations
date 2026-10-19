// The one place this package imports @match-feed/core. Core is not published yet,
// so it is imported by relative path (as packages/match does); switch to the
// package name once it is. Only types and `rank` are used.
export * from '../../core/src/index.ts';
