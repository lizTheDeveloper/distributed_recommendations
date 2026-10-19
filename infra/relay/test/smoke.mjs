// Smoke test for the relay's limits and write policy. Talks to a running strfry
// (directly, without Caddy) and checks the rules in README.md "Configuration".
//
//   node infra/relay/test/smoke.mjs ws://127.0.0.1:7777 packages/match/node_modules,apps/web/node_modules
//
// The second argument lists node_modules directories to load nostr-tools and ws from
// (comma separated): the repo's own pinned copies, so this script adds no dependency.
//
// Run the relay with POLICY_BURST=5 POLICY_RATE=1 so the rate-limit case triggers.
// Uses throwaway keys and a local relay only; never point this at a public relay.

import { createRequire } from "node:module";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";

const [url = "ws://127.0.0.1:7777", modules = "packages/match/node_modules,apps/web/node_modules"] = process.argv.slice(2);
const requires = modules.split(",").map((d) => createRequire(resolve(d, "..", "noop.js")));
const req = (name) => {
  for (const r of requires) {
    try { return r(name); } catch (e) { if (e.code !== "MODULE_NOT_FOUND") throw e; }
  }
  throw new Error(`${name} not found in ${modules}`);
};
const { generateSecretKey, finalizeEvent, getPublicKey } = req("nostr-tools/pure");
const WebSocket = req("ws");

// A documentation-range address. Caddy would overwrite X-Real-IP; here the test sets
// it so it can check that the IP never reaches the logs.
const FAKE_IP = "203.0.113.77";
const now = () => Math.floor(Date.now() / 1000);
let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
  if (!ok) failures++;
};

function connect() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { headers: { "X-Real-IP": FAKE_IP } });
    const waiters = new Map();
    const subs = new Map();
    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg[0] === "OK") waiters.get(msg[1])?.(msg);
      if (msg[0] === "EVENT") subs.get(msg[1])?.events.push(msg[2]);
      if (msg[0] === "EOSE") subs.get(msg[1])?.done(subs.get(msg[1]).events);
    });
    ws.on("open", () =>
      resolve({
        publish: (ev) =>
          new Promise((res) => {
            const t = setTimeout(() => res(["OK", ev.id, false, "timeout"]), 5000);
            waiters.set(ev.id, (m) => { clearTimeout(t); res(m); });
            ws.send(JSON.stringify(["EVENT", ev]));
          }),
        query: (filter) =>
          new Promise((res) => {
            const id = randomBytes(4).toString("hex");
            subs.set(id, { events: [], done: (e) => { ws.send(JSON.stringify(["CLOSE", id])); res(e); } });
            ws.send(JSON.stringify(["REQ", id, filter]));
          }),
        close: () => ws.close(),
      }),
    );
    ws.on("error", reject);
  });
}

function wrap({ expiration, contentBytes = 1200, kind = 1059, p }) {
  const tags = [["p", p]];
  if (expiration !== undefined) tags.push(["expiration", String(expiration)]);
  return finalizeEvent(
    { kind, created_at: now() - Math.floor(Math.random() * 3600), tags, content: randomBytes(contentBytes).toString("base64") },
    generateSecretKey(),
  );
}

const recipient = getPublicKey(generateSecretKey());

// NIP-11
const httpUrl = url.replace(/^ws/, "http");
const info = await fetch(httpUrl, { headers: { Accept: "application/nostr+json" } }).then((r) => r.json());
check("NIP-11 document served", typeof info.name === "string" && info.name.length > 0, info.name);
check("NIP-11 lists NIP-40", Array.isArray(info.supported_nips) && info.supported_nips.includes(40));

const c = await connect();
let r = await c.publish(wrap({ expiration: now() + 14 * 86400, p: recipient }));
check("gift wrap with 14-day expiration accepted", r[2] === true, r[3]);
const stored = await c.query({ kinds: [1059], "#p": [recipient] });
check("gift wrap readable by #p", stored.length === 1);

r = await c.publish(wrap({ p: recipient }));
check("gift wrap without expiration rejected", r[2] === false && /expiration/.test(r[3]), r[3]);
r = await c.publish(wrap({ expiration: now() + 40 * 86400, p: recipient }));
check("gift wrap expiring in 40 days rejected", r[2] === false, r[3]);
r = await c.publish(wrap({ expiration: now() - 60, p: recipient }));
check("expired gift wrap rejected", r[2] === false, r[3]);
r = await c.publish(wrap({ kind: 1, expiration: now() - 60, p: recipient }));
check("expired non-wrap event rejected (NIP-40)", r[2] === false, r[3]);

// ~33 KB wrap (the NIP-17 128-bucket size from docs/PROTOCOL.md) fits; > 64 KiB does not.
r = await c.publish(wrap({ expiration: now() + 86400, contentBytes: 24_000, p: recipient }));
check("33 KB gift wrap accepted", r[2] === true, r[3]);
r = await c.publish(wrap({ expiration: now() + 86400, contentBytes: 50_000, p: recipient }));
check("> 64 KiB event rejected", r[2] === false, r[3]);

// Rate limit: burst 5 at 1/s (set by the caller). Earlier publishes used some tokens.
const results = [];
for (let i = 0; i < 12; i++) results.push(await c.publish(wrap({ expiration: now() + 86400, contentBytes: 64, p: recipient })));
const limited = results.filter((m) => m[2] === false && /rate-limited/.test(m[3])).length;
check("per-IP rate limit kicks in", limited > 0, `${limited}/12 rate-limited`);
c.close();

console.log(failures ? `${failures} check(s) failed` : "all relay checks passed");
console.log(`FAKE_IP=${FAKE_IP}`);
process.exit(failures ? 1 : 0);
