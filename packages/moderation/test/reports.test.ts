import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KIND_REPORT, REPORT_TYPES, buildReport, labelsFromReports, parseReport, verifyNostrEvent } from '../src/index.ts';
import { keypair, sign } from './helpers.ts';

const author = keypair(1);
const reporter = keypair(2);
const EVENT = 'a'.repeat(64);

test('report types are exactly NIP-56\'s, in order', () => {
  assert.deepEqual([...REPORT_TYPES], ['nudity', 'malware', 'profanity', 'illegal', 'spam', 'impersonation', 'other']);
});

test('video report: e tag carries the type, p tag names the author, a tag for addressable videos', () => {
  const addr = `34235:${author.pk}:abc`;
  const t = buildReport({ type: 'video', eventId: EVENT, pubkey: author.pk, address: addr }, 'illegal', { content: 'see 1:23', createdAt: 100 });
  assert.equal(t.kind, KIND_REPORT);
  assert.equal(t.kind, 1984);
  assert.deepEqual(t.tags, [
    ['e', EVENT, 'illegal'],
    ['p', author.pk],
    ['a', addr],
  ]);
  assert.equal(t.content, 'see 1:23');
  assert.equal(t.created_at, 100);
});

test('creator report puts the type on the p tag (profile report)', () => {
  const t = buildReport({ type: 'creator', pubkey: author.pk }, 'impersonation', { createdAt: 1 });
  assert.deepEqual(t.tags, [['p', author.pk, 'impersonation']]);
});

test('taste-list report targets the kind-30005 curation set', () => {
  const addr = `30005:${author.pk}:faves`;
  const t = buildReport({ type: 'taste-list', eventId: EVENT, pubkey: author.pk, address: addr, relay: 'wss://relay.example' }, 'spam', { createdAt: 1 });
  assert.deepEqual(t.tags, [
    ['e', EVENT, 'spam', 'wss://relay.example'],
    ['p', author.pk],
    ['a', addr, 'wss://relay.example'],
  ]);
  assert.throws(() => buildReport({ type: 'taste-list', eventId: EVENT, pubkey: author.pk, address: `30023:${author.pk}:x` }, 'spam'), /30005/);
});

test('refuses malformed targets and impersonation on a video', () => {
  assert.throws(() => buildReport({ type: 'creator', pubkey: 'npub1xyz' }, 'spam'), /pubkey/);
  assert.throws(() => buildReport({ type: 'video', eventId: 'x', pubkey: author.pk }, 'spam'), /eventId/);
  assert.throws(() => buildReport({ type: 'video', eventId: EVENT, pubkey: author.pk }, 'impersonation'), /profile report/);
  assert.throws(() => buildReport({ type: 'video', eventId: EVENT, pubkey: author.pk, address: `34235:${'b'.repeat(64)}:x` }, 'spam'), /address/);
  assert.throws(() => buildReport({ type: 'creator', pubkey: author.pk }, 'rude' as never), /unknown report type/);
});

test('content is stripped of control and bidi characters and capped', () => {
  const t = buildReport({ type: 'creator', pubkey: author.pk }, 'other', { content: 'a‮b\u0000c' + 'x'.repeat(5000) });
  assert.ok(!/[‮\u0000]/.test(t.content));
  assert.equal(t.content.length, 2000);
});

test('optional NIP-32 qualification adds L/l tags', () => {
  const t = buildReport({ type: 'creator', pubkey: author.pk }, 'nudity', { label: { namespace: 'social.nos.ontology', value: 'NS-nud' } });
  assert.deepEqual(t.tags.slice(1), [
    ['L', 'social.nos.ontology'],
    ['l', 'NS-nud', 'social.nos.ontology'],
  ]);
});

test('a signed report verifies and parses back', () => {
  const e = sign(buildReport({ type: 'video', eventId: EVENT, pubkey: author.pk }, 'spam', { createdAt: 5 }), reporter);
  assert.ok(verifyNostrEvent(e));
  assert.deepEqual(parseReport(e), [{ id: e.id, reporter: reporter.pk, createdAt: 5, type: 'spam', target: `e:${EVENT}`, pubkey: author.pk }]);
});

test('labelsFromReports needs threshold distinct trusted reporters and ignores others', () => {
  const friends = [keypair(10), keypair(11), keypair(12)];
  const stranger = keypair(13);
  const rep = (k: ReturnType<typeof keypair>, ts: number) => sign(buildReport({ type: 'creator', pubkey: author.pk }, 'nudity', { createdAt: ts }), k);
  const two = [rep(friends[0], 1), rep(friends[1], 2), rep(friends[1], 3), rep(stranger, 4)];
  const opts = { trusted: friends.map((f) => f.pk), threshold: 3, verify: verifyNostrEvent };
  assert.deepEqual(labelsFromReports(two, opts), []);
  const three = [...two, rep(friends[2], 9)];
  const labels = labelsFromReports(three, opts);
  assert.equal(labels.length, 1);
  assert.equal(labels[0].namespace, 'nip56');
  assert.equal(labels[0].value, 'nudity');
  assert.deepEqual(labels[0].targets, [`p:${author.pk}`]);
  assert.equal(labels[0].createdAt, 9);
  // A forged report (bad signature) doesn't count.
  const forged = { ...rep(friends[2], 9), content: 'tampered' };
  assert.deepEqual(labelsFromReports([...two, forged], opts), []);
});
