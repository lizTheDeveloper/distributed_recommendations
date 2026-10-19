// Tier 2 discovery-channel stats (ANALYTICS.md). Not transmitted in v1: no DAP
// aggregator exists yet. The device keeps a local tally of what it *would*
// contribute, honoring the viewer's switches, so the setting is real and inspectable.

import type { SourceKind } from "./core.ts";
import { SOURCE_KINDS } from "./core.ts";
import type { Settings } from "./settings.ts";

export type Tally = Record<SourceKind, number>;

export function emptyTally(): Tally {
  const t = {} as Tally;
  for (const k of SOURCE_KINDS) t[k] = 0;
  return t;
}

export function loadTally(x: unknown): Tally {
  const t = emptyTally();
  if (typeof x === "object" && x !== null) {
    for (const k of SOURCE_KINDS) {
      const v = (x as Record<string, unknown>)[k];
      if (typeof v === "number" && Number.isInteger(v) && v >= 0) t[k] = v;
    }
  }
  return t;
}

/** Would this view be contributed? */
export function contributes(kind: SourceKind, s: Pick<Settings, "analytics" | "privateWatching">): boolean {
  return !s.privateWatching && s.analytics.contribute && s.analytics.perKind[kind];
}

export function countView(t: Tally, kind: SourceKind, s: Pick<Settings, "analytics" | "privateWatching">): Tally {
  return contributes(kind, s) ? { ...t, [kind]: t[kind] + 1 } : t;
}
