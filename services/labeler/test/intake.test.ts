import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultPolicy, fetchLabels, moderateVideo, relayQuery, verifyNostrEvent } from '../../../packages/moderation/src/index.ts';
import { LabelerStore } from '../src/repo.ts';
import { createSigner } from '../src/signer.ts';
import { caseIdFor, ingestReports, purge, reviewQueue, runIntake } from '../src/intake.ts';
import type { LabelerContext } from '../src/labeling.ts';
import { dismissCase } from '../src/labeling.ts';
import { INTAKE, LABELER, MemoryRelays, NOW, RELAY, config, keypair, report, sign } from './helpers.ts';

const author = keypair(50);
const EV = 'ab'.repeat(32);
const vid = (eventId = EV) => ({ type: 'video' as const, eventId, pubkey: author.pk });
const reporters = Array.from({ length: 30 }, (_, i) => keypair(100 + i));

test('intake queues verified reports addressed to the labeler and nothing else', async () => {
  const store = await LabelerStore.memory();
  const good = report(reporters[0], vid(), 'spam', { content: 'buy followers links‮' });
  const notAddressed = report(reporters[1], vid(), 'spam', { address: false });
  const tampered = { ...report(reporters[2], vid(), 'spam'), content: 'changed' };
  const notReport = sign({ kind: 1, created_at: NOW, tags: [['p', LABELER.pk]], content: 'hi' }, reporters[3]);
  // A typed p tag for the labeler is a report ABOUT the labeler, not an address.
  const aboutLabeler = sign({ kind: 1984, created_at: NOW - 5, tags: [['p', LABELER.pk, 'spam']], content: '' }, reporters[4]);
  const { stats } = ingestReports([good, notAddressed, tampered, notReport, aboutLabeler], { config: config(), store, now: NOW });
  assert.equal(stats.accepted, 1);
  assert.equal(stats.notAddressed, 2);
  assert.equal(stats.invalid, 2);
  const [c] = store.cases();
  assert.equal(c.id, caseIdFor(`e:${EV}`));
  assert.deepEqual(c.types, { spam: 1 });
  const [r] = store.reportsForCase(c.id);
  assert.equal(r.pubkey, author.pk, 'the reported author, not the labeler');
  assert.equal(r.content, 'buy followers links', 'display-safe');
  assert.equal(store.labels().length, 0, 'reports never label on their own');
});

test('dedupe: same event twice, and the same reporter re-reporting the same thing, count once', async () => {
  const store = await LabelerStore.memory();
  const a1 = report(reporters[0], vid(), 'spam', { createdAt: NOW - 100, content: 'first' });
  const a2 = report(reporters[0], vid(), 'spam', { createdAt: NOW - 50, content: 'second' });
  const b = report(reporters[1], vid(), 'spam');
  const b2 = report(reporters[1], vid(), 'nudity');
  const s1 = ingestReports([a1, a1, a2, b, b2], { config: config(), store, now: NOW }).stats;
  assert.equal(s1.duplicate, 1);
  assert.equal(s1.merged, 1);
  assert.equal(s1.accepted, 3);
  const s2 = ingestReports([a1, a2, b], { config: config(), store, now: NOW }).stats;
  assert.equal(s2.duplicate, 3);
  const c = store.cases()[0];
  assert.deepEqual(c.reporters.sort(), [reporters[0].pk, reporters[1].pk].sort());
  assert.deepEqual(c.types, { spam: 2, nudity: 1 });
  const mine = store.reportsForCase(c.id).filter((r) => r.reporter === reporters[0].pk);
  assert.equal(mine.length, 1);
  assert.equal(mine[0].content, 'second');
  assert.deepEqual(mine[0].duplicates, [a1.id]);
});

test('rate limits per reporter (per day and open at once); ignored, stale and future reports are dropped', async () => {
  const store = await LabelerStore.memory();
  const cfg = config({ rateLimit: { perDay: 3, maxOpen: 100 }, ignoredReporters: [reporters[9].pk], maxReportAgeDays: 10 });
  const flood = Array.from({ length: 6 }, (_, i) => report(reporters[0], vid((i + 1).toString(16).padStart(64, '0')), 'spam', { createdAt: NOW - i }));
  let s = ingestReports(flood, { config: cfg, store, now: NOW }).stats;
  assert.equal(s.accepted, 3);
  assert.equal(s.rateLimited, 3);
  assert.equal(store.getReporter(reporters[0].pk).dropped, 3);
  // A day later the window has moved.
  s = ingestReports([report(reporters[0], vid('77'.repeat(32)), 'spam', { createdAt: NOW + 86_000 })], { config: cfg, store, now: NOW + 86_401 }).stats;
  assert.equal(s.accepted, 1);

  const open = config({ rateLimit: { perDay: 100, maxOpen: 2 } });
  const store2 = await LabelerStore.memory();
  s = ingestReports(Array.from({ length: 4 }, (_, i) => report(reporters[1], vid((i + 9).toString(16).padStart(64, '0')), 'spam')), { config: open, store: store2, now: NOW }).stats;
  assert.equal(s.accepted, 2);
  assert.equal(s.rateLimited, 2);

  s = ingestReports(
    [report(reporters[9], vid(), 'spam'), report(reporters[2], vid(), 'spam', { createdAt: NOW - 11 * 86400 }), report(reporters[3], vid(), 'spam', { createdAt: NOW + 3600 })],
    { config: cfg, store, now: NOW },
  ).stats;
  assert.deepEqual([s.ignoredReporter, s.tooOld, s.future, s.accepted], [1, 1, 1, 0]);
});

