import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assertValidUnsigned } from '../src/event.ts';
import { BridgeRefusal, checkBridgeable, formatTimestamp, selectKind, toVideoEvent } from '../src/mapping.ts';
import type { EventTemplate, PtCaption, PtChapter, PtVideo, Tag } from '../src/types.ts';

const fx = <T>(name: string): T => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const landscape = () => fx<PtVideo>('framatube-landscape.video.json');
const short = () => fx<PtVideo>('tchncs-portrait-short.video.json');
const mirrored = () => fx<PtVideo>('framatube-mirrored-portrait.video.json');
const chaptered = () => fx<PtVideo>('framatube-chaptered.video.json');
const captions = fx<{ data: PtCaption[] }>('framatube-landscape.captions.json').data;
const chapters = fx<{ chapters: PtChapter[] }>('framatube-chaptered.chapters.json').chapters;

const T0 = 1792440000;
const PK = 'f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9';

const tag = (e: EventTemplate, name: string) => e.tags.find((t) => t[0] === name);
const tagsNamed = (e: EventTemplate, name: string) => e.tags.filter((t) => t[0] === name);
/** imeta entries as key -> values. */
function imeta(t: Tag): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const kv of t.slice(1)) {
    const i = kv.indexOf(' ');
    const k = kv.slice(0, i);
    m.set(k, [...(m.get(k) ?? []), kv.slice(i + 1)]);
  }
  return m;
}
const first = (m: Map<string, string[]>, k: string) => m.get(k)?.[0];

test('landscape video -> addressable normal video (34235) with d = uuid', () => {
  const v = landscape();
  const e = toVideoEvent(v, { createdAt: T0 });
  assert.equal(e.kind, 34235);
  assert.deepEqual(e.tags[0], ['d', v.uuid]);
  assert.equal(e.created_at, T0);
  assertValidUnsigned({ ...e, pubkey: PK });
});

test('regular kinds when addressable is false: 21 for landscape, 22 for portrait short', () => {
  assert.equal(toVideoEvent(landscape(), { addressable: false }).kind, 21);
  const s = toVideoEvent(short(), { addressable: false });
  assert.equal(s.kind, 22);
  assert.equal(tag(s, 'd'), undefined, 'regular events carry no d tag');
});

test('kind selection: portrait <= shortMaxDuration is short; overrides work', () => {
  assert.equal(selectKind(short()), 34236); // 0.5625, 14 s
  assert.equal(selectKind(mirrored()), 34236); // 0.5625, 162 s
  assert.equal(selectKind(mirrored(), { shortMaxDuration: 60 }), 34235);
  assert.equal(selectKind(mirrored(), { shortMaxDuration: null }), 34236);
  assert.equal(selectKind(landscape(), { kind: 'short' }), 34236);
  assert.equal(selectKind(short(), { kind: 'normal', addressable: false }), 21);
  // Missing aspectRatio falls back to file dimensions.
  const v = short();
  v.aspectRatio = null;
  assert.equal(selectKind(v), 34236);
});

