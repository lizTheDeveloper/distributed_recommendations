import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_LABEL_RULES, MATCH_FEED_NAMESPACE, parseLabelEvent } from '../../../packages/moderation/src/index.ts';
import { NAMESPACE, VOCABULARY, checkValues, strongestAction } from '../src/vocabulary.ts';
import { labelTemplate } from '../src/labeling.ts';
import { parseTargetSpec, subjectKind, targetFromKey } from '../src/targets.ts';
import { LABELER, NOW, VIDEO_URL, keypair, sign } from './helpers.ts';

test('vocabulary is exactly the moderation package\'s match-feed.moderation rules', () => {
  assert.equal(NAMESPACE, MATCH_FEED_NAMESPACE);
  const fromPackage = DEFAULT_LABEL_RULES.filter((r) => r.namespace === MATCH_FEED_NAMESPACE).map((r) => r.value);
  assert.deepEqual(VOCABULARY.map((v) => v.value), fromPackage);
  assert.ok(VOCABULARY.length >= 19);
  assert.equal(VOCABULARY.find((v) => v.value === 'nudity')!.category, 'nsfw');
  assert.equal(VOCABULARY.find((v) => v.value === 'spam')!.action, 'hide');
  assert.equal(strongestAction(['profanity', 'hate']), 'blur');
  assert.equal(strongestAction(['profanity', 'spam']), 'hide');
});

test('checkValues rejects values the moderation package does not know', () => {
  assert.deepEqual(checkValues(['spam', 'spam', 'scam']), ['spam', 'scam']);
  assert.throws(() => checkValues(['Spam']), /unknown label value/);
  assert.throws(() => checkValues(['NS-nud']), /unknown label value/);
  assert.throws(() => checkValues([]), /at least one/);
});

test('target specs map to the tags moderation matches', () => {
  const pk = keypair(5).pk;
  assert.deepEqual(parseTargetSpec(`video:${VIDEO_URL}#t=10`), { type: 'r', value: VIDEO_URL });
  assert.deepEqual(parseTargetSpec(`event:${'ab'.repeat(32)}`), { type: 'e', value: 'ab'.repeat(32) });
  assert.deepEqual(parseTargetSpec(`creator:${pk}`), { type: 'p', value: pk });
  assert.deepEqual(parseTargetSpec('channel:Alice_Channel@Tube.Example'), { type: 'r', value: 'https://tube.example/video-channels/alice_channel' });
  assert.deepEqual(parseTargetSpec('account:alice@tube.example'), { type: 'r', value: 'https://tube.example/accounts/alice' });
  assert.deepEqual(parseTargetSpec('instance:https://Bad.Example/'), { type: 'r', value: 'https://bad.example' });
  assert.deepEqual(parseTargetSpec(`list:30005:${pk}:faves`), { type: 'a', value: `30005:${pk}:faves` });
  assert.deepEqual(parseTargetSpec('tag:#Crypto'), { type: 't', value: 'crypto' });
  assert.throws(() => parseTargetSpec(`list:34235:${pk}:x`), /30005/);
  assert.throws(() => parseTargetSpec('video:https://tube.example/'), /video's https/);
  assert.throws(() => parseTargetSpec('event:nothex'), /64-hex/);
  assert.throws(() => parseTargetSpec('creator:npub1nope'), /./);
  assert.throws(() => parseTargetSpec('nonsense'), /<kind>:<value>/);
  assert.equal(subjectKind(parseTargetSpec('instance:bad.example')), 'instance');
  assert.equal(subjectKind(parseTargetSpec('channel:a@b.example')), 'creator');
  assert.equal(subjectKind(parseTargetSpec(`video:${VIDEO_URL}`)), 'video');
  assert.equal(subjectKind(parseTargetSpec(`list:30005:${pk}:x`)), 'taste-list');
  assert.equal(targetFromKey(`x:${'cd'.repeat(32)}`), undefined);
});

test('label templates parse back through packages/moderation with the same meaning', () => {
  const t = labelTemplate({ targets: [parseTargetSpec(`video:${VIDEO_URL}`)], values: ['nudity', 'ai-generated'], reason: 'Explicit nudity in the first minute', expiresAt: NOW + 3600, reviewer: 'r' }, NOW);
  const labels = parseLabelEvent(sign(t, LABELER));
  assert.deepEqual(labels.map((l) => [l.namespace, l.value]), [
    [MATCH_FEED_NAMESPACE, 'nudity'],
    [MATCH_FEED_NAMESPACE, 'ai-generated'],
  ]);
  assert.equal(labels[0].reason, 'Explicit nudity in the first minute');
  assert.equal(labels[0].expiresAt, NOW + 3600);
  assert.deepEqual(labels[0].targets, [`r:${VIDEO_URL}`]);
});

test('label templates enforce reason, expiry and a legal ground for "illegal"', () => {
  const base = { targets: [parseTargetSpec(`video:${VIDEO_URL}`)], values: ['spam'], reason: 'Repeated link spam', reviewer: 'r' };
  assert.throws(() => labelTemplate({ ...base, reason: 'spam' }, NOW), /reason of at least/);
  assert.throws(() => labelTemplate({ ...base, expiresAt: NOW - 1 }, NOW), /future/);
  assert.throws(() => labelTemplate({ ...base, values: ['illegal'] }, NOW), /legal ground/);
  assert.ok(labelTemplate({ ...base, values: ['illegal'], legalGround: 'Example: national law on X, section Y' }, NOW));
  assert.throws(() => labelTemplate({ ...base, targets: [] }, NOW), /target/);
  // Control and bidi characters are stripped from the public reason.
  assert.equal(labelTemplate({ ...base, reason: 'Spam‮ links\u0007 everywhere' }, NOW).content, 'Spam links everywhere');
});
