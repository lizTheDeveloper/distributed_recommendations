import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { SocketLike } from "../src/lib/match/wsRelay.ts";
import { WsRelay, matchesFilter } from "../src/lib/match/wsRelay.ts";
import type { SignedEvent } from "../src/lib/match/pkg.ts";
import { GIFT_WRAP_KIND, INSECURE_plaintextPsiForTests, InMemoryRelay, MatchClient, localSigner, generateMatchKey } from "../src/lib/match/pkg.ts";
import { finalizeEvent, generateSecretKey } from "../../../packages/match/node_modules/nostr-tools/lib/esm/pure.js";

/**
 * A fake relay behind fake sockets: stores events in the match package's
 * InMemoryRelay (signature, size and NIP-40 checks) and speaks NIP-01 / NIP-42.
 */
class FakeRelay {
  store = new InMemoryRelay();
  sockets: FakeSocket[] = [];
  requireAuth = false;
  challenge = "c-" + Math.random().toString(36).slice(2);
  authed = new Set<string>();
  received: unknown[][] = [];
  silent = false;
  socket = (url: string): SocketLike => {
    const s = new FakeSocket(this, url);
    this.sockets.push(s);
    return s;
  };
}

class FakeSocket implements SocketLike {
  readyState = 0;
  onopen: ((ev?: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev?: unknown) => void) | null = null;
  onerror: ((ev?: unknown) => void) | null = null;
  private relay: FakeRelay;
  readonly url: string;
  constructor(relay: FakeRelay, url: string) {
    this.relay = relay;
    this.url = url;
    setTimeout(() => {
      this.readyState = 1;
      this.onopen?.();
      if (relay.requireAuth) this.push(["AUTH", relay.challenge]);
    }, 1);
  }
  push(msg: unknown[]) {
    setTimeout(() => this.onmessage?.({ data: JSON.stringify(msg) }), 0);
  }
  close() {
    this.readyState = 3;
    setTimeout(() => this.onclose?.(), 0);
  }
  send(data: string) {
    const msg = JSON.parse(data) as unknown[];
    this.relay.received.push(msg);
    if (this.relay.silent) return;
    void this.handle(msg);
  }
  private async handle(msg: unknown[]) {
    const r = this.relay;
    if (msg[0] === "EVENT") {
      const ev = msg[1] as SignedEvent;
      if (r.requireAuth && r.authed.size === 0) return this.push(["OK", ev.id, false, "auth-required: sign in first"]);
      const res = await r.store.publish(ev);
      this.push(["OK", ev.id, res.ok, res.message]);
    } else if (msg[0] === "REQ") {
      const sub = msg[1] as string;
      if (r.requireAuth && r.authed.size === 0) return this.push(["CLOSED", sub, "auth-required: sign in first"]);
      for (const e of await r.store.query(msg[2] as never)) this.push(["EVENT", sub, e]);
      this.push(["EOSE", sub]);
    } else if (msg[0] === "AUTH") {
      const ev = msg[1] as SignedEvent;
      const ok = ev.kind === 22242 && ev.tags.some((t) => t[0] === "challenge" && t[1] === r.challenge) && ev.tags.some((t) => t[0] === "relay" && t[1] === this.url);
      if (ok) r.authed.add(ev.pubkey);
      this.push(["OK", ev.id, ok, ok ? "" : "invalid: bad auth"]);
    }
  }
}

function note(content = "hi", tags: string[][] = []): SignedEvent {
  return finalizeEvent({ kind: 1, created_at: Math.floor(Date.now() / 1000), tags, content }, generateSecretKey()) as SignedEvent;
}

test("ws relay: publish waits for OK, query collects until EOSE and sends CLOSE", async () => {
  const fake = new FakeRelay();
  const relay = new WsRelay({ urls: ["wss://r1.example"], socket: fake.socket, timeoutMs: 1000 });
  const ev = note("hello", [["p", "a".repeat(64)]]);
  assert.deepEqual(await relay.publish(ev), { ok: true, message: "" });
  const got = await relay.query({ kinds: [1], "#p": ["a".repeat(64)] });
  assert.deepEqual(got.map((e) => e.id), [ev.id]);
  assert.ok(fake.received.some((m) => m[0] === "CLOSE"), "CLOSE after EOSE");
  assert.deepEqual(await relay.query({ kinds: [1], "#p": ["b".repeat(64)] }), []);
  assert.equal(relay.statuses()[0].state, "open");
  relay.close();
});

