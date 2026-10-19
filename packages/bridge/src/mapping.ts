// PeerTube video -> NIP-71 video event template.
//
// Spec: https://github.com/nostr-protocol/nips/blob/master/71.md (read 2026-10-19)
// - kinds 21 (normal) / 22 (short) are regular; 34235 / 34236 are their
//   addressable versions and "include a `d` tag as a unique identifier and can
//   be updated while maintaining the same addressable reference".
// - "The primary source of video information is the `imeta` tags" (NIP-92):
//   each imeta MUST have `url` plus at least one other field, and "There SHOULD
//   be only one `imeta` tag per URL". NIP-71 adds `duration` and `bitrate`.
// - Other tags used here: title (required), published_at, alt, duration,
//   content-warning, text-track, segment, t, p, r, and for imported content
//   `["origin", "<platform>", "<external-id>", "<original-url>", ...]`.

import { cleanText } from './event.ts';
import {
  KIND_ADDRESSABLE_SHORT_VIDEO,
  KIND_ADDRESSABLE_VIDEO,
  KIND_SHORT_VIDEO,
  KIND_VIDEO,
  PT_PLAYLIST_HLS,
  PT_PRIVACY_PUBLIC,
  PT_STATE_PUBLISHED,
} from './types.ts';
import type { EventTemplate, PtCaption, PtChapter, PtVideo, PtVideoFile, Tag } from './types.ts';

export type KindPolicy = 'auto' | 'normal' | 'short';
export type NsfwPolicy = 'warn' | 'skip';

export interface ToVideoEventOptions {
  /** Use addressable kinds 34235/34236 with `d` = PeerTube uuid (default true). */
  addressable?: boolean;
  /** Normal vs short selection (default 'auto': portrait and <= shortMaxDuration). */
  kind?: KindPolicy;
  /** Portrait videos longer than this many seconds stay "normal" in auto mode (default 180; null = no limit). */
  shortMaxDuration?: number | null;
  /** created_at in unix seconds (default: now). */
  createdAt?: number;
  /** NSFW videos: publish with a content-warning tag ('warn', default) or refuse ('skip'). */
  nsfw?: NsfwPolicy;
  /** Order of imeta tags; many clients play the first one they understand (default 'hls-first'). */
  order?: 'hls-first' | 'mp4-first';
  /** Add `fallback` URLs from PeerTube redundancy mirrors (default false, best effort). */
  includeMirrors?: boolean;
  /** Add NIP-94 `magnet` URIs to imeta (default false: P2P exposes viewer IPs, see THREAT_MODEL). */
  includeMagnet?: boolean;
  /** Captions from GET /api/v1/videos/{id}/captions, mapped to `text-track` tags. */
  captions?: PtCaption[];
  /** Chapters from GET /api/v1/videos/{id}/chapters, mapped to `segment` tags. */
  chapters?: PtChapter[];
  /** Creator's pubkey, added as a `p` tag when an instance key signs on a creator's behalf. */
  creatorPubkey?: string;
  /** Base URL of the instance the JSON came from, used to resolve relative paths (default: origin of video.url). */
  instanceUrl?: string;
  /**
   * Set when the event is signed by a bridge/instance key, not by the
   * creator. Adds a disclosure to `alt`, a NIP-48 `proxy` tag pointing at the
   * ActivityPub object, and a NIP-32 self-label
   * `["L", BRIDGE_LABEL_NAMESPACE]`, `["l", "instance-signed", BRIDGE_LABEL_NAMESPACE]`.
   * `operator` names who runs the bridge (e.g. the instance host).
   */
  instanceSigned?: { operator: string };
}

/** NIP-32 label namespace for bridge provenance labels. */
export const BRIDGE_LABEL_NAMESPACE = 'match-feed.bridge';

export class BridgeRefusal extends Error {
  readonly uuid: string;
  constructor(uuid: string, reason: string) {
    super(reason);
    this.name = 'BridgeRefusal';
    this.uuid = uuid;
  }
}

export type BridgeCheck = { ok: true } | { ok: false; reason: string };

