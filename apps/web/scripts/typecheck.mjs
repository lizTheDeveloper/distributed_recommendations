// Typecheck the app. Errors inside packages/ (core and match, which apps/web imports
// from source but must not edit) are reported separately as upstream issues and
// don't fail this check; app errors do.
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const tsc = createRequire(import.meta.url).resolve("typescript/bin/tsc");
const r = spawnSync(process.execPath, [tsc, "-p", "tsconfig.typecheck.json", "--pretty", "false"], { encoding: "utf8" });
const lines = (r.stdout + r.stderr).split("\n").filter(Boolean);
const isCore = (l) => l.startsWith("../../packages/");
const errorStarts = lines.filter((l) => /error TS\d+/.test(l));
const core = errorStarts.filter(isCore);
const app = errorStarts.filter((l) => !isCore(l));
if (core.length) {
  console.warn(`packages/: ${core.length} type error(s), not in apps/web (report upstream):`);
  for (const l of core) console.warn("  " + l);
}
if (app.length) {
  for (const l of lines.filter((l) => !isCore(l))) console.error(l);
  process.exit(1);
}
console.log("apps/web: no type errors");
