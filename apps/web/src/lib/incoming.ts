// Things handed to the app from outside: native deep links and share-sheet items
// (window.MatchFeedNative.incoming), the installed PWA's share target, and manifest
// shortcuts. Pure: turns them into an action the UI confirms before doing anything.

import type { Incoming } from "./native.ts";
import { parseNpub, parseNprofile } from "./bech32.ts";
import { watchId } from "./videos.ts";

export type IncomingAction =
  | { kind: "match"; pubkey: string; source: "deeplink" | "share" }
  | { kind: "video"; url: string; host: string; videoId: string; source: "deeplink" | "share" };

/** A canonical-enough watch URL: https only, no user info, query or fragment. */
export function peertubeWatch(text: string): { url: string; host: string; videoId: string } | null {
  let u: URL;
  try {
    u = new URL(text.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.username || u.password) return null;
  const w = watchId(`${u.origin}${u.pathname}`);
  if (!w) return null;
  return { url: `${u.origin}${u.pathname.replace(/\/$/, "")}`, host: u.host, videoId: w.id };
}

/** A native item (only shape-checked by the shell) to an action, or null. */
export function fromNative(item: Incoming): IncomingAction | null {
  if (!item || (item.source !== "deeplink" && item.source !== "share")) return null;
  if (item.kind === "nostr") {
    const v = String(item.value ?? "");
    const pubkey = v.startsWith("nprofile1") ? parseNprofile(v) : v.startsWith("npub1") ? parseNpub(v) : null;
    return pubkey ? { kind: "match", pubkey, source: item.source } : null;
  }
  if (item.kind === "peertube-watch") {
    const w = peertubeWatch(String(item.value ?? ""));
    return w ? { kind: "video", ...w, source: item.source } : null;
  }
  return null;
}

/**
 * The PWA share target (manifest `share_target`, GET to ./ with share_url,
 * share_text, share_title) and nostr: links in shared text. Browsers often put the
 * link in `text`, so every https URL in the text is tried.
 */
export function fromShareParams(params: URLSearchParams): IncomingAction | null {
  const fields = [params.get("share_url"), params.get("share_text"), params.get("share_title")].filter((x): x is string => !!x).map((x) => x.slice(0, 4000));
  for (const f of fields) {
    for (const m of f.matchAll(/https:\/\/[^\s<>"']+/g)) {
      const w = peertubeWatch(m[0].replace(/[.,;:!?)]+$/, ""));
      if (w) return { kind: "video", ...w, source: "share" };
    }
  }
  for (const f of fields) {
    const m = /(?:nostr:)?(npub1[02-9ac-hj-np-z]{58}|nprofile1[02-9ac-hj-np-z]{20,1900})/.exec(f);
    if (m) {
      const pubkey = m[1].startsWith("npub1") ? parseNpub(m[1]) : parseNprofile(m[1]);
      if (pubkey) return { kind: "match", pubkey, source: "share" };
    }
  }
  return null;
}

/** Manifest shortcuts: `?view=reels|grid`, `?screen=<id>`. */
export function startRoute(params: URLSearchParams, screens: readonly string[]): { view?: "reels" | "grid"; screen?: string } {
  const out: { view?: "reels" | "grid"; screen?: string } = {};
  const v = params.get("view");
  if (v === "reels" || v === "grid") out.view = v;
  const s = params.get("screen");
  if (s && screens.includes(s)) out.screen = s;
  return out;
}
