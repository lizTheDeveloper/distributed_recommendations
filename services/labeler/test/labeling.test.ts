// End to end: a reviewer's label is signed, published to an in-memory relay, read
// back by packages/moderation exactly as the app would (fetchLabels → LabelIndex
// → applyModeration / moderateVideo), and retracted the same way.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyModeration,
  defaultPolicy,
  fetchLabels,
  moderateVideo,
  relayQuery,
  verifyNostrEvent,
} from '../../../packages/moderation/src/index.ts';
import type { ModerationPolicy } from '../../../packages/moderation/src/index.ts';
import type { Video } from '../../../packages/moderation/src/core.ts';
import { LabelerStore } from '../src/repo.ts';
import { createSigner } from '../src/signer.ts';
import { PublishError, activeLabels, dismissCase, escalateCase, issueLabel, retractLabel } from '../src/labeling.ts';
import type { LabelerContext } from '../src/labeling.ts';
import { ingestReports } from '../src/intake.ts';
import { verifyAuditChain } from '../src/store.ts';
import { parseTargetSpec } from '../src/targets.ts';
import { exportAudit, statementsOfReasons, toCsv, transparencySummary } from '../src/transparency.ts';
import { LABELER, MemoryRelays, NOW, RELAY, VIDEO_URL, config, keypair, report } from './helpers.ts';

const video = (id = VIDEO_URL, over: Partial<Video> = {}): Video => ({
  id,
  title: 'A video',
  creator: 'alice_channel@tube.example',
  durationSec: 120,
  publishedAt: new Date('2026-10-10T00:00:00Z'),
  tags: [],
  ...over,
});

function policy(store = false): ModerationPolicy {
  const p = defaultPolicy(store);
  p.settings.labelers = [{ pubkey: LABELER.pk, name: 'Multiverse labeler' }];
  return p;
}

async function setup() {
  const net = new MemoryRelays();
  const store = await LabelerStore.memory();
  const signer = await createSigner('key', { env: { LABELER_SECRET_KEY: LABELER.hex }, expectedPubkey: LABELER.pk });
  const ctx: LabelerContext = { store, labeler: LABELER.pk, signer, relays: [RELAY], relayOptions: { WebSocket: net.ctor(), timeoutMs: 1000, retries: 0 }, now: () => NOW };
  /** What the app sees: labels fetched from the relay by packages/moderation. */
  const appView = (now = NOW) =>
    fetchLabels({ labelers: [LABELER.pk], relays: [RELAY], query: relayQuery({ WebSocket: net.ctor(), timeoutMs: 1000 }), verify: verifyNostrEvent, now });
  return { net, store, ctx, appView };
}

test('label → relay → packages/moderation hides the video; retraction (NIP-09) restores it', async () => {
  const { net, store, ctx, appView } = await setup();
  const before = await appView();
  assert.equal(moderateVideo(video(), policy(), { labels: before }).action, 'allow');

  const rec = await issueLabel(ctx, { targets: [parseTargetSpec(`video:${VIDEO_URL}`)], values: ['spam'], reason: 'Link spam posted across many channels', reviewer: 'alice' });
  assert.equal(net.events(RELAY).length, 1);
  assert.equal(net.events(RELAY)[0].kind, 1985);
  assert.equal(rec.event.pubkey, LABELER.pk);

  const labels = await appView();
  const verdict = moderateVideo(video(), policy(), { labels });
  assert.equal(verdict.action, 'hide');
  assert.deepEqual(verdict.titles, ['Spam']);
  assert.equal(verdict.reasons[0].kind === 'label' && verdict.reasons[0].reason, 'Link spam posted across many channels');
  const feed = applyModeration([{ video: video(), source: { kind: 'explore' } }, { video: video('https://tube.example/videos/watch/other'), source: { kind: 'explore' } }], policy(), { labels });
  assert.equal(feed.hiddenCount, 1);
  assert.equal(feed.allowed.length, 1);
  // A viewer who doesn't subscribe to the labeler is unaffected.
  assert.equal(moderateVideo(video(), defaultPolicy(), { labels }).action, 'allow');

  await retractLabel(ctx, rec.id, { reason: 'Appeal upheld: the links were the creator\'s own', reviewer: 'bob' });
  const deletion = net.sent(5)[0];
  assert.deepEqual(deletion.tags, [['e', rec.id], ['k', '1985']]);
  assert.equal(moderateVideo(video(), policy(), { labels: await appView() }).action, 'allow');
  assert.equal(activeLabels(store, NOW).length, 0);

  const log = store.auditLog();
  assert.deepEqual(log.map((e) => [e.action, e.actor, e.actorKind]), [
    ['label', 'alice', 'human'],
    ['retract', 'bob', 'human'],
  ]);
  assert.deepEqual(verifyAuditChain(log), { ok: true });
});

