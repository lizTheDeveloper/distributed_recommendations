// Docker e2e: two Match clients through a real OHTTP relay (Caddy, infra/ohttp/relay)
// → Cloudflare privacy-gateway-server (infra/ohttp/gateway) → the Nostr target →
// strfry (infra/relay). Started by infra/ohttp/e2e/run.sh, which sets
// OHTTP_E2E_RELAY_URL; skipped otherwise.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OhttpRelay } from '../src/ohttpRelay.ts';
import { fetchKeyConfig } from '../src/ohttp.ts';
import { randomPubkey, wrapLike } from './helpers.ts';
import { twoUsersExchange } from './scenario.ts';

const RELAY = process.env.OHTTP_E2E_RELAY_URL;
const skip = RELAY ? false : 'set OHTTP_E2E_RELAY_URL (infra/ohttp/e2e/run.sh)';

test('the gateway key config comes through the relay and pins', { skip }, async () => {
  const keysUrl = new URL('/ohttp-keys', RELAY!).toString();
  const a = await fetchKeyConfig(keysUrl);
  const b = await fetchKeyConfig(keysUrl, { pins: [a.pin] });
  assert.equal(a.pin, b.pin);
  assert.equal(a.config.kemId, 0x0020, 'X25519 picked out of the gateway list');
});

test('two match clients over relay → Cloudflare gateway → target → strfry', { skip }, async () => {
  const pin = (await fetchKeyConfig(new URL('/ohttp-keys', RELAY!).toString())).pin;
  const sizes: number[] = [];
  const mk = () => new OhttpRelay({ relayUrl: RELAY!, pins: [pin], batchDelayMs: { min: 5, max: 50 }, onRequest: (i) => sizes.push(i.requestBytes) });
  const alice = mk();
  const bob = mk();
  try {
    await twoUsersExchange(alice, bob);
    assert.ok(sizes.length > 10);
    assert.ok(sizes.every((n) => [4_096, 40_960, 81_920].includes(n)));
  } finally {
    alice.close();
    bob.close();
  }
});

test('the gateway refuses any target but the Nostr target', { skip }, async () => {
  const t = new OhttpRelay({ relayUrl: RELAY!, targetOrigin: 'https://example.com', batchDelayMs: { min: 1, max: 5 } });
  try {
    const r = await t.publish(wrapLike(randomPubkey()));
    assert.equal(r.ok, false);
    assert.match(r.message, /refused|HTTP 403/);
  } finally {
    t.close();
  }
});
