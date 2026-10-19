// Single import point for the shared library. The app must use packages/core, not
// reimplement it. The validation helpers are internal to core (not re-exported from
// its index); the taste-list parser reuses them so both formats apply identical
// string rules (PROTOCOL.md "Conventions").
export * from "../../../../packages/core/src/index.ts";
export {
  array,
  boolean,
  fail,
  has,
  number,
  plainObject,
  string,
} from "../../../../packages/core/src/validate.ts";
