import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseSecretKey, secretKeySigner, verifySignedEvent } from '../src/nostr-signer.ts';
import { normalizeInstance, parseChannelHandle } from '../src/peertube.ts';
import type { FetchLike } from '../src/peertube.ts';
import { sync } from '../src/sync.ts';
import type { SignedEvent } from '../src/types.ts';

const fx = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const SK = '0000000000000000000000000000000000000000000000000000000000000003';

// Offline PeerTube: the real framaconf channel page; detail for the 2nd video is
// the real fixture, the 1st is that fixture re-keyed, the 3rd is made Unlisted.
function fakePeerTube(): { fetch: FetchLike; requests: string[] } {
  const channel = fx('framatube-framaconf.channel-videos.json');
  const [a, b, c] = channel.data.map((v: { uuid: string }) => v.uuid);
  const detail = fx('framatube-landscape.video.json');
  const details: Record<string, unknown> = {
    [b]: detail,
    [a]: { ...detail, uuid: a, url: `https://framatube.org/videos/watch/${a}`, name: channel.data[0].name },
    [c]: { ...detail, uuid: c, privacy: { id: 2, label: 'Unlisted' } },
  };
  const requests: string[] = [];
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const f: FetchLike = async (url) => {
    requests.push(url);
    const u = new URL(url);
    if (u.pathname === '/api/v1/video-channels/framaconf/videos') {
      const start = Number(u.searchParams.get('start'));
      const count = Number(u.searchParams.get('count'));
      return json({ total: channel.data.length, data: channel.data.slice(start, start + count) });
    }
    let m = u.pathname.match(/^\/api\/v1\/videos\/([^/]+)$/);
    if (m) return details[m[1]] ? json(details[m[1]]) : json({ error: 'not found' }, 404);
    m = u.pathname.match(/^\/api\/v1\/videos\/([^/]+)\/captions$/);
    if (m) return json(fx('framatube-landscape.captions.json'));
    m = u.pathname.match(/^\/api\/v1\/videos\/([^/]+)\/chapters$/);
    if (m) return json({ chapters: [] });
    return json({ error: 'unexpected' }, 404);
  };
  return { fetch: f, requests };
}

// In-memory NIP-01 relay speaking through a WebSocket-shaped object.
class FakeRelay {
  events: SignedEvent[] = [];
  received: unknown[] = [];
  socketCtor() {
    const relay = this;
    return class FakeSocket extends EventTarget {
      readonly OPEN = 1;
      readyState = 0;
      constructor(_url: string) {
        super();
        queueMicrotask(() => {
          this.readyState = 1;
          this.dispatchEvent(new Event('open'));
        });
      }
      send(data: string) {
        const msg = JSON.parse(data);
        relay.received.push(msg);
        const reply = (m: unknown) => queueMicrotask(() => this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(m) })));
        if (msg[0] === 'EVENT') {
          const e = msg[1] as SignedEvent;
          const ok = verifySignedEvent(e);
          if (ok) relay.events.push(e);
          reply(['OK', e.id, ok, ok ? '' : 'invalid: bad signature']);
        } else if (msg[0] === 'REQ') {
          const [, sub, filter] = msg;
          for (const e of relay.events) {
            const d = e.tags.find((t) => t[0] === 'd')?.[1];
            if (filter.kinds.includes(e.kind) && filter.authors.includes(e.pubkey) && (!filter['#d'] || filter['#d'].includes(d))) {
              reply(['EVENT', sub, e]);
            }
          }
          reply(['EOSE', sub]);
        }
      }
      close() {
        this.readyState = 3;
      }
    } as unknown as new (url: string) => WebSocket;
  }
}

test('instance and handle parsing', () => {
  assert.equal(normalizeInstance('framatube.org'), 'https://framatube.org');
  assert.equal(normalizeInstance('https://framatube.org/'), 'https://framatube.org');
  assert.deepEqual(parseChannelHandle('framaconf'), { name: 'framaconf' });
  assert.deepEqual(parseChannelHandle('@framaconf@framatube.org'), { name: 'framaconf', host: 'framatube.org' });
  assert.throws(() => parseChannelHandle('a/b'));
});

test('dry run without a signer: unsigned templates, refusals reported, no relay traffic', async () => {
  const pt = fakePeerTube();
  const results = await sync('framatube.org', 'framaconf', null, ['wss://must-not-be-used.invalid'], {
    client: { fetch: pt.fetch, minIntervalMs: 0 },
    relay: {
      WebSocket: class {
        constructor() {
          throw new Error('dry run opened a socket');
        }
      } as unknown as new (url: string) => WebSocket,
    },
  });
  assert.deepEqual(results.map((r) => r.status), ['built', 'built', 'refused']);
  assert.match(results[2].reason!, /not public \(privacy: Unlisted\)/);
  assert.equal(results[0].event, undefined);
  assert.equal(results[1].template!.kind, 34235);
  assert.ok(results[1].template!.tags.some((t) => t[0] === 'text-track'));
  assert.ok(pt.requests.every((u) => u.startsWith('https://framatube.org/api/v1/')));
});

test('limit is respected', async () => {
  const pt = fakePeerTube();
  const results = await sync('framatube.org', 'framaconf', null, [], { limit: 1, client: { fetch: pt.fetch, minIntervalMs: 0 } });
  assert.equal(results.length, 1);
});

test('publish: signs, sends to relays, and skips relays that already have the same version', async () => {
  const relay = new FakeRelay();
  const signer = secretKeySigner(parseSecretKey(SK));
  const opts = {
    publish: true,
    fetchExtras: false,
    verify: verifySignedEvent,
    client: { fetch: fakePeerTube().fetch, minIntervalMs: 0 },
    relay: { WebSocket: relay.socketCtor(), timeoutMs: 1000 },
  };
  const first = await sync('framatube.org', 'framaconf', signer, ['wss://relay.test'], opts);
  assert.deepEqual(first.map((r) => r.status), ['published', 'published', 'refused']);
  for (const r of first.filter((x) => x.event)) {
    assert.ok(verifySignedEvent(r.event!));
    assert.deepEqual(r.relays, [{ relay: 'wss://relay.test', ok: true, message: '' }]);
  }
  assert.equal(relay.events.length, 2);

  const second = await sync('framatube.org', 'framaconf', signer, ['wss://relay.test'], { ...opts, client: { fetch: fakePeerTube().fetch, minIntervalMs: 0 } });
  for (const r of second.filter((x) => x.event)) {
    assert.equal(r.relays![0].message, 'unchanged; not re-sent');
  }
  assert.equal(relay.events.length, 2, 'nothing re-sent');
});

test('publish requires a signer and relays', async () => {
  await assert.rejects(sync('framatube.org', 'framaconf', null, ['wss://x.test'], { publish: true }), /signer/);
  const signer = secretKeySigner(parseSecretKey(SK));
  await assert.rejects(sync('framatube.org', 'framaconf', signer, [], { publish: true }), /relay/);
});
