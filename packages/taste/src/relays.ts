// Relay access for publishing picks, over packages/bridge's NIP-01 client (WHATWG
// WebSocket; NIP-42 AUTH; retries). Only relays the caller passes are contacted.

import { publish, query } from '../../bridge/src/relay.ts';
import type { PublishResult, RelayOptions } from '../../bridge/src/relay.ts';
import type { SignedEvent } from '../../bridge/src/types.ts';
import type { QueryFn } from './peertube.ts';

export type { PublishResult, RelayOptions };

/**
 * Query several relays with one filter and merge the answers (deduplicated by id).
 * A relay that fails is skipped; `onError` hears about it. All relays failing is an error.
 */
export function relaysQuery(urls: readonly string[], opts: RelayOptions & { onError?: (relay: string, err: unknown) => void } = {}): QueryFn {
  if (!urls.length) throw new Error('no relays given');
  return async (filter) => {
    const byId = new Map<string, SignedEvent>();
    let failures = 0;
    await Promise.all(
      urls.map(async (u) => {
        try {
          for (const e of await query(u, filter, opts)) if (e && typeof e.id === 'string') byId.set(e.id, e);
        } catch (err) {
          failures++;
          opts.onError?.(u, err);
        }
      }),
    );
    if (failures === urls.length) throw new Error(`all ${urls.length} relays failed`);
    return [...byId.values()];
  };
}

export type PublishFn = (relays: string[], event: SignedEvent) => Promise<PublishResult[]>;

/** The bridge's publisher (retries, NIP-42 AUTH with `authSigner`). */
export function relayPublisher(opts: RelayOptions = {}): PublishFn {
  return (relays, event) => publish(relays, event, opts);
}
