// Signing, reusing packages/bridge's signer (THREAT_MODEL T23 approach):
//
//   bunker  NIP-46 remote signer (preferred): LABELER_BUNKER_URL=bunker://…,
//           optional LABELER_BUNKER_CLIENT_KEY for a stable client session
//   key     LABELER_SECRET_KEY (nsec1… or 64 hex)
//
// Each variable also has a `_FILE` form (Docker secrets). Secrets are never read
// from argv (cli.ts refuses them). The signer's pubkey must be the configured
// labeler pubkey, so a mix-up can't publish labels under another key.

import { readFileSync } from 'node:fs';
import { bunkerSigner, parseSecretKey, secretKeySigner } from './deps.ts';
import type { BunkerOptions, ClosableSigner, Signer } from './deps.ts';

export type SignerMode = 'bunker' | 'key';
export const SIGNER_MODES: readonly SignerMode[] = ['bunker', 'key'];

export type Env = Record<string, string | undefined>;

/** `NAME` or the contents of the file named by `NAME_FILE` (trimmed). */
export function envSecret(env: Env, name: string): string | undefined {
  const direct = env[name];
  const file = env[`${name}_FILE`];
  if (direct && file) throw new Error(`set ${name} or ${name}_FILE, not both`);
  if (file) return readFileSync(file, 'utf8').trim();
  return direct || undefined;
}

export interface CreateSignerOptions {
  /** Expected labeler pubkey (hex). Required: the check is the point. */
  expectedPubkey: string;
  env?: Env;
  /** For tests: the bunker's relay pool, timeouts, auth URL callback. */
  bunker?: Omit<BunkerOptions, 'clientSecretKey'>;
}

export async function createSigner(mode: SignerMode, opts: CreateSignerOptions): Promise<ClosableSigner> {
  const env = opts.env ?? process.env;
  let signer: ClosableSigner;
  if (mode === 'bunker') {
    const url = envSecret(env, 'LABELER_BUNKER_URL');
    if (!url) throw new Error('--signer bunker needs LABELER_BUNKER_URL (or LABELER_BUNKER_URL_FILE) in the environment');
    const ck = envSecret(env, 'LABELER_BUNKER_CLIENT_KEY');
    signer = await bunkerSigner(url, { ...opts.bunker, clientSecretKey: ck ? parseSecretKey(ck) : undefined });
  } else if (mode === 'key') {
    const sk = envSecret(env, 'LABELER_SECRET_KEY');
    if (!sk) throw new Error('--signer key needs LABELER_SECRET_KEY (or LABELER_SECRET_KEY_FILE) in the environment');
    const s: Signer = secretKeySigner(parseSecretKey(sk));
    signer = { ...s, getPublicKey: s.getPublicKey, signEvent: s.signEvent, close: async () => {} };
  } else {
    throw new Error(`unknown signer mode ${String(mode)}; use bunker or key`);
  }
  const pk = await signer.getPublicKey();
  if (pk !== opts.expectedPubkey) {
    await signer.close();
    throw new Error(`signer pubkey ${pk} is not the configured labeler ${opts.expectedPubkey}`);
  }
  return signer;
}
