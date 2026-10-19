// A local, in-memory Nostr relay for developing and testing Match. Never point
// development traffic at public relays: use this instead.
//
//   npm run dev-relay                    # ws://127.0.0.1:7777
//   npm run dev-relay -- --port 7788     # another port
//   npm run dev-relay -- --auth          # require NIP-42 AUTH before serving REQs
//
// - NIP-01: EVENT (signature checked with nostr-tools), REQ with ids / authors /
//   kinds / #<tag> / since / until / limit, CLOSE, EOSE, OK, CLOSED, NOTICE; live
//   subscriptions after EOSE.
// - 64 KiB: events whose JSON is over 65,536 bytes are refused (`OK false invalid:`);
//   WebSocket frames are capped at 256 KiB.
// - NIP-40: expired events are refused, hidden from queries and purged every minute.
// - NIP-42 (with --auth): every connection gets a challenge; REQs are refused with
//   `CLOSED auth-required:` until the client authenticates (kind 22242, matching
//   challenge and relay URL, created within 10 minutes).
// - Listens on 127.0.0.1 only. Nothing is written to disk.

import { WebSocketServer } from "ws";
import { randomBytes } from "node:crypto";
import { verifyEvent } from "nostr-tools/pure";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const port = Number(opt("--port", process.env.PORT ?? 7777));
const requireAuth = flag("--auth");
const quiet = flag("--quiet");
const MAX_EVENT_BYTES = 65_536;
const MAX_FRAME_BYTES = 256 * 1024;
const MAX_SUBS = 20;
const MAX_LIMIT = 5000;

/** @type {Map<string, any>} */
const events = new Map();
const log = (...a) => quiet || console.log(new Date().toISOString().slice(11, 19), ...a);
const nowSec = () => Math.floor(Date.now() / 1000);
const bytes = (ev) => Buffer.byteLength(JSON.stringify(ev), "utf8");
const expiration = (ev) => {
  const t = ev.tags.find((x) => x[0] === "expiration");
  const n = t ? Number(t[1]) : NaN;
  return Number.isInteger(n) ? n : undefined;
};
const expired = (ev) => {
  const e = expiration(ev);
  return e !== undefined && e <= nowSec();
};

function validShape(ev) {
  return (
    ev && typeof ev === "object" &&
    typeof ev.id === "string" && /^[0-9a-f]{64}$/.test(ev.id) &&
    typeof ev.pubkey === "string" && /^[0-9a-f]{64}$/.test(ev.pubkey) &&
    typeof ev.sig === "string" && /^[0-9a-f]{128}$/.test(ev.sig) &&
    Number.isInteger(ev.kind) && Number.isInteger(ev.created_at) &&
    typeof ev.content === "string" &&
    Array.isArray(ev.tags) && ev.tags.every((t) => Array.isArray(t) && t.every((v) => typeof v === "string"))
  );
}

function matches(ev, f) {
  if (f.ids && !f.ids.includes(ev.id)) return false;
  if (f.authors && !f.authors.includes(ev.pubkey)) return false;
  if (f.kinds && !f.kinds.includes(ev.kind)) return false;
  if (f.since !== undefined && ev.created_at < f.since) return false;
  if (f.until !== undefined && ev.created_at > f.until) return false;
  for (const [k, vals] of Object.entries(f)) {
    if (k.length === 2 && k[0] === "#" && Array.isArray(vals)) {
      if (!ev.tags.some((t) => t[0] === k[1] && vals.includes(t[1]))) return false;
    }
  }
  return true;
}

function query(filters) {
  const out = [];
  for (const f of filters) {
    const hits = [...events.values()].filter((e) => !expired(e) && matches(e, f)).sort((a, b) => b.created_at - a.created_at);
    out.push(...hits.slice(0, Math.min(MAX_LIMIT, Number.isInteger(f.limit) ? f.limit : MAX_LIMIT)));
  }
  return [...new Map(out.map((e) => [e.id, e])).values()].sort((a, b) => a.created_at - b.created_at);
}

setInterval(() => {
  let n = 0;
  for (const [id, ev] of events) if (expired(ev)) (events.delete(id), n++);
  if (n) log(`purged ${n} expired event(s)`);
}, 60_000).unref();

const wss = new WebSocketServer({ host: "127.0.0.1", port, maxPayload: MAX_FRAME_BYTES });
const url = `ws://127.0.0.1:${port}`;
const clients = new Set();

