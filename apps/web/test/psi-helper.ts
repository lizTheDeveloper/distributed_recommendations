// Real OpenMined PSI for tests: packages/match's adapter when its node_modules has
// psi.js, otherwise the same cardinality-only wiring over apps/web's pinned copy
// (2.0.6), so these tests don't depend on another package's install state.
import { createRequire } from "node:module";
import type { PsiFactory } from "../src/lib/match/pkg.ts";
import { openMinedPsi } from "../src/lib/match/pkg.ts";

type Lib = {
  client: { createWithNewKey(r: boolean): { createRequest(i: readonly string[]): { serializeBinary(): Uint8Array }; getIntersectionSize(s: unknown, r: unknown): number; delete(): void } };
  server: { createWithNewKey(r: boolean): { createSetupMessage(f: number, n: number, i: readonly string[]): { serializeBinary(): Uint8Array }; processRequest(r: unknown): { serializeBinary(): Uint8Array }; delete(): void } };
  request: { deserializeBinary(b: Uint8Array): { getEncryptedElementsList(): unknown[] } };
  response: { deserializeBinary(b: Uint8Array): unknown };
  serverSetup: { deserializeBinary(b: Uint8Array): unknown };
};

export async function testPsi(): Promise<PsiFactory> {
  try {
    return await openMinedPsi();
  } catch {
    const lib = (await (createRequire(import.meta.url)("@openmined/psi.js") as () => Promise<Lib>)()) as Lib;
    return () => {
      let client: ReturnType<Lib["client"]["createWithNewKey"]> | undefined;
      return {
        async createRequest(items) {
          client = lib.client.createWithNewKey(false);
          return client.createRequest(items).serializeBinary();
        },
        async answerRequest(request, items) {
          const req = lib.request.deserializeBinary(request);
          const server = lib.server.createWithNewKey(false);
          try {
            return { setup: server.createSetupMessage(1e-9, req.getEncryptedElementsList().length, items).serializeBinary(), response: server.processRequest(req).serializeBinary() };
          } finally {
            server.delete();
          }
        },
        async intersectionSize(setup, response) {
          const n = client!.getIntersectionSize(lib.serverSetup.deserializeBinary(setup), lib.response.deserializeBinary(response));
          client!.delete();
          client = undefined;
          return n;
        },
        dispose() {
          client?.delete();
          client = undefined;
        },
      };
    };
  }
}