test('a dismissed case reopens when someone new reports it; the queue puts illegal and trusted first', async () => {
  const store = await LabelerStore.memory();
  const cfg = config({ trustedReporters: [reporters[5].pk] });
  ingestReports([report(reporters[0], vid('01'.repeat(32)), 'spam')], { config: cfg, store, now: NOW - 300 });
  ingestReports([report(reporters[1], vid('02'.repeat(32)), 'illegal', { createdAt: NOW - 100 })], { config: cfg, store, now: NOW - 100 });
  ingestReports([report(reporters[5], vid('03'.repeat(32)), 'spam', { createdAt: NOW - 50 })], { config: cfg, store, now: NOW - 50 });
  assert.deepEqual(reviewQueue(store).map((c) => c.target), [`e:${'02'.repeat(32)}`, `e:${'03'.repeat(32)}`, `e:${'01'.repeat(32)}`]);

  const ctx: LabelerContext = { store, labeler: LABELER.pk, relays: [], now: () => NOW };
  const id = caseIdFor(`e:${'01'.repeat(32)}`);
  dismissCase(ctx, id, { reason: 'Not spam, ordinary promotion', reviewer: 'alice' });
  ingestReports([report(reporters[0], vid('01'.repeat(32)), 'nudity')], { config: cfg, store, now: NOW });
  assert.equal(store.getCase(id)!.status, 'dismissed', 'the same reporter again does not reopen');
  const s = ingestReports([report(reporters[2], vid('01'.repeat(32)), 'spam')], { config: cfg, store, now: NOW }).stats;
  assert.equal(s.casesReopened, 1);
  assert.equal(store.getCase(id)!.status, 'open');
  assert.deepEqual(store.auditLog().map((e) => [e.action, e.actorKind]), [
    ['dismiss', 'human'],
    ['reopen', 'system'],
  ]);
});

test('runIntake reads `#p`-filtered reports from the in-memory relay, collects relay errors, and never publishes by default', async () => {
  const net = new MemoryRelays();
  const store = await LabelerStore.memory();
  net.add(INTAKE, report(reporters[0], vid(), 'spam'), report(reporters[1], vid(), 'spam'), report(reporters[2], vid(), 'nudity', { address: false }));
  const cfg = config({ intakeRelays: [INTAKE, 'wss://down.test'], trustedReporters: reporters.slice(0, 5).map((k) => k.pk) });
  net.down.add('wss://down.test');
  const s = await runIntake({ config: cfg, store, now: NOW, relayOptions: { WebSocket: net.ctor(), timeoutMs: 500, retries: 0 } });
  assert.equal(s.accepted, 2);
  assert.equal(s.errors.length, 1);
  assert.match(s.errors[0], /down\.test/);
  const req = net.received.find((r) => r.msg[0] === 'REQ' && r.url === INTAKE)!.msg[2] as Record<string, unknown>;
  assert.deepEqual(req.kinds, [1984]);
  assert.deepEqual(req['#p'], [LABELER.pk]);
  assert.equal(net.sent().length, 0, 'auto-blur is off by default: nothing is published');
  assert.equal(store.getMeta('intake.lastRun'), NOW);
  // The next run starts from the cursor minus the lookback, and dedupe keeps it idempotent.
  const s2 = await runIntake({ config: cfg, store, now: NOW + 600, relayOptions: { WebSocket: net.ctor(), timeoutMs: 500, retries: 0 } });
  assert.equal(s2.accepted, 0);
  const req2 = net.received.filter((r) => r.msg[0] === 'REQ' && r.url === INTAKE)[1].msg[2] as Record<string, number>;
  assert.equal(req2.since, NOW - 2 * 86400);
});

