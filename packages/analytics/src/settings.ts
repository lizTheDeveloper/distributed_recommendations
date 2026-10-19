// The viewer's switches (docs/ANALYTICS.md, decision Q1): contribution is on by
// default, with an off switch for the whole feature and one per channel; nothing is
// ever recorded or sent during private watching.

import { CHANNELS, type Channel } from "./channels.ts";
import type { SourceKind } from "./core.ts";

export interface ContributionSettings {
  /** "Contribute anonymous discovery stats". Default true. */
  contribute: boolean;
  /** Per-channel switches. A missing entry means on; `false` means never report it. */
  perChannel: Partial<Record<Channel, boolean>>;
  /** Private watching: nothing is recorded, and nothing is uploaded while it is on. */
  privateWatching: boolean;
}

export const DEFAULT_CONTRIBUTION: Readonly<ContributionSettings> = Object.freeze({
  contribute: true,
  perChannel: Object.freeze({}),
  privateWatching: false,
});

/**
 * Adapter for apps/web `Settings` (`analytics: {contribute, perKind}`, `privateWatching`).
 * Web's per-kind switches cover the six rank sources; "search" and "other" follow the
 * master switch until web adds switches for them.
 */
export function fromWebSettings(s: {
  analytics: { contribute: boolean; perKind: Partial<Record<SourceKind, boolean>> };
  privateWatching: boolean;
}): ContributionSettings {
  const perChannel: Partial<Record<Channel, boolean>> = {};
  for (const [k, v] of Object.entries(s.analytics.perKind ?? {})) {
    if ((CHANNELS as readonly string[]).includes(k) && typeof v === "boolean") perChannel[k as Channel] = v;
  }
  return { contribute: s.analytics.contribute !== false, perChannel, privateWatching: s.privateWatching === true };
}

/** May a view through this channel be counted or reported, under these settings? */
export function channelAllowed(channel: Channel, s: ContributionSettings): boolean {
  return s.contribute === true && s.privateWatching !== true && s.perChannel[channel] !== false;
}
