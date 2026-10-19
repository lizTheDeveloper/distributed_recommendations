import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KeyConfig } from 'ohttp-ts';
import { KeyConfigError, SUITE, createInProcessGateway, fetchKeyConfig, ohttpClient, relayFetch, selectKeyConfig } from '../src/ohttp.ts';

const enc = new TextEncoder();

function echoTarget() {
  const seen: { url: string; method: string; headers: [string, string][]; body: string }[] = [];
  return {
    seen,
    async handle(req: Request): Promise<Response> {
      const body = await req.text();
      seen.push({ url: req.url, method: req.method, headers: Array.from(req.headers as unknown as Iterable<[string, string]>), body });
      return new Response(`echo:${body}`, { status: 201, headers: { 'content-type': 'text/plain', 'x-secret-header': 'drop-me' } });
    },
  };
}

test('encapsulation round trip: client → relay → gateway → target and back', async () => {
  const target = echoTarget();
  const gw = await createInProcessGateway({ target: (r) => target.handle(r), allowedAuthority: 'nostr-target.internal' });
  const forwarded: { path: string; bytes: number }[] = [];
  const fetch = relayFetch((r) => gw.handle(r), { onForward: (i) => forwarded.push(i) });

  const key = await fetchKeyConfig('https://relay.test/ohttp-keys', { fetch });
  assert.equal(key.pin, gw.pin, 'key fetched through the relay is the gateway key');
  const client = ohttpClient(key.config);
  const secret = 'the plaintext the relay must not see 0123456789abcdef';
  const { init, context } = await client.encapsulateRequest(
    new Request('https://nostr-target.internal/v1/exchange', { method: 'POST', headers: { 'content-type': 'application/json' }, body: secret }),
  );
  const outer = new Uint8Array(init.body as ArrayBuffer);
  assert.equal(outer[0], 1, 'RFC 9458 header: key id');
  assert.equal((outer[1] << 8) | outer[2], 0x0020, 'KEM DHKEM(X25519)');
  assert.equal((outer[3] << 8) | outer[4], 0x0001, 'KDF HKDF-SHA256');
  assert.equal((outer[5] << 8) | outer[6], 0x0001, 'AEAD AES-128-GCM');
  assert.ok(!Buffer.from(outer).includes(Buffer.from('plaintext')), 'ciphertext only');
  assert.ok(!Buffer.from(outer).includes(Buffer.from('nostr-target')), 'the target name is inside the encryption too');

  const res = await fetch('https://relay.test/gateway', init);
  assert.equal(res.status, 200, 'outer status is always 200; the real one is inside');
  assert.equal(res.headers.get('content-type'), 'message/ohttp-res');
  const inner = await context.decapsulateResponse(res);
  assert.equal(inner.status, 201);
  assert.equal(await inner.text(), `echo:${secret}`);
  assert.equal(inner.headers.get('x-secret-header'), null, 'gateway strips target headers');

  assert.equal(target.seen.length, 1);
  assert.equal(target.seen[0].url, 'https://nostr-target.internal/v1/exchange');
  assert.equal(target.seen[0].body, secret);
  assert.deepEqual(
    forwarded.map((f) => f.path),
    ['/ohttp-keys', '/gateway'],
  );
});

test('a response for one request cannot be opened with another request context', async () => {
  const target = echoTarget();
  const gw = await createInProcessGateway({ target: (r) => target.handle(r), allowedAuthority: 'nostr-target.internal' });
  const client = ohttpClient((await selectKeyConfig(gw.keys)).config);
  const mk = () => client.encapsulateRequest(new Request('https://nostr-target.internal/x', { method: 'POST', body: 'a' }));
  const a = await mk();
  const b = await mk();
  const resA = await gw.handle(new Request('http://gw/gateway', a.init));
  await assert.rejects(() => b.context.decapsulateResponse(resA));
});

