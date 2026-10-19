import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_RECIPE, rank, seededRng } from '../src/core.ts';
import {
  APP_STORE_SETTINGS,
  LabelIndex,
  KIND_LABEL,
  addBlock,
  applyModeration,
  attachVerdicts,
  buildReport,
  defaultPolicy,
  labelsFromReports,
  moderateVideo,
  parseLabelEvent,
  parseModerationSettings,
  parsePolicyJson,
  peertubeVideoMeta,
  publicSubjects,
  serializePolicy,
  setSensitiveMode,
  selfLabels,
  verifyNostrEvent,
  videoTargetKeys,
} from '../src/index.ts';
import type { InstanceDefaults, Label, ModerationCandidate, ModerationPolicy } from '../src/index.ts';
import { NOW, keypair, sign, video } from './helpers.ts';

const labeler = keypair(40);
const stranger = keypair(41);
const curator = keypair(42);
const matchPeer = keypair(43);

const V = (n: number) => `https://tube.example/videos/watch/0000000${n}-0000-0000-0000-000000000000`;

function labelOn(target: string[], ns: string, value: string, by = labeler): Label[] {
  return parseLabelEvent(sign({ kind: KIND_LABEL, created_at: 1, tags: [['L', ns], ['l', value, ns], target], content: '' }, by));
}

function withLabeler(p: ModerationPolicy = defaultPolicy()): ModerationPolicy {
  return { ...p, settings: { ...p.settings, labelers: [{ pubkey: labeler.pk, name: 'Test labeler' }] } };
}

const follow = (v: ReturnType<typeof video>, extra: Partial<ModerationCandidate> = {}): ModerationCandidate => ({ video: v, source: { kind: 'follow', via: v.creator }, ...extra });

test('defaults: NSFW and violence blur, instance blocklists on, report threshold 3', () => {
  const p = defaultPolicy();
  assert.equal(p.settings.nsfw, 'blur');
  assert.equal(p.settings.violence, 'blur');
  assert.equal(p.settings.instanceBlocklists, true);
  assert.equal(p.settings.reportThreshold, 3);
  assert.equal(defaultPolicy(true).settings.nsfw, 'hide');
  assert.equal(APP_STORE_SETTINGS.nsfw, 'hide');
});

test('PeerTube nsfw flag: blurred by default, hidden in store builds, shown only after two-step opt-in', () => {
  const v = video(V(1));
  const cands: ModerationCandidate[] = [follow(v, { moderation: { video: { nsfw: true, nsfwSummary: 'Artistic nudity' } } })];
  const blurred = applyModeration(cands, defaultPolicy());
  assert.equal(blurred.allowed.length, 1);
  const w = blurred.warnings.get(v.id)!;
  assert.equal(w.action, 'blur');
  assert.deepEqual(w.titles, ['Sensitive (creator-flagged)']);
  assert.equal(w.reasons[0].kind === 'label' && w.reasons[0].reason, 'Artistic nudity');

  const store = applyModeration(cands, defaultPolicy(true));
  assert.equal(store.allowed.length, 0);
  assert.equal(store.hiddenCount, 1);

  const p = defaultPolicy();
  assert.throws(() => setSensitiveMode(p.settings, 'nsfw', 'show'), /adult confirmation/);
  const shown = { ...p, settings: setSensitiveMode(p.settings, 'nsfw', 'show', { confirmAdult: true, now: 7 }) };
  assert.equal(shown.settings.adultConfirmedAt, 7);
  const r = applyModeration(cands, shown);
  assert.equal(r.warnings.get(v.id)?.action, 'label', 'still labelled, not blurred');
  // Going back to blur clears the confirmation.
  assert.equal(setSensitiveMode(shown.settings, 'nsfw', 'blur').adultConfirmedAt, undefined);
});