test('retraction works even when the relay keeps the label (moderation honours the kind 5 itself)', async () => {
  const { net, ctx, appView } = await setup();
  net.honorDeletions = false;
  const rec = await issueLabel(ctx, { targets: [parseTargetSpec(`video:${VIDEO_URL}`)], values: ['scam'], reason: 'Fake giveaway asking for payment', reviewer: 'alice' });
  await retractLabel(ctx, rec.id, { reason: 'Mistaken identity, wrong video', reviewer: 'alice' });
  assert.equal(net.events(RELAY).length, 2, 'relay still holds label and deletion');
  assert.equal(moderateVideo(video(), policy(), { labels: await appView() }).action, 'allow');
});

test('NSFW values follow the viewer setting: blur by default, hide on store builds; expiry is honoured', async () => {
  const { ctx, appView } = await setup();
  await issueLabel(ctx, { targets: [parseTargetSpec(`video:${VIDEO_URL}`)], values: ['nudity'], reason: 'Nudity without a content warning', expiresAt: NOW + 7 * 86400, reviewer: 'alice' });
  const labels = await appView();
  assert.equal(moderateVideo(video(), policy(), { labels }).action, 'blur');
  assert.equal(moderateVideo(video(), policy(true), { labels }).action, 'hide');
  const later = await appView(NOW + 8 * 86400);
  assert.equal(moderateVideo(video(), policy(), { labels: later }).action, 'allow');
});

test('creator, instance and taste-list labels reach every video they cover', async () => {
  const { ctx, appView } = await setup();
  const curator = keypair(77);
  await issueLabel(ctx, { targets: [parseTargetSpec('instance:bad.example')], values: ['!hide'], reason: 'Instance hosts mostly spam uploads', reviewer: 'alice' });
  await issueLabel(ctx, { targets: [parseTargetSpec('channel:alice_channel@tube.example')], values: ['harassment'], reason: 'Channel posts targeted harassment', reviewer: 'alice' });
  await issueLabel(ctx, { targets: [parseTargetSpec(`list:30005:${curator.pk}:picks`)], values: ['undisclosed-sponsorship', 'spam'], reason: 'Paid placements without disclosure', reviewer: 'alice' });
  const labels = await appView();
  assert.equal(moderateVideo(video('https://bad.example/videos/watch/x', { creator: 'x@bad.example' }), policy(), { labels }).action, 'hide');
  assert.equal(moderateVideo(video(), policy(), { labels }).action, 'blur');
  const m = applyModeration(
    [{ video: video('https://ok.example/w/1', { creator: 'bob@ok.example' }), source: { kind: 'taste', via: 'picks' }, moderation: { source: { pubkey: curator.pk, list: `30005:${curator.pk}:picks` } } }],
    policy(),
    { labels },
  );
  assert.equal(m.hiddenCount, 1);
  assert.equal(m.hidden[0].reasons[0].kind, 'sources-blocked');
});

test('labeling a reported case closes it; dismiss and escalate are audited; nothing publishes for them', async () => {
  const { net, store, ctx } = await setup();
  const reporter = keypair(31);
  const author = keypair(32);
  const ev = 'ee'.repeat(32);
  ingestReports([report(reporter, { type: 'video', eventId: ev, pubkey: author.pk }, 'illegal', { content: 'looks like a stolen card shop' })], { config: config(), store, now: NOW });
  const [c] = store.cases();
  assert.equal(c.status, 'open');
  escalateCase(ctx, c.id, { to: 'instance', reviewer: 'alice', reference: 'abuse #4411', reason: 'Sent to the hosting instance for removal' });
  await assert.rejects(issueLabel(ctx, { targets: [], caseId: c.id, values: ['illegal'], reason: 'Sells stolen payment cards', reviewer: 'alice' }), /legal ground/);
  const rec = await issueLabel(ctx, { targets: [], caseId: c.id, values: ['illegal'], reason: 'Sells stolen payment cards', legalGround: 'Example ground: fraud statute (to be named by counsel)', note: 'internal', reviewer: 'alice' });
  assert.deepEqual(rec.targets, [{ type: 'e', value: ev }]);
  assert.equal(store.getCase(c.id)!.status, 'labeled');
  assert.equal(net.sent().length, 1);
  assert.ok(!JSON.stringify(rec.event).includes('internal'), 'notes are never published');
  assert.ok(!JSON.stringify(rec.event).includes('fraud statute'), 'the legal ground stays in the statement of reasons');

  const other = keypair(33);
  ingestReports([report(other, { type: 'creator', pubkey: author.pk }, 'spam')], { config: config(), store, now: NOW });
  const c2 = store.cases('open')[0];
  assert.throws(() => dismissCase(ctx, c2.id, { reason: 'short', reviewer: 'alice' }), /reason/);
  dismissCase(ctx, c2.id, { reason: 'Ordinary self-promotion, within policy', reviewer: 'alice' });
  assert.equal(store.getCase(c2.id)!.status, 'dismissed');
  assert.equal(net.sent().length, 1);
  assert.deepEqual(store.auditLog().map((e) => e.action), ['escalate', 'label', 'dismiss']);
});

