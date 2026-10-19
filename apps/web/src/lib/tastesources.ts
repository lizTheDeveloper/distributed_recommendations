// Network adapters for "Follow taste" (creatortaste.ts is the pure part).
//
// - Nostr: a separate, read-only WsRelay over the relays the viewer configured. It
//   never answers NIP-42 AUTH (no signer), so reading a creator's public list never
//   identifies the viewer's Match key to a relay. No relays configured = no Nostr.
// - Signatures: checked with packages/match's InMemoryRelay, whose `publish` runs
//   nostr-tools' verifyEvent (id hash + Schnorr signature); nothing is published.
// - Taste-list URL: https only, no credentials or referrer, 64 KiB cap.
// - Playlists: the channel's home instance, through the catalog.

import type { Catalog, ChannelProfile } from "./catalog.ts";
import type { ChannelRef } from "./handles.ts";
import type { NostrEvent, NostrFilter, TasteDeps } from "./creatortaste.ts";
import { TASTE_LIST_LIMITS } from "./tastelist.ts";
import type { RelayFilter, SignedEvent } from "./match/pkg.ts";
import { InMemoryRelay } from "./match/pkg.ts";
import { WsRelay } from "./match/wsRelay.ts";

/** Event id + signature check, via match's in-memory relay (which verifies on publish). */
export async function verifyNostrEvent(e: NostrEvent): Promise<boolean> {
  try {
    // A fresh object with only the NIP-01 fields: nostr-tools caches its verdict in a
    // symbol property, which a spread would copy along with a forged signature.
    const fresh = { id: e.id, pubkey: e.pubkey, created_at: e.created_at, kind: e.kind, tags: e.tags.map((t) => [...t]), content: e.content, sig: e.sig };
    const r = await new InMemoryRelay().publish(fresh as SignedEvent);
    return r.ok;
  } catch {
    return false;
  }
}

/** Read-only queries over the viewer's relays, filtered again locally. */
export function relayQuery(urls: readonly string[], timeoutMs = 6000): (f: NostrFilter) => Promise<NostrEvent[]> {
  return async (f) => {
    const relay = new WsRelay({ urls, authSigner: () => null, timeoutMs });
    try {
      // WsRelay sends the filter as is; its local re-check covers kinds only, so
      // authors, ids and #d are checked here.
      const evs = (await relay.query(f as unknown as RelayFilter)) as unknown as NostrEvent[];
      return evs.filter(
        (e) =>
          (!f.kinds || f.kinds.includes(e.kind)) &&
          (!f.authors || f.authors.includes(e.pubkey)) &&
          (!f.ids || f.ids.includes(e.id)) &&
          (!f["#d"] || e.tags.some((t) => t[0] === "d" && f["#d"]!.includes(t[1]))),
      );
    } finally {
      relay.close();
    }
  };
}

export async function fetchTasteListText(url: string): Promise<string> {
  const u = new URL(url);
  if (u.protocol !== "https:") throw new Error("not https");
  const res = await fetch(u.toString(), { credentials: "omit", referrerPolicy: "no-referrer", headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`returned ${res.status}`);
  const len = Number(res.headers.get("content-length") ?? 0);
  if (len > TASTE_LIST_LIMITS.maxJsonBytes) throw new Error("larger than 64 KiB");
  return res.text();
}

export interface TasteDepsOptions {
  catalog: Catalog;
  ref: ChannelRef;
  profile: () => Promise<ChannelProfile>;
  relays: readonly string[];
  live: boolean;
  now: () => number;
}

export function tasteDeps(o: TasteDepsOptions): TasteDeps {
  return {
    now: o.now,
    profile: async () => {
      const p = await o.profile();
      return { text: p.text, displayName: p.displayName, ownerAccount: p.ownerAccount };
    },
    relays: o.live ? o.relays : [],
    nostrQuery: o.live && o.relays.length ? relayQuery(o.relays) : undefined,
    verify: verifyNostrEvent,
    fetchText: o.live ? fetchTasteListText : undefined,
    playlists: (owner) => o.catalog.creatorPlaylists(o.ref, owner),
  };
}