/** Policy gate: only public, published, non-live, non-blocked videos are bridged. */
export function checkBridgeable(v: PtVideo, opts: Pick<ToVideoEventOptions, 'nsfw'> = {}): BridgeCheck {
  if (!v || typeof v.uuid !== 'string') return { ok: false, reason: 'not a PeerTube video object' };
  if (v.privacy?.id !== PT_PRIVACY_PUBLIC) {
    return { ok: false, reason: `not public (privacy: ${v.privacy?.label ?? 'unknown'})` };
  }
  if (v.isLive) return { ok: false, reason: 'live stream (NIP-71 is for recorded video; use NIP-53)' };
  if (v.state && v.state.id !== PT_STATE_PUBLISHED) {
    return { ok: false, reason: `not published (state: ${v.state.label})` };
  }
  if (v.blacklisted) return { ok: false, reason: 'blocked by the instance' };
  if (v.nsfw && (opts.nsfw ?? 'warn') === 'skip') return { ok: false, reason: 'marked NSFW and nsfw policy is skip' };
  if (collectRenditions(v).length === 0) return { ok: false, reason: 'no playable files exposed by the API' };
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Renditions

interface Rendition {
  url: string;
  mime: string;
  hls: boolean;
  audioOnly: boolean;
  width?: number;
  height?: number;
  size?: number;
  magnet?: string;
  fallbacks: string[];
}

const MIME_BY_EXT: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  webm: 'video/webm',
  ogv: 'video/ogg',
  m4a: 'audio/mp4',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  opus: 'audio/ogg',
};

function extOf(url: string): string {
  try {
    const p = new URL(url).pathname;
    const dot = p.lastIndexOf('.');
    return dot >= 0 ? p.slice(dot + 1).toLowerCase() : '';
  } catch {
    return '';
  }
}

function isAudioOnly(f: PtVideoFile): boolean {
  return f.hasVideo === false || f.resolution?.id === 0;
}

function mimeOf(f: PtVideoFile): string {
  const m = MIME_BY_EXT[extOf(f.fileUrl)] ?? 'video/mp4';
  // PeerTube audio-only renditions are .mp4 containers without a video track.
  if (isAudioOnly(f) && m.startsWith('video/')) return m.replace('video/', 'audio/');
  return m;
}

