// Minimal local web admin for reviewers. Optional; the CLI does everything too.
//
// - Binds to 127.0.0.1 only (refuses any other address). Reach it from another
//   machine through an SSH tunnel, never by exposing it.
// - Checks the Host header (DNS rebinding) and Origin, and needs a per-process
//   CSRF token on every POST.
// - No scripts, no external resources, no media: targets are shown as text and
//   reporter text is collapsed by default (reviewer wellbeing, README).
// - Logs nothing about requests.

import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { toNpub } from './deps.ts';
import type { LabelerConfig } from './config.ts';
import { reviewQueue } from './intake.ts';
import type { LabelerContext } from './labeling.ts';
import { ESCALATION_TARGETS, activeLabels, dismissCase, escalateCase, issueLabel, retractLabel } from './labeling.ts';
import { subjectKind, targetFromKey } from './targets.ts';
import type { CaseRecord, Escalation, LabelRecord } from './types.ts';
import { REPORT_TYPE_HINTS, VOCABULARY } from './vocabulary.ts';

export const ADMIN_HOST = '127.0.0.1';
const MAX_BODY = 16 * 1024;

export interface AdminOptions {
  ctx: LabelerContext;
  config: LabelerConfig;
  /** The reviewer using this admin (one per process). */
  reviewer: string;
  port?: number;
  host?: string;
}

export interface AdminServer {
  url: string;
  csrf: string;
  server: Server;
  close(): Promise<void>;
}

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const date = (t?: number) => (t ? new Date(t * 1000).toISOString().replace('T', ' ').slice(0, 16) + 'Z' : '');
const short = (pk: string) => {
  try {
    const n = toNpub(pk);
    return `${n.slice(0, 12)}…${n.slice(-4)}`;
  } catch {
    return pk.slice(0, 12);
  }
};

const STYLE = `body{font:15px/1.45 system-ui,sans-serif;margin:0 auto;max-width:960px;padding:16px;color:#1b1b1b;background:#fafafa}
@media (prefers-color-scheme:dark){body{color:#e8e8e8;background:#161616}input,textarea,select{background:#222;color:#eee}}
table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #8884;padding:6px;text-align:left;vertical-align:top}
.note{border-left:4px solid #c80;padding:8px 12px;background:#c801}.err{border-left:4px solid #c00;padding:8px 12px}
code{word-break:break-all}fieldset{margin:12px 0;border:1px solid #8886}label{display:inline-block;margin:2px 10px 2px 0}
textarea,input[type=text]{width:100%;box-sizing:border-box}`;

function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${STYLE}</style></head><body>
<nav><a href="/">Queue</a> · <a href="/labels">Labels</a></nav>
<p class="note">Take breaks. Targets are shown as text and never loaded here. Open media only when you must, with sound off, and stop when you have what you need. Suspected child sexual abuse material: do not open, download or share it; follow README "Illegal content".</p>
${body}</body></html>`;
}

function queueHtml(cases: CaseRecord[]): string {
  if (!cases.length) return '<h1>Queue</h1><p>No open cases.</p>';
  const rows = cases
    .map((c) => {
      const t = targetFromKey(c.target);
      return `<tr><td><a href="/case/${esc(c.id)}">${esc(c.id)}</a></td><td>${esc(t ? subjectKind(t) : 'blob')}</td><td>${esc(Object.entries(c.types).map(([k, v]) => `${k}×${v}`).join(', '))}</td><td>${c.reporters.length} (${c.trustedReporters.length} trusted)</td><td>${esc(date(c.openedAt))}</td><td>${c.autoBlurId ? 'auto-blurred' : ''}</td></tr>`;
    })
    .join('');
  return `<h1>Queue (${cases.length} open)</h1><table><tr><th>Case</th><th>Subject</th><th>Reported for</th><th>Reporters</th><th>Opened</th><th></th></tr>${rows}</table>`;
}

function labelRow(l: LabelRecord, csrf: string): string {
  const state = l.retraction ? `retracted ${esc(date(l.retraction.at))}` : l.expiresAt ? `expires ${esc(date(l.expiresAt))}` : 'active';
  const form = l.retraction
    ? ''
    : `<form method="post" action="/label/${esc(l.id)}/retract"><input type="hidden" name="csrf" value="${esc(csrf)}"><input type="text" name="reason" placeholder="Public reason for retracting (min 10 characters)" required minlength="10"><button>Retract</button></form>`;
  return `<tr><td><code>${esc(l.id.slice(0, 16))}…</code></td><td>${esc(l.values.join(', '))}</td><td>${esc(l.reason)}</td><td>${esc(l.automated ? 'automated' : l.reviewer)}</td><td>${state}</td><td>${form}</td></tr>`;
}

function caseHtml(c: CaseRecord, opts: AdminOptions, csrf: string): string {
  const { store } = opts.ctx;
  const t = targetFromKey(c.target);
  const reports = store.reportsForCase(c.id);
  const hints = new Set(Object.keys(c.types).flatMap((k) => REPORT_TYPE_HINTS[k] ?? []));
  const reportRows = reports
    .map(
      (r) =>
        `<tr><td>${esc(r.type)}</td><td>${esc(short(r.reporter))}${r.trusted ? ' (trusted)' : ''}</td><td>${esc(date(r.createdAt))}</td><td>${r.content ? `<details><summary>Reporter's text</summary>${esc(r.content)}</details>` : ''}</td></tr>`,
    )
    .join('');
  const labels = c.labelIds.map((id) => store.getLabel(id)).filter((l): l is LabelRecord => !!l);
  const vocab = VOCABULARY.map(
    (v) => `<label><input type="checkbox" name="value" value="${esc(v.value)}"${hints.has(v.value) ? ' data-hint' : ''}> ${esc(v.title)} <small>(${esc(v.value)}, ${esc(v.category ? `${v.category} setting` : v.action)})${hints.has(v.value) ? ' ← reported' : ''}</small></label>`,
  ).join('');
  const hidden = `<input type="hidden" name="csrf" value="${esc(csrf)}">`;
  const decide =
    c.status === 'open'
      ? `<form method="post" action="/case/${esc(c.id)}/label">${hidden}<fieldset><legend>Label</legend>${vocab}
