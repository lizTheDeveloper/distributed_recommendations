// Two Match clients exchange messages end to end over Oblivious HTTP, in process:
// MatchClient → OhttpRelay → stand-in OHTTP relay → in-process gateway (ohttp-ts)
// → Nostr target → WsUpstream → a NIP-01 relay over real WebSockets.
// The Docker version of this (Caddy relay → Cloudflare gateway → strfry) is
// e2e-docker.test.ts.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OhttpRelay } from '../src/ohttpRelay.ts';
import { startStack } from './helpers.ts';
import { twoUsersExchange } from './scenario.ts';

test('two match clients: request, PSI preview, accept, sketches, revoke — all over OHTTP', async () => {
  const s = await startStack({ relays: 2 });
  const sizes: number[] = [];
  const opts = { relayUrl: s.relayUrl, fetch: s.fetch, pins: [s.gateway.pin], batchDelayMs: { min: 1, max: 10 }, onRequest: (i: { requestBytes: number }) => sizes.push(i.requestBytes) };
  const alice = new OhttpRelay(opts);
  const bob = new OhttpRelay(opts);
  try {
    await twoUsersExchange(alice, bob);
    // Both upstream relays hold the same wraps; what they hold is only gift wraps.
    const [r1, r2] = s.relays;
    assert.ok(r1.store.log.length >= 9, `${r1.store.log.length} wraps`);
    assert.deepEqual(
      r1.store.log.map((e) => e.id).sort(),
      r2.store.log.map((e) => e.id).sort(),
    );
    assert.ok(r1.store.log.every((e) => e.kind === 1059));
    // The OHTTP relay only ever saw bucket-sized requests.
    assert.ok(sizes.every((n) => [4_096, 40_960, 81_920].includes(n)), sizes.join(','));
    assert.ok(s.forwarded.every((f) => f.path === '/gateway' || f.path === '/ohttp-keys'));
  } finally {
    alice.close();
    bob.close();
    await s.close();
  }
});
