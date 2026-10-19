#!/usr/bin/env -S node --experimental-strip-types --disable-warning=ExperimentalWarning
// match-feed-labeler: report intake, review queue, labels, audit. See README.md.

import { parseArgs } from 'node:util';
import { toNpub } from './deps.ts';
import type { ClosableSigner } from './deps.ts';
import { startAdmin } from './admin.ts';
import { checkReviewer, loadConfig } from './config.ts';
import type { LabelerConfig } from './config.ts';
import { purge, reviewQueue, runIntake } from './intake.ts';
import type { LabelerContext } from './labeling.ts';
import { ESCALATION_TARGETS, activeLabels, dismissCase, escalateCase, issueLabel, labelTemplate, reopenCase, retractLabel, retractionTemplate } from './labeling.ts';
import { LabelerStore } from './repo.ts';
import { SIGNER_MODES, createSigner } from './signer.ts';
import type { SignerMode } from './signer.ts';
import { verifyAuditChain } from './store.ts';
import { parseTargetSpec, subjectKind, targetFromKey } from './targets.ts';
import type { Target } from './targets.ts';
import { exportAudit, statementsOfReasons, toCsv, transparencySummary } from './transparency.ts';
import type { Escalation } from './types.ts';
import { VOCABULARY } from './vocabulary.ts';

const USAGE = `Usage: match-feed-labeler <command> [options]

Review:
  vocab                         the label values (from packages/moderation)
  intake [--watch <minutes>]    read NIP-56 reports addressed to the labeler into the queue
  queue [--status open|labeled|dismissed|all] [--json]
  show <case>                   one case and its reports
  label (--case <id> | --target <kind:value> ...) --value <v>[,<v>] --reason <text>
        [--expires 30d|12h|<ISO date>] [--legal-ground <text>] [--note <text>] [--publish]
                                DRY RUN unless --publish: prints the event and records nothing
  retract <label id> --reason <text> [--keep-closed] [--publish]
  dismiss <case> --reason <text>
  reopen <case> --reason <text>
  escalate <case> --to ${ESCALATION_TARGETS.join('|')} --reason <text> [--reference <ticket>]
  labels [--active] [--json]
  admin [--port 8787]           local web admin on 127.0.0.1 (needs --signer to publish)

Transparency:
  audit verify                  check the audit log's hash chain
  audit export [--format jsonl|csv] [--public] [--since <date>] [--until <date>]
  statements [--format jsonl|csv] [--public] [--since <date>] [--until <date>]
                                DSA Art. 17-style statements of reasons, one per label
  transparency [--since <date>] [--until <date>]   aggregate counts (JSON)
  purge                         apply the retention policy (config.retention)

Options:
  --config <file>     default: $LABELER_CONFIG or ./labeler.config.json
  --reviewer <name>   who decides (or LABELER_REVIEWER); written to the audit log, never published
  --signer bunker|key keys come from the environment only, never from argv:
                      bunker: LABELER_BUNKER_URL (+ optional LABELER_BUNKER_CLIENT_KEY)
                      key:    LABELER_SECRET_KEY
                      (each also as <NAME>_FILE, for Docker secrets)
  --quiet, -h/--help

Proxy: run with NODE_USE_ENV_PROXY=1 (the npm script does) so WebSocket uses HTTPS_PROXY.`;