<p><label for="reason">Public reason (published with the label; no personal data)</label><textarea id="reason" name="reason" required minlength="10" maxlength="500"></textarea></p>
<p><label for="lg">Legal ground (required for "illegal"; not published)</label><input type="text" id="lg" name="legalGround"></p>
<p><label for="note">Internal note (audit log only)</label><input type="text" id="note" name="note"></p>
<p><label for="exp">Expires after (days, empty = until retracted)</label><input type="text" id="exp" name="expiresDays" inputmode="numeric"></p>
<button>Sign and publish label</button></fieldset></form>
<form method="post" action="/case/${esc(c.id)}/dismiss">${hidden}<fieldset><legend>Dismiss (no label)</legend><input type="text" name="reason" required minlength="10" placeholder="Why no action (audit log)"><button>Dismiss</button></fieldset></form>`
      : `<p>Status: <strong>${esc(c.status)}</strong> ${esc(date(c.resolvedAt))}</p>`;
  const escalate = `<form method="post" action="/case/${esc(c.id)}/escalate">${hidden}<fieldset><legend>Record an escalation</legend><select name="to">${ESCALATION_TARGETS.map((x) => `<option>${x}</option>`).join('')}</select> <input type="text" name="reference" placeholder="Their ticket / report number (never the material)"><input type="text" name="reason" required minlength="10" placeholder="What was escalated and why"><button>Record</button></fieldset></form>`;
  const escRows = c.escalations.map((e: Escalation) => `<li>${esc(e.to)} ${esc(date(e.at))} by ${esc(e.by)} ${esc(e.reference ?? '')}</li>`).join('');
  return `<h1>Case ${esc(c.id)}</h1>
