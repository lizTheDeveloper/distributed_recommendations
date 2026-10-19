// Test fixtures: real PeerTube API objects from packages/bridge/test/fixtures,
// bridged to signed NIP-71 events with the bridge's own mapping, and fixed keys.

import { readFileSync } from 'node:fs';
import { toVideoEvent } from '../../bridge/src/mapping.ts';
import type { ToVideoEventOptions } from '../../bridge/src/mapping.ts';
import { signWith } from '../../bridge/src/event.ts';
import type { PtVideo, SignedEvent } from '../../bridge/src/types.ts';
import { secretKeySigner, verifySignedEvent } from '../src/node-signers.ts';
import type { Signer } from '../src/signers.ts';

export const fx = (name: string): PtVideo =>
  JSON.parse(readFileSync(new URL(`../../bridge/test/fixtures/${name}`, import.meta.url), 'utf8'));

export const skBytes = (n: number) => Uint8Array.from((n.toString(16).padStart(64, '0').match(/../g) ?? []).map((h) => parseInt(h, 16)));

/** Fixed keys: the creator who curates, a bridge (instance) key, and a stranger. */
export const curator: Signer = secretKeySigner(skBytes(0xc0ffee));
export const bridge: Signer = secretKeySigner(skBytes(0xb21d6e));
export const stranger: Signer = secretKeySigner(skBytes(0x5742));

export const LANDSCAPE = 'framatube-landscape.video.json';
export const PORTRAIT = 'tchncs-portrait-short.video.json';
export const CHAPTERED = 'framatube-chaptered.video.json';
export const MIRRORED_PORTRAIT = 'framatube-mirrored-portrait.video.json';
export const FIXTURES = [LANDSCAPE, PORTRAIT, CHAPTERED, MIRRORED_PORTRAIT];

/** A fixture bridged and signed the way `match-feed-bridge sync` would. */
export async function bridged(name: string, signer: Signer = bridge, opts: ToVideoEventOptions = {}): Promise<SignedEvent> {
  const t = toVideoEvent(fx(name), { createdAt: 1792000000, ...opts });
  return signWith(signer, t, { verify: verifySignedEvent });
}

export const NOW_S = 1792411200; // 2026-10-19T12:00:00Z (approx.)
