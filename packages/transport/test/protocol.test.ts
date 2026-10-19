import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_EVENT_BYTES,
  ProtocolError,
  REQUEST_BUCKETS,
  RESPONSE_BUCKETS,
  decodeRequest,
  decodeResponse,
  encodeRequest,
  encodeResponse,
  eventBytes,
  padJson,
  utf8Length,
  validateFilter,
} from '../src/protocol.ts';
import { randomPubkey, wrapLike } from './helpers.ts';

const enc = new TextEncoder();

test('padJson hits the bucket exactly, also with multi-byte characters', () => {
  for (const size of [...REQUEST_BUCKETS, ...RESPONSE_BUCKETS]) {
    const s = padJson({ v: 1, note: 'héllo ✓ 🎥' }, size);
    assert.equal(utf8Length(s), size);
    const back = JSON.parse(s);
    assert.equal(back.note, 'héllo ✓ 🎥');
    assert.match(back.pad, /^0+$/);
  }
  assert.throws(() => padJson({ big: 'x'.repeat(5_000) }, 4_096), ProtocolError);
});

test('request round trip: publish and query, exact size', () => {
  const p = randomPubkey();
  const ev = wrapLike(p, { contentBytes: 33_000 });
  const body = encodeRequest({ v: 1, respBytes: 262_144, ops: [{ op: 'publish', event: ev }, { op: 'query', filter: { kinds: [1059], '#p': [p], limit: 10 } }] }, 40_960);
  const bytes = enc.encode(body);
  assert.equal(bytes.length, 40_960);
  const r = decodeRequest(bytes);
  assert.equal(r.respBytes, 262_144);
  assert.deepEqual(r.ops[0], { op: 'publish', event: ev });
  assert.deepEqual(r.ops[1], { op: 'query', filter: { kinds: [1059], '#p': [p], limit: 10 } });
});

test('decodeRequest refuses unpadded sizes, unknown keys, bad ops and oversize events', () => {
  const p = randomPubkey();
  const ok = encodeRequest({ v: 1, respBytes: 4_096, ops: [] }, 4_096);
  assert.doesNotThrow(() => decodeRequest(enc.encode(ok)));
  // Not a bucket size.
  assert.throws(() => decodeRequest(enc.encode(JSON.stringify({ v: 1, respBytes: 4096, ops: [], pad: '' }))), /exactly one of/);
  // Extra key.
  assert.throws(() => decodeRequest(enc.encode(padJson({ v: 1, respBytes: 4096, ops: [], x: 1 }, 4_096))), /keys must be exactly/);
  // Bad respBytes.
  assert.throws(() => decodeRequest(enc.encode(padJson({ v: 1, respBytes: 5000, ops: [] }, 4_096))), /respBytes/);
  // Unknown op.
  assert.throws(() => decodeRequest(enc.encode(padJson({ v: 1, respBytes: 4096, ops: [{ op: 'delete' }] }, 4_096))), /op:/);
  // Too many queries.
  const q = { op: 'query', filter: { '#p': [p] } };
  assert.throws(() => decodeRequest(enc.encode(padJson({ v: 1, respBytes: 4096, ops: [q, q, q, q, q] }, 4_096))), /at most 4 queries/);
  // Event over 64 KiB (sent in the largest bucket).
  const big = wrapLike(p, { contentBytes: MAX_EVENT_BYTES });
  assert.ok(eventBytes(big) > MAX_EVENT_BYTES);
  assert.throws(() => decodeRequest(enc.encode(padJson({ v: 1, respBytes: 4096, ops: [{ op: 'publish', event: big }] }, 81_920))), /over 65536/);
  // Malformed event.
  assert.throws(() => decodeRequest(enc.encode(padJson({ v: 1, respBytes: 4096, ops: [{ op: 'publish', event: { id: 'x' } }] }, 4_096))), /malformed/);
});

test('validateFilter: known keys only, bounded, no open-ended scans', () => {
  const p = randomPubkey();
  assert.deepEqual(validateFilter({ '#p': [p], kinds: [1059], since: 1, until: 2, limit: 5 }), { '#p': [p], kinds: [1059], since: 1, until: 2, limit: 5 });
  assert.throws(() => validateFilter({ kinds: [1059] }), /needs ids, authors or #p/);
  assert.throws(() => validateFilter({ '#p': [p], '#e': [p] }), /unknown key/);
  assert.throws(() => validateFilter({ '#p': ['ABC'] }), /64-hex/);
  assert.throws(() => validateFilter({ '#p': Array.from({ length: 257 }, () => p) }), /1–256/);
  assert.throws(() => validateFilter({ '#p': [p], limit: 501 }), /limit/);
  assert.throws(() => validateFilter({ '#p': [p], since: -1 }), /since/);
});

test('encodeResponse fills exactly the asked size, newest first, and flags truncation', () => {
  const p = randomPubkey();
  const events = Array.from({ length: 12 }, (_, i) => wrapLike(p, { createdAt: 1_000 + i, contentBytes: 20_000 })).reverse();
  for (const size of RESPONSE_BUCKETS) {
    const s = encodeResponse({ v: 1, status: 'ok', results: [{ op: 'query', ok: true, events, more: false }] }, size);
    const bytes = enc.encode(s);
    assert.equal(bytes.length, size);
    const r = decodeResponse(bytes, size);
    const q = r.results[0];
    assert.equal(q.op, 'query');
    if (q.op !== 'query') return;
    const fits = Math.floor((size - 120) / (eventBytes(events[0]) + 1));
    assert.equal(q.events.length, Math.min(12, fits), `size ${size}`);
    assert.equal(q.more, q.events.length < 12);
    assert.deepEqual(
      q.events.map((e) => e.id),
      events.slice(0, q.events.length).map((e) => e.id),
    );
  }
  assert.throws(() => decodeResponse(enc.encode(encodeResponse({ v: 1, status: 'ok', results: [] }, 4_096)), 65_536), /expected exactly/);
});
