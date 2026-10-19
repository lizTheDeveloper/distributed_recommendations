// PeerTube: abuse reports to the hosting instance, and the instance's own
// public moderation data.
//
// Checked on 2026-10-19 against PeerTube's OpenAPI (support/doc/api/openapi.yaml,
// develop and master, version 8.3.0) and its server code:
// - POST /api/v1/abuses needs an OAuth2 user token on that instance. Body
//   `{reason (2–3000 chars), predefinedReasons?, video?: {id, startAt?, endAt?},
//   comment?: {id}, account?: {id}}`; one of video/comment/account is required.
//   The server accepts `violentOrRepulsive` (packages/core-utils
//   abusePredefinedReasonsMap); the OpenAPI enum says `violentOrAbusive`, which
//   the server rejects. We follow the server.
// - A report filed on your own instance about a remote video is forwarded to the
//   video's origin instance as an ActivityPub `Flag` (server/core/lib/moderation.ts,
//   send-flag.ts), so either instance works; the origin is where it is acted on.
// - GET /api/v1/blocklist/status?accounts=…&hosts=… is public (no auth) and says
//   whether the SERVER blocks each account/host (`blockedByServer`). Point queries only.
// - GET /api/v1/server/blocklist/public-log?startDate=… (PeerTube >= 8.3) lists the
//   server's block/unblock actions as `{name, actions: [{type, target, createdAt}]}`,
//   500 per page, only when the admin enabled `blocklist.public_log`; otherwise 403.
//   Off on framatube.org and peertube.tv (8.3.1) on 2026-10-19; 400 on 8.2.4 (tilvids.com).
// - The full server blocklists (GET /api/v1/server/blocklist/accounts|servers) are admin-only.

import type { FetchLike, FetchResponseLike } from './types.ts';
import type { ReportType } from './reports.ts';
import { cleanDisplay, hostOf, normHandle, normHost } from './text.ts';

/** PeerTube's predefined abuse reasons, as its server validates them. */
export const PEERTUBE_ABUSE_REASONS = [
  'violentOrRepulsive',
  'hatefulOrAbusive',
  'spamOrMisleading',
  'privacy',
  'rights',
  'serverRules',
  'thumbnails',
  'captions',
] as const;
export type PeerTubeAbuseReason = (typeof PEERTUBE_ABUSE_REASONS)[number];

export const PEERTUBE_ABUSE_LIMITS = { reasonMin: 2, reasonMax: 3000, maxPredefined: 8 } as const;

/** Default mapping from a NIP-56 type (our report UI) to PeerTube's categories. */
export const REPORT_TYPE_TO_PEERTUBE: Readonly<Record<ReportType, PeerTubeAbuseReason[]>> = {
  nudity: ['serverRules'],
  malware: ['spamOrMisleading'],
  profanity: ['hatefulOrAbusive'],
  illegal: ['serverRules'],
  spam: ['spamOrMisleading'],
  impersonation: ['spamOrMisleading'],
  other: [],
};

/** `POST /api/v1/abuses` body (PeerTube `AbuseCreate`). */
export interface PeerTubeAbuseBody {
  reason: string;
  predefinedReasons?: PeerTubeAbuseReason[];
  video?: { id: string | number; startAt?: number; endAt?: number };
  account?: { id: number };
}

/** A request the app can show, then send with `PeerTubeModerationClient.submitAbuse`. */
export interface PreparedAbuseReport {
  method: 'POST';
  /** `<instance>/api/v1/abuses` */
  url: string;
  instance: string;
  body: PeerTubeAbuseBody;
}

export interface AbuseReportInput {
  /** Instance to file on: the video's origin (default), or the viewer's own instance. */
  instance: string;
  /** Video id, uuid or shortUUID (the uuid is the same on every instance). */
  videoId?: string | number;
  /** Numeric account id on `instance` (see `resolveAccountId`). */
  accountId?: number;
  reason: string;
  predefinedReasons?: readonly PeerTubeAbuseReason[];
  /** Seconds into the video where the problem starts / ends. */
  startAt?: number;
  endAt?: number;
}

export function normalizeInstance(instance: string): string {
  return `https://${normHost(instance)}`;
}

/**
 * Where a canonical watch URL lives: `https://host/videos/watch/<uuid>` or
 * `https://host/w/<shortUUID>`. Returns the origin and the id, or null.
 */
export function videoRefFromUrl(url: string): { instance: string; videoId: string } | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const m = /^\/(?:videos\/watch|w)\/([0-9A-Za-z-]{8,40})\/?$/.exec(u.pathname);
  return m ? { instance: u.origin, videoId: m[1] } : null;
}

