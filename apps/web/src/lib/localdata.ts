// Which local state is sensitive, and moving it out of plaintext localStorage.
//
// Sensitive = anything that reveals what the viewer watches or likes: watch and
// endorsement history, the discovery tally, feed impressions, follows, taste-list
// subscriptions, followed creator tastes, and the two caches keyed by video ids the viewer resolved or
// endorsed. These live only in the encrypted vault. Settings, the recipe and the
// last tab stay in localStorage: they're configuration, not behavior.

import type { KV } from "./storage.ts";
import { PREFIX } from "./storage.ts";
import type { Vault } from "./vault.ts";

export const SENSITIVE_KEYS = [
  "history",
  "tally",
  "impressions",
  "follows",
  "taste",
  // Followed creator tastes ("Follow taste"): whose picks you follow.
  "tastefollows",
  "videos",
  "tags",
  // Reels "not interested" ids.
  "hidden",
  // Match: the identity secret (local key) or the extension's pubkey, the MatchBook
  // (per-match secret keys, both sides' sketches), petnames and the activity log, and
  // the offline demo's simulated peer.
  "identity",
  "matchbook",
  "matchmeta",
  "demopeer",
  // Moderation (packages/moderation): block and mute lists, labeler subscriptions, the
  // NSFW choice, cached label events and instance defaults. Says whom the viewer avoids.
  "moderation",
  // Creator studio: the draft of "Publish my picks" (picked from your endorsements).
  "picks",
] as const;
export type SensitiveKey = (typeof SENSITIVE_KEYS)[number];
export type SensitiveData = Partial<Record<SensitiveKey, unknown>>;

export function isSensitive(k: string): k is SensitiveKey {
  return (SENSITIVE_KEYS as readonly string[]).includes(k);
}

export interface Loaded {
  data: SensitiveData;
  /** Keys moved from plaintext localStorage into the vault on this start. */
  migrated: SensitiveKey[];
  /** Plaintext from an older version is still in localStorage (memory vault only). */
  legacyLeft: boolean;
}

/**
 * Decrypt the vault, then migrate any plaintext left by older versions: encrypt it,
 * wait until the ciphertext is stored, and only then delete the plaintext. With a
 * memory vault the plaintext is read for this session but left in place (deleting it
 * would lose it); new writes never go to localStorage.
 */
export async function loadSensitive(vault: Vault, kv: KV): Promise<Loaded> {
  const data: SensitiveData = {};
  const stored = await vault.readAll();
  for (const k of SENSITIVE_KEYS) if (k in stored) data[k] = stored[k];
  const migrated: SensitiveKey[] = [];
  const legacy: SensitiveKey[] = [];
  for (const k of SENSITIVE_KEYS) {
    const raw = kv.get(PREFIX + k);
    if (raw === null) continue;
    legacy.push(k);
    if (k in data) continue; // the vault already has newer data
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue; // unreadable plaintext: just delete it below
    }
    data[k] = parsed;
    if (vault.status !== "memory") {
      vault.write(k, parsed);
      migrated.push(k);
    }
  }
  if (vault.status === "memory") return { data, migrated: [], legacyLeft: legacy.length > 0 };
  if (legacy.length) {
    try {
      await vault.flush();
    } catch {
      return { data, migrated: [], legacyLeft: true }; // keep the plaintext; retry next start
    }
    for (const k of legacy) kv.remove(PREFIX + k);
  }
  return { data, migrated, legacyLeft: false };
}

/** Delete any plaintext copies of sensitive state (wipe). */
export function removeLegacy(kv: KV): void {
  for (const k of SENSITIVE_KEYS) kv.remove(PREFIX + k);
}