test('PeerTube nsfwFlags: violent follows the violence setting, explicit sex the NSFW setting', () => {
  const vio = video(V(1));
  const sex = video(V(2));
  const cands = [follow(vio, { moderation: { video: { nsfw: true, nsfwFlags: 1 } } }), follow(sex, { moderation: { video: { nsfw: true, nsfwFlags: 2 } } })];
  const p = defaultPolicy();
  const policy = { ...p, settings: { ...setSensitiveMode(p.settings, 'nsfw', 'show', { confirmAdult: true }), violence: 'hide' as const } };
  const r = applyModeration(cands, policy);
  assert.deepEqual(r.hidden.map((h) => h.video.id), [vio.id]);
  assert.equal(r.warnings.get(sex.id)?.action, 'label');
});

test('labels from a subscribed labeler hide, blur or label; strangers are ignored', () => {
  const spam = video(V(1));
  const gore = video(V(2));
  const misleading = video(V(3));
  const strangerLabelled = video(V(4));
  const labels = new LabelIndex([
    ...labelOn(['r', spam.id], 'match-feed.moderation', 'spam'),
    ...labelOn(['r', gore.id], 'match-feed.moderation', 'gore'),
    ...labelOn(['r', misleading.id], 'match-feed.moderation', 'misleading'),
    ...labelOn(['r', strangerLabelled.id], 'match-feed.moderation', 'spam', stranger),
  ]);
  const r = applyModeration([spam, gore, misleading, strangerLabelled].map((v) => follow(v)), withLabeler(), { labels });
  assert.deepEqual(r.hidden.map((h) => h.video.id), [spam.id]);
  assert.equal(r.hidden[0].reasons[0].kind, 'label');
  assert.equal(r.warnings.get(gore.id)?.action, 'blur');
  assert.equal(r.warnings.get(misleading.id)?.action, 'label');
  assert.equal(r.warnings.has(strangerLabelled.id), false);
  assert.deepEqual(r.allowed.map((c) => c.video.id), [gore.id, misleading.id, strangerLabelled.id]);
});

test('labels can target the instance, the channel, the Nostr event, the creator key or a tag', () => {
  const pk = keypair(44).pk;
  const v = video(V(1), { creator: 'bob@tube.example', tags: ['Crypto'] });
  const meta = { eventId: 'e'.repeat(64), pubkey: pk, address: `34235:${pk}:x` };
  const keys = videoTargetKeys(v, meta);
  for (const k of ['r:https://tube.example', 'r:https://tube.example/video-channels/bob', 'r:https://tube.example/c/bob', `e:${'e'.repeat(64)}`, `p:${pk}`, `a:34235:${pk}:x`, 't:crypto']) {
    assert.ok(keys.includes(k), k);
  }
  const labels = new LabelIndex(labelOn(['r', 'https://tube.example'], 'match-feed.moderation', '!hide'));
  assert.equal(moderateVideo(v, withLabeler(), { labels }).action, 'hide');
});

test('viewer rules override defaults; unknown labels follow unknownLabels', () => {
  const v = video(V(1));
  const labels = new LabelIndex([...labelOn(['r', v.id], 'match-feed.moderation', 'misleading'), ...labelOn(['r', v.id], 'com.example', 'weird')]);
  const p = withLabeler();
  assert.deepEqual(moderateVideo(v, p, { labels }).titles.sort(), ['Misleading', 'weird']);
  const strict = { ...p, settings: { ...p.settings, unknownLabels: 'ignore' as const, rules: [{ namespace: 'match-feed.moderation', value: 'misleading', action: 'hide' as const }] } };
  const verdict = moderateVideo(v, strict, { labels });
  assert.equal(verdict.action, 'hide');
  assert.equal(verdict.reasons.length, 1);
});

test('nos.social ontology prefix rule and the ugc namespace', () => {
  const a = video(V(1));
  const b = video(V(2));
  const labels = new LabelIndex([...labelOn(['r', a.id], 'social.nos.ontology', 'NS-nud'), ...parseLabelEvent(sign({ kind: KIND_LABEL, created_at: 1, tags: [['l', 'cringe'], ['r', b.id]], content: '' }, labeler))]);
  const r = applyModeration([follow(a), follow(b)], withLabeler(), { labels });
  assert.equal(r.warnings.get(a.id)?.action, 'blur');
  assert.equal(r.warnings.get(b.id)?.action, 'label');
});

