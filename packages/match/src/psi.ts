// PSI-cardinality adapters for core's `PsiCardinality` interface.
//
// Roles (core preview.ts, PROTOCOL.md §4): the **target** is the PSI *client*: it
// calls `createRequest(targetItems)` and later `intersectionSize(setup, response)`,
// so it alone learns |A ∩ B|, noises it on-device and sends only the noised value.
// The **requester** is the PSI *server*: `answerRequest(request, requesterItems)`.
//
// Both sides pad their set to exactly `PSI_SET_SIZE` (128) with random 64-hex
// nonces (the same padding sketches use; a nonce never equals a video URL, so it
// never intersects). Then neither side learns the other's real set size from the
// PSI messages, and every PSI message fits one 8,192-byte control message.
//
// SECURITY: OpenMined PSI (`@openmined/psi.js`, Apache-2.0, ECDH-PSI over P-256)
// has **no published audit or security model** (THREAT_MODEL, Process step 2;
// OSS_STACK §6). Treat it as semi-honest and budget an audit before launch.

import { createRequire } from 'node:module';
import type { PsiCardinality, Rng } from './core.ts';
import { randomHex, shuffle } from './core.ts';

/** Every PSI set is padded (or truncated, newest first) to exactly this many items. */
export const PSI_SET_SIZE = 128;

/** Default GCS false-positive rate for the server setup (over the whole client set). */
export const PSI_DEFAULT_FPR = 1e-9;

/**
 * Pad a preview set to `PSI_SET_SIZE`: keep the first 128 real items (pass them
 * newest first, as `selectSketchItems` returns them), fill with random nonces and
 * shuffle. Returns the padded set and how many real items it holds.
 */
export function padPsiSet(items: readonly string[], rng: Rng): { items: string[]; realCount: number } {
  const real = [...new Set(items)].slice(0, PSI_SET_SIZE);
  const padded = real.slice();
  while (padded.length < PSI_SET_SIZE) padded.push(randomHex(rng, 32));
  return { items: shuffle(padded, rng), realCount: real.length };
}

/** A one-run PSI session: create one per preview, then `dispose()` it. */
export interface PsiSession extends PsiCardinality {
  dispose(): void;
}

export type PsiFactory = () => PsiSession;

export function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

export function fromBase64(text: string): Uint8Array {
  return new Uint8Array(Buffer.from(text, 'base64'));
}

// --- OpenMined PSI ----------------------------------------------------------------

// Minimal structural types for the parts of @openmined/psi.js we use.
interface PsiProto {
  serializeBinary(): Uint8Array;
}
interface PsiRequestProto extends PsiProto {
  getEncryptedElementsList(): unknown[];
  getRevealIntersection(): boolean;
}
interface PsiClient {
  createRequest(items: readonly string[]): PsiProto;
  getIntersectionSize(setup: unknown, response: unknown): number;
  delete(): void;
}
interface PsiServer {
  createSetupMessage(fpr: number, numClientInputs: number, inputs: readonly string[]): PsiProto;
  processRequest(request: unknown): PsiProto;
  delete(): void;
}
interface PsiLibrary {
  client?: { createWithNewKey(revealIntersection?: boolean): PsiClient };
  server?: { createWithNewKey(revealIntersection?: boolean): PsiServer };
  request: { deserializeBinary(b: Uint8Array): PsiRequestProto };
  response: { deserializeBinary(b: Uint8Array): unknown };
  serverSetup: { deserializeBinary(b: Uint8Array): unknown };
}

let library: Promise<PsiLibrary> | undefined;

function loadLibrary(): Promise<PsiLibrary> {
  if (!library) {
    // psi.js is a CommonJS WASM bundle; its Node build needs only `crypto` and `fs`.
    const require = createRequire(import.meta.url);
    const init = require('@openmined/psi.js') as () => Promise<PsiLibrary>;
    library = init();
  }
  return library;
}

/**
 * Load OpenMined PSI (WASM) and return a factory of one-run sessions in
 * cardinality-only mode (`revealIntersection = false`). Sessions keep the PSI
 * client's secret key in memory between `createRequest` and `intersectionSize`;
 * it is never serialized.
 */
export async function openMinedPsi(opts: { fpr?: number; maxSetSize?: number } = {}): Promise<PsiFactory> {
  const psi = await loadLibrary();
  const fpr = opts.fpr ?? PSI_DEFAULT_FPR;
  const maxSetSize = opts.maxSetSize ?? PSI_SET_SIZE;
  if (!psi.client || !psi.server) throw new Error('@openmined/psi.js loaded without client/server');
  const clientLib = psi.client;
  const serverLib = psi.server;
  return () => {
    let client: PsiClient | undefined;
    const check = (items: readonly string[]) => {
      if (items.length === 0 || items.length > maxSetSize) throw new RangeError(`PSI set must have 1..${maxSetSize} items`);
    };
    return {
      async createRequest(items) {
        check(items);
        client?.delete();
        client = clientLib.createWithNewKey(false);
        return client.createRequest(items).serializeBinary();
      },
      async answerRequest(request, items) {
        check(items);
        const req = psi.request.deserializeBinary(request);
        const n = req.getEncryptedElementsList().length;
        if (n === 0 || n > maxSetSize) throw new RangeError(`PSI request must have 1..${maxSetSize} elements`);
        // Cardinality only: refuse a request that asks to reveal the intersection.
        if (req.getRevealIntersection()) throw new Error('PSI request asks to reveal the intersection');
        const server = serverLib.createWithNewKey(false);
        try {
          const setup = server.createSetupMessage(fpr, n, items).serializeBinary();
          const response = server.processRequest(req).serializeBinary();
          return { setup, response };
        } finally {
          server.delete();
        }
      },
      async intersectionSize(setup, response) {
        if (!client) throw new Error('createRequest must be called first');
        try {
          return client.getIntersectionSize(psi.serverSetup.deserializeBinary(setup), psi.response.deserializeBinary(response));
        } finally {
          client.delete();
          client = undefined;
        }
      },
      dispose() {
        client?.delete();
        client = undefined;
      },
    };
  };
}

// --- INSECURE test double -----------------------------------------------------------

/**
 * INSECURE. NOT PRIVATE. FOR TESTS ONLY.
 *
 * Same message flow and roles as real PSI, but the "request" is the target's
 * plaintext item list and the "setup" is the requester's: each side hands the other
 * its whole set. Use it only where `@openmined/psi.js` can't load (e.g. a runtime
 * without WASM) to exercise the protocol plumbing. Never ship it.
 */
export function INSECURE_plaintextPsiForTests(): PsiFactory {
  const enc = (items: readonly string[]) => new TextEncoder().encode(JSON.stringify(['INSECURE-TEST-PSI', ...items]));
  const dec = (b: Uint8Array): string[] => {
    const v = JSON.parse(new TextDecoder().decode(b)) as unknown;
    if (!Array.isArray(v) || v[0] !== 'INSECURE-TEST-PSI') throw new Error('not an insecure test PSI message');
    return v.slice(1) as string[];
  };
  return () => {
    let mine: string[] | undefined;
    return {
      async createRequest(items) {
        mine = [...items];
        return enc(items);
      },
      async answerRequest(request, items) {
        dec(request);
        return { setup: enc(items), response: enc([]) };
      },
      async intersectionSize(setup) {
        if (!mine) throw new Error('createRequest must be called first');
        const theirs = new Set(dec(setup));
        return mine.filter((x) => theirs.has(x)).length;
      },
      dispose() {
        mine = undefined;
      },
    };
  };
}
