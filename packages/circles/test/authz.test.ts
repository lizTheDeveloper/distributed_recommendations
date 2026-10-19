// Supply-chain regression (the ts-mls override), the app-level authorization guards
// around marmot-ts 0.5.1 (src/authz.ts) and fixed-size padding of round messages
// (src/padding.ts), over real MLS and the in-memory relay. Never touches the network.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Proposals, createGroupEvent, getGroupMembers, getNostrGroupIdHex, getPubkeyLeafNodeIndexes } from '@internet-privacy/marmot-ts';
import { finalizeEvent, generateSecretKey, getEventHash } from 'nostr-tools/pure';
import * as nip59 from 'nostr-tools/nip59';
import type { ClientState } from 'ts-mls';
import { createCommit } from 'ts-mls';
import { checkCommitAuthorized, checkKeyPackageEvent, checkSenderBinding } from '../src/authz.ts';
import { CircleMember } from '../src/client.ts';
import { DEFAULT_CIRCLE_POLICY } from '../src/core.ts';
import { CIRCLE_KINDS } from '../src/kinds.ts';
import { MAX_CANDIDATES, MAX_OPEN_BYTES, encodeRoundKey, encodeRoundOpen } from '../src/messages.ts';
import { InMemoryNostrNetwork, MAX_EVENT_BYTES } from '../src/network.ts';
import { PAD_BUCKETS, PaddingError, bucketFor, padRumor, serializedLength, unpadContent } from '../src/padding.ts';
import { T0, hexId, localIdentity, testClock } from './helpers.ts';

const here = dirname(fileURLToPath(import.meta.url));
const pkgDir = join(here, '..');

/**
 * ts-mls versions known to put an UpdatePath on a commit with a single Remove
 * (docs/CIRCLES.md §1). marmot-ts 0.5.1's own pin, 2.0.0-rc.10, is NOT one of them.
 * Add a version here only after checking its clientState.js / createCommit path rule.
 */
const FIXED_TS_MLS = new Set(['2.0.0-rc.16']);

test('supply chain: ts-mls is overridden to a fixed version, for us AND for marmot-ts', () => {
  const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
  assert.ok(FIXED_TS_MLS.has(pkg.overrides?.['ts-mls']), 'package.json overrides.ts-mls must pin a fixed ts-mls (security fix)');
  assert.ok(FIXED_TS_MLS.has(pkg.dependencies['ts-mls']));
  const lock = JSON.parse(readFileSync(join(pkgDir, 'package-lock.json'), 'utf8'));
  for (const [path, entry] of Object.entries(lock.packages as Record<string, { version?: string }>)) {
    if (path.endsWith('node_modules/ts-mls')) assert.ok(FIXED_TS_MLS.has(entry.version!), `lockfile ${path} = ${entry.version}`);
  }
  // What Node actually resolves, from our package and from inside marmot-ts.
  const ours = createRequire(join(pkgDir, 'package.json'));
  const marmotPkg = ours.resolve('@internet-privacy/marmot-ts/package.json');
  const fromMarmot = createRequire(marmotPkg);
  for (const req of [ours, fromMarmot]) {
    let dir = dirname(req.resolve('ts-mls'));
    while (!readdirHasPkg(dir)) dir = dirname(dir);
    const v = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).version;
    assert.ok(FIXED_TS_MLS.has(v), `resolved ts-mls ${v} at ${dir}`);
  }
});

function readdirHasPkg(dir: string): boolean {
  try {
    return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).name === 'ts-mls';
  } catch {
    return false;
  }
}

// ---- A small circle: admin, bob (co-admin), dave; carol joins later ----

const clock = testClock(T0);
const network = new InMemoryNostrNetwork({ now: clock.now });
const ids = {
  admin: localIdentity(),
  bob: localIdentity(),
  carol: localIdentity(),
  dave: localIdentity(),
  mallory: localIdentity(),
};
let admin: CircleMember;
let bob: CircleMember;
let carol: CircleMember;
let dave: CircleMember;

const marmotAuth = { validateCredential: async () => true };

before(async () => {
  const make = (k: keyof typeof ids) => CircleMember.create({ signer: ids[k].signer, network, now: clock.now });
  [admin, bob, carol, dave] = await Promise.all([make('admin'), make('bob'), make('carol'), make('dave')]);
  for (const m of [bob, carol, dave]) await m.publishKeyPackage();
  await admin.createCircle('Authz club', { admins: [bob.identity] });
  await admin.invite(bob.identity);
  await admin.invite(dave.identity);
  await bob.acceptInvite();
  await dave.acceptInvite();
  for (const m of [admin, bob, dave]) await m.sync();
});

