// Artifact build: the single-file page can't load a second script, so psi.js is
// bundled inline (about 2 MB, WASM embedded as base64 by Emscripten).
import init from "@openmined/psi.js/psi_wasm_web.js";

export async function loadPsiInit() {
  return init;
}
