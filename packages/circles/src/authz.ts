// App-level authorization checks around marmot-ts 0.5.1 (docs/CIRCLES.md §1,
// "Authorization gaps in 0.5.1 and the app-level guards").
//
// marmot-ts 0.7.0 fixes these inside the library. We stay on 0.5.1 until 0.7.0 has
// been out for two weeks, so CircleMember runs these checks itself:
//
//   1. Welcome author: the authenticated author of a Welcome (the NIP-59 seal signer,
//      which applesauce checks equals the rumor pubkey) must be a member AND an admin
//      of the group the Welcome joins. Otherwise the joined group is discarded.
//   2. Commit authorization against the PARENT state: 0.5.1 builds its admin-only
//      commit callback once per ingest batch, from the state before the batch, so a
//      second commit in the same batch is checked against a stale tree and admin list
//      (for example after an admin was demoted earlier in the batch). We re-check every
//      applied commit against the state it was applied to. A non-admin may only
//      self-update: same member set, same group-context extensions.
//   3. Identity binding: the Nostr key that signed an inner round event must be the
//      basic-credential identity of the MLS leaf that sent the application message.
//      A leaf whose credential claims someone else's pubkey cannot sign as them, so it
//      cannot take part in rounds (k counts round-key senders, all proven this way).
//   4. Kind-445 shape: exactly one tag, ["h", <group id>], and a valid signature.
//   5. Key packages: verified signature, author = the invitee, credential = author.
//
// These are checks, not fixes: a violation of (2) cannot be undone at the app layer,
// so the member halts the circle locally (fail closed) instead of following a state
// it cannot trust.

import { getCredentialPubkey, getGroupMembers, getKeyPackageNostrPubkey, getMarmotGroupData, isAdmin } from '@internet-privacy/marmot-ts';
import { verifyEvent } from 'nostr-tools/pure';
import type { ClientState } from 'ts-mls';
import { getCredentialFromLeafIndex } from 'ts-mls';
import type { NostrEventLike } from './network.ts';

export type AuthzResult = { ok: true } | { ok: false; reason: string };

const OK: AuthzResult = { ok: true };
const fail = (reason: string): AuthzResult => ({ ok: false, reason });

function fresh(e: NostrEventLike): NostrEventLike {
  // nostr-tools caches verdicts on the object (T25); always verify a copy.
  return {
    id: e.id,
    pubkey: e.pubkey,
    created_at: e.created_at,
    kind: e.kind,
    tags: Array.isArray(e.tags) ? e.tags.map((t) => [...t]) : [],
    content: e.content,
    sig: e.sig,
  };
}

/** Nostr pubkey of the basic credential at `leafIndex` in `state`'s tree, if any. */
export function leafPubkey(state: ClientState, leafIndex: number | bigint): string | undefined {
  try {
    return getCredentialPubkey(getCredentialFromLeafIndex(state.ratchetTree, Number(leafIndex) as never));
  } catch {
    return undefined;
  }
}

/** (1) The Welcome author must be an active admin (member + admin list) of the joined group. */
export function checkWelcomeAuthor(joined: ClientState, author: string): AuthzResult {
  const data = getMarmotGroupData(joined);
  if (!data) return fail('welcome: group has no Marmot group data');
  if (!getGroupMembers(joined).includes(author)) return fail('welcome: author is not a member of the group');
  if (!isAdmin(data, author)) return fail('welcome: author is not an admin of the group');
  return OK;
}

/** Structural equality over decoded MLS values (objects, arrays, Uint8Array, bigint). */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a instanceof Uint8Array || b instanceof Uint8Array) {
    if (!(a instanceof Uint8Array && b instanceof Uint8Array) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (!deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false;
  return true;
}

function sameExtensions(a: ClientState, b: ClientState): boolean {
  return deepEqual(a.groupContext.extensions, b.groupContext.extensions);
}

/**
 * (2) Was the commit that turned `parent` into `child` allowed, given its sender?
 * Admins (per the parent's admin list) may commit anything. Anyone else may only
 * self-update: the member set and the group-context extensions must not change.
 */
export function checkCommitAuthorized(parent: ClientState, child: ClientState, senderLeafIndex: number | bigint | undefined): AuthzResult {
  if (senderLeafIndex === undefined) return fail('commit: no member sender');
  const sender = leafPubkey(parent, senderLeafIndex);
  if (!sender) return fail('commit: sender leaf has no valid credential in the parent state');
  const data = getMarmotGroupData(parent);
  if (!data) return fail('commit: parent state has no Marmot group data');
  if (isAdmin(data, sender)) return OK;
  const before = getGroupMembers(parent).sort().join(',');
  const after = getGroupMembers(child).sort().join(',');
  if (before !== after) return fail(`commit: non-admin ${sender.slice(0, 12)}… changed the member set`);
  if (!sameExtensions(parent, child)) return fail(`commit: non-admin ${sender.slice(0, 12)}… changed the group context`);
  return OK;
}

/**
 * (3) The inner round event's signer must be the MLS sender's credential identity.
 * `state` is the state the message was decrypted under; for a message from an older
 * epoch the tree of that epoch is used when ts-mls still holds it.
 */
export function checkSenderBinding(state: ClientState, messageEpoch: bigint, senderLeafIndex: number | bigint | undefined, signer: string): AuthzResult {
  if (senderLeafIndex === undefined) return fail('application message: no member sender');
  let tree: ClientState = state;
  if (messageEpoch < state.groupContext.epoch) {
    const old = state.historicalReceiverData.get(messageEpoch);
    if (!old) return fail('application message: epoch no longer held');
    tree = { ...state, ratchetTree: old.ratchetTree };
  }
  const mls = leafPubkey(tree, senderLeafIndex);
  if (!mls) return fail('application message: sender leaf has no valid credential');
  if (mls !== signer) return fail('application message: inner signer is not the MLS sender');
  return OK;
}

/** (4) Kind-445 shape: one `h` tag for this group, nothing else, and a valid signature. */
export function checkGroupEvent(event: NostrEventLike, nostrGroupIdHex: string): AuthzResult {
  if (event.kind !== 445) return fail('group event: wrong kind');
  if (!Array.isArray(event.tags) || event.tags.length !== 1) return fail('group event: must carry exactly one tag');
  const [t] = event.tags;
  if (!Array.isArray(t) || t.length !== 2 || t[0] !== 'h' || t[1] !== nostrGroupIdHex) return fail('group event: tag must be ["h", group id]');
  if (!verifyEvent(fresh(event))) return fail('group event: bad signature');
  return OK;
}

/** (5) A key package event used for an invite: verified, by the invitee, credential = author. */
export function checkKeyPackageEvent(event: NostrEventLike, invitee: string): AuthzResult {
  if (event.kind !== 30443 && event.kind !== 443) return fail('key package: wrong kind');
  if (event.pubkey !== invitee) return fail('key package: not authored by the invitee');
  if (!verifyEvent(fresh(event))) return fail('key package: bad signature');
  let identity: string;
  try {
    identity = getKeyPackageNostrPubkey(event as never);
  } catch (e) {
    return fail(`key package: ${(e as Error).message}`);
  }
  if (identity !== event.pubkey) return fail('key package: credential identity is not the author');
  return OK;
}
