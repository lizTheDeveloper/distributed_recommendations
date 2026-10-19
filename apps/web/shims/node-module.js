// Browser stand-in for `node:module`, used only by packages/match/src/psi.ts, which
// loads @openmined/psi.js with `createRequire(import.meta.url)('@openmined/psi.js')`.
// Here that returns an init function that loads the browser (WASM) build of psi.js:
// lazily from dist/psi.js in the live build, inlined in the artifact build.
// Wired up by scripts/build.mjs (an esbuild onResolve for `node:module`).
import { loadPsiInit } from "mf-psi-source";

export function createRequire() {
  return (id) => {
    if (id === "@openmined/psi.js") return () => loadPsiInit().then((init) => init());
    throw new Error(`${id} isn't available in the browser`);
  };
}
