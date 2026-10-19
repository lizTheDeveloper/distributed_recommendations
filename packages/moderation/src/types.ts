// Shared Nostr and HTTP shapes. Kept structural so the app can pass events from
// nostr-tools, NDK or its own relay code.

/** A signed Nostr event (NIP-01). */
export interface NostrEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

/** An unsigned event, ready for the user's signer (NIP-07, NIP-46 or a local key). */
export interface EventTemplate {
  kind: number;
  created_at: number;
  tags: string[][];
  content: string;
}

/** NIP-01 REQ filter (only the fields this package uses). */
export interface NostrFilter {
  kinds?: number[];
  authors?: string[];
  since?: number;
  until?: number;
  limit?: number;
  ids?: string[];
  [tag: `#${string}`]: string[] | undefined;
}

/** Fetches events matching `filter` from `relays`. Injected; see `relay.ts` for a default. */
export type QueryFn = (relays: readonly string[], filter: NostrFilter) => Promise<NostrEvent[]>;

/** Checks an event's id and signature. Injected; see `nostr.ts` `verifyNostrEvent`. */
export type VerifyFn = (e: NostrEvent) => boolean;

export interface FetchResponseLike {
  ok: boolean;
  status: number;
  headers?: { get(name: string): string | null };
  json(): Promise<unknown>;
  text?(): Promise<string>;
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<FetchResponseLike>;