/** Validate and build the request. Never sends anything. Throws `TypeError` on bad input. */
export function prepareAbuseReport(input: AbuseReportInput): PreparedAbuseReport {
  const instance = normalizeInstance(input.instance);
  const reason = cleanDisplay(input.reason, PEERTUBE_ABUSE_LIMITS.reasonMax);
  if (reason.length < PEERTUBE_ABUSE_LIMITS.reasonMin) throw new TypeError('reason: at least 2 characters');
  const pre = [...new Set(input.predefinedReasons ?? [])];
  for (const r of pre) if (!PEERTUBE_ABUSE_REASONS.includes(r)) throw new TypeError(`unknown PeerTube reason: ${r}`);
  if (pre.length > PEERTUBE_ABUSE_LIMITS.maxPredefined) throw new TypeError('too many predefined reasons');
  const body: PeerTubeAbuseBody = { reason };
  if (pre.length) body.predefinedReasons = pre;
  if (input.videoId !== undefined) {
    const id = input.videoId;
    if (!(typeof id === 'number' ? Number.isInteger(id) && id > 0 : /^[0-9A-Za-z-]{1,40}$/.test(id))) throw new TypeError('videoId: id, uuid or shortUUID');
    const v: PeerTubeAbuseBody['video'] = { id };
    const intOk = (n: number | undefined) => n === undefined || (Number.isInteger(n) && n >= 0);
    if (!intOk(input.startAt) || !intOk(input.endAt)) throw new TypeError('startAt/endAt: integer seconds ≥ 0');
    if (input.endAt !== undefined && (input.startAt === undefined || input.endAt <= input.startAt)) {
      throw new TypeError('endAt needs a startAt before it');
    }
    if (input.startAt !== undefined) v.startAt = input.startAt;
    if (input.endAt !== undefined) v.endAt = input.endAt;
    body.video = v;
  }
  if (input.accountId !== undefined) {
    if (!Number.isInteger(input.accountId) || input.accountId <= 0) throw new TypeError('accountId: positive integer');
    body.account = { id: input.accountId };
  }
  if (!body.video && !body.account) throw new TypeError('a report needs a video or an account');
  return { method: 'POST', url: `${instance}/api/v1/abuses`, instance, body };
}

// ---- Instance-level defaults ---------------------------------------------

export interface PublicBlocklistAction {
  type: 'block' | 'unblock';
  /** `name@host` for an account, a bare host for a server. */
  target: string;
  createdAt: string;
}

/**
 * What one instance publicly says about moderation. Serializable; cache it.
 * Blocks here mean the instance's ADMINS muted an account or server.
 */
export interface InstanceDefaults {
  /** `https://host` */
  instance: string;
  /** Whether the server's own blocklists could be read, and how. */
  source: 'public-log' | 'status' | 'none';
  blockedAccounts: string[];
  blockedHosts: string[];
  /** `instance.isNSFW` from /api/v1/config: the whole instance hosts NSFW content. */
  isNSFW: boolean;
  /** `instance.defaultNSFWPolicy`: `display`, `warn`/`blur`, `do_not_list`. */
  defaultNSFWPolicy?: string;
  publicLogEnabled: boolean;
  serverVersion?: string;
  /** Unix seconds. */
  fetchedAt: number;
}

/** Apply block/unblock actions in time order. Handles PeerTube's public log and the old auto-mute plugin format. */
export function foldBlocklistActions(actions: readonly PublicBlocklistAction[]): { accounts: string[]; hosts: string[] } {
  const accounts = new Set<string>();
  const hosts = new Set<string>();
  const sorted = [...actions].sort((a, b) => Date.parse(a.createdAt || '0') - Date.parse(b.createdAt || '0'));
  for (const a of sorted) {
    let key: string;
    let set: Set<string>;
    try {
      if (a.target.includes('@')) {
        key = normHandle(a.target);
        set = accounts;
      } else {
        key = normHost(a.target);
        set = hosts;
      }
    } catch {
      continue;
    }
    if (a.type === 'block') set.add(key);
    else if (a.type === 'unblock') set.delete(key);
  }
  return { accounts: [...accounts], hosts: [...hosts] };
}

/**
 * Parse a mute-list feed: PeerTube 8.3's `{name, actions: [...]}` (public log and
 * mute-list subscriptions) or the deprecated auto-mute plugin's
 * `{data: [{value, action?: 'add'|'remove', updatedAt?}]}`.
 */
export function parseMuteFeed(json: unknown): PublicBlocklistAction[] {
  const o = json as Record<string, unknown>;
  if (!o || typeof o !== 'object') throw new TypeError('mute feed: expected an object');
  const out: PublicBlocklistAction[] = [];
  if (Array.isArray(o.actions)) {
    for (const a of o.actions as Record<string, unknown>[]) {
      if (!a || (a.type !== 'block' && a.type !== 'unblock') || typeof a.target !== 'string') continue;
      out.push({ type: a.type, target: a.target, createdAt: typeof a.createdAt === 'string' ? a.createdAt : '' });
    }
    return out;
  }
  if (Array.isArray(o.data)) {
    for (const d of o.data as Record<string, unknown>[]) {
      if (!d || typeof d.value !== 'string') continue;
      out.push({ type: d.action === 'remove' ? 'unblock' : 'block', target: d.value, createdAt: typeof d.updatedAt === 'string' ? d.updatedAt : '' });
    }
    return out;
  }
  throw new TypeError('mute feed: neither `actions` nor `data`');
}

