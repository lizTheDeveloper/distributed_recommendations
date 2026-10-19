// The live build's PSI: OpenMined psi.js in a sandboxed, opaque-origin iframe
// (public/psi-frame.html + psi-frame.js). psi.js's Emscripten bindings need
// `new Function`, which the app page's CSP forbids, and Chrome applies the page's CSP
// to workers as well. The frame has its own CSP and can't reach the app's storage.
// Same contract as packages/match's `openMinedPsi()`: cardinality only, sets padded
// to 128 by the caller, setup false-positive rate 1e-9.

import type { PsiFactory, PsiSession } from "./pkg.ts";
import { PSI_DEFAULT_FPR, PSI_SET_SIZE } from "./pkg.ts";

export async function framePsi(url = "psi-frame.html", timeoutMs = 20_000): Promise<PsiFactory> {
  const frame = document.createElement("iframe");
  frame.src = url;
  frame.title = "Private set intersection (no content)";
  frame.setAttribute("sandbox", "allow-scripts");
  frame.setAttribute("aria-hidden", "true");
  frame.tabIndex = -1;
  frame.style.cssText = "position:absolute;width:0;height:0;border:0;visibility:hidden";
  let next = 1;
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  let loaded: () => void = () => {};
  const ready = new Promise<void>((r) => (loaded = r));
  window.addEventListener("message", (e: MessageEvent) => {
    if (e.source !== frame.contentWindow || !e.data || e.data.mfPsi !== true) return;
    const { id, ok, value, error } = e.data;
    if (id === 0) return loaded();
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    if (ok) p.resolve(value);
    else p.reject(new Error(error));
  });
  document.body.appendChild(frame);
  const timeout = <T>(p: Promise<T>, what: string) =>
    Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`PSI frame timed out (${what})`)), timeoutMs))]);
  await timeout(ready, "load");
  const call = <T>(op: string, args?: unknown): Promise<T> =>
    timeout(
      new Promise<T>((resolve, reject) => {
        const id = next++;
        pending.set(id, { resolve: (v) => resolve(v as T), reject });
        // The frame's origin is opaque, so "*" is the only possible target; the
        // message goes to that one window.
        frame.contentWindow?.postMessage({ id, op, args }, "*");
      }),
      op,
    );
  try {
    await call("init");
  } catch (e) {
    frame.remove();
    throw e;
  }
  let sessions = 0;
  return (): PsiSession => {
    const sid = ++sessions;
    const max = PSI_SET_SIZE;
    return {
      createRequest: (items) => call<Uint8Array>("createRequest", { sid, items: [...items], max }),
      answerRequest: (request, items) => call<{ setup: Uint8Array; response: Uint8Array }>("answer", { request, items: [...items], fpr: PSI_DEFAULT_FPR, max }),
      intersectionSize: (setup, response) => call<number>("size", { sid, setup, response }),
      dispose: () => void call("dispose", { sid }).catch(() => undefined),
    };
  };
}
