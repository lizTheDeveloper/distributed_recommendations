// The in-memory model of a creator's picks, shared by both wire formats.

/** A bridged NIP-71 video event a pick points at. */
export interface VideoRef {
  /** NIP-71 kind: 34235/34236 (addressable, what the bridge emits) or 21/22. */
  kind: number;
  /** Author of the video event (the bridge key). */
  pubkey: string;
  /** `d` tag (the PeerTube uuid) for addressable kinds; required for an `a` ref. */
  d?: string;
  /** Event id, when known: emitted as an `e` ref next to the `a` ref. */
  id?: string;
  /** Relay hint for the `a`/`e` tag. */
  relay?: string;
  /** Canonical PeerTube watch URL the event points back to. */
  url: string;
}

/** One pick. Field names match taste-list v1 items. */
export interface Pick {
  /** Canonical PeerTube watch URL (`items[].id` in taste-list v1). */
  url: string;
  /** The bridged video event; picks without one go into the JSON list only. */
  video?: VideoRef;
  /** When the creator picked it, Unix seconds. */
  addedAt?: number;
  /** Paid placement (FTC Endorsement Guides): cards show "Sponsored". */
  sponsored: boolean;
  /** Material connection (own channel, friend, employer): cards show "Affiliated". */
  affiliated: boolean;
  /** Short note shown with the pick, ≤ 280 characters. */
  note?: string;
}

/** A creator's set of picks: one NIP-51 video curation set, one taste-list v1 document. */
export interface PicksSet {
  /** NIP-51 `d` identifier (stable per set; e.g. "picks"). */
  d: string;
  /** NIP-51 `title`, taste-list `name`; 1–80 characters. */
  title: string;
  description?: string;
  /** NIP-51 `image` (https URL). Not carried by taste-list v1. */
  image?: string;
  /** Taste-list v1 `author`; defaults to the signer's npub when exporting. */
  author?: string;
  /** Unix seconds; NIP-51 uses the event's `created_at`. */
  updatedAt?: number;
  /** In any order; each format orders them itself. Unique by `url`. */
  items: Pick[];
}