function isHttpUrl(s: unknown): s is string {
  if (typeof s !== 'string') return false;
  try {
    const u = new URL(s);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

function basename(url: string): string {
  return new URL(url).pathname.split('/').pop() ?? '';
}

/**
 * One progressive file per resolution plus the HLS master playlist.
 * PeerTube may expose the same resolution twice: as a "web video" MP4
 * (video.files) and as a fragmented MP4 inside the HLS playlist. They are
 * different files (different bytes), so they cannot be `fallback`s of each
 * other; we keep the web video when present and the HLS file otherwise
 * (unless mirror fallbacks were requested, see preferHls).
 * If the uploader disabled downloads, only the HLS playlist is bridged.
 */
function collectRenditions(v: PtVideo, opts: ToVideoEventOptions = {}): Rendition[] {
  const hls = (v.streamingPlaylists ?? []).find((p) => p.type === PT_PLAYLIST_HLS && isHttpUrl(p.playlistUrl));
  const mirrors = opts.includeMirrors
    ? (hls?.redundancies ?? []).map((r) => r.baseUrl).filter(isHttpUrl).map((b) => b.replace(/\/+$/, ''))
    : [];

  // Mirrors only replicate HLS files, so when mirror fallbacks are wanted and
  // exist, prefer the HLS fragmented MP4s (which get fallbacks) instead.
  const preferHls = mirrors.length > 0;
  const byRes = new Map<string, { f: PtVideoFile; fromHls: boolean }>();
  const add = (f: PtVideoFile, fromHls: boolean) => {
    if (!isHttpUrl(f.fileUrl)) return;
    const key = isAudioOnly(f) ? 'audio' : String(f.resolution?.id ?? `${f.width}x${f.height}`);
    const cur = byRes.get(key);
    if (!cur || (cur.fromHls !== fromHls && fromHls === preferHls)) byRes.set(key, { f, fromHls });
  };
  for (const f of hls?.files ?? []) add(f, true);
  for (const f of v.files ?? []) add(f, false);

  const videoFiles = [...byRes.values()].filter((x) => !isAudioOnly(x.f));
  const maxDim = videoFiles
    .map((x) => x.f)
    .sort((a, b) => (b.width ?? 0) * (b.height ?? 0) - (a.width ?? 0) * (a.height ?? 0))[0];

  const out: Rendition[] = [];
  if (hls) {
    out.push({
      url: hls.playlistUrl,
      mime: 'application/x-mpegURL', // spelling used in the NIP-71 example
      hls: true,
      audioOnly: false,
      width: maxDim?.width,
      height: maxDim?.height,
      // Redundancy mirrors did not serve the master playlist in our tests
      // (404 on 2026-10-19), so no fallbacks for it.
      fallbacks: [],
    });
  }
  if (v.downloadEnabled === false) return out;

  const files = [...byRes.values()].sort((a, b) => {
    const aa = isAudioOnly(a.f) ? 1 : 0;
    const ba = isAudioOnly(b.f) ? 1 : 0;
    if (aa !== ba) return aa - ba; // audio last
    return (b.f.width ?? 0) * (b.f.height ?? 0) - (a.f.width ?? 0) * (a.f.height ?? 0); // largest first
  });
  for (const { f, fromHls } of files) {
    out.push({
      url: f.fileUrl,
      mime: mimeOf(f),
      hls: false,
      audioOnly: isAudioOnly(f),
      width: f.width || undefined,
      height: f.height || undefined,
      size: f.size || undefined,
      magnet: f.magnetUri,
      // Mirrors store HLS files under <baseUrl>/<same filename>.
      fallbacks: fromHls ? mirrors.map((m) => `${m}/${basename(f.fileUrl)}`) : [],
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Helpers

function resolveUrl(pathOrUrl: string | null | undefined, base: string): string | undefined {
  if (!pathOrUrl) return undefined;
  try {
    const u = new URL(pathOrUrl, base);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : undefined;
  } catch {
    return undefined;
  }
}

function aspectOf(v: PtVideo): number | undefined {
  if (typeof v.aspectRatio === 'number' && v.aspectRatio > 0) return v.aspectRatio;
  const f = [...(v.streamingPlaylists ?? []).flatMap((p) => p.files ?? []), ...(v.files ?? [])].find(
    (x) => (x.width ?? 0) > 0 && (x.height ?? 0) > 0,
  );
  return f ? f.width! / f.height! : undefined;
}

/** Best preview image: same aspect ratio as the video, largest first. */
function pickImage(v: PtVideo, base: string): string | undefined {
  const ar = aspectOf(v);
  const thumbs = (v.thumbnails ?? []).filter((t) => isHttpUrl(t.fileUrl) && t.width > 0 && t.height > 0);
  if (thumbs.length) {
    thumbs.sort((a, b) => {
      if (ar) {
        const da = Math.abs(a.width / a.height - ar);
        const db = Math.abs(b.width / b.height - ar);
        if (Math.abs(da - db) > 0.02) return da - db;
      }
      return b.width * b.height - a.width * a.height;
    });
    return thumbs[0].fileUrl;
  }
  return resolveUrl(v.previewPath, base) ?? resolveUrl(v.thumbnailPath, base);
}

export function selectKind(v: PtVideo, opts: ToVideoEventOptions = {}): number {
  const policy = opts.kind ?? 'auto';
  const maxShort = opts.shortMaxDuration === undefined ? 180 : opts.shortMaxDuration;
  let short: boolean;
  if (policy === 'short') short = true;
  else if (policy === 'normal') short = false;
  else {
    const ar = aspectOf(v);
    short = ar !== undefined && ar < 1 && (maxShort === null || v.duration <= maxShort);
  }
  const addressable = opts.addressable ?? true;
  if (addressable) return short ? KIND_ADDRESSABLE_SHORT_VIDEO : KIND_ADDRESSABLE_VIDEO;
  return short ? KIND_SHORT_VIDEO : KIND_VIDEO;
}

function unixSeconds(iso: string | null | undefined): number | undefined {
  if (!iso) return undefined;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? Math.floor(t / 1000) : undefined;
}

/** HH:MM:SS.sss as required by NIP-71 `segment`. */
export function formatTimestamp(seconds: number): string {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const r = ms % 1000;
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(h)}:${p(m)}:${p(s)}.${p(r, 3)}`;
}

function humanDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

/** NIP-32 namespace for a PeerTube language id ('fr' -> ISO-639-1, 'kab' -> ISO-639-3). */
function languageNamespace(code: string): string | undefined {
  if (/^[a-z]{2}$/.test(code)) return 'ISO-639-1';
  if (/^[a-z]{3}$/.test(code)) return 'ISO-639-3';
  return undefined;
}

function normalizeHashtag(t: string): string {
  return cleanText(t).trim().replace(/^#+/, '').replace(/\s+/g, '-').toLowerCase();
}

// ---------------------------------------------------------------------------

/**
 * Build an unsigned NIP-71 event template (no pubkey/id/sig) for a PeerTube
 * video detail object (GET /api/v1/videos/{uuid}). Throws BridgeRefusal if the
 * video must not be bridged (see checkBridgeable).
 */
export function toVideoEvent(v: PtVideo, opts: ToVideoEventOptions = {}): EventTemplate {
  const check = checkBridgeable(v, opts);
  if (!check.ok) throw new BridgeRefusal(v?.uuid ?? '?', check.reason);

  const base = opts.instanceUrl ?? new URL(v.url).origin;
  const kind = selectKind(v, opts);
  const addressable = kind === KIND_ADDRESSABLE_VIDEO || kind === KIND_ADDRESSABLE_SHORT_VIDEO;
  const isShort = kind === KIND_SHORT_VIDEO || kind === KIND_ADDRESSABLE_SHORT_VIDEO;
  const title = cleanText(v.name).trim();
  const duration = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : undefined;
  const image = pickImage(v, base);
  const lang = v.language?.id ?? undefined;
  const langNs = lang ? languageNamespace(lang) : undefined;
  const creator = v.channel?.displayName || v.account?.displayName || v.channel?.name || v.account?.name;
  const canonical = v.url;

  const tags: Tag[] = [];
  if (addressable) tags.push(['d', v.uuid]);
  tags.push(['title', title]);
  const published = unixSeconds(v.originallyPublishedAt) ?? unixSeconds(v.publishedAt);
  if (published !== undefined) tags.push(['published_at', String(published)]);
  tags.push([
    'alt',
    cleanText(
      `${isShort ? 'Short video' : 'Video'}: "${title}"` +
        (creator ? ` by ${creator}` : '') +
        (duration ? ` (${humanDuration(duration)})` : '') +
        `. Watch on PeerTube: ${canonical}` +
        (opts.instanceSigned
          ? `. Bridged to Nostr by ${opts.instanceSigned.operator} with its own key; not signed by the creator.`
          : ''),
    ),
  ]);
  if (duration !== undefined) tags.push(['duration', String(duration)]);

  let renditions = collectRenditions(v, opts);
  if ((opts.order ?? 'hls-first') === 'mp4-first') {
    renditions = [...renditions.filter((r) => !r.hls && !r.audioOnly), ...renditions.filter((r) => r.hls), ...renditions.filter((r) => r.audioOnly)];
  }
  const seen = new Set<string>();
  for (const r of renditions) {
    if (seen.has(r.url)) continue; // NIP-92: only one imeta per URL
    seen.add(r.url);
    const im: Tag = ['imeta', `url ${r.url}`, `m ${r.mime}`];
    if (r.width && r.height) im.push(`dim ${r.width}x${r.height}`);
    if (r.size) im.push(`size ${r.size}`);
    if (r.size && duration) im.push(`bitrate ${Math.round((r.size * 8) / duration)}`);
    if (duration !== undefined) im.push(`duration ${duration}`);
    if (image && !r.audioOnly) im.push(`image ${image}`);
    // Audio track language (NIP-71 `l <code> <namespace> ov`); skip 'no speech'/'undetermined' codes.
    if (r.audioOnly && lang && langNs && !['zxx', 'und', 'mis'].includes(lang)) im.push(`l ${lang} ${langNs} ov`);
    for (const fb of r.fallbacks) im.push(`fallback ${fb}`);
    if (opts.includeMagnet && r.magnet?.startsWith('magnet:')) im.push(`magnet ${r.magnet}`);
    tags.push(im);
  }

  for (const c of opts.captions ?? []) {
    const url = resolveUrl(c.fileUrl ?? c.captionPath, base);
    if (!url) continue;
    const t: Tag = ['text-track', url, 'captions'];
    if (c.language?.id) t.push(c.language.id);
    tags.push(t);
  }

  const chapters = [...(opts.chapters ?? [])]
    .filter((c) => Number.isFinite(c.timecode) && c.timecode >= 0)
    .sort((a, b) => a.timecode - b.timecode);
  chapters.forEach((c, i) => {
    const end = chapters[i + 1]?.timecode ?? duration;
    if (end === undefined || end <= c.timecode) return;
    tags.push(['segment', formatTimestamp(c.timecode), formatTimestamp(end), cleanText(c.title).trim()]);
  });

  if (v.nsfw) {
    const reason = cleanText(v.nsfwSummary ?? '').trim();
    tags.push(['content-warning', reason || 'Marked as sensitive (NSFW) on PeerTube']);
  }

  if (lang && langNs) tags.push(['L', langNs], ['l', lang, langNs]); // NIP-32 self-label
  if (opts.instanceSigned) tags.push(['L', BRIDGE_LABEL_NAMESPACE], ['l', 'instance-signed', BRIDGE_LABEL_NAMESPACE]);

  const hashtags = new Set((v.tags ?? []).map(normalizeHashtag).filter(Boolean));
  for (const t of hashtags) tags.push(['t', t]);

  if (opts.creatorPubkey) {
    if (!/^[0-9a-f]{64}$/.test(opts.creatorPubkey)) throw new TypeError('creatorPubkey must be 32-byte lowercase hex');
    tags.push(['p', opts.creatorPubkey]);
  }

  tags.push(['r', canonical]);
  tags.push(['origin', 'peertube', v.uuid, canonical]);
  // NIP-48: PeerTube's video URL is its ActivityPub object id.
  if (opts.instanceSigned) tags.push(['proxy', canonical, 'activitypub']);

  return {
    kind,
    created_at: opts.createdAt ?? Math.floor(Date.now() / 1000),
    tags,
    content: cleanText(v.description ?? v.truncatedDescription ?? ''),
  };
}
