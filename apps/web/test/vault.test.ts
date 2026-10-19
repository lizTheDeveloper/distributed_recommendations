import { test } from "node:test";
import assert from "node:assert/strict";
import { IDBFactory } from "fake-indexeddb";
import type { RecordStore, Vault } from "../src/lib/vault.ts";
import { PBKDF2_ITERATIONS, idbRecordStore, memoryRecordStore, openVault } from "../src/lib/vault.ts";
import { loadSensitive, removeLegacy } from "../src/lib/localdata.ts";
import { memoryKV } from "../src/lib/storage.ts";
import { DAY_MS, pruneHistory, record } from "../src/lib/history.ts";
import { defaultSettings, loadSettings } from "../src/lib/settings.ts";

const subtle = globalThis.crypto.subtle;
const ITER = 1000; // fast passphrase tests; production uses PBKDF2_ITERATIONS

async function ready(store: RecordStore | null, extra: { iterations?: number } = {}): Promise<Vault> {
  const r = await openVault({ store, subtle, iterations: extra.iterations ?? ITER });
  assert.equal(r.kind, "ready");
  return (r as { vault: Vault }).vault;
}

const bytesOf = (x: unknown) => new Uint8Array((x as { ct: ArrayBuffer | Uint8Array }).ct instanceof Uint8Array ? ((x as { ct: Uint8Array }).ct.buffer as ArrayBuffer) : ((x as { ct: ArrayBuffer }).ct));
const contains = (hay: Uint8Array, needle: string) => Buffer.from(hay).includes(Buffer.from(needle));

const ev = (id: string, at: number) => ({ videoId: `https://a.example/videos/watch/${id}`, at, kind: "endorse" as const, tags: ["cob-oven"] });

test("records are AES-GCM ciphertext with fresh 96-bit IVs under a non-extractable key", async () => {
  const store = memoryRecordStore();
  const v = await ready(store);
  assert.equal(v.status, "device");
  v.write("history", [ev("secret-video", 1)]);
  v.write("tally", { follow: 1 });
  await v.flush();
  const raw = store.dump();
  const key = raw.get("key") as CryptoKey;
  assert.equal(key.extractable, false);
  assert.equal((key.algorithm as AesKeyAlgorithm).length, 256);
  await assert.rejects(subtle.exportKey("raw", key));
  const h = raw.get("rec:history") as { iv: Uint8Array };
  assert.equal(h.iv.length, 12);
  assert.ok(!contains(bytesOf(h), "secret-video"), "no plaintext in the ciphertext");
  assert.notDeepEqual(h.iv, (raw.get("rec:tally") as { iv: Uint8Array }).iv);
  // Rewriting the same value uses a new IV.
  v.write("history", [ev("secret-video", 1)]);
  await v.flush();
  assert.notDeepEqual((store.dump().get("rec:history") as { iv: Uint8Array }).iv, h.iv);
  // Reopen: same key, same data.
  const again = await ready(store);
  assert.deepEqual(await again.readAll(), { history: [ev("secret-video", 1)], tally: { follow: 1 } });
});

test("a ciphertext moved to another record name fails authentication and is dropped", async () => {
  const store = memoryRecordStore();
  const v = await ready(store);
  v.write("history", [ev("x", 1)]);
  v.write("follows", []);
  await v.flush();
  const m = store.dump();
  m.set("rec:follows", m.get("rec:history"));
  m.set("rec:tags", { iv: new Uint8Array(3), ct: new Uint8Array(4) }); // malformed
  const data = await (await ready(store)).readAll();
  assert.deepEqual(Object.keys(data), ["history"]);
  assert.ok(!m.has("rec:follows") && !m.has("rec:tags"), "undecryptable records are deleted");
});