test('self-labels and content-warning add warnings but can never hide', () => {
  const author = keypair(45);
  const evt = sign({ kind: 34235, created_at: 1, tags: [['d', 'x'], ['content-warning', 'flashing lights'], ['L', 'match-feed.moderation'], ['l', 'spam', 'match-feed.moderation']], content: '' }, author);
  const v = video(V(1));
  const verdict = moderateVideo(v, defaultPolicy(), {}, { eventId: evt.id, pubkey: author.pk, selfLabels: selfLabels(evt) });
  assert.equal(verdict.action, 'blur');
  assert.ok(verdict.titles.includes('Content warning'));
});

test('block lists hide by creator, account, instance, npub, tag, keyword and video', () => {
  const pk = keypair(46).pk;
  const vs = [
    video(V(1), { creator: 'troll@tube.example' }),
    video(V(2), { creator: 'chan@ok.example' }),
    video('https://spam.example/videos/watch/1'),
    video(V(4)),
    video(V(5), { tags: ['#Crypto'] }),
    video(V(6), { title: 'Free MONEY inside' }),
    video(V(7)),
    video(V(8), { title: 'fine' }),
  ];
  let b = defaultPolicy().blocks;
  b = addBlock(b, 'creator', 'troll@tube.example');
  b = addBlock(b, 'creator', 'owner@ok.example');
  b = addBlock(b, 'instance', 'spam.example');
  b = addBlock(b, 'npub', pk);
  b = addBlock(b, 'tag', 'crypto');
  b = addBlock(b, 'keyword', 'free money');
  b = addBlock(b, 'video', V(7));
  const cands: ModerationCandidate[] = vs.map((v) => follow(v));
  cands[1].moderation = { video: { account: 'owner@ok.example' } };
  cands[3].moderation = { video: { pubkey: pk } };
  const r = applyModeration(cands, { ...defaultPolicy(), blocks: b });
  assert.equal(r.hiddenCount, 7);
  assert.deepEqual(r.allowed.map((c) => c.video.id), [V(8)]);
  assert.deepEqual(
    r.hidden.map((h) => (h.reasons[0].kind === 'blocked' ? h.reasons[0].list : '?')),
    ['creator', 'creator', 'instance', 'npub', 'tag', 'keyword', 'video'],
  );
});

test('blocked match and taste-list sources are dropped; other sources keep the video', () => {
  const both = video(V(1));
  const onlyList = video(V(2));
  const onlyMatch = video(V(3));
  const addr = `30005:${curator.pk}:deals`;
  let b = addBlock(defaultPolicy().blocks, 'npub', matchPeer.pk);
  b = addBlock(b, 'tasteList', addr);
  const cands: ModerationCandidate[] = [
    { video: both, source: { kind: 'follow', via: 'Alice' } },
    { video: both, source: { kind: 'taste', via: 'Deals' }, moderation: { source: { pubkey: curator.pk, list: addr } } },
    { video: onlyList, source: { kind: 'taste', via: 'Deals' }, moderation: { source: { pubkey: curator.pk, list: addr } } },
    { video: onlyMatch, source: { kind: 'match', via: 'Sam', strength: 0.4 }, moderation: { source: { pubkey: matchPeer.pk } } },
  ];
  const r = applyModeration(cands, { ...defaultPolicy(), blocks: b });
  assert.deepEqual(r.allowed.map((c) => [c.video.id, c.source.kind]), [[both.id, 'follow']]);
  assert.equal(r.droppedSources.length, 1);
  assert.equal(r.droppedSources[0].videoId, both.id);
  assert.deepEqual(r.hidden.map((h) => [h.video.id, h.reasons[0].kind]), [
    [onlyList.id, 'sources-blocked'],
    [onlyMatch.id, 'sources-blocked'],
  ]);
});

