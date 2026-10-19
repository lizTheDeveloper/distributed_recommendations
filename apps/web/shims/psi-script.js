// Live build: load psi.js (the browser build of @openmined/psi.js 2.0.6, WASM
// embedded) from the app's own origin, only when a preview first needs it.
let pending;
export function loadPsiInit() {
  if (!pending) {
    pending = new Promise((resolve, reject) => {
      if (typeof globalThis.PSI === "function") return resolve(globalThis.PSI);
      const s = document.createElement("script");
      s.src = "psi.js";
      s.async = true;
      s.onload = () => (typeof globalThis.PSI === "function" ? resolve(globalThis.PSI) : reject(new Error("psi.js loaded without PSI")));
      s.onerror = () => reject(new Error("couldn't load psi.js"));
      document.head.appendChild(s);
    });
    pending.catch(() => (pending = undefined));
  }
  return pending;
}
