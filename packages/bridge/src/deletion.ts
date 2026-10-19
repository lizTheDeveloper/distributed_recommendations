// NIP-09 deletion requests for events this bridge published earlier.
//
// NIP-09 (fetched 2026-10-19): kind 5 with one or more `e` or `a` tags, each
// referencing an event the author requests to be deleted; it SHOULD include a
// `k` tag for the kind of each referenced event; `content` MAY carry a reason.
// For an `a` tag relays SHOULD delete all versions of the addressable event up
// to the deletion request's created_at, so a video that becomes public again
// later must be re-published with a newer created_at (sync does this).
// Only the same pubkey can delete, so the request must be signed by the key
// that signed the video event.

import { PT_PRIVACY_PUBLIC } from './types.ts';
import type { EventTemplate, PtVideo } from './types.ts';

export const KIND_DELETION = 5;

export interface DeletionTarget {
  kind: number;
  pubkey: string;
  /** Id of the published version (an `e` tag). */
  eventId?: string;
  /** `kind:pubkey:d` for addressable events (an `a` tag). */
  address?: string;
}

export function toDeletionRequest(target: DeletionTarget, reason: string, createdAt = Math.floor(Date.now() / 1000)): EventTemplate {
  const tags: string[][] = [];
  if (target.eventId) tags.push(['e', target.eventId]);
  if (target.address) {
    const [k, pk] = target.address.split(':');
    if (k !== String(target.kind) || pk !== target.pubkey) throw new Error('address does not match kind/pubkey');
    tags.push(['a', target.address]);
  }
  if (tags.length === 0) throw new Error('deletion request needs an event id or an address');
  tags.push(['k', String(target.kind)]);
  return { kind: KIND_DELETION, created_at: createdAt, tags, content: reason };
}

export type GoneReason = 'removed' | 'not-public' | 'blocked';

/**
 * Decide whether a previously bridged video should be withdrawn. Returns a
 * reason only for the states the task covers: removed (404/410, or 401/403 for
 * private/internal videos), not public (unlisted, private, internal, password)
 * and blocked by the instance. Transient states (transcoding, no files yet)
 * and still-public videos return undefined: the event stays.
 */
export function goneReason(video: PtVideo | undefined, httpStatus?: number): { reason: GoneReason; text: string } | undefined {
  if (httpStatus === 404 || httpStatus === 410) return { reason: 'removed', text: 'The PeerTube video was removed.' };
  if (httpStatus === 401 || httpStatus === 403) return { reason: 'not-public', text: 'The PeerTube video is no longer public.' };
  if (!video) return undefined;
  if (video.blacklisted) return { reason: 'blocked', text: 'The PeerTube instance blocked this video.' };
  if (video.privacy?.id !== PT_PRIVACY_PUBLIC) return { reason: 'not-public', text: 'The PeerTube video is no longer public.' };
  return undefined;
}