test('regression: under the overridden ts-mls, a commit removing ONE member carries an UpdatePath', async () => {
  const g = admin.group!;
  const remove = await Proposals.proposeRemoveUser(dave.identity)({ state: g.state, ciphersuite: g.ciphersuite, groupData: g.groupData! });
  // Public wire format so the framed commit is inspectable; nothing is published.
  const { commit } = await createCommit({
    context: { cipherSuite: g.ciphersuite, authService: marmotAuth as never, externalPsks: {} },
    state: g.state,
    extraProposals: remove as never,
    wireAsPublicMessage: true,
  });
  const content = (commit as unknown as { publicMessage: { content: { commit: { proposals: unknown[]; path?: unknown } } } }).publicMessage.content;
  assert.equal(content.commit.proposals.length, 1, 'exactly one Remove');
  assert.ok(content.commit.path, 'RFC 9420 §12.4: a Remove needs a path (ts-mls 2.0.0-rc.10 omitted it; removed members could read the next epoch)');
});

test('key packages: only verified events by the invitee whose credential is the author', async () => {
  const [kp] = await network.request(network.relays, { kinds: [30443], authors: [carol.identity] });
  assert.ok(checkKeyPackageEvent(kp, carol.identity).ok);
  assert.match((checkKeyPackageEvent(kp, dave.identity) as { reason: string }).reason, /not authored by the invitee/);
  assert.match((checkKeyPackageEvent({ ...kp, content: kp.content.slice(0, -4) + 'AAAA' }, carol.identity) as { reason: string }).reason, /bad signature/);
});

test('welcome author: a re-wrapped Welcome from a non-admin member or a stranger is refused; the admin\'s is accepted', async () => {
  await admin.invite(carol.identity);
  const [genuine] = await network.request(network.relays, { kinds: [1059], '#p': [carol.identity] });
  const rumor = nip59.unwrapEvent(genuine as never, ids.carol.sk);
  assert.equal(rumor.pubkey, admin.identity);
  // Same MLS Welcome, re-sent under other authors (newer, so carol tries them first).
  for (const [who, sk] of [['dave', ids.dave.sk], ['mallory', ids.mallory.sk]] as const) {
    const wrap = nip59.wrapEvent({ kind: rumor.kind, content: rumor.content, tags: rumor.tags, created_at: rumor.created_at + (who === 'dave' ? 10 : 20) }, sk, carol.identity);
    const res = await network.publish(network.relays, wrap as never);
    assert.ok(Object.values(res)[0].ok, `${who}'s wrap accepted by the relay`);
  }
  const groupId = await carol.acceptInvite();
  assert.equal(groupId, admin.group!.idStr);
  const reasons = carol.rejections.filter((r) => r.what === 'welcome').map((r) => r.reason);
  assert.deepEqual(reasons, ['welcome: author is not a member of the group', 'welcome: author is not an admin of the group']);
  for (const m of [admin, bob, carol, dave]) await m.sync();
  assert.equal(new Set([admin, bob, carol, dave].map((m) => m.epoch())).size, 1);
});

test('commit authorization against the parent state (pure check on real MLS states)', async () => {
  const leaf = (s: ClientState, who: CircleMember) => getPubkeyLeafNodeIndexes(s, who.identity)[0];
  // A non-admin self-update: allowed.
  const p1 = dave.group!.state;
  await dave.selfUpdate();
  const c1 = dave.group!.state;
  assert.ok(checkCommitAuthorized(p1, c1, leaf(p1, dave)).ok);
  // A membership change by an admin: allowed; the same transition from a non-admin: refused.
  const g = admin.group!;
  for (const m of [admin, bob, carol]) await m.sync();
  const remove = await Proposals.proposeRemoveUser(carol.identity)({ state: g.state, ciphersuite: g.ciphersuite, groupData: g.groupData! });
  const { newState } = await createCommit({
    context: { cipherSuite: g.ciphersuite, authService: marmotAuth as never, externalPsks: {} },
    state: g.state,
    extraProposals: remove as never,
  });
  assert.ok(checkCommitAuthorized(g.state, newState, leaf(g.state, admin)).ok);
  assert.match((checkCommitAuthorized(g.state, newState, leaf(g.state, dave)) as { reason: string }).reason, /changed the member set/);
  // A non-admin changing the group context (e.g. the admin list): refused.
  const tampered = { ...g.state, groupContext: { ...g.state.groupContext, extensions: g.state.groupContext.extensions.slice(1) } };
  assert.match((checkCommitAuthorized(g.state, tampered, leaf(g.state, dave)) as { reason: string }).reason, /changed the group context/);
  assert.match((checkCommitAuthorized(g.state, newState, undefined) as { reason: string }).reason, /no member sender/);
});

