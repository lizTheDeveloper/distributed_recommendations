// The viewer's Match identity: a Nostr key. Either a local key (generated here or
// imported as nsec), whose secret is kept only in the encrypted vault, or a NIP-07
// browser extension that holds the key and signs for us (the secret never reaches
// this page).

import type { NostrSigner } from "./pkg.ts";
import { generateMatchKey, localSigner } from "./pkg.ts";
import { HEX64, parseNsec } from "../bech32.ts";

export type StoredIdentity =
  | { kind: "local"; secret: string; pubkey: string; createdAt: number; imported: boolean }
  | { kind: "nip07"; pubkey: string; createdAt: number };

interface Nip07 {
  getPublicKey(): Promise<string>;
  signEvent(e: unknown): Promise<unknown>;
  nip44?: { encrypt(pk: string, pt: string): Promise<string>; decrypt(pk: string, ct: string): Promise<string> };
}

function ext(): Nip07 | undefined {
  const n = (globalThis as { nostr?: Nip07 }).nostr;
  return n && typeof n.getPublicKey === "function" && typeof n.signEvent === "function" ? n : undefined;
}

/** "none" | "no-nip44" (too old for Match) | "ok". */
export function nip07Support(): "none" | "no-nip44" | "ok" {
  const n = ext();
  if (!n) return "none";
  return n.nip44 && typeof n.nip44.encrypt === "function" && typeof n.nip44.decrypt === "function" ? "ok" : "no-nip44";
}

/** The extension as a match `NostrSigner`. */
export function nip07Signer(): NostrSigner {
  const n = ext();
  if (!n?.nip44) throw new Error("No NIP-07 extension with NIP-44 support");
  const nip44 = n.nip44;
  return {
    getPublicKey: () => n.getPublicKey(),
    signEvent: (t) => n.signEvent(t) as ReturnType<NostrSigner["signEvent"]>,
    nip44: { encrypt: (pk, pt) => nip44.encrypt(pk, pt), decrypt: (pk, ct) => nip44.decrypt(pk, ct) },
  };
}

export function generateIdentity(now = Date.now()): StoredIdentity {
  const k = generateMatchKey();
  return { kind: "local", secret: k.secret, pubkey: k.pubkey, createdAt: now, imported: false };
}

/** Import an nsec (or 64-hex secret). Throws with a plain message on bad input. */
export async function importIdentity(text: string, now = Date.now()): Promise<StoredIdentity> {
  const secret = parseNsec(text);
  if (!secret) throw new Error("That isn't an nsec key. It starts with nsec1 and is 63 characters long.");
  const pubkey = await localSigner(secret).getPublicKey();
  return { kind: "local", secret, pubkey, createdAt: now, imported: true };
}

export async function useExtension(now = Date.now()): Promise<StoredIdentity> {
  const pubkey = await nip07Signer().getPublicKey();
  if (!HEX64.test(pubkey)) throw new Error("The extension returned an invalid public key");
  return { kind: "nip07", pubkey, createdAt: now };
}

export function signerFor(id: StoredIdentity): NostrSigner {
  return id.kind === "local" ? localSigner(id.secret) : nip07Signer();
}

/** Validate what the vault returned. */
export function loadIdentity(x: unknown): StoredIdentity | null {
  if (typeof x !== "object" || x === null) return null;
  const o = x as Record<string, unknown>;
  const createdAt = typeof o.createdAt === "number" ? o.createdAt : 0;
  if (o.kind === "local" && typeof o.secret === "string" && HEX64.test(o.secret) && typeof o.pubkey === "string" && HEX64.test(o.pubkey)) {
    return { kind: "local", secret: o.secret, pubkey: o.pubkey, createdAt, imported: o.imported === true };
  }
  if (o.kind === "nip07" && typeof o.pubkey === "string" && HEX64.test(o.pubkey)) return { kind: "nip07", pubkey: o.pubkey, createdAt };
  return null;
}
