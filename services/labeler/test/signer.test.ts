import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AbstractSimplePool } from 'nostr-tools/abstract-pool';
import { defaultPolicy, fetchLabels, moderateVideo, relayQuery, verifyNostrEvent } from '../../../packages/moderation/src/index.ts';
import { LabelerStore } from '../src/repo.ts';
import { createSigner, envSecret } from '../src/signer.ts';
import { issueLabel } from '../src/labeling.ts';
import { parseTargetSpec } from '../src/targets.ts';
import { FakeBunker, LABELER, MemoryRelays, NOW, RELAY, VIDEO_URL, keypair, tmp } from './helpers.ts';

const asPool = (b: FakeBunker) => b as unknown as AbstractSimplePool;

test('every nostr-tools in play is exactly 2.25.2 (labeler, moderation, bridge)', () => {
  for (const rel of ['../node_modules', '../../../packages/moderation/node_modules', '../../../packages/bridge/node_modules']) {
    const pkg = JSON.parse(readFileSync(new URL(`${rel}/nostr-tools/package.json`, import.meta.url), 'utf8'));
    assert.equal(pkg.version, '2.25.2', rel);
  }
  const own = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(own.dependencies['nostr-tools'], '2.25.2');
  assert.match(readFileSync(new URL('../.npmrc', import.meta.url), 'utf8'), /ignore-scripts=true/);
});

test('key mode: from LABELER_SECRET_KEY or LABELER_SECRET_KEY_FILE; never both; must be the labeler key', async () => {
  const s = await createSigner('key', { env: { LABELER_SECRET_KEY: LABELER.hex }, expectedPubkey: LABELER.pk });
  assert.equal(await s.getPublicKey(), LABELER.pk);
  const file = join(tmp(), 'sk');
  writeFileSync(file, `${LABELER.hex}\n`, { mode: 0o600 });
  const f = await createSigner('key', { env: { LABELER_SECRET_KEY_FILE: file }, expectedPubkey: LABELER.pk });
  assert.equal(await f.getPublicKey(), LABELER.pk);
  assert.throws(() => envSecret({ LABELER_SECRET_KEY: 'a', LABELER_SECRET_KEY_FILE: file }, 'LABELER_SECRET_KEY'), /not both/);
  await assert.rejects(createSigner('key', { env: {}, expectedPubkey: LABELER.pk }), /LABELER_SECRET_KEY/);
  await assert.rejects(createSigner('key', { env: { LABELER_SECRET_KEY: keypair(3).hex }, expectedPubkey: LABELER.pk }), /not the configured labeler/);
  await assert.rejects(createSigner('nope' as 'key', { env: {}, expectedPubkey: LABELER.pk }), /unknown signer mode/);
});

test('bunker mode (NIP-46, the bridge\'s signer): labels are signed by the remote key and the app honours them', async () => {
  const b = new FakeBunker(keypair(0xb0), LABELER);
  const signer = await createSigner('bunker', { env: { LABELER_BUNKER_URL: b.url() }, expectedPubkey: LABELER.pk, bunker: { pool: asPool(b), timeoutMs: 2000 } });
  assert.notEqual(b.remotePubkey, LABELER.pk);
  const net = new MemoryRelays();
  const store = await LabelerStore.memory();
  const rec = await issueLabel(
    { store, labeler: LABELER.pk, signer, relays: [RELAY], relayOptions: { WebSocket: net.ctor(), timeoutMs: 1000, retries: 0 }, now: () => NOW },
    { targets: [parseTargetSpec(`video:${VIDEO_URL}`)], values: ['malware'], reason: 'Links to a credential stealer', reviewer: 'alice' },
  );
  assert.equal(rec.event.pubkey, LABELER.pk);
  assert.deepEqual(b.methods, ['connect', 'get_public_key', 'sign_event']);
  const labels = await fetchLabels({ labelers: [LABELER.pk], relays: [RELAY], query: relayQuery({ WebSocket: net.ctor() }), verify: verifyNostrEvent, now: NOW });
  const p = defaultPolicy();
  p.settings.labelers = [{ pubkey: LABELER.pk }];
  assert.equal(moderateVideo({ id: VIDEO_URL, title: 't', creator: 'a@tube.example', durationSec: 1, publishedAt: new Date(0), tags: [] }, p, { labels }).action, 'hide');
  await signer.close();
});

