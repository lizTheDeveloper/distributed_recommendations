// Typed access to the store, plus the audit log writer.

import type { Driver } from './store.ts';
import { GENESIS, auditHash, openDriver } from './store.ts';
import type { AuditEntry, CaseRecord, CaseStatus, LabelRecord, ReportRecord, ReporterState } from './types.ts';

export type NewAuditEntry = Omit<AuditEntry, 'seq' | 'prev' | 'hash' | 'at'> & { at?: number };

export class LabelerStore {
  readonly driver: Driver;
  constructor(driver: Driver) {
    this.driver = driver;
  }

  static async open(path: string, opts: { onFallback?: (msg: string) => void; forceJson?: boolean } = {}): Promise<LabelerStore> {
    return new LabelerStore(await openDriver(path, opts));
  }

  static memory(): Promise<LabelerStore> {
    return LabelerStore.open(':memory:');
  }

  tx<T>(fn: () => T): T {
    return this.driver.tx(fn);
  }

  close(): void {
    this.driver.close();
  }

  // reports
  reportKey(r: Pick<ReportRecord, 'reporter' | 'target' | 'type'>): string {
    return `${r.reporter}|${r.target}|${r.type}`;
  }
  getReport(key: string): ReportRecord | undefined {
    return this.driver.get('reports', key) as ReportRecord | undefined;
  }
  putReport(r: ReportRecord): void {
    this.driver.put('reports', this.reportKey(r), r);
  }
  deleteReport(key: string): void {
    this.driver.delete('reports', key);
  }
  reports(): ReportRecord[] {
    return this.driver.list('reports') as ReportRecord[];
  }
  reportsForCase(caseId: string): ReportRecord[] {
    return this.reports()
      .filter((r) => r.caseId === caseId)
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  // dedupe
  seen(eventId: string): boolean {
    return this.driver.get('seen', eventId) !== undefined;
  }
  markSeen(eventId: string, at: number): void {
    this.driver.put('seen', eventId, { id: eventId, at });
  }
  seenEntries(): { id: string; at: number }[] {
    return this.driver.list('seen') as { id: string; at: number }[];
  }
  deleteSeen(eventId: string): void {
    this.driver.delete('seen', eventId);
  }

  // cases
  getCase(id: string): CaseRecord | undefined {
    return this.driver.get('cases', id) as CaseRecord | undefined;
  }
  putCase(c: CaseRecord): void {
    this.driver.put('cases', c.id, c);
  }
  cases(status?: CaseStatus): CaseRecord[] {
    const all = this.driver.list('cases') as CaseRecord[];
    return status ? all.filter((c) => c.status === status) : all;
  }

  // labels
  getLabel(id: string): LabelRecord | undefined {
    return this.driver.get('labels', id) as LabelRecord | undefined;
  }
  putLabel(l: LabelRecord): void {
    this.driver.put('labels', l.id, l);
  }
  labels(): LabelRecord[] {
    return (this.driver.list('labels') as LabelRecord[]).sort((a, b) => a.decidedAt - b.decidedAt);
  }

  // reporters
  getReporter(pk: string): ReporterState {
    return (this.driver.get('reporters', pk) as ReporterState | undefined) ?? { pubkey: pk, recent: [], dropped: 0 };
  }
  putReporter(s: ReporterState): void {
    this.driver.put('reporters', s.pubkey, s);
  }
  reporterStates(): ReporterState[] {
    return this.driver.list('reporters') as ReporterState[];
  }
  deleteReporter(pk: string): void {
    this.driver.delete('reporters', pk);
  }

  // meta
  getMeta<T>(key: string): T | undefined {
    return this.driver.get('meta', key) as T | undefined;
  }
  setMeta(key: string, value: unknown): void {
    this.driver.put('meta', key, value);
  }

  // audit
  audit(entry: NewAuditEntry): AuditEntry {
    return this.tx(() => {
      const last = this.driver.lastAudit();
      const base: Omit<AuditEntry, 'hash'> = {
        ...entry,
        at: entry.at ?? Math.floor(Date.now() / 1000),
        seq: (last?.seq ?? 0) + 1,
        prev: last?.hash ?? GENESIS,
      };
      // Drop undefined fields so the hash is stable after a JSON round trip.
      const clean = JSON.parse(JSON.stringify(base)) as Omit<AuditEntry, 'hash'>;
      const full: AuditEntry = { ...clean, hash: auditHash(clean) };
      this.driver.appendAudit(full);
      return full;
    });
  }
  auditLog(): AuditEntry[] {
    return this.driver.audit();
  }
}
