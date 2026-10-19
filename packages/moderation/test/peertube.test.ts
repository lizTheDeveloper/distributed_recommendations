import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PEERTUBE_ABUSE_REASONS,
  PeerTubeModerationClient,
  PeerTubeModerationError,
  foldBlocklistActions,
  parseMuteFeed,
  planReport,
  prepareAbuseReport,
  videoRefFromUrl,
} from '../src/index.ts';
import { fakeFetch, keypair, res, video } from './helpers.ts';

const UUID = '7516913d-6a4e-4b9a-9d3b-123456789abc';
const WATCH = `https://tube.example/videos/watch/${UUID}`;

test('videoRefFromUrl reads /videos/watch/<uuid> and /w/<shortUUID>', () => {
  assert.deepEqual(videoRefFromUrl(WATCH), { instance: 'https://tube.example', videoId: UUID });
  assert.deepEqual(videoRefFromUrl('https://tube.example/w/kkGMgK9ZtnKfYAgnEtQxbv'), { instance: 'https://tube.example', videoId: 'kkGMgK9ZtnKfYAgnEtQxbv' });
  assert.equal(videoRefFromUrl('https://tube.example/c/alice'), null);
  assert.equal(videoRefFromUrl('javascript:alert(1)'), null);
});

test('prepareAbuseReport builds the POST /api/v1/abuses body PeerTube validates', () => {
  const p = prepareAbuseReport({ instance: 'tube.example', videoId: UUID, reason: 'Spam link in description', predefinedReasons: ['spamOrMisleading'], startAt: 10, endAt: 20 });
  assert.equal(p.method, 'POST');
  assert.equal(p.url, 'https://tube.example/api/v1/abuses');
  assert.deepEqual(p.body, { reason: 'Spam link in description', predefinedReasons: ['spamOrMisleading'], video: { id: UUID, startAt: 10, endAt: 20 } });
  const acc = prepareAbuseReport({ instance: 'https://tube.example/', accountId: 42, reason: 'impersonating me' });
  assert.deepEqual(acc.body, { reason: 'impersonating me', account: { id: 42 } });
});

test('prepareAbuseReport enforces PeerTube constraints', () => {
  const base = { instance: 'tube.example', videoId: UUID };
  assert.throws(() => prepareAbuseReport({ ...base, reason: 'x' }), /at least 2/);
  assert.equal(prepareAbuseReport({ ...base, reason: 'y'.repeat(5000) }).body.reason.length, 3000);
  assert.throws(() => prepareAbuseReport({ ...base, reason: 'ok', endAt: 5 }), /startAt/);
  assert.throws(() => prepareAbuseReport({ ...base, reason: 'ok', startAt: 5, endAt: 5 }), /startAt/);
  assert.throws(() => prepareAbuseReport({ ...base, reason: 'ok', startAt: -1 }), /integer/);
  // The OpenAPI file says violentOrAbusive; the server only accepts violentOrRepulsive.
  assert.throws(() => prepareAbuseReport({ ...base, reason: 'ok', predefinedReasons: ['violentOrAbusive' as never] }), /unknown PeerTube reason/);
  assert.ok(PEERTUBE_ABUSE_REASONS.includes('violentOrRepulsive'));
  assert.throws(() => prepareAbuseReport({ instance: 'tube.example', reason: 'ok' }), /video or an account/);
  assert.throws(() => prepareAbuseReport({ ...base, videoId: '../../x', reason: 'ok' }), /videoId/);
});

test('submitAbuse never sends without explicit confirmation', async () => {
  const f = fakeFetch(() => res(200, { abuse: { id: 7 } }));
  const c = new PeerTubeModerationClient({ fetch: f.fetch });
  const p = prepareAbuseReport({ instance: 'tube.example', videoId: UUID, reason: 'spam' });
  await assert.rejects(c.submitAbuse(p, { accessToken: 'tok', confirmed: false }), /not confirmed/);
  await assert.rejects(c.submitAbuse(p, { accessToken: 'tok' } as never), /not confirmed/);
  assert.equal(f.calls.length, 0);
  assert.deepEqual(await c.submitAbuse(p, { accessToken: 'tok', confirmed: true }), { id: 7 });
  assert.equal(f.calls.length, 1);
  const { url, init } = f.calls[0];
  assert.equal(url, 'https://tube.example/api/v1/abuses');
  assert.equal(init?.method, 'POST');
  assert.equal(init?.credentials, 'omit');
  assert.equal((init?.headers as Record<string, string>).authorization, 'Bearer tok');
  assert.deepEqual(JSON.parse(String(init?.body)), p.body);
});