test("ws relay: refuses events over 64 KiB before sending; relay rejections come back", async () => {
  const fake = new FakeRelay();
  const relay = new WsRelay({ urls: ["wss://r1.example"], socket: fake.socket, timeoutMs: 1000 });
  const big = note("x".repeat(70_000));
  const r = await relay.publish(big);
  assert.equal(r.ok, false);
  assert.match(r.message, /too large/);
  assert.equal(fake.received.length, 0, "nothing sent");
  const bad = { ...note("tampered"), content: "changed" };
  const r2 = await relay.publish(bad);
  assert.equal(r2.ok, false);
  assert.match(r2.message, /bad signature/);
});

test("ws relay: NIP-42 AUTH only when the relay asks, then retries once", async () => {
  const fake = new FakeRelay();
  fake.requireAuth = true;
  const sk = generateMatchKey();
  let asked = 0;
  const relay = new WsRelay({
    urls: ["wss://auth.example"],
    socket: fake.socket,
    timeoutMs: 1000,
    authSigner: () => {
      asked++;
      return localSigner(sk.secret);
    },
  });
  const ev = note("needs auth");
  assert.deepEqual(await relay.publish(ev), { ok: true, message: "" });
  assert.equal(asked, 1);
  assert.ok(fake.authed.has(sk.pubkey));
  const auth = fake.received.find((m) => m[0] === "AUTH")![1] as SignedEvent;
  assert.equal(auth.kind, 22242);
  assert.deepEqual(auth.tags, [["relay", "wss://auth.example"], ["challenge", fake.challenge]]);
  assert.equal((await relay.query({ kinds: [1] })).length, 1, "REQ works after auth");
  assert.equal(relay.statuses()[0].authed, true);

  // Without a signer, an auth-required relay just fails the publish.
  const fake2 = new FakeRelay();
  fake2.requireAuth = true;
  const noAuth = new WsRelay({ urls: ["wss://auth2.example"], socket: fake2.socket, timeoutMs: 500 });
  const r = await noAuth.publish(note());
  assert.equal(r.ok, false);
  assert.match(r.message, /auth-required/);
});

test("ws relay: several relays, merged and de-duplicated; one down is fine", async () => {
  const a = new FakeRelay();
  const b = new FakeRelay();
  const down: (u: string) => SocketLike = () => {
    throw new Error("refused");
  };
  const relay = new WsRelay({
    urls: ["wss://a.example", "wss://b.example", "wss://down.example"],
    socket: (u) => (u.includes("down") ? down(u) : u.includes("//a.") ? a.socket(u) : b.socket(u)),
    timeoutMs: 500,
  });
  const ev = note("both");
  assert.equal((await relay.publish(ev)).ok, true);
  const only = note("only b");
  await b.store.publish(only);
  const got = await relay.query({ kinds: [1] });
  assert.deepEqual(got.map((e) => e.id).sort(), [ev.id, only.id].sort());
  assert.equal(relay.statuses()[2].state, "error");

  const allDown = new WsRelay({ urls: ["wss://down.example"], socket: down, timeoutMs: 200 });
  await assert.rejects(allDown.query({ kinds: [1] }), /no relay answered/);
  assert.equal((await new WsRelay({ urls: [] }).publish(ev)).ok, false);
});

test("ws relay: a silent relay times out instead of hanging", async () => {
  const fake = new FakeRelay();
  fake.silent = true;
  const relay = new WsRelay({ urls: ["wss://slow.example"], socket: fake.socket, timeoutMs: 100 });
  const r = await relay.publish(note());
  assert.equal(r.ok, false);
  assert.match(r.message, /timed out/);
  assert.deepEqual(await relay.query({ kinds: [1] }), []);
});

