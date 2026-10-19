// Rumor kinds for the Match protocol. PROVISIONAL: not registered in the NIP
// registry (github.com/nostr-protocol/nips README, checked 2026-10-19, which lists
// no kinds in 3000-3999). They are regular-range kinds (1000-9999, NIP-01), like
// NIP-17's kind 14. Rumors are never published on their own: they travel only
// inside NIP-59 gift wraps (kind 1059), so relays never see these numbers. They
// still must not collide with kinds other clients might put in a gift wrap.

export const MATCH_KINDS = {
  matchRequest: 3470,
  matchAccept: 3471,
  previewRequest: 3472,
  previewResponse: 3473,
  previewAnswer: 3474,
  previewResult: 3475,
  sketch: 3476,
  renew: 3477,
  revoke: 3478,
} as const;

export type MatchKindName = keyof typeof MATCH_KINDS;
export type MatchKind = (typeof MATCH_KINDS)[MatchKindName];

/** NIP-59 seal and gift wrap kinds. */
export const SEAL_KIND = 13;
export const GIFT_WRAP_KIND = 1059;

const BY_NUMBER = new Map<number, MatchKindName>(
  (Object.entries(MATCH_KINDS) as [MatchKindName, number][]).map(([name, kind]) => [kind, name]),
);

export function matchKindName(kind: number): MatchKindName | undefined {
  return BY_NUMBER.get(kind);
}
