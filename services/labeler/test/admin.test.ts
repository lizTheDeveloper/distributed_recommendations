import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { LabelerStore } from '../src/repo.ts';
import { createSigner } from '../src/signer.ts';
import { startAdmin } from '../src/admin.ts';
import { caseIdFor, ingestReports } from '../src/intake.ts';
import type { LabelerContext } from '../src/labeling.ts';
import { LABELER, MemoryRelays, NOW, RELAY, config, keypair, report } from './helpers.ts';

function http(url: string, opts: { method?: string; body?: string; headers?: Record<string, string> } = {}): Promise<{ status: number; body: string; headers: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const req = request(url, { method: opts.method ?? 'GET', headers: { ...(opts.body ? { 'content-type': 'application/x-www-form-urlencoded' } : {}), ...opts.headers } }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode!, body, headers: res.headers }));
    });
    req.on('error', reject);
    req.end(opts.body);
  });
}

async function setup() {
  const net = new MemoryRelays();
  const store = await LabelerStore.memory();
  const signer = await createSigner('key', { env: { LABELER_SECRET_KEY: LABELER.hex }, expectedPubkey: LABELER.pk });
  const ctx: LabelerContext = { store, labeler: LABELER.pk, signer, relays: [RELAY], relayOptions: { WebSocket: net.ctor(), timeoutMs: 1000, retries: 0 }, now: () => NOW };
  const ev = 'cd'.repeat(32);
  ingestReports([report(keypair(60), { type: 'video', eventId: ev, pubkey: keypair(61).pk }, 'spam', { content: '<script>alert(1)</script> spam' })], { config: config(), store, now: NOW });
  const admin = await startAdmin({ ctx, config: config(), reviewer: 'alice', port: 0 });
  return { net, store, admin, caseId: caseIdFor(`e:${ev}`) };
}

test('admin binds to 127.0.0.1 only', async () => {
  const store = await LabelerStore.memory();
  await assert.rejects(startAdmin({ ctx: { store, labeler: LABELER.pk, relays: [] }, config: config(), reviewer: 'a', host: '0.0.0.0' }), /127\.0\.0\.1 only/);
  const { admin } = await setup();
  assert.match(admin.url, /^http:\/\/127\.0\.0\.1:\d+\/$/);
  assert.equal((admin.server.address() as { address: string }).address, '127.0.0.1');
  await admin.close();
});

test('admin pages: escaped reporter text, collapsed, no scripts; Host header checked', async () => {
  const { admin, caseId } = await setup();
  const q = await http(admin.url);
  assert.equal(q.status, 200);
  assert.match(q.body, new RegExp(caseId));
  assert.match(String(q.headers['content-security-policy']), /default-src 'none'/);
  const c = await http(`${admin.url}case/${caseId}`);
  assert.ok(!c.body.includes('<script>'));
  assert.match(c.body, /<details><summary>Reporter's text<\/summary>&lt;script&gt;/);
  assert.match(c.body, /← reported/);
  const rebinding = await http(admin.url, { headers: { host: 'evil.example:80' } });
  assert.equal(rebinding.status, 421);
  await admin.close();
});

test('admin POSTs need the CSRF token and same origin; a label posted from the form is published and audited', async () => {
  const { admin, net, store, caseId } = await setup();
  const form = (extra: Record<string, string | string[]>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(extra)) for (const x of [v].flat()) p.append(k, x);
    return p.toString();
  };
  const body = { value: ['spam'], reason: 'Link spam on a reported video', expiresDays: '30' };
  assert.equal((await http(`${admin.url}case/${caseId}/label`, { method: 'POST', body: form(body) })).status, 403);
  assert.equal((await http(`${admin.url}case/${caseId}/label`, { method: 'POST', body: form({ ...body, csrf: 'x'.repeat(32) }) })).status, 403);
  const cross = await http(`${admin.url}case/${caseId}/label`, { method: 'POST', body: form({ ...body, csrf: admin.csrf }), headers: { origin: 'http://evil.example' } });
  assert.equal(cross.status, 403);
  assert.equal(net.sent().length, 0);

  const ok = await http(`${admin.url}case/${caseId}/label`, { method: 'POST', body: form({ ...body, csrf: admin.csrf }), headers: { origin: admin.url.slice(0, -1) } });
  assert.equal(ok.status, 303);
  assert.equal(net.sent(1985).length, 1);
  const [l] = store.labels();
  assert.equal(l.reviewer, 'alice');
  assert.equal(l.expiresAt, NOW + 30 * 86400);
  assert.equal(store.getCase(caseId)!.status, 'labeled');

  const bad = await http(`${admin.url}label/${l.id}/retract`, { method: 'POST', body: form({ csrf: admin.csrf, reason: 'short' }) });
  assert.equal(bad.status, 400);
  assert.match(bad.body, /reason of at least/);
  const r = await http(`${admin.url}label/${l.id}/retract`, { method: 'POST', body: form({ csrf: admin.csrf, reason: 'Appeal accepted after review' }) });
  assert.equal(r.status, 303);
  assert.equal(net.sent(5).length, 1);
  assert.deepEqual(store.auditLog().map((e) => e.action), ['label', 'retract']);
  await admin.close();
});
