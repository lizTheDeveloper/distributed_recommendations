// PSI (OpenMined psi.js 2.0.6, WASM) in a sandboxed iframe (psi-frame.html).
// psi.js's Emscripten bindings generate code with `new Function`, which the app
// page's Content Security Policy forbids (no 'unsafe-eval'), and Chrome applies the
// page's policy to its workers too. The frame is sandboxed without
// allow-same-origin, so it runs in an opaque origin: it can't read the app's storage,
// cookies or vault key, and the app page's CSP stays strict.
//
// Cardinality only (revealIntersection = false); sets of 1..max; the PSI client key
// stays in this frame between createRequest and size.

let lib;
const clients = new Map();

function check(items, max) {
  if (!Array.isArray(items) || items.length === 0 || items.length > max) throw new RangeError(`PSI set must have 1..${max} items`);
}

const ops = {
  async init() {
    lib = await window.PSI();
    if (!lib.client || !lib.server) throw new Error("psi.js loaded without client/server");
    return true;
  },
  createRequest({ sid, items, max }) {
    check(items, max);
    clients.get(sid)?.delete();
    const c = lib.client.createWithNewKey(false);
    clients.set(sid, c);
    return c.createRequest(items).serializeBinary();
  },
  answer({ request, items, fpr, max }) {
    check(items, max);
    const req = lib.request.deserializeBinary(request);
    const n = req.getEncryptedElementsList().length;
    if (n === 0 || n > max) throw new RangeError(`PSI request must have 1..${max} elements`);
    if (req.getRevealIntersection()) throw new Error("PSI request asks to reveal the intersection");
    const server = lib.server.createWithNewKey(false);
    try {
      return { setup: server.createSetupMessage(fpr, n, items).serializeBinary(), response: server.processRequest(req).serializeBinary() };
    } finally {
      server.delete();
    }
  },
  size({ sid, setup, response }) {
    const c = clients.get(sid);
    if (!c) throw new Error("createRequest must be called first");
    try {
      return c.getIntersectionSize(lib.serverSetup.deserializeBinary(setup), lib.response.deserializeBinary(response));
    } finally {
      c.delete();
      clients.delete(sid);
    }
  },
  dispose({ sid }) {
    clients.get(sid)?.delete();
    clients.delete(sid);
    return true;
  },
};

window.addEventListener("message", async (e) => {
  if (e.source !== window.parent) return;
  const { id, op, args } = e.data ?? {};
  if (typeof id !== "number") return;
  // An opaque-origin frame can only answer with "*"; the reply goes to the parent window.
  try {
    if (!ops[op]) throw new Error(`unknown op ${op}`);
    window.parent.postMessage({ mfPsi: true, id, ok: true, value: await ops[op](args ?? {}) }, "*");
  } catch (err) {
    window.parent.postMessage({ mfPsi: true, id, ok: false, error: String((err && err.message) || err) }, "*");
  }
});
window.parent.postMessage({ mfPsi: true, id: 0, ok: true, value: "loaded" }, "*");