class UsageError extends Error {}
const usage = (msg: string): never => {
  throw new UsageError(msg);
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?$/;
function parseDate(s: string | undefined, flag: string): number | undefined {
  if (s === undefined) return undefined;
  if (!DATE_RE.test(s)) usage(`${flag}: YYYY-MM-DD or an ISO timestamp`);
  const t = Date.parse(s.length === 10 ? `${s}T00:00:00Z` : s);
  if (Number.isNaN(t)) usage(`${flag}: not a date`);
  return Math.floor(t / 1000);
}

/** `30d`, `12h`, `90m` or an ISO date → Unix seconds. */
function parseExpiry(s: string | undefined, now: number): number | undefined {
  if (s === undefined) return undefined;
  const m = /^(\d{1,5})([dhm])$/.exec(s.trim());
  if (m) return now + Number(m[1]) * { d: 86_400, h: 3600, m: 60 }[m[2] as 'd' | 'h' | 'm'];
  const t = parseDate(s, '--expires')!;
  if (t <= now) usage('--expires must be in the future');
  return t;
}

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      config: { type: 'string' },
      reviewer: { type: 'string' },
      signer: { type: 'string' },
      publish: { type: 'boolean', default: false },
      case: { type: 'string' },
      target: { type: 'string', multiple: true, default: [] },
      value: { type: 'string', multiple: true, default: [] },
      reason: { type: 'string' },
      expires: { type: 'string' },
      'legal-ground': { type: 'string' },
      note: { type: 'string' },
      'keep-closed': { type: 'boolean', default: false },
      to: { type: 'string' },
      reference: { type: 'string' },
      status: { type: 'string', default: 'open' },
      active: { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
      format: { type: 'string', default: 'jsonl' },
      public: { type: 'boolean', default: false },
      since: { type: 'string' },
      until: { type: 'string' },
      watch: { type: 'string' },
      port: { type: 'string', default: '8787' },
      quiet: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
      // Refused outright: secrets never go on the command line (shell history, ps).
      nsec: { type: 'string' },
      'secret-key': { type: 'string' },
      key: { type: 'string' },
      bunker: { type: 'string' },
      'bunker-url': { type: 'string' },
    },
  });
  if (values.help || positionals.length === 0) {
    process.stdout.write(USAGE + '\n');
    return 0;
  }
  for (const f of ['nsec', 'secret-key', 'key', 'bunker', 'bunker-url'] as const) {
    if (values[f] !== undefined) usage('secrets are never accepted on the command line; use LABELER_SECRET_KEY or LABELER_BUNKER_URL in the environment');
  }
  const log = (s: string) => {
    if (!values.quiet) process.stderr.write(s + '\n');
  };
  const out = (s: string) => process.stdout.write(s + '\n');
  const [cmd, ...args] = positionals;

  if (cmd === 'vocab') {
    for (const v of VOCABULARY) out(`${v.value.padEnd(26)} ${v.category ? `${v.category} setting (default blur)` : v.action.padEnd(5)}  ${v.title}`);
    return 0;
  }

  const configPath = values.config ?? process.env.LABELER_CONFIG ?? './labeler.config.json';
  const config: LabelerConfig = loadConfig(configPath);
  const mode = values.signer as SignerMode | undefined;
  if (mode !== undefined && !SIGNER_MODES.includes(mode)) usage('--signer must be bunker or key');
  const now = () => Math.floor(Date.now() / 1000);
  const reviewer = () => checkReviewer(values.reviewer ?? process.env.LABELER_REVIEWER, config);
  const reason = () => values.reason ?? usage('--reason is required');

  let signer: ClosableSigner | undefined;
  const needSigner = async () => {
    if (!mode) usage(`${cmd} needs --signer bunker|key`);
    if (!signer) {
      if (mode === 'bunker') log('connecting to the remote signer (approve in your signer app if asked)…');
      signer = await createSigner(mode!, { expectedPubkey: config.labeler, bunker: { onauth: (u) => log(`remote signer asks you to authorize: ${u}`) } });
    }
    return signer;
  };

  const store = await LabelerStore.open(config.store, { onFallback: log });
  const ctx: LabelerContext = { store, labeler: config.labeler, relays: config.publishRelays, now };
  try {
    switch (cmd) {
      case 'whoami': {
        const s = await needSigner();
        out(`${toNpub(await s.getPublicKey())} (${mode}), store: ${store.driver.kind} ${config.store}`);
        return 0;
      }
      case 'intake': {
        if (config.autoBlur.enabled) {
          if (mode) ctx.signer = await needSigner();
          else log('note: autoBlur is enabled but no --signer was given; queueing only');
        }
        const once = async () => {
          const s = await runIntake({ config, store, ctx, now: now() });
          const { errors, ...counts } = s;
          log(`intake: ${Object.entries(counts).filter(([, v]) => v).map(([k, v]) => `${v} ${k}`).join(', ') || 'nothing new'}`);
          for (const e of errors) log(`  error: ${e}`);
          return errors.length && errors.length >= config.intakeRelays.length ? 1 : 0;
        };
        if (values.watch === undefined) return await once();
        const minutes = Number(values.watch);
        if (!(minutes >= 1 && minutes <= 1440)) usage('--watch: minutes, 1–1440');
        let stop = false;
        const halt = () => {
          stop = true;
        };
        process.once('SIGTERM', halt);
        process.once('SIGINT', halt);
        while (!stop) {
          await once().catch((err: Error) => log(`intake failed: ${err.message}`));
          for (let i = 0; i < minutes * 60 && !stop; i++) await new Promise((r) => setTimeout(r, 1000));
        }
        return 0;
      }
      case 'queue': {
        const list = values.status === 'open' ? reviewQueue(store) : values.status === 'all' ? store.cases() : store.cases(values.status as 'labeled' | 'dismissed');
        if (values.json) return (out(JSON.stringify(list, null, 2)), 0);
        if (!list.length) return (out('no cases'), 0);
        for (const c of list) {
          const t = targetFromKey(c.target);
          out(`${c.id}  ${c.status.padEnd(9)} ${(t ? subjectKind(t) : 'blob').padEnd(10)} ${Object.entries(c.types).map(([k, v]) => `${k}×${v}`).join(',').padEnd(24)} ${c.reporters.length} reporters (${c.trustedReporters.length} trusted)${c.autoBlurId ? ' auto-blurred' : ''}`);
        }
        return 0;
      }
      case 'show': {
        const c = store.getCase(args[0] ?? usage('show <case>'));
        if (!c) usage(`no case ${args[0]}`);
        out(JSON.stringify({ case: c, reports: store.reportsForCase(c!.id), labels: c!.labelIds.map((id) => store.getLabel(id)) }, null, 2));
        return 0;
      }
      case 'label': {
        const targets: Target[] = (values.target as string[]).map(parseTargetSpec);
        if (!targets.length && !values.case) usage('label needs --case <id> or at least one --target');
        if (values.case && !store.getCase(values.case)) usage(`no case ${values.case}`);
        const caseTarget = values.case ? targetFromKey(store.getCase(values.case)!.target) : undefined;
        if (!targets.length && !caseTarget) usage('this case\'s target cannot be labeled directly; give --target');
        const input = {
          targets: targets.length ? targets : [caseTarget!],
          values: (values.value as string[]).flatMap((v) => v.split(',')).map((v) => v.trim()).filter(Boolean),
          reason: reason(),
          reviewer: reviewer(),
          ...(values.case ? { caseId: values.case } : {}),
          ...(values.note ? { note: values.note } : {}),
          ...(values['legal-ground'] ? { legalGround: values['legal-ground'] } : {}),
          ...(values.expires ? { expiresAt: parseExpiry(values.expires, now()) } : {}),
        };
        if (!values.publish) {
          log('DRY RUN: nothing signed, published or recorded. Add --publish --signer bunker|key.');
          out(JSON.stringify(labelTemplate(input, now())));
          return 0;
        }
        ctx.signer = await needSigner();
        const rec = await issueLabel(ctx, input);
        log(`published label ${rec.id}: ${rec.relays.map((r) => `${r.relay} ${r.ok ? 'ok' : 'FAIL ' + r.message}`).join('; ')}`);
        out(JSON.stringify(rec.event));
        return 0;
      }
      case 'retract': {
        const id = args[0] ?? usage('retract <label id>');
        if (!store.getLabel(id)) usage(`no label ${id} in this labeler's records`);
        if (!values.publish) {
          log('DRY RUN: nothing signed, published or recorded. Add --publish --signer bunker|key.');
          out(JSON.stringify(retractionTemplate(id, reason(), now())));
          return 0;
        }
        ctx.signer = await needSigner();
        const rec = await retractLabel(ctx, id, { reason: reason(), reviewer: reviewer(), reopen: values['keep-closed'] ? false : undefined });
        log(`published deletion ${rec.retraction!.eventId} for label ${id}`);
        return 0;
      }
      case 'dismiss':
        dismissCase(ctx, args[0] ?? usage('dismiss <case>'), { reason: reason(), reviewer: reviewer() });
        return 0;
      case 'reopen':
        reopenCase(ctx, args[0] ?? usage('reopen <case>'), { reason: reason(), reviewer: reviewer() });
        return 0;
      case 'escalate':
        escalateCase(ctx, args[0] ?? usage('escalate <case>'), {
          to: (values.to ?? usage('--to is required')) as Escalation['to'],
          reason: reason(),
          reviewer: reviewer(),
          ...(values.reference ? { reference: values.reference } : {}),
        });
        return 0;
      case 'labels': {
        const list = values.active ? activeLabels(store, now()) : store.labels();
        if (values.json) return (out(JSON.stringify(list, null, 2)), 0);
        for (const l of list) out(`${l.id}  ${new Date(l.decidedAt * 1000).toISOString().slice(0, 10)} ${l.values.join(',').padEnd(20)} ${l.retraction ? 'retracted' : l.expiresAt && l.expiresAt <= now() ? 'expired' : 'active'}  ${l.automated ? 'automated' : l.reviewer}`);
        return 0;
      }
      case 'audit': {
        if (args[0] === 'verify') {
          const r = verifyAuditChain(store.auditLog());
          out(r.ok ? `audit log intact (${store.auditLog().length} entries)` : `audit log BROKEN at seq ${r.seq}: ${r.why}`);
          return r.ok ? 0 : 1;
        }
        if (args[0] !== 'export') usage('audit verify | audit export');
        const rows = exportAudit(store, { since: parseDate(values.since, '--since'), until: parseDate(values.until, '--until'), public: values.public });
        out(values.format === 'csv' ? toCsv(rows) : rows.map((r) => JSON.stringify(r)).join('\n'));
        return 0;
      }
      case 'statements': {
        const rows = statementsOfReasons(store, config, { since: parseDate(values.since, '--since'), until: parseDate(values.until, '--until'), public: values.public });
        out(values.format === 'csv' ? toCsv(rows) : rows.map((r) => JSON.stringify(r)).join('\n'));
        return 0;
      }
      case 'transparency':
        out(JSON.stringify(transparencySummary(store, config, { since: parseDate(values.since, '--since'), until: parseDate(values.until, '--until') }), null, 2));
        return 0;
      case 'purge':
        out(JSON.stringify(purge(store, config, now())));
        return 0;
      case 'admin': {
        const r = reviewer();
        if (mode) ctx.signer = await needSigner();
        else log('note: no --signer: you can browse and dismiss, but publishing labels will fail');
        const port = Number(values.port);
        if (!Number.isInteger(port) || port < 1 || port > 65535) usage('--port: 1–65535');
        const a = await startAdmin({ ctx, config, reviewer: r, port });
        log(`admin for ${r} at ${a.url} (127.0.0.1 only; Ctrl-C to stop)`);
        await new Promise<void>((resolve) => {
          process.once('SIGINT', resolve);
          process.once('SIGTERM', resolve);
        });
        await a.close();
        return 0;
      }
      default:
        usage(`unknown command ${cmd}`);
    }
    return 0;
  } finally {
    await signer?.close();
    store.close();
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: Error) => {
    if (err instanceof UsageError) {
      process.stderr.write(`error: ${err.message}\n\nRun with --help for usage.\n`);
      process.exit(2);
    }
    process.stderr.write(`error: ${err.message}\n`);
    process.exit(1);
  },
);