test('submitAbuse explains PeerTube errors', async () => {
  const p = prepareAbuseReport({ instance: 'tube.example', videoId: UUID, reason: 'spam' });
  const c = new PeerTubeModerationClient({ fetch: fakeFetch(() => res(403, { status: 403 })).fetch });
  await assert.rejects(c.submitAbuse(p, { accessToken: 't', confirmed: true }), (e: unknown) => e instanceof PeerTubeModerationError && e.status === 403 && /own video/.test(e.message));
});

test('resolveAccountId and instanceConfig read public endpoints without credentials', async () => {
  const f = fakeFetch((url) => {
    if (url.endsWith('/api/v1/accounts/bob%40other.example')) return res(200, { id: 99, name: 'bob' });
    if (url.endsWith('/api/v1/config')) return res(200, { serverVersion: '8.3.1', instance: { isNSFW: true, defaultNSFWPolicy: 'do_not_list' }, blocklist: { publicLog: { enabled: false } } });
    return res(404, {});
  });
  const c = new PeerTubeModerationClient({ fetch: f.fetch });
  assert.equal(await c.resolveAccountId('tube.example', '@Bob@other.example'), 99);
  assert.deepEqual(await c.instanceConfig('tube.example'), { isNSFW: true, defaultNSFWPolicy: 'do_not_list', publicLogEnabled: false, serverVersion: '8.3.1' });
  for (const call of f.calls) {
    assert.equal(call.init?.credentials, 'omit');
    assert.equal(call.init?.referrerPolicy, 'no-referrer');
  }
  await assert.rejects(c.resolveAccountId('tube.example', 'nobody@x.example'), PeerTubeModerationError);
});

test('public blocklist log: null when disabled (403) or missing (400), paged by startDate', async () => {
  const off = new PeerTubeModerationClient({ fetch: fakeFetch(() => res(403, {})).fetch });
  assert.equal(await off.publicBlocklistLog('tube.example'), null);
  const old = new PeerTubeModerationClient({ fetch: fakeFetch(() => res(400, {})).fetch });
  assert.equal(await old.publicBlocklistLog('tube.example'), null);

  const page1 = Array.from({ length: 500 }, (_, i) => ({ type: 'block', target: `u${i}@bad.example`, createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString() }));
  const page2 = [page1[499], { type: 'unblock', target: 'u0@bad.example', createdAt: '2026-02-01T00:00:00.000Z' }];
  const f = fakeFetch((url) => res(200, { name: 'Tube', actions: url.includes('startDate=') ? page2 : page1 }));
  const c = new PeerTubeModerationClient({ fetch: f.fetch });
  const log = await c.publicBlocklistLog('tube.example');
  assert.equal(log?.length, 501);
  assert.equal(f.calls.length, 2);
  assert.match(f.calls[1].url, /startDate=2026-01-01T00%3A08%3A19.000Z/);
  const folded = foldBlocklistActions(log!);
  assert.equal(folded.accounts.length, 499);
  assert.ok(!folded.accounts.includes('u0@bad.example'));
});

test('foldBlocklistActions applies actions in time order and splits accounts from hosts', () => {
  const r = foldBlocklistActions([
    { type: 'unblock', target: 'spam.example', createdAt: '2026-03-01T00:00:00Z' },
    { type: 'block', target: 'spam.example', createdAt: '2026-01-01T00:00:00Z' },
    { type: 'block', target: 'Troll@Tube.Example', createdAt: '2026-01-02T00:00:00Z' },
    { type: 'block', target: 'bad.example', createdAt: '2026-01-03T00:00:00Z' },
    { type: 'block', target: 'not a target', createdAt: '2026-01-03T00:00:00Z' },
  ]);
  assert.deepEqual(r, { accounts: ['troll@tube.example'], hosts: ['bad.example'] });
});

test('parseMuteFeed reads PeerTube 8.3 lists and the old auto-mute plugin format', () => {
  assert.deepEqual(parseMuteFeed({ name: 'x', actions: [{ type: 'block', target: 'a.example', createdAt: 't' }, { type: 'nuke', target: 'b' }] }), [
    { type: 'block', target: 'a.example', createdAt: 't' },
  ]);
  assert.deepEqual(parseMuteFeed({ data: [{ value: 'peertube.cpy.re' }, { value: 'root@peertube.cpy.re', action: 'remove', updatedAt: 'u' }] }), [
    { type: 'block', target: 'peertube.cpy.re', createdAt: '' },
    { type: 'unblock', target: 'root@peertube.cpy.re', createdAt: 'u' },
  ]);
  assert.throws(() => parseMuteFeed({}), /neither/);
});