test('taste list blocked by name (provisional lists) and curator hidden by a labeler (T7/T8)', () => {
  const a = video(V(1));
  const b2 = video(V(2));
  const blocks = addBlock(defaultPolicy().blocks, 'tasteList', 'Sketchy Picks');
  const labels = new LabelIndex(labelOn(['p', curator.pk], 'match-feed.moderation', 'spam'));
  const cands: ModerationCandidate[] = [
    { video: a, source: { kind: 'taste', via: 'Sketchy Picks' } },
    { video: b2, source: { kind: 'taste', via: 'Promo list' }, moderation: { source: { pubkey: curator.pk } } },
    { video: b2, source: { kind: 'explore' } },
  ];
  const r = applyModeration(cands, { ...withLabeler(), blocks }, { labels });
  assert.deepEqual(r.hidden.map((h) => h.video.id), [a.id]);
  assert.deepEqual(r.allowed.map((c) => c.source.kind), ['explore']);
  assert.equal(r.droppedSources[0].reason.kind, 'label');
});

test('sourceMeta and videoMeta callbacks work for callers that keep facts outside candidates', () => {
  const v = video(V(1));
  const blocks = addBlock(defaultPolicy().blocks, 'npub', matchPeer.pk);
  const r = applyModeration([{ video: v, source: { kind: 'match', via: 'Sam' } }], { ...defaultPolicy(), blocks }, {
    sourceMeta: (s) => (s.via === 'Sam' ? { pubkey: matchPeer.pk } : undefined),
    videoMeta: () => ({ nsfw: true }),
  });
  assert.equal(r.hiddenCount, 1);
});

test('instance defaults: server-muted accounts and hosts hide; NSFW instances blur; can be turned off', () => {
  const muted = video(V(1), { creator: 'spammer@far.example' });
  const fromBadHost = video('https://bad.example/videos/watch/1');
  const fromNsfwInstance = video('https://nsfw.example/videos/watch/1');
  const ok = video(V(4));
  const inst: InstanceDefaults[] = [
    { instance: 'https://tube.example', source: 'public-log', blockedAccounts: ['spammer@far.example'], blockedHosts: ['bad.example'], isNSFW: false, publicLogEnabled: true, fetchedAt: 1 },
    { instance: 'https://nsfw.example', source: 'none', blockedAccounts: [], blockedHosts: [], isNSFW: true, publicLogEnabled: false, fetchedAt: 1 },
  ];
  const cands = [muted, fromBadHost, fromNsfwInstance, ok].map((v) => follow(v));
  const r = applyModeration(cands, defaultPolicy(), { instances: inst });
  assert.deepEqual(r.hidden.map((h) => h.reasons[0]), [
    { kind: 'instance-blocklist', instance: 'https://tube.example', target: 'spammer@far.example' },
    { kind: 'instance-blocklist', instance: 'https://tube.example', target: 'bad.example' },
  ]);
  assert.equal(r.warnings.get(fromNsfwInstance.id)?.action, 'blur');
  const p = defaultPolicy();
  const off = applyModeration(cands, { ...p, settings: { ...p.settings, instanceBlocklists: false } }, { instances: inst });
  assert.equal(off.hiddenCount, 0);
});

test('trusted reports warn after the threshold, never hide', () => {
  const v = video(V(1));
  const author = keypair(47);
  const evId = 'c'.repeat(64);
  const friends = [keypair(50), keypair(51), keypair(52)];
  const reports = friends.map((f) => sign(buildReport({ type: 'video', eventId: evId, pubkey: author.pk }, 'illegal'), f));
  const labels = new LabelIndex(labelsFromReports(reports, { trusted: friends.map((f) => f.pk), threshold: 3, verify: verifyNostrEvent }));
  const verdict = moderateVideo(v, defaultPolicy(), { labels }, { eventId: evId, pubkey: author.pk });
  assert.equal(verdict.action, 'blur');
  assert.deepEqual(verdict.titles, ['Reported by people you trust']);
});