test('bunker mode refuses a bunker that holds a different key, a wrong secret, or no URL', async () => {
  const other = new FakeBunker(keypair(0xb1), keypair(0xb2));
  await assert.rejects(createSigner('bunker', { env: { LABELER_BUNKER_URL: other.url() }, expectedPubkey: LABELER.pk, bunker: { pool: asPool(other), timeoutMs: 2000 } }), /not the configured labeler/);
  const wrong = new FakeBunker(keypair(0xb3), LABELER, 'right');
  await assert.rejects(
    createSigner('bunker', { env: { LABELER_BUNKER_URL: wrong.url().replace('secret=right', 'secret=bad') }, expectedPubkey: LABELER.pk, bunker: { pool: asPool(wrong), timeoutMs: 2000 } }),
    /invalid secret/,
  );
  await assert.rejects(createSigner('bunker', { env: {}, expectedPubkey: LABELER.pk }), /LABELER_BUNKER_URL/);
  await assert.rejects(createSigner('bunker', { env: { LABELER_BUNKER_URL: 'alice@example.com' }, expectedPubkey: LABELER.pk }), /bunker:\/\//);
});

// ---------------------------------------------------------------- CLI (offline paths only)

function cli(args: string[], env: Record<string, string> = {}) {
  const path = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
  const { LABELER_SECRET_KEY: _a, LABELER_BUNKER_URL: _b, LABELER_REVIEWER: _c, LABELER_CONFIG: _d, ...rest } = process.env;
  return spawnSync(process.execPath, ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', path, ...args], { env: { ...rest, ...env }, encoding: 'utf8', timeout: 20_000 });
}

function cliConfig(): string {
  const dir = tmp();
  const path = join(dir, 'labeler.config.json');
  // Relays point at a closed local port: the tests below must fail before any connection anyway.
  writeFileSync(path, JSON.stringify({ v: 1, labeler: LABELER.pk, publishRelays: ['ws://127.0.0.1:9'], intakeRelays: ['ws://127.0.0.1:9'], store: join(dir, 'db.sqlite'), reviewers: ['alice'] }));
  return path;
}

test('CLI: secrets on argv are refused; publishing needs --signer and the key in the environment', () => {
  const cfg = cliConfig();
  for (const flag of ['--nsec', '--secret-key', '--key', '--bunker', '--bunker-url']) {
    const r = cli(['label', '--config', cfg, flag, 'x']);
    assert.equal(r.status, 2, flag);
    assert.match(r.stderr, /never accepted on the command line/);
  }
  const base = ['label', '--config', cfg, '--target', `video:${VIDEO_URL}`, '--value', 'spam', '--reason', 'Link spam everywhere', '--reviewer', 'alice', '--publish'];
  let r = cli(base);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /needs --signer/);
  r = cli([...base, '--signer', 'key']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /LABELER_SECRET_KEY/);
  r = cli([...base, '--signer', 'key'], { LABELER_SECRET_KEY: keypair(4).hex });
  assert.match(r.stderr, /not the configured labeler/);
  r = cli([...base.slice(0, -3), '--reviewer', 'mallory']);
  assert.match(r.stderr, /not in config.reviewers/);
});

test('CLI: label is a dry run by default and records nothing; vocab and audit verify work offline', () => {
  const cfg = cliConfig();
  const r = cli(['label', '--config', cfg, '--target', `video:${VIDEO_URL}`, '--value', 'nudity,ai-generated', '--reason', 'Nudity without a warning', '--expires', '30d', '--reviewer', 'alice']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /DRY RUN/);
  const t = JSON.parse(r.stdout);
  assert.equal(t.kind, 1985);
  assert.deepEqual(t.tags.filter((x: string[]) => x[0] === 'l').map((x: string[]) => x[1]), ['nudity', 'ai-generated']);
  assert.ok(t.tags.some((x: string[]) => x[0] === 'expiration'));
  const v = cli(['audit', 'verify', '--config', cfg]);
  assert.equal(v.status, 0);
  assert.match(v.stdout, /intact \(0 entries\)/);
  const vocab = cli(['vocab']);
  assert.match(vocab.stdout, /undisclosed-sponsorship/);
  const bad = cli(['label', '--config', cfg, '--target', `video:${VIDEO_URL}`, '--value', 'NS-nud', '--reason', 'x'.repeat(20), '--reviewer', 'alice']);
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /unknown label value/);
});