test('identity binding: the inner signer must be the MLS sender leaf\'s identity', () => {
  const s = admin.group!.state;
  const bobLeaf = getPubkeyLeafNodeIndexes(s, bob.identity)[0];
  assert.ok(checkSenderBinding(s, s.groupContext.epoch, bobLeaf, bob.identity).ok);
  assert.match((checkSenderBinding(s, s.groupContext.epoch, bobLeaf, dave.identity) as { reason: string }).reason, /not the MLS sender/);
});

test('kind-445 events with extra tags are dropped before decryption', async () => {
  const h = getNostrGroupIdHex(admin.group!.state);
  const ev = finalizeEvent({ kind: 445, created_at: Math.floor(clock.now().getTime() / 1000), tags: [['h', h], ['p', bob.identity]], content: 'AAAA' }, generateSecretKey());
  await network.publish(network.relays, ev as never);
  await admin.sync();
  assert.ok(admin.rejections.some((r) => r.what === 'group-event' && r.id === ev.id && /exactly one tag/.test(r.reason)));
  assert.equal(admin.halted, undefined);
});

test('padding: exact bucket sizes, strict receiver, and unpadded round messages are dropped', async () => {
  const base = { kind: CIRCLE_KINDS.roundKey, created_at: 1_792_411_200, tags: [] as string[][], content: '{"a":1}', pubkey: hexId(1) };
  for (const b of PAD_BUCKETS) {
    const r = padRumor(base, b, (x) => getEventHash(x));
    assert.equal(serializedLength(r), b);
    assert.equal(unpadContent(b, r.content), '{"a":1}');
  }
  assert.equal(bucketFor(100), PAD_BUCKETS[0]);
  assert.equal(bucketFor(100, PAD_BUCKETS[1]), PAD_BUCKETS[1]);
  assert.throws(() => bucketFor(PAD_BUCKETS.at(-1)! + 1), PaddingError);
  assert.throws(() => unpadContent(PAD_BUCKETS[0] + 1, '{}'), /unpadded/);
  assert.throws(() => unpadContent(PAD_BUCKETS[0], '{} x '), /padded JSON/);

  // A member who sends a correctly signed but UNPADDED round message: dropped.
  const created_at = Math.floor(clock.now().getTime() / 1000);
  const inner = await ids.bob.signer.signEvent({ kind: CIRCLE_KINDS.roundKey, created_at, tags: [], content: encodeRoundKey({ v: 1, roundId: hexId(7), epoch: bob.epoch(), roundKey: hexId(8) }) });
  const unsigned = { kind: CIRCLE_KINDS.roundKey, created_at, tags: [] as string[][], content: JSON.stringify(inner), pubkey: bob.identity };
  await bob.group!.sendApplicationRumor({ ...unsigned, id: getEventHash(unsigned) } as never);
  const seenBefore = admin.seen.length;
  await admin.sync();
  assert.equal(admin.seen.length, seenBefore);
  assert.ok(admin.rejections.some((r) => r.what === 'round-message' && /unpadded/.test(r.reason)));
});