test('blockStatus asks in chunks and returns only server blocks', async () => {
  const accounts = Array.from({ length: 45 }, (_, i) => `u${i}@x.example`);
  const f = fakeFetch((url) => {
    const q = new URL(url).searchParams;
    const out: Record<string, Record<string, unknown>> = { accounts: {}, hosts: {} };
    for (const a of q.getAll('accounts')) out.accounts[a] = { blockedByServer: a === 'u3@x.example', blockedByUser: false };
    for (const h of q.getAll('hosts')) out.hosts[h] = { blockedByServer: h === 'bad.example' };
    return res(200, out);
  });
  const c = new PeerTubeModerationClient({ fetch: f.fetch });
  const r = await c.blockStatus('tube.example', { accounts, hosts: ['bad.example', 'ok.example'] });
  assert.deepEqual(r, { accounts: ['u3@x.example'], hosts: ['bad.example'] });
  assert.equal(f.calls.length, 2);
  assert.match(f.calls[0].url, /^https:\/\/tube\.example\/api\/v1\/blocklist\/status\?accounts=/);
});

test('instanceDefaults prefers the public log, falls back to status, else reports none', async () => {
  const mk = (logOn: boolean) =>
    fakeFetch((url) => {
      if (url.endsWith('/api/v1/config')) return res(200, { instance: { isNSFW: false }, blocklist: { publicLog: { enabled: logOn } } });
      if (url.includes('public-log')) return res(200, { name: 'T', actions: [{ type: 'block', target: 'bad.example', createdAt: '2026-01-01T00:00:00Z' }] });
      if (url.includes('blocklist/status')) return res(200, { accounts: { 'm@x.example': { blockedByServer: true } }, hosts: {} });
      return res(404, {});
    });
  const withLog = await new PeerTubeModerationClient({ fetch: mk(true).fetch, now: () => 5 }).instanceDefaults('tube.example', { accounts: ['m@x.example'] });
  assert.equal(withLog.source, 'public-log');
  assert.deepEqual(withLog.blockedHosts, ['bad.example']);
  assert.equal(withLog.fetchedAt, 5);
  const viaStatus = await new PeerTubeModerationClient({ fetch: mk(false).fetch }).instanceDefaults('tube.example', { accounts: ['m@x.example'] });
  assert.equal(viaStatus.source, 'status');
  assert.deepEqual(viaStatus.blockedAccounts, ['m@x.example']);
  const none = mk(false);
  const n = await new PeerTubeModerationClient({ fetch: none.fetch }).instanceDefaults('tube.example');
  assert.equal(n.source, 'none');
  assert.equal(none.calls.length, 1);
});

test('planReport: PeerTube report to the hosting instance first, NIP-56 when a Nostr event exists', () => {
  const pk = keypair(3).pk;
  const v = video(WATCH);
  const plan = planReport({ video: v, type: 'illegal', details: 'minor in danger', meta: { eventId: 'e'.repeat(64), pubkey: pk }, now: 10 });
  assert.equal(plan.peertube?.url, 'https://tube.example/api/v1/abuses');
  assert.deepEqual(plan.peertube?.body, { reason: 'Something that may be illegal: minor in danger', predefinedReasons: ['serverRules'], video: { id: UUID } });
  assert.deepEqual(plan.nostr?.tags, [['e', 'e'.repeat(64), 'illegal'], ['p', pk]]);
  assert.ok(plan.notes.some((n) => /hotline/.test(n)));
  const via = planReport({ video: v, type: 'spam', viaInstance: 'home.example', peertubeReasons: ['rights'] });
  assert.equal(via.peertube?.instance, 'https://home.example');
  assert.deepEqual(via.peertube?.body.predefinedReasons, ['spamOrMisleading', 'rights']);
  assert.equal(via.nostr, undefined);
  assert.ok(via.notes[0].includes('forwards it to tube.example'));
  const nonPt = planReport({ video: video('https://example.org/clip.mp4'), type: 'spam' });
  assert.equal(nonPt.peertube, undefined);
});