export class PeerTubeModerationError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'PeerTubeModerationError';
    this.status = status;
  }
}

export interface PeerTubeModerationClientOptions {
  fetch?: FetchLike;
  /** Unix seconds clock, for `fetchedAt`. */
  now?: () => number;
}

const STATUS_CHUNK = 40;

/**
 * Talks to PeerTube instances for moderation. Reads use public endpoints with
 * `credentials: "omit"` and no referrer. The only write, `submitAbuse`, runs only
 * when the app calls it with `confirmed: true` after the user pressed "Send".
 */
export class PeerTubeModerationClient {
  private readonly fetchImpl: FetchLike;
  private readonly now: () => number;

  constructor(opts: PeerTubeModerationClientOptions = {}) {
    this.fetchImpl = opts.fetch ?? ((u, i) => fetch(u, i));
    this.now = opts.now ?? (() => Math.floor(Date.now() / 1000));
  }

  private async getJson(url: string): Promise<{ res: FetchResponseLike; body: unknown }> {
    const res = await this.fetchImpl(url, { method: 'GET', credentials: 'omit', referrerPolicy: 'no-referrer', headers: { accept: 'application/json' } });
    if (!res.ok) return { res, body: undefined };
    return { res, body: await res.json() };
  }

  /**
   * Send a prepared abuse report with the user's OAuth access token for that
   * instance. Refuses unless `confirmed` is true: the app must have shown the
   * report and the user must have chosen to send it.
   */
  async submitAbuse(report: PreparedAbuseReport, opts: { accessToken: string; confirmed: boolean }): Promise<{ id: number }> {
    if (opts.confirmed !== true) throw new Error('refusing to send an abuse report the user has not confirmed');
    if (!opts.accessToken) throw new Error('an access token for the instance is required (PeerTube reports need an account)');
    const res = await this.fetchImpl(report.url, {
      method: 'POST',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      headers: { 'content-type': 'application/json', accept: 'application/json', authorization: `Bearer ${opts.accessToken}` },
      body: JSON.stringify(report.body),
    });
    if (!res.ok) {
      const why =
        res.status === 401 ? 'not logged in to this instance' : res.status === 403 ? 'you cannot report your own video' : res.status === 404 ? 'video or account not found' : 'rejected';
      throw new PeerTubeModerationError(res.status, `PeerTube ${res.status}: ${why}`);
    }
    const body = (await res.json()) as { abuse?: { id?: unknown } };
    const id = body?.abuse?.id;
    if (typeof id !== 'number') throw new PeerTubeModerationError(res.status, 'unexpected response');
    return { id };
  }

  /** Numeric id of `name@host` as known to `instance` (`GET /api/v1/accounts/{name}`), for account reports. */
  async resolveAccountId(instance: string, handle: string): Promise<number> {
    const base = normalizeInstance(instance);
    const h = normHandle(handle);
    const { res, body } = await this.getJson(`${base}/api/v1/accounts/${encodeURIComponent(h)}`);
    const id = (body as { id?: unknown } | undefined)?.id;
    if (!res.ok || typeof id !== 'number') throw new PeerTubeModerationError(res.status, `account ${h} not found on ${base}`);
    return id;
  }

  /** `GET /api/v1/config`: NSFW defaults and whether the public blocklist log is on. */
  async instanceConfig(instance: string): Promise<{ isNSFW: boolean; defaultNSFWPolicy?: string; publicLogEnabled: boolean; serverVersion?: string }> {
    const base = normalizeInstance(instance);
    const { res, body } = await this.getJson(`${base}/api/v1/config`);
    if (!res.ok) throw new PeerTubeModerationError(res.status, `config ${res.status}`);
    const c = body as { instance?: { isNSFW?: unknown; defaultNSFWPolicy?: unknown }; blocklist?: { publicLog?: { enabled?: unknown } }; serverVersion?: unknown };
    return {
      isNSFW: c?.instance?.isNSFW === true,
      ...(typeof c?.instance?.defaultNSFWPolicy === 'string' ? { defaultNSFWPolicy: c.instance.defaultNSFWPolicy } : {}),
      publicLogEnabled: c?.blocklist?.publicLog?.enabled === true,
      ...(typeof c?.serverVersion === 'string' ? { serverVersion: c.serverVersion } : {}),
    };
  }