test('nothing is recorded when no relay accepts the label; signer must be the labeler key', async () => {
  const { net, store, ctx } = await setup();
  net.rejecting.add(RELAY);
  await assert.rejects(
    issueLabel(ctx, { targets: [parseTargetSpec(`video:${VIDEO_URL}`)], values: ['spam'], reason: 'Link spam everywhere', reviewer: 'alice' }),
    (err: unknown) => err instanceof PublishError && /blocked/.test(err.message),
  );
  assert.equal(store.labels().length, 0);
  assert.equal(store.auditLog().length, 0);
  await assert.rejects(createSigner('key', { env: { LABELER_SECRET_KEY: keypair(9).hex }, expectedPubkey: LABELER.pk }), /not the configured labeler/);
  await assert.rejects(issueLabel({ ...ctx, signer: undefined }, { targets: [parseTargetSpec(`video:${VIDEO_URL}`)], values: ['spam'], reason: 'Link spam everywhere', reviewer: 'a' }), /no signer/);
  await assert.rejects(issueLabel(ctx, { targets: [parseTargetSpec(`video:${VIDEO_URL}`)], values: ['not-a-value'], reason: 'Link spam everywhere', reviewer: 'a' }), /unknown label value/);
});

test('transparency: statements of reasons (DSA Art. 17 structure), public redaction, summary, CSV', async () => {
  const { store, ctx } = await setup();
  const cfg = config({ appealUrl: 'https://multiverse.school/labeler/appeal', policyUrl: 'https://multiverse.school/labeler/policy' });
  ingestReports([report(keypair(40), { type: 'video', eventId: 'aa'.repeat(32), pubkey: keypair(41).pk }, 'nudity', { createdAt: NOW - 7300 })], { config: cfg, store, now: NOW - 7200 });
  const c = store.cases()[0];
  const l1 = await issueLabel(ctx, { targets: [], caseId: c.id, values: ['nudity'], reason: 'Nudity without a content warning', reviewer: 'alice' });
  await issueLabel(ctx, { targets: [parseTargetSpec('tag:=cmd|calc')], values: ['spam'], reason: '=HYPERLINK("x") spam tag', reviewer: 'bob' });
  await retractLabel(ctx, l1.id, { reason: 'Creator added a content warning', reviewer: 'alice' });

  const full = statementsOfReasons(store, cfg);
  assert.equal(full.length, 2);
  const s = full.find((x) => x.decision_id === l1.id)!;
  assert.equal(s.source, 'notice');
  assert.equal(s.notices, 1);
  assert.equal(s.visibility_effect, 'blur');
  assert.equal(s.viewer_controlled, true);
  assert.equal(s.automated_decision, false);
  assert.equal(s.ground, 'incompatible_with_policy');
  assert.match(s.redress, /appeal/);
  assert.equal(s.reviewer, 'alice');
  assert.ok(s.retracted_at);
  assert.equal(full[1].source, 'own_initiative');

  const pub = statementsOfReasons(store, cfg, { public: true });
  assert.ok(pub.every((x) => x.reviewer === undefined && x.targets === undefined));
  const audit = exportAudit(store, { public: true });
  assert.ok(audit.every((e) => !e.actor.match(/alice|bob/) && e.targets === undefined));
  assert.equal(new Set(audit.filter((e) => e.actorKind === 'human').map((e) => e.actor)).size, 2);

  const sum = transparencySummary(store, cfg);
  assert.equal(sum.reports.accepted, 1);
  assert.equal(sum.decisions.labels, 2);
  assert.equal(sum.decisions.retractions, 1);
  assert.equal(sum.decisions.fromNotices, 1);
  assert.equal(sum.decisions.medianHoursToDecision, 2);
  assert.equal(sum.auditChain, 'intact');

  const csv = toCsv(full);
  assert.match(csv, /'=HYPERLINK/);
  assert.equal(csv.split('\r\n')[0].split(',')[0], 'decision_id');
});