test("wipe crypto-shreds: ciphertext and key are deleted, kept state is re-encrypted under a new key", async () => {
  const store = memoryRecordStore();
  const v = await ready(store);
  v.write("history", [ev("x", 1)]);
  v.write("follows", [{ handle: "a@b.example", addedAt: 1 }]);
  await v.flush();
  const oldKey = store.dump().get("key") as CryptoKey;
  const oldHistory = store.dump().get("rec:history") as { iv: Uint8Array; ct: ArrayBuffer };
  await v.shred({ follows: [{ handle: "a@b.example", addedAt: 1 }] });
  const m = store.dump();
  assert.ok(!m.has("rec:history"));
  assert.notEqual(m.get("key"), oldKey);
  // A copy of the old ciphertext (e.g. left on disk) can't be opened with the new key.
  const newKey = m.get("key") as CryptoKey;
  await assert.rejects(subtle.decrypt({ name: "AES-GCM", iv: oldHistory.iv as Uint8Array<ArrayBuffer>, additionalData: new TextEncoder().encode("mf-vault:v1:history") }, newKey, oldHistory.ct));
  assert.deepEqual(await (await ready(store)).readAll(), { follows: [{ handle: "a@b.example", addedAt: 1 }] });
  // Writes queued before a wipe never land after it.
  v.write("history", [ev("late", 2)]);
  await v.shred();
  assert.deepEqual(await (await ready(store)).readAll(), {});
});

test("a lost device key makes old records unreadable and they are cleared", async () => {
  const store = memoryRecordStore();
  const v = await ready(store);
  v.write("history", [ev("x", 1)]);
  await v.flush();
  store.dump().delete("key");
  const v2 = await ready(store);
  assert.deepEqual(await v2.readAll(), {});
  assert.ok(!store.dump().has("rec:history"));
});

test("optional passphrase: no key stored, wrong passphrase rejected, reset deletes everything", async () => {
  assert.ok(PBKDF2_ITERATIONS >= 600_000);
  const store = memoryRecordStore();
  const v = await ready(store);
  v.write("history", [ev("x", 1)]);
  await v.flush();
  await assert.rejects(v.setPassphrase("short"), /at least/);
  await v.setPassphrase("correct horse battery");
  assert.equal(v.status, "passphrase");
  assert.ok(!store.dump().has("key"), "no stored key in passphrase mode");
  v.write("tally", { follow: 2 }); // writes keep working under the derived key
  await v.flush();

  const locked = await openVault({ store, subtle });
  assert.equal(locked.kind, "locked");
  if (locked.kind !== "locked") return;
  assert.equal(await locked.unlock("wrong passphrase"), null);
  const u = await locked.unlock("correct horse battery");
  assert.ok(u);
  assert.deepEqual(await u.readAll(), { history: [ev("x", 1)], tally: { follow: 2 } });

  await u.clearPassphrase();
  assert.equal(u.status, "device");
  const back = await ready(store);
  assert.deepEqual(await back.readAll(), { history: [ev("x", 1)], tally: { follow: 2 } });

  await back.setPassphrase("another passphrase");
  const again = await openVault({ store, subtle });
  assert.equal(again.kind, "locked");
  if (again.kind !== "locked") return;
  const fresh = await again.reset();
  assert.equal(fresh.status, "device");
  assert.deepEqual(await fresh.readAll(), {});
  assert.equal((await openVault({ store, subtle })).kind, "ready");
});

test("no IndexedDB or WebCrypto: memory vault, nothing persisted", async () => {
  const noStore = await openVault({ store: null, subtle, unavailableReason: "IndexedDB is blocked." });
  assert.equal(noStore.kind, "ready");
  const v = (noStore as { vault: Vault }).vault;
  assert.equal(v.status, "memory");
  assert.equal(v.reason, "IndexedDB is blocked.");
  v.write("history", [ev("x", 1)]);
  await v.flush();
  assert.deepEqual(await v.readAll(), {});
  await assert.rejects(v.setPassphrase("long enough passphrase"));

  const noCrypto = await openVault({ store: memoryRecordStore(), subtle: undefined });
  assert.equal((noCrypto as { vault: Vault }).vault.status, "memory");

  const broken: RecordStore = { get: async () => { throw new Error("InvalidStateError"); }, keys: async () => [], apply: async () => {} };
  const r = await openVault({ store: broken, subtle });
  assert.equal((r as { vault: Vault }).vault.status, "memory");
  assert.match((r as { vault: Vault }).vault.reason!, /InvalidStateError/);
});

