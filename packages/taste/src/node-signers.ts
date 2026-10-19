// Node signers (they pull in nostr-tools through packages/bridge): a local key and
// a NIP-46 remote signer, chosen from the environment like the bridge CLI. Keys
// come from the environment only, never from argv.
//
//   NOSTR_BUNKER_URL=bunker://<pubkey>?relay=wss://…   creator's key via NIP-46 (preferred)
//   NOSTR_BUNKER_CLIENT_KEY=<hex|nsec>                  optional NIP-46 session key
//   NOSTR_SECRET_KEY=<hex|nsec>                         creator's own key

import {
  bunkerSigner,
  ephemeralSigner,
  parseSecretKey,
  secretKeySigner,
  verifySignedEvent,
} from '../../bridge/src/nostr-signer.ts';
import type { ClosableSigner } from '../../bridge/src/nostr-signer.ts';
import type { Signer } from '../../bridge/src/event.ts';

export { bunkerSigner, ephemeralSigner, parseSecretKey, secretKeySigner, verifySignedEvent };
export type { ClosableSigner };

export type EnvSignerMode = 'bunker' | 'key';

/**
 * A signer from the environment: `mode` 'bunker' needs NOSTR_BUNKER_URL, 'key'
 * needs NOSTR_SECRET_KEY. Without `mode`, a bunker URL wins over a key. Returns
 * null when nothing is configured. Call `close()` when done (a no-op for keys).
 */
export async function signerFromEnv(
  env: Record<string, string | undefined> = process.env,
  opts: { mode?: EnvSignerMode; onauth?: (url: string) => void; timeoutMs?: number } = {},
): Promise<ClosableSigner | null> {
  const mode = opts.mode ?? (env.NOSTR_BUNKER_URL ? 'bunker' : env.NOSTR_SECRET_KEY ? 'key' : undefined);
  if (mode === 'bunker') {
    if (!env.NOSTR_BUNKER_URL) throw new Error('NOSTR_BUNKER_URL is not set');
    const ck = env.NOSTR_BUNKER_CLIENT_KEY;
    return bunkerSigner(env.NOSTR_BUNKER_URL, { clientSecretKey: ck ? parseSecretKey(ck) : undefined, onauth: opts.onauth, timeoutMs: opts.timeoutMs });
  }
  if (mode === 'key') {
    if (!env.NOSTR_SECRET_KEY) throw new Error('NOSTR_SECRET_KEY is not set');
    const s: Signer = secretKeySigner(parseSecretKey(env.NOSTR_SECRET_KEY));
    return { ...s, close: async () => {} };
  }
  return null;
}