test('required and descriptive tags follow NIP-71', () => {
  const v = landscape();
  const e = toVideoEvent(v, { createdAt: T0 });
  assert.deepEqual(tag(e, 'title'), ['title', v.name]);
  // published_at prefers originallyPublishedAt (2026-06-18T22:00:00Z)
  assert.deepEqual(tag(e, 'published_at'), ['published_at', String(Date.parse('2026-06-18T22:00:00.000Z') / 1000)]);
  assert.deepEqual(tag(e, 'duration'), ['duration', '3165']);
  assert.match(tag(e, 'alt')![1], /^Video: "PeerTube : une plateforme.*" by FramaConf \(52:45\)\. Watch on PeerTube: https:\/\/framatube\.org\/videos\/watch\//);
  assert.deepEqual(tagsNamed(e, 't'), [['t', 'jdll'], ['t', 'jdll2026']]);
  assert.deepEqual(tag(e, 'L'), ['L', 'ISO-639-1']);
  assert.deepEqual(tag(e, 'l'), ['l', 'fr', 'ISO-639-1']);
  assert.deepEqual(tag(e, 'r'), ['r', v.url]);
  assert.deepEqual(tag(e, 'origin'), ['origin', 'peertube', v.uuid, v.url]);
  assert.equal(e.content, v.description);
  assert.equal(tag(e, 'content-warning'), undefined);
});

test('remote video keeps the canonical origin URL; relative paths resolve against the queried instance', () => {
  const v = mirrored(); // fetched from framatube.org, hosted on tube.tchncs.de
  v.thumbnails = [];
  const e = toVideoEvent(v, { instanceUrl: 'https://framatube.org' });
  assert.deepEqual(tag(e, 'r'), ['r', 'https://tube.tchncs.de/videos/watch/20dc68b8-9eba-4f38-95fd-fff2be96af60']);
  const img = first(imeta(tagsNamed(e, 'imeta')[0]), 'image')!;
  assert.ok(img.startsWith('https://framatube.org/lazy-static/'), img);
});

test('imeta tags are well formed per NIP-92 and unique per URL', () => {
  for (const v of [landscape(), short(), mirrored(), chaptered()]) {
    const e = toVideoEvent(v);
    const ims = tagsNamed(e, 'imeta');
    assert.ok(ims.length >= 2, `${v.uuid}: expected several renditions`);
    const urls = new Set<string>();
    for (const t of ims) {
      for (const kv of t.slice(1)) assert.match(kv, /^[a-z]+ \S/, `bad imeta entry ${kv}`);
      const m = imeta(t);
      assert.equal(m.get('url')?.length, 1, 'exactly one url');
      assert.ok(m.size >= 2, 'url plus at least one other field');
      assert.ok(first(m, 'm'), 'mime type present');
      const url = first(m, 'url')!;
      assert.ok(!urls.has(url), `duplicate imeta url ${url}`);
      urls.add(url);
      assert.equal(first(m, 'duration'), String(v.duration));
      if (first(m, 'dim')) assert.match(first(m, 'dim')!, /^\d+x\d+$/);
      if (first(m, 'bitrate')) assert.match(first(m, 'bitrate')!, /^\d+$/);
    }
  }
});

test('landscape renditions: HLS master first, then MP4s largest first, audio last', () => {
  const ims = tagsNamed(toVideoEvent(landscape()), 'imeta').map(imeta);
  assert.equal(first(ims[0], 'm'), 'application/x-mpegURL');
  assert.match(first(ims[0], 'url')!, /-master\.m3u8$/);
  assert.equal(first(ims[0], 'dim'), '1280x720');
  assert.ok(first(ims[0], 'image'));
  assert.deepEqual(
    ims.slice(1).map((m) => [first(m, 'm'), first(m, 'dim')]),
    [
      ['video/mp4', '1280x720'],
      ['video/mp4', '854x480'],
      ['video/mp4', '640x360'],
      ['video/mp4', '426x240'],
      ['audio/mp4', undefined],
    ],
  );
  const audio = ims.at(-1)!;
  assert.equal(first(audio, 'l'), 'fr ISO-639-1 ov');
  assert.equal(audio.get('image'), undefined);
  // 720p: 206904957 bytes over 3165 s
  assert.equal(first(ims[1], 'size'), '206904957');
  assert.equal(first(ims[1], 'bitrate'), String(Math.round((206904957 * 8) / 3165)));
});

test('prefers web-video MP4s over HLS fragmented MP4s; portrait dims are WxH', () => {
  const ims = tagsNamed(toVideoEvent(short()), 'imeta').map(imeta);
  const mp4 = ims.filter((m) => first(m, 'm') === 'video/mp4');
  assert.equal(mp4.length, 4);
  for (const m of mp4) assert.doesNotMatch(first(m, 'url')!, /fragmented/);
  assert.equal(first(mp4[0], 'dim'), '2160x3840');
  // PeerTube only generates 16:9 and 1:1 thumbnails; for a portrait video the
  // closest aspect ratio (square) is chosen over the larger 16:9 preview.
  const img = short().thumbnails!.find((t) => t.fileUrl === first(ims[0], 'image'))!;
  assert.equal(img.aspectRatio, '1:1');
});

test('mp4-first ordering', () => {
  const ims = tagsNamed(toVideoEvent(short(), { order: 'mp4-first' }), 'imeta').map(imeta);
  assert.equal(first(ims[0], 'm'), 'video/mp4');
  assert.equal(first(ims.at(-2)!, 'm'), 'application/x-mpegURL');
  assert.equal(first(ims.at(-1)!, 'm'), 'audio/mp4');
});

test('mirrors (opt-in) select HLS files and add their mirror copies as fallbacks; magnet is opt-in', () => {
  const plain = tagsNamed(toVideoEvent(mirrored()), 'imeta').map(imeta);
  assert.ok(plain.every((m) => !m.has('fallback') && !m.has('magnet')));
  const withMirrors = tagsNamed(toVideoEvent(mirrored(), { includeMirrors: true, includeMagnet: true }), 'imeta').map(imeta);
  const hlsFile = withMirrors.find((m) => /-480-fragmented\.mp4$/.test(first(m, 'url')!))!;
  assert.deepEqual(hlsFile.get('fallback'), [
    'https://rankett.net/static/redundancy/hls/20dc68b8-9eba-4f38-95fd-fff2be96af60/06adf899-cc61-44d5-b6c0-ec07a09a0d26-480-fragmented.mp4',
    'https://video.mycrowd.ca/static/redundancy/hls/20dc68b8-9eba-4f38-95fd-fff2be96af60/06adf899-cc61-44d5-b6c0-ec07a09a0d26-480-fragmented.mp4',
  ]);
  assert.match(first(hlsFile, 'magnet')!, /^magnet:\?/);
  assert.equal(withMirrors[0].get('fallback'), undefined, 'no fallback for master playlist');
});

test('downloads disabled -> only the HLS playlist is bridged', () => {
  const v = landscape();
  v.downloadEnabled = false;
  const ims = tagsNamed(toVideoEvent(v), 'imeta').map(imeta);
  assert.equal(ims.length, 1);
  assert.equal(first(ims[0], 'm'), 'application/x-mpegURL');
  v.streamingPlaylists = [];
  assert.throws(() => toVideoEvent(v), BridgeRefusal);
});

test('captions -> text-track, chapters -> segment', () => {
  const e1 = toVideoEvent(landscape(), { captions });
  assert.deepEqual(tagsNamed(e1, 'text-track'), [
    ['text-track', 'https://framatube.org/lazy-static/video-captions/354a0cdc-3ee3-488c-9fc3-58469f69a9a7-fr.vtt', 'captions', 'fr'],
  ]);
  const v = chaptered();
  const segs = tagsNamed(toVideoEvent(v, { chapters }), 'segment');
  assert.equal(segs.length, chapters.length);
  assert.deepEqual(segs[0], ['segment', '00:00:22.000', '00:01:55.000', 'KI-Vorstellung: Muse Glimmer']);
  assert.equal(segs.at(-1)![2], formatTimestamp(v.duration));
  assert.equal(formatTimestamp(3725.5), '01:02:05.500');
});

test('hashtags are normalized: lowercase, no #, deduplicated', () => {
  const v = chaptered();
  v.tags = ['KI', '#ki', 'Künstliche Intelligenz', ' Python '];
  assert.deepEqual(tagsNamed(toVideoEvent(v), 't'), [['t', 'ki'], ['t', 'künstliche-intelligenz'], ['t', 'python']]);
});

test('nsfw: content-warning by default, refusal with nsfw=skip', () => {
  const v = landscape();
  v.nsfw = true;
  v.nsfwSummary = null;
  assert.deepEqual(tag(toVideoEvent(v), 'content-warning'), ['content-warning', 'Marked as sensitive (NSFW) on PeerTube']);
  v.nsfwSummary = 'Graphic violence';
  assert.deepEqual(tag(toVideoEvent(v), 'content-warning'), ['content-warning', 'Graphic violence']);
  assert.throws(() => toVideoEvent(v, { nsfw: 'skip' }), (err: Error) => err instanceof BridgeRefusal && /NSFW/.test(err.message));
});

test('refuses non-public, live, unpublished and blocked videos', () => {
  const cases: [string, (v: PtVideo) => void, RegExp][] = [
    ['unlisted', (v) => (v.privacy = { id: 2, label: 'Unlisted' }), /not public \(privacy: Unlisted\)/],
    ['private', (v) => (v.privacy = { id: 3, label: 'Private' }), /not public/],
    ['internal', (v) => (v.privacy = { id: 4, label: 'Internal' }), /not public/],
    ['password', (v) => (v.privacy = { id: 5, label: 'Password protected' }), /not public/],
    ['missing privacy', (v) => delete (v as Partial<PtVideo>).privacy, /not public/],
    ['live', (v) => (v.isLive = true), /live/],
    ['transcoding', (v) => (v.state = { id: 2, label: 'To transcode' }), /not published/],
    ['blacklisted', (v) => (v.blacklisted = true), /blocked/],
    ['no files', (v) => ((v.files = []), (v.streamingPlaylists = [])), /no playable/],
  ];
  for (const [name, mutate, re] of cases) {
    const v = landscape();
    mutate(v);
    const c = checkBridgeable(v);
    assert.equal(c.ok, false, name);
    assert.throws(() => toVideoEvent(v), (err: Error) => err instanceof BridgeRefusal && re.test(err.message), name);
  }
});

test('creatorPubkey adds a p tag; invalid pubkey rejected', () => {
  assert.deepEqual(tag(toVideoEvent(landscape(), { creatorPubkey: PK }), 'p'), ['p', PK]);
  assert.throws(() => toVideoEvent(landscape(), { creatorPubkey: 'npub1xyz' }), /creatorPubkey/);
});

test('untrusted text is cleaned so the event id is unambiguous', () => {
  const v = landscape();
  v.name = 'Title\u0000 with\u001b junk';
  v.description = 'desc\u0007ok\nnext';
  const e = toVideoEvent(v);
  assert.equal(tag(e, 'title')![1], 'Title with junk');
  assert.equal(e.content, 'descok\nnext');
  assertValidUnsigned({ ...e, pubkey: PK });
});

test('same input and createdAt -> identical template (idempotent re-runs)', () => {
  assert.deepEqual(toVideoEvent(landscape(), { createdAt: T0, captions }), toVideoEvent(landscape(), { createdAt: T0, captions }));
});
