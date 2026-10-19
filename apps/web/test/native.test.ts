import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import type { Vault } from "../src/lib/vault.ts";
import { memoryRecordStore, openVault } from "../src/lib/vault.ts";
import { MAX_SECRET_LENGTH, SECRET_NAMES, keyStoreLabel, matchNotice, nativeBridge, notificationId } from "../src/lib/native.ts";
import { generateIdentity, hydrateIdentity, storableIdentity } from "../src/lib/match/identity.ts";

const subtle = globalThis.crypto.subtle;

function fakeSecrets() {
  const m = new Map<string, string>();
  return {
    m,
    get: async (n: string) => m.get(n) ?? null,
    set: async (n: string, v: string) => void m.set(n, v),
    remove: async (n: string) => void m.delete(n),
  };
}
async function ready(store: ReturnType<typeof memoryRecordStore>, native: ReturnType<typeof fakeSecrets> | null): Promise<Vault> {
  const r = await openVault({ store, subtle, native, iterations: 1000 });
  assert.equal(r.kind, "ready");
  return (r as { vault: Vault }).vault;
}

test("bridge types match apps/mobile/bridge/types.ts when it is in the tree", () => {
  const p = new URL("../../mobile/bridge/types.ts", import.meta.url);
  if (!existsSync(p)) return; // apps/web builds on its own (reproducibility copies)
  const src = readFileSync(p, "utf8");
  for (const n of SECRET_NAMES) assert.ok(src.includes(`"${n}"`), n);
  assert.ok(src.includes(`MAX_SECRET_LENGTH = ${MAX_SECRET_LENGTH}`));
  for (const k of ["onIncoming", "requestPermission", "notify(", "onOpen", "enable(", "disable()", "version: 1", '"peertube-watch"']) assert.ok(src.includes(k), k);
});

test("nativeBridge: undefined in a browser, version 1 only", () => {
  assert.equal(nativeBridge({}), undefined);
  assert.equal(nativeBridge({ MatchFeedNative: { version: 2, platform: "ios", secrets: { get() {} } } }), undefined);
  assert.equal(nativeBridge({ MatchFeedNative: { version: 1, platform: "ios", secrets: { get() {} } } })?.platform, "ios");
  assert.equal(keyStoreLabel(undefined), "this browser");
  assert.equal(keyStoreLabel("android"), "Android Keystore");
});

test("notifications: stable 31-bit ids, generic lock-screen text", () => {
  const a = notificationId("request:abc");
  assert.equal(a, notificationId("request:abc"));
  assert.notEqual(a, notificationId("request:abd"));
  assert.ok(a >= 0 && a < 2 ** 31);
  const n = matchNotice("request", "Meme Video");
  assert.deepEqual(n, { title: "New match request", body: "Open Meme Video to review it.", route: "matches" });
});

test("vault key in the native keystore: no key in IndexedDB, survives reopen", async () => {
  const store = memoryRecordStore();
  const sec = fakeSecrets();
  const v = await ready(store, sec);
  assert.equal(v.keyStore, "native");
  v.write("history", [{ videoId: "x" }]);
  await v.flush();
  assert.equal(store.dump().has("key"), false);
  assert.equal(atob(sec.m.get("vault-key")!).length, 32);
  const again = await ready(store, sec);
  assert.deepEqual((await again.readAll()).history, [{ videoId: "x" }]);
});

test("first start in the native shell migrates records off the IndexedDB key", async () => {
  const store = memoryRecordStore();
  const browser = await ready(store, null);
  assert.equal(browser.keyStore, "browser");
  browser.write("follows", [{ handle: "a@b.example" }]);
  await browser.flush();
  assert.ok(store.dump().has("key"));
  const sec = fakeSecrets();
  const v = await ready(store, sec);
  assert.equal(store.dump().has("key"), false, "old key deleted");
  assert.ok(sec.m.has("vault-key"));
  assert.deepEqual((await v.readAll()).follows, [{ handle: "a@b.example" }]);
});

test("wipe replaces the keystore key (crypto-shred); passphrase mode removes it", async () => {
  const store = memoryRecordStore();
  const sec = fakeSecrets();
  const v = await ready(store, sec);
  v.write("history", [1]);
  await v.flush();
  const before = sec.m.get("vault-key");
  await v.shred({ follows: [2] });
  assert.notEqual(sec.m.get("vault-key"), before);
  assert.deepEqual(await v.readAll(), { follows: [2] });
  await v.setPassphrase("correct horse battery");
  assert.equal(sec.m.has("vault-key"), false);
  assert.equal(v.keyStore, undefined);
  await v.clearPassphrase();
  assert.ok(sec.m.has("vault-key"));
  assert.equal(store.dump().has("key"), false);
  assert.deepEqual(await v.readAll(), { follows: [2] });
});

test("a lost keystore key starts fresh instead of failing", async () => {
  const store = memoryRecordStore();
  const sec = fakeSecrets();
  const v = await ready(store, sec);
  v.write("history", [1]);
  await v.flush();
  sec.m.clear();
  const again = await ready(store, sec);
  assert.deepEqual(await again.readAll(), {});
});

test("identity secret moves to the keystore; the vault keeps only the pubkey", async () => {
  const sec = fakeSecrets();
  const id = generateIdentity(5);
  if (id.kind !== "local") throw new Error("expected a local key");
  const stored = await storableIdentity(id, sec);
  assert.deepEqual(stored, { kind: "local", keystore: true, pubkey: id.pubkey, createdAt: 5, imported: false });
  assert.equal(sec.m.get("nostr-secret-key"), id.secret);
  assert.deepEqual(await hydrateIdentity(stored, sec), id);
  assert.equal(await hydrateIdentity(stored, null), null, "no keystore: can't be used");
  assert.deepEqual(await storableIdentity(id, null), id, "browser: unchanged");
  const ext = { kind: "nip07" as const, pubkey: "3".repeat(64), createdAt: 1 };
  assert.deepEqual(await storableIdentity(ext, sec), ext);
});