test('tampered ciphertext and unknown key ids are refused by the gateway', async () => {
  const target = echoTarget();
  const gw = await createInProcessGateway({ target: (r) => target.handle(r), allowedAuthority: 'nostr-target.internal' });
  const client = ohttpClient((await selectKeyConfig(gw.keys)).config);
  const { init } = await client.encapsulateRequest(new Request('https://nostr-target.internal/x', { method: 'POST', body: 'hello' }));
  const body = new Uint8Array(init.body as ArrayBuffer);
  const flipped = body.slice();
  flipped[flipped.length - 1] ^= 1;
  let res = await gw.handle(new Request('http://gw/gateway', { method: 'POST', headers: { 'content-type': 'message/ohttp-req' }, body: flipped }));
  assert.equal(res.status, 400);
  const otherKey = body.slice();
  otherKey[0] = 9;
  res = await gw.handle(new Request('http://gw/gateway', { method: 'POST', headers: { 'content-type': 'message/ohttp-req' }, body: otherKey }));
  assert.equal(res.status, 400);
  assert.equal(target.seen.length, 0);
});

test('the gateway only forwards to the allow-listed target authority', async () => {
  const target = echoTarget();
  const gw = await createInProcessGateway({ target: (r) => target.handle(r), allowedAuthority: 'nostr-target.internal' });
  const client = ohttpClient((await selectKeyConfig(gw.keys)).config);
  const { init, context } = await client.encapsulateRequest(new Request('https://169.254.169.254/latest/meta-data', { method: 'GET' }));
  const inner = await context.decapsulateResponse(await gw.handle(new Request('http://gw/gateway', init)));
  assert.equal(inner.status, 403);
  assert.equal(target.seen.length, 0);
});

test('key pinning: TOFU returns the pin, a matching pin passes, any other key is refused', async () => {
  const seedA = new Uint8Array(32).fill(1);
  const seedB = new Uint8Array(32).fill(2);
  const t = echoTarget();
  const gwA = await createInProcessGateway({ target: (r) => t.handle(r), allowedAuthority: 'x', seed: seedA });
  const gwA2 = await createInProcessGateway({ target: (r) => t.handle(r), allowedAuthority: 'x', seed: seedA });
  const gwB = await createInProcessGateway({ target: (r) => t.handle(r), allowedAuthority: 'x', seed: seedB });
  assert.equal(gwA.pin, gwA2.pin, 'same seed, same key (SEED_SECRET_KEY semantics)');
  assert.notEqual(gwA.pin, gwB.pin);

  const tofu = await selectKeyConfig(gwA.keys);
  assert.equal(tofu.pin, gwA.pin);
  assert.equal((await selectKeyConfig(gwA.keys, [gwA.pin])).pin, gwA.pin);
  await assert.rejects(() => selectKeyConfig(gwB.keys, [gwA.pin]), KeyConfigError);
  // A rotation ships both pins in the app before the gateway switches.
  assert.equal((await selectKeyConfig(gwB.keys, [gwA.pin, gwB.pin])).pin, gwB.pin);
});

test('key configs: a list with an unsupported KEM is skipped, a bare config parses, junk is refused', async () => {
  const good = await KeyConfig.generate(SUITE, 7);
  const goodBytes = KeyConfig.serialize(good);
  // A config for KEM 0x0011 (P-384), which our suite can't use, listed first.
  const fake = new Uint8Array([3, 0x00, 0x11, ...new Uint8Array(97).fill(4), 0x00, 0x04, 0x00, 0x02, 0x00, 0x02]);
  const list = new Uint8Array(2 + fake.length + 2 + goodBytes.length);
  new DataView(list.buffer).setUint16(0, fake.length);
  list.set(fake, 2);
  new DataView(list.buffer).setUint16(2 + fake.length, goodBytes.length);
  list.set(goodBytes, 4 + fake.length);
  const picked = await selectKeyConfig(list);
  assert.equal(picked.config.keyId, 7);
  assert.equal((await selectKeyConfig(goodBytes)).config.keyId, 7);
  await assert.rejects(() => selectKeyConfig(enc.encode('<html>captive portal</html>')), KeyConfigError);
});