test('plugs into core rank() as a pre-filter; verdicts attach to ranked items', () => {
  const vs = Array.from({ length: 6 }, (_, i) => video(V(i), { creator: `c${i}@tube.example`, publishedAt: new Date(NOW.getTime() - i * 3600_000) }));
  const blocks = addBlock(defaultPolicy().blocks, 'creator', 'c0@tube.example');
  const cands: ModerationCandidate[] = vs.map((v, i) => follow(v, i === 2 ? { moderation: { video: { nsfw: true } } } : {}));
  const m = applyModeration(cands, { ...defaultPolicy(), blocks });
  const items = attachVerdicts(rank(m.allowed, DEFAULT_RECIPE, { now: NOW, limit: 10, rng: seededRng(1) }), m);
  assert.equal(items.length, 5);
  assert.ok(!items.some((i) => i.video.id === vs[0].id));
  assert.equal(items.find((i) => i.video.id === vs[2].id)?.moderation?.action, 'blur');
  assert.equal(items.find((i) => i.video.id === vs[1].id)?.moderation, undefined);
  assert.equal(m.hiddenCount, 1);
});

test('verdicts do not depend on candidate order (facts merge across a video\'s candidates)', () => {
  const v = video(V(1));
  const a: ModerationCandidate = { video: v, source: { kind: 'explore' } };
  const b: ModerationCandidate = { video: v, source: { kind: 'follow', via: 'x' }, moderation: { video: { nsfw: true } } };
  assert.equal(applyModeration([a, b], defaultPolicy()).warnings.get(v.id)?.action, 'blur');
  assert.equal(applyModeration([b, a], defaultPolicy()).warnings.get(v.id)?.action, 'blur');
});

test('publicSubjects only lists explore candidates by default', () => {
  const cands: ModerationCandidate[] = [
    { video: video(V(1), { creator: 'a@tube.example' }), source: { kind: 'explore' }, moderation: { video: { account: 'acct@tube.example' } } },
    { video: video('https://other.example/videos/watch/2', { creator: 'b@other.example' }), source: { kind: 'match', via: 'Sam' } },
  ];
  assert.deepEqual(publicSubjects(cands), { accounts: ['a@tube.example', 'acct@tube.example'], hosts: ['tube.example'] });
  assert.equal(publicSubjects(cands, { kinds: ['explore', 'match'] }).hosts.length, 2);
});

test('peertubeVideoMeta extracts nsfw fields and the owner account', () => {
  assert.deepEqual(peertubeVideoMeta({ nsfw: true, nsfwFlags: 2, nsfwSummary: 'x‮y', account: { name: 'Bob', host: 'Tube.Example' }, truncatedDescription: 'hi' }), {
    nsfw: true,
    nsfwFlags: 2,
    nsfwSummary: 'x y',
    account: 'bob@tube.example',
    description: 'hi',
  });
  assert.deepEqual(peertubeVideoMeta(null), {});
});

test('settings and policy serialize and parse strictly', () => {
  const p = withLabeler();
  p.settings.rules.push({ namespace: 'com.example', value: 'x*', action: 'blur', labeler: labeler.pk, title: 'X' });
  const back = parsePolicyJson(serializePolicy(p));
  assert.deepEqual(back, p);
  assert.throws(() => parseModerationSettings({ v: 1, nsfw: 'show' }), /adultConfirmedAt/);
  assert.throws(() => parseModerationSettings({ v: 1, extra: true }), /unknown key/);
  assert.throws(() => parseModerationSettings({ v: 1, rules: [{ namespace: 'a', value: 'b', action: 'nuke' }] }), /action/);
  assert.throws(() => parseModerationSettings({ v: 1, labelers: [{ pubkey: 'npub1x' }] }), /hex/);
  assert.throws(() => parseModerationSettings({ v: 1, labelers: [{ pubkey: labeler.pk, relays: ['https://x'] }] }), /ws/);
  assert.deepEqual(parseModerationSettings({ v: 1 }), defaultPolicy().settings);
});
