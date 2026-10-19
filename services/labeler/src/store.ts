// Persistence: SQLite through node:sqlite (in Node 22.22 it loads without a flag
// and prints an ExperimentalWarning), or a JSON file when node:sqlite is missing
// or the path ends in `.json`. Both hold the same records:
//
//   reports    ReportRecord by `${reporter}|${target}|${type}`
//   seen       report event ids already processed (dedupe)
//   cases      CaseRecord by target
//   labels     LabelRecord by event id
//   reporters  ReporterState by pubkey (rate limits)
//   meta       cursors
//   audit      append-only, hash-chained (SQLite triggers refuse UPDATE/DELETE)
//
// Nothing here stores IP addresses: the labeler only makes outbound relay
// connections and never learns any.

import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { AuditEntry } from './types.ts';

export type Collection = 'reports' | 'seen' | 'cases' | 'labels' | 'reporters' | 'meta';
const COLLECTIONS: readonly Collection[] = ['reports', 'seen', 'cases', 'labels', 'reporters', 'meta'];

export interface Driver {
  readonly kind: 'sqlite' | 'json' | 'memory';
  get(coll: Collection, id: string): unknown;
  put(coll: Collection, id: string, value: unknown): void;
  delete(coll: Collection, id: string): void;
  list(coll: Collection): unknown[];
  appendAudit(e: AuditEntry): void;
  audit(): AuditEntry[];
  lastAudit(): AuditEntry | undefined;
  tx<T>(fn: () => T): T;
  close(): void;
}

// ------------------------------------------------------------------ SQLite

interface SqliteDb {
  exec(sql: string): void;
  prepare(sql: string): { run(...a: unknown[]): unknown; get(...a: unknown[]): unknown; all(...a: unknown[]): unknown[] };
  close(): void;
}

class SqliteDriver implements Driver {
  readonly kind = 'sqlite' as const;
  private depth = 0;
  private readonly db: SqliteDb;
  constructor(db: SqliteDb) {
    this.db = db;
    db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS records (coll TEXT NOT NULL, id TEXT NOT NULL, json TEXT NOT NULL, PRIMARY KEY (coll, id)) WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS audit (seq INTEGER PRIMARY KEY, json TEXT NOT NULL);
      CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit BEGIN SELECT RAISE(ABORT, 'audit log is append-only'); END;
      CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit BEGIN SELECT RAISE(ABORT, 'audit log is append-only'); END;
    `);
  }
  get(coll: Collection, id: string): unknown {
    const r = this.db.prepare('SELECT json FROM records WHERE coll = ? AND id = ?').get(coll, id) as { json: string } | undefined;
    return r ? JSON.parse(r.json) : undefined;
  }
  put(coll: Collection, id: string, value: unknown): void {
    this.db.prepare('INSERT INTO records (coll, id, json) VALUES (?, ?, ?) ON CONFLICT (coll, id) DO UPDATE SET json = excluded.json').run(coll, id, JSON.stringify(value));
  }
  delete(coll: Collection, id: string): void {
    this.db.prepare('DELETE FROM records WHERE coll = ? AND id = ?').run(coll, id);
  }
  list(coll: Collection): unknown[] {
    return (this.db.prepare('SELECT json FROM records WHERE coll = ? ORDER BY id').all(coll) as { json: string }[]).map((r) => JSON.parse(r.json));
  }
  appendAudit(e: AuditEntry): void {
    this.db.prepare('INSERT INTO audit (seq, json) VALUES (?, ?)').run(e.seq, JSON.stringify(e));
  }
  audit(): AuditEntry[] {
    return (this.db.prepare('SELECT json FROM audit ORDER BY seq').all() as { json: string }[]).map((r) => JSON.parse(r.json));
  }
  lastAudit(): AuditEntry | undefined {
    const r = this.db.prepare('SELECT json FROM audit ORDER BY seq DESC LIMIT 1').get() as { json: string } | undefined;
    return r ? JSON.parse(r.json) : undefined;
  }
  tx<T>(fn: () => T): T {
    if (this.depth > 0) return fn();
    this.depth++;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const out = fn();
      this.db.exec('COMMIT');
      return out;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    } finally {
      this.depth--;
    }
  }
  close(): void {
    this.db.close();
  }
}

// ------------------------------------------------------------------ JSON / memory

interface JsonShape {
  v: 1;
  records: Record<Collection, Record<string, unknown>>;
  audit: AuditEntry[];
}

class JsonDriver implements Driver {
  readonly kind: 'json' | 'memory';
  private data: JsonShape;
  private depth = 0;
  private readonly path: string | undefined;
  constructor(path: string | undefined) {
    this.path = path;
    this.kind = path ? 'json' : 'memory';
    const empty = (): JsonShape => ({ v: 1, records: Object.fromEntries(COLLECTIONS.map((c) => [c, {}])) as JsonShape['records'], audit: [] });
    this.data = empty();
    if (path && existsSync(path)) {
      const o = JSON.parse(readFileSync(path, 'utf8')) as JsonShape;
      if (o.v !== 1 || !o.records || !Array.isArray(o.audit)) throw new Error(`${path}: not a labeler store`);
      this.data = { ...empty(), ...o, records: { ...empty().records, ...o.records } };
    }
  }
  private flush(): void {
    if (!this.path || this.depth > 0) return;
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp-${process.pid}`;
    writeFileSync(tmp, JSON.stringify(this.data), { mode: 0o600 });
    renameSync(tmp, this.path);
    chmodSync(this.path, 0o600);
  }
  get(coll: Collection, id: string): unknown {
    const v = this.data.records[coll][id];
    return v === undefined ? undefined : structuredClone(v);
  }
  put(coll: Collection, id: string, value: unknown): void {
    this.data.records[coll][id] = structuredClone(value);
    this.flush();
  }
  delete(coll: Collection, id: string): void {
    delete this.data.records[coll][id];
    this.flush();
  }
  list(coll: Collection): unknown[] {
    return Object.keys(this.data.records[coll])
      .sort()
      .map((k) => structuredClone(this.data.records[coll][k]));
  }
  appendAudit(e: AuditEntry): void {
    this.data.audit.push(structuredClone(e));
    this.flush();
  }
  audit(): AuditEntry[] {
    return structuredClone(this.data.audit);
  }
  lastAudit(): AuditEntry | undefined {
    const e = this.data.audit.at(-1);
    return e && structuredClone(e);
  }
  tx<T>(fn: () => T): T {
    const snapshot = structuredClone(this.data);
    this.depth++;
    try {
      const out = fn();
      this.depth--;
      this.flush();
      return out;
    } catch (err) {
      this.depth--;
      this.data = snapshot;
      throw err;
    }
  }
  close(): void {
    this.flush();
  }
}