<p>Subject: <strong>${esc(t ? subjectKind(t) : 'blob')}</strong> <code>${esc(c.target)}</code></p>
<p>${c.reporters.length} reporters (${c.trustedReporters.length} trusted). Opened ${esc(date(c.openedAt))}.</p>
<h2>Reports</h2><table><tr><th>Type</th><th>Reporter</th><th>Date</th><th>Text</th></tr>${reportRows || '<tr><td colspan="4">Report records were purged (retention).</td></tr>'}</table>
${labels.length ? `<h2>Labels</h2><table>${labels.map((l) => labelRow(l, csrf)).join('')}</table>` : ''}
${decide}${escalate}${escRows ? `<ul>${escRows}</ul>` : ''}`;
}

function readBody(req: IncomingMessage): Promise<URLSearchParams> {
  return new Promise((resolve, reject) => {
    if (!/^application\/x-www-form-urlencoded\b/.test(req.headers['content-type'] ?? '')) return reject(new HttpError(415, 'form posts only'));
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new HttpError(413, 'too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(new URLSearchParams(Buffer.concat(chunks).toString('utf8'))));
    req.on('error', reject);
  });
}

class HttpError extends Error {
  readonly status: number;
  constructor(status: number, msg: string) {
    super(msg);
    this.status = status;
  }
}

function send(res: ServerResponse, status: number, html: string, headers: Record<string, string> = {}): void {
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'cache-control': 'no-store',
    'x-frame-options': 'DENY',
    ...headers,
  });
  res.end(html);
}

export async function startAdmin(opts: AdminOptions): Promise<AdminServer> {
  const host = opts.host ?? ADMIN_HOST;
  if (host !== '127.0.0.1') throw new Error('the admin binds to 127.0.0.1 only; use an SSH tunnel to reach it from elsewhere');
  const csrf = randomBytes(24).toString('base64url');
  const csrfBuf = Buffer.from(csrf);
  let allowedHosts: Set<string> = new Set();
  const { ctx } = opts;

  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    if (!allowedHosts.has(String(req.headers.host ?? '').toLowerCase())) throw new HttpError(421, 'unexpected Host header');
    const url = new URL(req.url ?? '/', 'http://local');
    const parts = url.pathname.split('/').filter(Boolean);
    if (req.method === 'GET') {
      if (parts.length === 0) return send(res, 200, page('Labeler queue', queueHtml(reviewQueue(ctx.store))));
      if (parts[0] === 'labels' && parts.length === 1) {
        const all = ctx.store.labels().reverse();
        const active = new Set(activeLabels(ctx.store, (ctx.now ?? (() => Math.floor(Date.now() / 1000)))()).map((l) => l.id));
        return send(res, 200, page('Labels', `<h1>Labels (${active.size} in force)</h1><table>${all.map((l) => labelRow(l, csrf)).join('')}</table>`));
      }
      if (parts[0] === 'case' && parts.length === 2) {
        const c = ctx.store.getCase(parts[1]);
        if (!c) throw new HttpError(404, 'no such case');
        return send(res, 200, page(`Case ${c.id}`, caseHtml(c, opts, csrf)));
      }
      throw new HttpError(404, 'not found');
    }
    if (req.method !== 'POST') throw new HttpError(405, 'method not allowed');
    const origin = req.headers.origin;
    if (origin !== undefined && !allowedHosts.has(origin.replace(/^http:\/\//, '').toLowerCase())) throw new HttpError(403, 'cross-origin post');
    const form = await readBody(req);
    const token = Buffer.from(form.get('csrf') ?? '');
    if (token.length !== csrfBuf.length || !timingSafeEqual(token, csrfBuf)) throw new HttpError(403, 'bad CSRF token');
    const reason = form.get('reason') ?? '';
    if (parts[0] === 'case' && parts.length === 3) {
      const id = parts[1];
      if (parts[2] === 'label') {
        const days = (form.get('expiresDays') ?? '').trim();
        const now = (ctx.now ?? (() => Math.floor(Date.now() / 1000)))();
        if (days && !/^\d{1,4}$/.test(days)) throw new HttpError(400, 'expiry: whole days');
        await issueLabel(ctx, {
          targets: [],
          caseId: id,
          values: form.getAll('value'),
          reason,
          reviewer: opts.reviewer,
          ...(form.get('note') ? { note: form.get('note')! } : {}),
          ...(form.get('legalGround') ? { legalGround: form.get('legalGround')! } : {}),
          ...(days && Number(days) > 0 ? { expiresAt: now + Number(days) * 86_400 } : {}),
        });
      } else if (parts[2] === 'dismiss') dismissCase(ctx, id, { reason, reviewer: opts.reviewer });
      else if (parts[2] === 'escalate') {
        escalateCase(ctx, id, { to: (form.get('to') ?? '') as Escalation['to'], reviewer: opts.reviewer, reason, ...(form.get('reference') ? { reference: form.get('reference')! } : {}) });
      } else throw new HttpError(404, 'not found');
      return send(res, 303, '', { location: `/case/${encodeURIComponent(id)}` });
    }
    if (parts[0] === 'label' && parts.length === 3 && parts[2] === 'retract') {
      await retractLabel(ctx, parts[1], { reason, reviewer: opts.reviewer });
      return send(res, 303, '', { location: '/labels' });
    }
    throw new HttpError(404, 'not found');
  };

  const server = createServer((req, res) => {
    handle(req, res).catch((err: unknown) => {
      const status = err instanceof HttpError ? err.status : 400;
      if (!res.headersSent) send(res, status, page('Error', `<p class="err">${esc((err as Error).message)}</p><p><a href="/">Back to the queue</a></p>`));
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port ?? 8787, host, () => resolve());
  });
  const port = (server.address() as AddressInfo).port;
  allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  return {
    url: `http://127.0.0.1:${port}/`,
    csrf,
    server,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}