test("ws relay: drops malformed or non-matching events from a misbehaving relay", async () => {
  const fake = new FakeRelay();
  const relay = new WsRelay({ urls: ["wss://evil.example"], socket: fake.socket, timeoutMs: 500 });
  await relay.publish(note()); // opens the socket
  const sock = fake.sockets[0];
  const origSend = sock.send.bind(sock);
  sock.send = (data: string) => {
    const msg = JSON.parse(data);
    if (msg[0] === "REQ") {
      sock.push(["EVENT", msg[1], { junk: true }]);
      sock.push(["EVENT", msg[1], note("wrong kind")]);
      sock.push(["EOSE", msg[1]]);
      return;
    }
    origSend(data);
  };
  assert.deepEqual(await relay.query({ kinds: [GIFT_WRAP_KIND] }), []);
  assert.equal(matchesFilter(note("x", [["p", "1"]]), { "#p": ["1"] }), true);
});

test("ws relay: MatchClient runs request → accept → sketch over it", async () => {
  const fake = new FakeRelay();
  const mk = () => new WsRelay({ urls: ["wss://r.example"], socket: fake.socket, timeoutMs: 1000 });
  const psi = INSECURE_plaintextPsiForTests();
  const ka = generateMatchKey();
  const kb = generateMatchKey();
  const alice = await MatchClient.create({ identity: localSigner(ka.secret), relay: mk(), psi });
  const bob = await MatchClient.create({ identity: localSigner(kb.secret), relay: mk(), psi });
  const id = await alice.requestMatch(kb.pubkey);
  const r1 = await bob.sync();
  assert.deepEqual(r1.events.map((e) => e.type), ["match-requested"]);
  await bob.acceptMatch(id);
  const r2 = await alice.sync();
  assert.ok(r2.events.some((e) => e.type === "match-active"));
  const hist = Array.from({ length: 5 }, (_, i) => ({ videoId: `https://v.example/videos/watch/${i}`, at: new Date(Date.now() - i * 1000), kind: "endorse" as const }));
  await bob.sendDueSketches(hist);
  const r3 = await alice.sync();
  assert.ok(r3.events.some((e) => e.type === "sketch"));
  assert.ok(fake.store.log.every((e) => e.kind === GIFT_WRAP_KIND));
});

test("dev relay script: stores, serves, enforces 64 KiB and NIP-40 over a real socket", async (t) => {
  const port = 17000 + Math.floor(Math.random() * 2000);
  const script = fileURLToPath(new URL("../scripts/dev-relay.mjs", import.meta.url));
  const proc = spawn(process.execPath, [script, "--port", String(port), "--quiet"], { stdio: ["ignore", "pipe", "pipe"] });
  t.after(() => proc.kill());
  await new Promise<void>((resolve, reject) => {
    proc.stdout.on("data", (d) => String(d).includes("dev relay on") && resolve());
    proc.on("exit", () => reject(new Error("relay exited")));
  });
  const WS = (globalThis as { WebSocket?: new (u: string) => SocketLike }).WebSocket;
  if (!WS) return t.skip("no global WebSocket in this Node");
  const relay = new WsRelay({ urls: [`ws://127.0.0.1:${port}`], socket: (u) => new WS(u), timeoutMs: 2000 });
  const ev = note("local");
  assert.deepEqual(await relay.publish(ev), { ok: true, message: "" });
  assert.deepEqual((await relay.query({ kinds: [1] })).map((e) => e.id), [ev.id]);
  const now = Math.floor(Date.now() / 1000);
  const sk = generateSecretKey();
  const old = finalizeEvent({ kind: 1059, created_at: now, tags: [["expiration", String(now - 5)]], content: "" }, sk) as SignedEvent;
  const r = await relay.publish(old);
  assert.equal(r.ok, false);
  assert.match(r.message, /expired/);
  // 64 KiB: craft one just over the limit and send it raw (the adapter would refuse it first).
  const big = finalizeEvent({ kind: 1, created_at: now, tags: [], content: "y".repeat(65_600) }, sk) as SignedEvent;
  const raw = new WS(`ws://127.0.0.1:${port}`);
  const reply = await new Promise<string>((resolve) => {
    raw.onopen = () => raw.send(JSON.stringify(["EVENT", big]));
    raw.onmessage = (m) => resolve(String(m.data));
  });
  raw.close();
  assert.match(reply, /too large/);
  relay.close();
});
