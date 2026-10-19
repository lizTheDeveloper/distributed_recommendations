import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LabelerStore } from '../src/repo.ts';
import { sqliteAvailable, verifyAuditChain } from '../src/store.ts';
import { tmp } from './helpers.ts';

test('node:sqlite is available in this Node (22.22), so SQLite is the default store', async () => {
  assert.equal(await sqliteAvailable(), true);
  const s = await LabelerStore.open(join(tmp(), 'db.sqlite'));
  assert.equal(s.driver.kind, 'sqlite');
  s.close();
});

for (const kind of ['sqlite', 'json'] as const) {
  test(`${kind} store: records persist, transactions roll back, audit chain verifies`, async () => {
    const path = join(tmp(), kind === 'sqlite' ? 'db.sqlite' : 'db.json');
    let s = await LabelerStore.open(path);
    assert.equal(s.driver.kind, kind);
    s.setMeta('k', { a: 1 });
    s.audit({ at: 1, actor: 'alice', actorKind: 'human', action: 'dismiss', caseId: 'c1', reason: 'not a violation' });
    s.audit({ at: 2, actor: 'system', actorKind: 'system', action: 'purge', details: { reports: 0 } });
    assert.throws(() =>
      s.tx(() => {
        s.setMeta('k', { a: 2 });
        s.audit({ at: 3, actor: 'bob', actorKind: 'human', action: 'dismiss', reason: 'rolled back' });
        throw new Error('boom');
      }),
    );
    s.close();
    s = await LabelerStore.open(path);
    assert.deepEqual(s.getMeta('k'), { a: 1 });
    const log = s.auditLog();
    assert.equal(log.length, 2);
    assert.deepEqual(verifyAuditChain(log), { ok: true });
    assert.equal(log[1].prev, log[0].hash);
    assert.equal((statSync(path).mode & 0o777).toString(8), '600');
    s.close();
  });
}

test('audit chain detects edits, and SQLite refuses UPDATE/DELETE on the audit table', async () => {
  const dir = tmp();
  const jpath = join(dir, 'a.json');
  const j = await LabelerStore.open(jpath);
  j.audit({ at: 1, actor: 'alice', actorKind: 'human', action: 'label', reason: 'original reason here' });
  j.audit({ at: 2, actor: 'alice', actorKind: 'human', action: 'dismiss', reason: 'second entry here' });
  j.close();
  const raw = JSON.parse(readFileSync(jpath, 'utf8'));
  raw.audit[0].reason = 'rewritten afterwards';
  writeFileSync(jpath, JSON.stringify(raw));
  const j2 = await LabelerStore.open(jpath);
  assert.deepEqual(verifyAuditChain(j2.auditLog()), { ok: false, seq: 1, why: 'entry was modified' });

  const s = await LabelerStore.open(join(dir, 'b.sqlite'));
  s.audit({ at: 1, actor: 'alice', actorKind: 'human', action: 'label', reason: 'original reason here' });
  const db = (s.driver as unknown as { db: { exec(sql: string): void } }).db;
  assert.throws(() => db.exec(`UPDATE audit SET json = '{}'`), /append-only/);
  assert.throws(() => db.exec('DELETE FROM audit'), /append-only/);
  s.close();
});

test('forceJson / .json paths use the JSON file store (the fallback when node:sqlite is missing)', async () => {
  const dir = tmp();
  const s = await LabelerStore.open(join(dir, 'db.sqlite'), { forceJson: true });
  assert.equal(s.driver.kind, 'json');
  s.setMeta('x', 1);
  s.close();
  assert.ok(readFileSync(join(dir, 'db.sqlite.json'), 'utf8').includes('"x"'));
});