/** Is node:sqlite importable in this runtime? */
export async function sqliteAvailable(): Promise<boolean> {
  try {
    await import('node:sqlite');
    return true;
  } catch {
    return false;
  }
}

/**
 * Open the store. `:memory:` is an in-memory store (tests). A path ending in
 * `.json` is a JSON file. Anything else is SQLite, falling back to `<path>.json`
 * when node:sqlite is unavailable (`onFallback` is told).
 */
export async function openDriver(path: string, opts: { onFallback?: (msg: string) => void; forceJson?: boolean } = {}): Promise<Driver> {
  if (path === ':memory:') return new JsonDriver(undefined);
  if (path.endsWith('.json') || opts.forceJson) return new JsonDriver(path.endsWith('.json') ? path : `${path}.json`);
  let mod: { DatabaseSync: new (p: string) => SqliteDb } | undefined;
  try {
    mod = (await import('node:sqlite')) as unknown as { DatabaseSync: new (p: string) => SqliteDb };
  } catch {
    opts.onFallback?.(`node:sqlite is not available in Node ${process.versions.node}; using ${path}.json`);
    return new JsonDriver(`${path}.json`);
  }
  mkdirSync(dirname(path), { recursive: true });
  const db = new mod.DatabaseSync(path);
  try {
    chmodSync(path, 0o600);
  } catch {
    /* best effort */
  }
  return new SqliteDriver(db);
}

// ------------------------------------------------------------------ audit chain

export const GENESIS = '0'.repeat(64);

function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v);
}

export function auditHash(e: Omit<AuditEntry, 'hash'>): string {
  return createHash('sha256').update(canonical(e)).digest('hex');
}

/** Check every link of the audit chain. Returns the first broken seq, or undefined. */
export function verifyAuditChain(entries: readonly AuditEntry[]): { ok: true } | { ok: false; seq: number; why: string } {
  let prev = GENESIS;
  let seq = 0;
  for (const e of entries) {
    seq++;
    if (e.seq !== seq) return { ok: false, seq: e.seq, why: `expected seq ${seq}` };
    if (e.prev !== prev) return { ok: false, seq: e.seq, why: 'prev hash does not match' };
    const { hash, ...rest } = e;
    if (auditHash(rest) !== hash) return { ok: false, seq: e.seq, why: 'entry was modified' };
    prev = hash;
  }
  return { ok: true };
}
