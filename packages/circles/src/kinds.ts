// Rumor kinds for Circle rounds. PROVISIONAL and unregistered, next to the Match
// kinds (3470-3478). They never appear on a relay in the clear: each is the inner,
// identity-signed event carried inside an MLS application message (Marmot kind 445).

export const CIRCLE_KINDS = {
  roundOpen: 3480,
  roundKey: 3481,
  roundMasked: 3482,
} as const;

export type CircleKindName = keyof typeof CIRCLE_KINDS;

const BY_NUMBER = new Map<number, CircleKindName>(
  (Object.entries(CIRCLE_KINDS) as [CircleKindName, number][]).map(([n, k]) => [k, n]),
);

export function circleKindName(kind: number): CircleKindName | undefined {
  return BY_NUMBER.get(kind);
}