  /**
   * The server's public blocklist log (PeerTube >= 8.3, opt-in by the admin).
   * Returns null when it isn't available (403 disabled, 400/404 older versions).
   * Pages by `startDate` (500 entries per page) up to `maxPages`.
   */
  async publicBlocklistLog(instance: string, opts: { startDate?: string; maxPages?: number } = {}): Promise<PublicBlocklistAction[] | null> {
    const base = normalizeInstance(instance);
    const out: PublicBlocklistAction[] = [];
    const seen = new Set<string>();
    let start = opts.startDate;
    for (let page = 0; page < (opts.maxPages ?? 10); page++) {
      const q = start ? `?startDate=${encodeURIComponent(start)}` : '';
      const { res, body } = await this.getJson(`${base}/api/v1/server/blocklist/public-log${q}`);
      if (!res.ok) {
        if (page === 0 && [400, 403, 404].includes(res.status)) return null;
        throw new PeerTubeModerationError(res.status, `public-log ${res.status}`);
      }
      const actions = parseMuteFeed(body);
      let fresh = 0;
      for (const a of actions) {
        const k = `${a.type}|${a.target}|${a.createdAt}`;
        if (seen.has(k)) continue;
        seen.add(k);
        out.push(a);
        fresh++;
      }
      if (actions.length < 500 || !fresh) break;
      start = actions[actions.length - 1].createdAt;
    }
    return out;
  }

  /**
   * `GET /api/v1/blocklist/status` for specific accounts and hosts. Point queries:
   * the instance learns which accounts you asked about, so pass only subjects that
   * came from public sources (`publicSubjects`). Returns those the SERVER blocks.
   */
  async blockStatus(instance: string, subjects: { accounts?: readonly string[]; hosts?: readonly string[] }): Promise<{ accounts: string[]; hosts: string[] }> {
    const base = normalizeInstance(instance);
    const accounts = [...new Set((subjects.accounts ?? []).map((a) => normHandle(a)))];
    const hosts = [...new Set((subjects.hosts ?? []).map((h) => normHost(h)))];
    const blocked = { accounts: [] as string[], hosts: [] as string[] };
    const items: [string, string][] = [...accounts.map((a): [string, string] => ['accounts', a]), ...hosts.map((h): [string, string] => ['hosts', h])];
    for (let i = 0; i < items.length; i += STATUS_CHUNK) {
      const qs = new URLSearchParams();
      for (const [k, v] of items.slice(i, i + STATUS_CHUNK)) qs.append(k, v);
      const { res, body } = await this.getJson(`${base}/api/v1/blocklist/status?${qs}`);
      if (!res.ok) throw new PeerTubeModerationError(res.status, `blocklist/status ${res.status}`);
      const b = body as { accounts?: Record<string, { blockedByServer?: unknown }>; hosts?: Record<string, { blockedByServer?: unknown }> };
      for (const [k, v] of Object.entries(b?.accounts ?? {})) if (v?.blockedByServer === true) blocked.accounts.push(k.toLowerCase());
      for (const [k, v] of Object.entries(b?.hosts ?? {})) if (v?.blockedByServer === true) blocked.hosts.push(k.toLowerCase());
    }
    return blocked;
  }

  /**
   * Everything an instance publicly offers: config, then the public log if
   * enabled, else block status for `subjects` (if given). Never throws for a
   * missing feature; network errors propagate.
   */
  async instanceDefaults(instance: string, subjects?: { accounts?: readonly string[]; hosts?: readonly string[] }): Promise<InstanceDefaults> {
    const base = normalizeInstance(instance);
    const cfg = await this.instanceConfig(base);
    let source: InstanceDefaults['source'] = 'none';
    let blocked = { accounts: [] as string[], hosts: [] as string[] };
    const log = cfg.publicLogEnabled ? await this.publicBlocklistLog(base) : null;
    if (log) {
      source = 'public-log';
      blocked = foldBlocklistActions(log);
    } else if (subjects && ((subjects.accounts?.length ?? 0) + (subjects.hosts?.length ?? 0)) > 0) {
      source = 'status';
      blocked = await this.blockStatus(base, subjects);
    }
    return {
      instance: base,
      source,
      blockedAccounts: blocked.accounts,
      blockedHosts: blocked.hosts,
      isNSFW: cfg.isNSFW,
      ...(cfg.defaultNSFWPolicy ? { defaultNSFWPolicy: cfg.defaultNSFWPolicy } : {}),
      publicLogEnabled: cfg.publicLogEnabled,
      ...(cfg.serverVersion ? { serverVersion: cfg.serverVersion } : {}),
      fetchedAt: this.now(),
    };
  }
}

/** Host of a video's canonical URL (its origin instance). */
export function videoInstance(videoId: string): string | undefined {
  return hostOf(videoId);
}
