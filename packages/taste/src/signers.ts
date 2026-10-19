// Browser-safe signer helpers. The Signer interface is packages/bridge's: the
// shape of NIP-07 `window.nostr`, so an extension, a NIP-46 bunker or a local key
// all fit. Node-only signers (env key, bunker) are in node-signers.ts.

import type { Signer } from '../../bridge/src/event.ts';
import type { EventTemplate, SignedEvent } from '../../bridge/src/types.ts';

export type { Signer };

interface Nip07 {
  getPublicKey(): Promise<string>;
  signEvent(e: EventTemplate): Promise<SignedEvent>;
}

/**
 * The NIP-07 extension (`window.nostr`) as a Signer. Throws when there is none.
 * Pass the object explicitly in tests. `signCurationSet` checks what it returns.
 */
export function nip07Signer(nostr: unknown = (globalThis as { nostr?: unknown }).nostr): Signer {
  const n = nostr as Partial<Nip07> | undefined;
  if (!n || typeof n.getPublicKey !== 'function' || typeof n.signEvent !== 'function') {
    throw new Error('no NIP-07 signer (window.nostr) available');
  }
  return {
    getPublicKey: () => n.getPublicKey!.call(n),
    signEvent: (t) => n.signEvent!.call(n, t),
  };
}