test('auto-blur (opt-in): only N distinct TRUSTED reporters, only video events, blur with expiry, case stays open', async () => {
  const net = new MemoryRelays();
  const store = await LabelerStore.memory();
  const trusted = reporters.slice(0, 3);
  const cfg = config({ trustedReporters: trusted.map((k) => k.pk), autoBlur: { enabled: true, threshold: 3, ttlHours: 48 } });
  const signer = await createSigner('key', { env: { LABELER_SECRET_KEY: LABELER.hex }, expectedPubkey: LABELER.pk });
  const ctx: LabelerContext = { store, labeler: LABELER.pk, signer, relays: [RELAY], relayOptions: { WebSocket: net.ctor(), timeoutMs: 500, retries: 0 }, now: () => NOW };
  const opts = { config: cfg, store, ctx, now: NOW, relayOptions: { WebSocket: net.ctor(), timeoutMs: 500, retries: 0 } };

  // Many untrusted reporters + 2 trusted: below threshold.
  net.add(INTAKE, ...reporters.slice(10, 20).map((k) => report(k, vid(), 'nudity')), report(trusted[0], vid(), 'nudity'), report(trusted[1], vid(), 'nudity'));
  // Three trusted reporters on a creator (p target): never auto-labeled.
  net.add(INTAKE, ...trusted.map((k) => report(k, { type: 'creator', pubkey: author.pk }, 'spam')));
  let s = await runIntake(opts);
  assert.equal(s.autoBlurred, 0);
  assert.equal(net.sent().length, 0);

  net.add(INTAKE, report(trusted[2], vid(), 'nudity'));
  s = await runIntake({ ...opts, now: NOW + 60 });
  assert.equal(s.autoBlurred, 1);
  const [label] = store.labels();
  assert.deepEqual(label.values, ['!warn']);
  assert.equal(label.automated, true);
  assert.equal(label.expiresAt, NOW + 48 * 3600);
  const c = store.getCase(caseIdFor(`e:${EV}`))!;
  assert.equal(c.status, 'open');
  assert.equal(c.autoBlurId, label.id);
  assert.equal(store.auditLog().at(-1)!.actorKind, 'automated');

  // Not repeated on the next run.
  net.add(INTAKE, report(reporters[3], vid(), 'nudity'));
  s = await runIntake({ ...opts, now: NOW + 120 });
  assert.equal(s.autoBlurred, 0);

  // The app sees a blur (never a hide), which lapses with the expiry.
  const app = (now: number) => fetchLabels({ labelers: [LABELER.pk], relays: [RELAY], query: relayQuery({ WebSocket: net.ctor() }), verify: verifyNostrEvent, now });
  const p = defaultPolicy(true);
  p.settings.labelers = [{ pubkey: LABELER.pk }];
  const v = { id: 'https://tube.example/w/x', title: 't', creator: 'c@tube.example', durationSec: 1, publishedAt: new Date(0), tags: [] };
  assert.equal(moderateVideo(v, p, { labels: await app(NOW + 200) }, { eventId: EV }).action, 'blur');
  assert.equal(moderateVideo(v, p, { labels: await app(NOW + 49 * 3600) }, { eventId: EV }).action, 'allow');
});

test('config: auto-blur is off by default and its threshold can never be 1', () => {
  assert.equal(config().autoBlur.enabled, false);
  assert.throws(() => config({ autoBlur: { enabled: true, threshold: 1 } }), /threshold/);
  assert.throws(() => config({ surprise: true }), /unknown key/);
  assert.throws(() => config({ publishRelays: ['https://not-a-relay'] }), /ws/);
  assert.throws(() => config({ trustedReporters: [reporters[0].pk], ignoredReporters: [reporters[0].pk] }), /both/);
});

test('retention purge removes reporter data of long-resolved cases, keeps the audit log', async () => {
  const store = await LabelerStore.memory();
  const cfg = config({ retention: { resolvedReportDays: 30 } });
  ingestReports([report(reporters[0], vid(), 'spam', { content: 'personal details here' })], { config: cfg, store, now: NOW });
  const ctx: LabelerContext = { store, labeler: LABELER.pk, relays: [], now: () => NOW };
  dismissCase(ctx, store.cases()[0].id, { reason: 'Within policy after review', reviewer: 'alice' });
  assert.equal(purge(store, cfg, NOW + 10 * 86400).reports, 0);
  const r = purge(store, cfg, NOW + 31 * 86400);
  assert.equal(r.reports, 1);
  assert.equal(r.seen, 1);
  assert.equal(store.reports().length, 0);
  assert.equal(store.cases().length, 1, 'the case (counts only) remains');
  assert.deepEqual(store.auditLog().map((e) => e.action), ['dismiss', 'purge', 'purge']);
});
