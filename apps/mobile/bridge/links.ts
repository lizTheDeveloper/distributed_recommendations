// Classifies text and URLs handed to the app (deep links, share-sheet text) into Incoming items.
// Pure and tested (test/links.test.ts). Nothing here fetches anything: a PeerTube URL is only
// recognized by its path shape, and the web app decides what to do with it.

import type { Incoming } from "./types.ts";

const MAX_INPUT = 4096;
const MAX_URL = 512;
// NIP-19 bech32: hrp + "1" + data in the bech32 charset. Checksum is verified in apps/web.
const BECH32 = /^(npub|nprofile)1[02-9ac-hj-np-z]{6,}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// PeerTube short UUIDs are base58 (translator "flickrBase58"), 22 characters in practice.
const SHORT_UUID = /^[1-9A-HJ-NP-Za-km-z]{16,24}$/;

/** A nostr entity from "nostr:npub1…", "nostr://npub1…" or a bare "npub1…". */
export function parseNostr(input: string): string | null {
  let s = input.trim();
  if (s.length > MAX_INPUT) return null;
  s = s.replace(/^nostr:(\/\/)?/i, "");
  s = s.toLowerCase();
  return BECH32.test(s) ? s : null;
}

/** A PeerTube watch URL (/w/<id>, /videos/watch/<id>, /videos/embed/<id>), normalized. */
export function parsePeerTubeWatch(input: string): { value: string; host: string; videoId: string } | null {
  const s = input.trim();
  if (s.length > MAX_URL) return null;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.username || u.password) return null;
  const parts = u.pathname.split("/").filter(Boolean);
  let id: string | undefined;
  if (parts.length === 2 && parts[0] === "w") id = parts[1];
  else if (parts.length === 3 && parts[0] === "videos" && (parts[1] === "watch" || parts[1] === "embed")) id = parts[2];
  if (!id || !(UUID.test(id) || SHORT_UUID.test(id))) return null;
  const t = u.searchParams.get("start") ?? u.searchParams.get("t");
  const clean = new URL(`https://${u.host}/w/${id}`);
  if (t && /^[0-9hms]{1,12}$/.test(t)) clean.searchParams.set("start", t);
  return { value: clean.toString(), host: u.host.toLowerCase(), videoId: id };
}

/** One URL or entity (a deep link). */
export function classifyLink(url: string, source: Incoming["source"]): Incoming | null {
  const n = parseNostr(url);
  if (n) return { kind: "nostr", source, value: n };
  const p = parsePeerTubeWatch(url);
  if (p) return { kind: "peertube-watch", source, ...p };
  return null;
}

/** Shared text, e.g. "Great talk https://framatube.org/w/abc… via PeerTube". First match wins. */
export function classifySharedText(text: string): Incoming | null {
  if (typeof text !== "string" || text.length > MAX_INPUT) return null;
  for (const token of text.split(/\s+/)) {
    const tok = token.replace(/^[<("']+|[>)"'.,;!?]+$/g, "");
    if (!tok) continue;
    const hit = classifyLink(tok, "share");
    if (hit) return hit;
  }
  return null;
}

/**
 * The app's own custom-scheme URL used to hand shares to the WebView:
 * <scheme>://share?text=… (Android MainActivity) or <scheme>://share (iOS share extension,
 * whose payload arrives through the share-target plugin instead).
 */
export function parseShareHandoff(url: string, scheme: string): { text: string | null } | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== `${scheme}:`) return null;
  if (u.host !== "share" && u.pathname.replace(/^\/+/, "") !== "share") return null;
  return { text: u.searchParams.get("text") };
}