wss.on("connection", (ws, req) => {
  const c = { ws, subs: new Map(), challenge: randomBytes(16).toString("hex"), authed: new Set() };
  clients.add(c);
  const send = (msg) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(msg));
  if (requireAuth) send(["AUTH", c.challenge]);
  log(`+ connection (${clients.size} open)`);

  ws.on("message", (data, isBinary) => {
    if (isBinary) return send(["NOTICE", "binary frames are not supported"]);
    let msg;
    try {
      msg = JSON.parse(data.toString("utf8"));
    } catch {
      return send(["NOTICE", "invalid: not JSON"]);
    }
    if (!Array.isArray(msg)) return send(["NOTICE", "invalid: not an array"]);
    const [type] = msg;
    if (type === "EVENT") {
      const ev = msg[1];
      if (!validShape(ev)) return send(["OK", ev?.id ?? "", false, "invalid: malformed event"]);
      const size = bytes(ev);
      if (size > MAX_EVENT_BYTES) return send(["OK", ev.id, false, `invalid: event too large (${size} bytes, max ${MAX_EVENT_BYTES})`]);
      if (!verifyEvent({ ...ev, tags: ev.tags.map((t) => [...t]) })) return send(["OK", ev.id, false, "invalid: bad signature"]);
      if (expired(ev)) return send(["OK", ev.id, false, "invalid: event has expired"]);
      if (events.has(ev.id)) return send(["OK", ev.id, true, "duplicate: already have this event"]);
      events.set(ev.id, ev);
      send(["OK", ev.id, true, ""]);
      log(`EVENT kind ${ev.kind}, ${size} bytes (${events.size} stored)`);
      for (const other of clients) {
        for (const [subId, filters] of other.subs) {
          if (filters.some((f) => matches(ev, f))) other.ws.readyState === other.ws.OPEN && other.ws.send(JSON.stringify(["EVENT", subId, ev]));
        }
      }
    } else if (type === "REQ") {
      const subId = msg[1];
      const filters = msg.slice(2).filter((f) => f && typeof f === "object");
      if (typeof subId !== "string" || subId.length > 64) return send(["NOTICE", "invalid: bad subscription id"]);
      if (requireAuth && c.authed.size === 0) return send(["CLOSED", subId, "auth-required: this relay serves authenticated clients only"]);
      if (!c.subs.has(subId) && c.subs.size >= MAX_SUBS) return send(["CLOSED", subId, "error: too many subscriptions"]);
      c.subs.set(subId, filters);
      for (const ev of query(filters)) send(["EVENT", subId, ev]);
      send(["EOSE", subId]);
    } else if (type === "CLOSE") {
      c.subs.delete(msg[1]);
    } else if (type === "AUTH") {
      const ev = msg[1];
      if (!validShape(ev) || !verifyEvent({ ...ev, tags: ev.tags.map((t) => [...t]) })) return send(["OK", ev?.id ?? "", false, "invalid: bad auth event"]);
      const tag = (n) => ev.tags.find((t) => t[0] === n)?.[1];
      const relayTag = (tag("relay") ?? "").replace(/\/$/, "");
      const okKind = ev.kind === 22242 && tag("challenge") === c.challenge && Math.abs(nowSec() - ev.created_at) < 600;
      const okRelay = relayTag === url || relayTag === `ws://localhost:${port}`;
      if (!okKind || !okRelay) return send(["OK", ev.id, false, "invalid: wrong challenge, relay or time"]);
      c.authed.add(ev.pubkey);
      send(["OK", ev.id, true, ""]);
      log(`AUTH ok (${ev.pubkey.slice(0, 8)}…)`);
    } else {
      send(["NOTICE", `unsupported: ${String(type).slice(0, 20)}`]);
    }
  });
  ws.on("close", () => {
    clients.delete(c);
    log(`- connection (${clients.size} open)`);
  });
  ws.on("error", () => {});
});

wss.on("listening", () => {
  console.log(`Local dev relay on ${url} (in memory${requireAuth ? ", NIP-42 AUTH required" : ""}). Add it under Matches → Relays. Ctrl+C to stop.`);
});
wss.on("error", (e) => {
  console.error(`dev relay: ${e.message}`);
  process.exit(1);
});