test("plaintext localStorage history is migrated once, then deleted", async () => {
  const kv = memoryKV();
  kv.set("mf.v1.history", JSON.stringify([ev("old", 5)]));
  kv.set("mf.v1.follows", JSON.stringify([{ handle: "a@b.example", addedAt: 1 }]));
  kv.set("mf.v1.tags", "{not json");
  kv.set("mf.v1.settings", JSON.stringify({ p2p: false }));
  const store = memoryRecordStore();
  const first = await loadSensitive(await ready(store), kv);
  assert.deepEqual(first.migrated.sort(), ["follows", "history"]);
  assert.deepEqual(first.data.history, [ev("old", 5)]);
  assert.equal(kv.get("mf.v1.history"), null);
  assert.equal(kv.get("mf.v1.follows"), null);
  assert.equal(kv.get("mf.v1.tags"), null, "unreadable plaintext is deleted too");
  assert.notEqual(kv.get("mf.v1.settings"), null, "settings aren't sensitive and stay");
  const second = await loadSensitive(await ready(store), kv);
  assert.deepEqual(second.migrated, []);
  assert.deepEqual(second.data.history, [ev("old", 5)]);
});

test("migration keeps the plaintext if the encrypted write fails, and memory mode never deletes or writes it", async () => {
  const kv = memoryKV();
  kv.set("mf.v1.history", JSON.stringify([ev("old", 5)]));
  const inner = memoryRecordStore();
  let fail = false;
  const flaky: RecordStore = { ...inner, apply: async (ops) => { if (fail) throw new Error("QuotaExceededError"); return inner.apply(ops); } };
  const v = await ready(flaky);
  fail = true;
  const r = await loadSensitive(v, kv);
  assert.equal(r.legacyLeft, true);
  assert.notEqual(kv.get("mf.v1.history"), null);

  const mem = (await openVault({ store: null, subtle: null })) as { vault: Vault };
  const m = await loadSensitive(mem.vault, kv);
  assert.deepEqual(m.data.history, [ev("old", 5)], "read for this session");
  assert.equal(m.legacyLeft, true);
  removeLegacy(kv);
  assert.equal(kv.get("mf.v1.history"), null);
});

test("IndexedDB store round trip (fake-indexeddb): CryptoKey and ciphertext survive a reopen", async () => {
  const factory = new IDBFactory();
  const v = await ready(await idbRecordStore(factory, "t"));
  v.write("history", [ev("idb", 9)]);
  await v.flush();
  const store2 = await idbRecordStore(factory, "t");
  assert.deepEqual((await store2.keys()).sort(), ["key", "meta", "rec:history"]);
  const v2 = await ready(store2);
  assert.deepEqual(await v2.readAll(), { history: [ev("idb", 9)] });
  await v2.shred();
  assert.deepEqual((await (await idbRecordStore(factory, "t")).keys()).sort(), ["key", "meta"]);
  await assert.rejects(idbRecordStore(undefined), /unavailable/);
});

test("retention: history outside the sharing window is deleted; private watching records nothing", () => {
  assert.equal(defaultSettings().retentionDays, 60);
  assert.equal(loadSettings({ retentionDays: 90 }).retentionDays, 90);
  assert.equal(loadSettings({ retentionDays: 7 }).retentionDays, 60);
  const now = 1_000 * DAY_MS;
  const h = [ev("old", now - 61 * DAY_MS), ev("edge", now - 60 * DAY_MS), ev("new", now - DAY_MS)];
  assert.deepEqual(pruneHistory(h, 60, now).map((e) => e.videoId.split("/").pop()), ["edge", "new"]);
  assert.deepEqual(pruneHistory(h, 30, now).map((e) => e.videoId.split("/").pop()), ["new"]);
  const kept = pruneHistory(h, 90, now);
  assert.equal(kept, h, "unchanged array when nothing expires");
  assert.equal(record(h, ev("p", now), { privateWatching: true }), h);
});