test('padding: a maximal round-open fits the largest bucket, and every bucket gives one kind-445 size under 64 KiB', async (t) => {
  // 256 candidate ids sized so the encoded round-open is just under MAX_OPEN_BYTES.
  const fill = (n: number) => Array.from({ length: MAX_CANDIDATES }, (_, i) => `https://tube.example/w/${String(i).padStart(4, '0')}${'x'.repeat(n)}`);
  let n = 0;
  const open = (k: number): string | undefined => {
    try {
      return encodeRoundOpen({ v: 1, roundId: hexId(9), circleId: 'ab'.repeat(16), epoch: 1, openedAt: 1_792_411_200, keyDeadline: 1_792_414_800, maskDeadline: 1_792_418_400, policy: DEFAULT_CIRCLE_POLICY, candidates: fill(k) });
    } catch {
      return undefined; // over MAX_OPEN_BYTES
    }
  };
  while (open(n + 1) !== undefined) n++;
  const big = open(n)!;
  assert.ok(big.length > MAX_OPEN_BYTES - MAX_CANDIDATES);
  const created_at = Math.floor(clock.now().getTime() / 1000);
  const sizes = new Map<number, Set<number>>();
  for (const bucket of PAD_BUCKETS) {
    for (const [kind, content] of [
      [CIRCLE_KINDS.roundOpen, bucket === PAD_BUCKETS.at(-1) ? big : '{"v":1}'],
      [CIRCLE_KINDS.roundKey, '{"v":1}'],
      [CIRCLE_KINDS.roundMasked, `{"v":1,"vector":"${'A'.repeat(1400)}"}`],
    ] as const) {
      const inner = await ids.admin.signer.signEvent({ kind, created_at, tags: [], content });
      const unsigned = { kind, created_at, tags: [] as string[][], content: JSON.stringify(inner), pubkey: admin.identity };
      const rumor = padRumor(unsigned, bucket, (x) => getEventHash(x));
      const before = network.log.length;
      await admin.group!.sendApplicationRumor(rumor as never);
      assert.equal(network.log.length, before + 1, 'relay accepted the event');
      const size = new TextEncoder().encode(JSON.stringify(network.log.at(-1))).length;
      assert.ok(size < MAX_EVENT_BYTES, `bucket ${bucket}: ${size} bytes`);
      sizes.set(bucket, (sizes.get(bucket) ?? new Set()).add(size));
    }
  }
  t.diagnostic(`kind-445 bytes per bucket: ${[...sizes].map(([b, s]) => `${b}→${[...s]}`).join(', ')}; max round-open rumor ${serializedLength({ kind: 3480, created_at: created_at, tags: [], content: JSON.stringify(await ids.admin.signer.signEvent({ kind: 3480, created_at, tags: [], content: big })), pubkey: admin.identity, id: hexId(0) })} bytes`);
  for (const [bucket, s] of sizes) assert.equal(s.size, 1, `bucket ${bucket}: one event size for all message types (${[...s]})`);
});

test('parent-state commit check: an unauthorized commit that the library applies halts the member', async () => {
  for (const m of [admin, bob, carol, dave]) await m.sync();
  // Commit 1 (admin): bob is no longer an admin.
  await admin.setAdmins([admin.identity]);
  await bob.sync();
  // Commit 2 (bob, now NOT an admin), built directly with ts-mls to skip marmot-ts's
  // local "Not a group admin" check, as a malicious client would: remove dave.
  const g = bob.group!;
  const remove = await Proposals.proposeRemoveUser(dave.identity)({ state: g.state, ciphersuite: g.ciphersuite, groupData: g.groupData! });
  const { commit } = await createCommit({
    context: { cipherSuite: g.ciphersuite, authService: marmotAuth as never, externalPsks: {} },
    state: g.state,
    extraProposals: remove as never,
    ratchetTreeExtension: true,
  });
  await network.publish(network.relays, (await createGroupEvent({ message: commit, state: g.state, ciphersuite: g.ciphersuite })) as never);

  // The admin sees commit 2 alone: marmot-ts's own callback (fresh admin list) rejects it.
  await admin.sync();
  assert.equal(admin.halted, undefined);
  assert.ok(getGroupMembers(admin.group!.state).includes(dave.identity));

  // Carol's library check is switched off, standing in for a library that applies an
  // unauthorized commit (the class of bug marmot-ts 0.7.0 fixes: stale admin lists,
  // fork recovery). The app-level parent-state check must catch it on its own.
  (carol.group as unknown as { createAdminVerificationCallback: () => unknown }).createAdminVerificationCallback = () => () => 'accept';
  await carol.sync();
  assert.match(carol.halted ?? '', /non-admin .* changed the member set/);
  assert.ok(carol.rejections.some((r) => r.what === 'commit'));
  assert.ok(!getGroupMembers(carol.group!.state).includes(dave.identity), 'the library applied the unauthorized commit');
  await assert.rejects(() => carol.openRound(['https://tube.example/v/1']), /circle halted/);
});
