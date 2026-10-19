// PSI for previews. OpenMined psi.js (WASM) is loaded lazily, the first time a
// preview needs it, so the 2 MB module never loads for people who don't use Match
// previews. If WASM can't load (an old browser, or a sandbox whose CSP forbids
// WebAssembly), previews are unavailable and say so; the rest of Match still works.

import type { PsiFactory, PsiSession } from "./pkg.ts";
import { openMinedPsi } from "./pkg.ts";

export type PsiStatus = { state: "idle" | "loading" | "ready" } | { state: "unavailable"; reason: string };

let status: PsiStatus = { state: "idle" };
let loading: Promise<PsiFactory | null> | null = null;
const listeners = new Set<() => void>();

export function psiStatus(): PsiStatus {
  return status;
}

export function onPsiStatus(fn: () => void): void {
  listeners.add(fn);
}

function set(s: PsiStatus) {
  status = s;
  for (const fn of listeners) fn();
}

let defaultLoader: () => Promise<PsiFactory> = () => openMinedPsi();

/** Choose how PSI loads (the live build runs it in a sandboxed frame). Call before first use. */
export function configurePsi(loader: () => Promise<PsiFactory>): void {
  defaultLoader = loader;
}

/** Load real PSI once. Resolves to null when it can't load. */
export function loadPsi(loader: () => Promise<PsiFactory> = defaultLoader): Promise<PsiFactory | null> {
  if (!loading) {
    set({ state: "loading" });
    loading = loader().then(
      (f) => {
        set({ state: "ready" });
        return f;
      },
      (e: unknown) => {
        const reason = e instanceof Error ? e.message : String(e);
        set({ state: "unavailable", reason: /CompileError|Content Security|unsafe-eval|wasm-eval/i.test(reason) ? `this page isn't allowed to run it (${reason.slice(0, 120)})` : reason });
        return null;
      },
    );
  }
  return loading;
}

export class PsiUnavailableError extends Error {
  constructor(reason: string) {
    super(`preview unavailable in this browser (${reason})`);
    this.name = "PsiUnavailableError";
  }
}

/**
 * A `PsiFactory` whose sessions load PSI on first use. `MatchClient` needs a factory
 * up front; this one costs nothing until a preview actually runs.
 */
export function lazyPsi(loader?: () => Promise<PsiFactory>): PsiFactory {
  return (): PsiSession => {
    let inner: PsiSession | undefined;
    const get = async () => {
      if (inner) return inner;
      const f = await loadPsi(loader);
      if (!f) throw new PsiUnavailableError(status.state === "unavailable" ? status.reason : "not loaded");
      inner = f();
      return inner;
    };
    return {
      createRequest: async (items) => (await get()).createRequest(items),
      answerRequest: async (req, items) => (await get()).answerRequest(req, items),
      intersectionSize: async (setup, res) => (await get()).intersectionSize(setup, res),
      dispose: () => inner?.dispose(),
    };
  };
}

/** Test hook: forget the loaded module. */
export function resetPsiForTests(): void {
  loading = null;
  status = { state: "idle" };
}
