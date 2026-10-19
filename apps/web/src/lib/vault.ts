// Encryption at rest for sensitive local state (THREAT_MODEL.md T9).
//
// Records are AES-GCM-256 ciphertext in IndexedDB, each with a fresh random 96-bit IV
// and the record name as additional authenticated data (so a ciphertext can't be
// swapped into another slot). The key is one of:
//   - device mode (default): a non-extractable CryptoKey generated once and stored
//     in IndexedDB. Page JavaScript can use it but can't export its bytes.
//   - passphrase mode (optional): derived with PBKDF2-SHA-256 from a passphrase the
//     viewer types at startup; only the salt and a check value are stored.
// Wiping deletes the ciphertext *and* the key (crypto-shredding), then starts over
// with a fresh key.
//
// When IndexedDB or WebCrypto is unavailable, `openVault` returns a memory vault:
// nothing is persisted, and there is never a plaintext fallback.

/** Async record store. Values must be structured-cloneable (CryptoKey, Uint8Array…). */
export interface RecordStore {
  get(key: string): Promise<unknown>;
  keys(): Promise<string[]>;
  /** Apply puts and deletes atomically (one transaction). */
  apply(ops: { put?: [string, unknown][]; del?: string[] }): Promise<void>;
}

export type VaultStatus = "device" | "passphrase" | "memory";

export interface Vault {
  readonly status: VaultStatus;
  /** Why the vault is memory-only. */
  readonly reason?: string;
  /** Decrypt every stored record. Records that fail to decrypt are dropped. */
  readAll(): Promise<Record<string, unknown>>;
  /** Queue an encrypted write. Serialized; the latest value per name wins. */
  write(name: string, value: unknown): void;
  /** Resolve once queued writes are stored. Rejects if the last write failed. */
  flush(): Promise<void>;
  /**
   * Crypto-shred: delete every record, the key and any passphrase data, then start a
   * new device key and store `keep` under it (one transaction).
   */
  shred(keep?: Record<string, unknown>): Promise<void>;
  /** Re-encrypt everything under a key derived from `passphrase`. */
  setPassphrase(passphrase: string): Promise<void>;
  /** Re-encrypt everything under a new device key. */
  clearPassphrase(): Promise<void>;
}

export type OpenResult =
  | { kind: "ready"; vault: Vault }
  | {
      kind: "locked";
      /** Resolves to null when the passphrase is wrong. */
      unlock(passphrase: string): Promise<Vault | null>;
      /** Forgotten passphrase: delete everything and start fresh. */
      reset(): Promise<Vault>;
    };

export interface VaultOptions {
  store: RecordStore | null;
  subtle: SubtleCrypto | null | undefined;
  random?: (bytes: Uint8Array<ArrayBuffer>) => Uint8Array<ArrayBuffer>;
  /** PBKDF2 iterations for new passphrases (tests lower it). */
  iterations?: number;
  /** Shown in the memory-mode note when `store` or `subtle` is missing. */
  unavailableReason?: string;
}

/** OWASP's 2023 figure for PBKDF2-HMAC-SHA-256. WebCrypto has no Argon2 or scrypt. */
export const PBKDF2_ITERATIONS = 600_000;
export const MIN_PASSPHRASE = 8;

const META = "meta";
const KEY = "key";
const REC = "rec:";
const CHECK_AAD = "mf-vault:v1:check";
const CHECK_TEXT = "match-feed vault check";

interface Box {
  iv: Uint8Array;
  ct: ArrayBuffer | Uint8Array;
}
type Meta = { v: 1; mode: "device" } | { v: 1; mode: "passphrase"; iterations: number; salt: Uint8Array; check: Box };

const enc = new TextEncoder();
const dec = new TextDecoder();
const aad = (name: string) => enc.encode("mf-vault:v1:" + name);

function isBox(x: unknown): x is Box {
  if (typeof x !== "object" || x === null) return false;
  const o = x as Box;
  return o.iv instanceof Uint8Array && o.iv.length === 12 && (o.ct instanceof ArrayBuffer || o.ct instanceof Uint8Array);
}

function isAesKey(x: unknown): x is CryptoKey {
  if (typeof x !== "object" || x === null) return false;
  const k = x as CryptoKey;
  return k.type === "secret" && k.algorithm?.name === "AES-GCM";
}

function isMeta(x: unknown): x is Meta {
  if (typeof x !== "object" || x === null) return false;
  const o = x as Record<string, unknown>;
  if (o.v !== 1) return false;
  if (o.mode === "device") return true;
  return o.mode === "passphrase" && typeof o.iterations === "number" && o.salt instanceof Uint8Array && isBox(o.check);
}

/** A vault that persists nothing. The app keeps state in memory for the session. */
export function memoryVault(reason: string): Vault {
  return {
    status: "memory",
    reason,
    readAll: async () => ({}),
    write() {},
    flush: async () => {},
    shred: async () => {},
    setPassphrase: async () => {
      throw new Error("Encrypted storage isn't available in this browser.");
    },
    clearPassphrase: async () => {},
  };
}

export async function openVault(opts: VaultOptions): Promise<OpenResult> {
  const { store, subtle } = opts;
  if (!store || !subtle) return { kind: "ready", vault: memoryVault(opts.unavailableReason ?? "Encrypted storage isn't available here.") };
  const random = opts.random ?? ((b) => globalThis.crypto.getRandomValues(b));
  const iterations = opts.iterations ?? PBKDF2_ITERATIONS;

  const newDeviceKey = () => subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]) as Promise<CryptoKey>;

  async function seal(key: CryptoKey, name: string, json: string): Promise<Box> {
    const iv = random(new Uint8Array(12));
    const ct = await subtle!.encrypt({ name: "AES-GCM", iv, additionalData: aad(name), tagLength: 128 }, key, enc.encode(json));
    return { iv, ct };
  }
  async function open(key: CryptoKey, name: string, box: Box): Promise<string> {
    const pt = await subtle!.decrypt({ name: "AES-GCM", iv: box.iv as Uint8Array<ArrayBuffer>, additionalData: aad(name), tagLength: 128 }, key, box.ct as ArrayBuffer);
    return dec.decode(pt);
  }
  async function derive(passphrase: string, salt: Uint8Array, iters: number): Promise<CryptoKey> {
    const base = await subtle!.importKey("raw", enc.encode(passphrase.normalize("NFC")), "PBKDF2", false, ["deriveKey"]);
    return subtle!.deriveKey(
      { name: "PBKDF2", hash: "SHA-256", salt: salt as Uint8Array<ArrayBuffer>, iterations: iters },
      base,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
  }
  async function checkBox(key: CryptoKey): Promise<Box> {
    const iv = random(new Uint8Array(12));
    const ct = await subtle!.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(CHECK_AAD) }, key, enc.encode(CHECK_TEXT));
    return { iv, ct };
  }
  async function checkOk(key: CryptoKey, box: Box): Promise<boolean> {
    try {
      const pt = await subtle!.decrypt({ name: "AES-GCM", iv: box.iv as Uint8Array<ArrayBuffer>, additionalData: enc.encode(CHECK_AAD) }, key, box.ct as ArrayBuffer);
      return dec.decode(pt) === CHECK_TEXT;
    } catch {
      return false;
    }
  }
  const recordKeys = async () => (await store!.keys()).filter((k) => k.startsWith(REC));

  /** Fresh device key + meta; deletes every existing record unless kept. */
  async function freshDevice(keep: Record<string, unknown> = {}): Promise<CryptoKey> {
    const key = await newDeviceKey();
    const put: [string, unknown][] = [
      [KEY, key],
      [META, { v: 1, mode: "device" } satisfies Meta],
    ];
    for (const [name, value] of Object.entries(keep)) put.push([REC + name, await seal(key, name, JSON.stringify(value))]);
    const keepKeys = new Set(put.map(([k]) => k));
    const del = (await store!.keys()).filter((k) => !keepKeys.has(k));
    await store!.apply({ put, del });
    return key;
  }

  function makeVault(initialKey: CryptoKey, initialStatus: "device" | "passphrase"): Vault {
    let key = initialKey;
    let status: "device" | "passphrase" = initialStatus;
    const pending = new Map<string, string>();
    let chain: Promise<void> = Promise.resolve();
    let lastError: unknown = null;

    /** Run `fn` after everything queued so far. */
    function enqueue<T>(fn: () => Promise<T>): Promise<T> {
      const p = chain.then(fn);
      chain = p.then(
        () => {},
        () => {},
      );
      return p;
    }
    async function drain() {
      if (!pending.size) return;
      const batch = [...pending.entries()];
      pending.clear();
      const put: [string, unknown][] = [];
      for (const [name, json] of batch) put.push([REC + name, await seal(key, name, json)]);
      await store!.apply({ put });
    }
    async function decryptAll(k: CryptoKey): Promise<{ data: Record<string, unknown>; bad: string[] }> {
      const data: Record<string, unknown> = {};
      const bad: string[] = [];
      for (const rk of await recordKeys()) {
        const name = rk.slice(REC.length);
        const box = await store!.get(rk);
        try {
          if (!isBox(box)) throw new Error("malformed");
          data[name] = JSON.parse(await open(k, name, box));
        } catch {
          bad.push(rk);
        }
      }
      return { data, bad };
    }
    /** Re-encrypt every record under `next`, writing `meta`/`key` in the same transaction. */
    async function rekey(next: CryptoKey, extra: { put: [string, unknown][]; del: string[] }) {
      await drain();
      const { data, bad } = await decryptAll(key);
      const put: [string, unknown][] = [...extra.put];
      for (const [name, value] of Object.entries(data)) put.push([REC + name, await seal(next, name, JSON.stringify(value))]);
      await store!.apply({ put, del: [...extra.del, ...bad] });
      key = next;
    }

    const vault: Vault = {
      get status() {
        return status;
      },
      readAll: () =>
        enqueue(async () => {
          await drain();
          const { data, bad } = await decryptAll(key);
          if (bad.length) await store!.apply({ del: bad });
          return data;
        }),
      write(name, value) {
        pending.set(name, JSON.stringify(value));
        void enqueue(drain).then(
          () => (lastError = null),
          (e) => (lastError = e),
        );
      },
      flush: () =>
        enqueue(async () => {
          await drain();
          if (lastError) throw lastError;
        }),
      shred: (keep = {}) =>
        enqueue(async () => {
          pending.clear();
          key = await freshDevice(keep);
          status = "device";
        }),
      setPassphrase: (passphrase) =>
        enqueue(async () => {
          if (passphrase.length < MIN_PASSPHRASE) throw new Error(`Use at least ${MIN_PASSPHRASE} characters.`);
          const salt = random(new Uint8Array(16));
          const next = await derive(passphrase, salt, iterations);
          const meta: Meta = { v: 1, mode: "passphrase", iterations, salt, check: await checkBox(next) };
          await rekey(next, { put: [[META, meta]], del: [KEY] });
          status = "passphrase";
        }),
      clearPassphrase: () =>
        enqueue(async () => {
          if (status === "device") return;
          const next = await newDeviceKey();
          await rekey(next, { put: [[KEY, next], [META, { v: 1, mode: "device" } satisfies Meta]], del: [] });
          status = "device";
        }),
    };
    return vault;
  }

  try {
    const meta = await store.get(META);
    if (isMeta(meta) && meta.mode === "passphrase") {
      return {
        kind: "locked",
        async unlock(passphrase) {
          const k = await derive(passphrase, meta.salt, meta.iterations);
          return (await checkOk(k, meta.check)) ? makeVault(k, "passphrase") : null;
        },
        async reset() {
          return makeVault(await freshDevice(), "device");
        },
      };
    }
    const stored = isMeta(meta) ? await store.get(KEY) : undefined;
    let key: CryptoKey;
    if (isAesKey(stored)) {
      key = stored as CryptoKey;
    } else {
      // First run, or the key is gone: existing ciphertext can't be read, so drop it.
      key = await freshDevice();
    }
    // Probe the full path once, so a broken WebCrypto falls back instead of failing later.
    await open(key, "probe", await seal(key, "probe", "1"));
    return { kind: "ready", vault: makeVault(key, "device") };
  } catch (e) {
    return { kind: "ready", vault: memoryVault(`Encrypted storage failed (${e instanceof Error ? e.message || e.name : String(e)}).`) };
  }
}

/** In-memory RecordStore (tests). Clones values the way IndexedDB does. */
export function memoryRecordStore(): RecordStore & { dump(): Map<string, unknown> } {
  const m = new Map<string, unknown>();
  return {
    dump: () => m,
    get: async (k) => (m.has(k) ? structuredClone(m.get(k)) : undefined),
    keys: async () => [...m.keys()],
    async apply({ put = [], del = [] }) {
      const cloned = put.map(([k, v]) => [k, structuredClone(v)] as const);
      for (const k of del) m.delete(k);
      for (const [k, v] of cloned) m.set(k, v);
    },
  };
}

export const IDB_NAME = "match-feed";
const IDB_STORE = "vault";

/** IndexedDB-backed RecordStore. Rejects when IndexedDB is missing, blocked or hangs. */
export function idbRecordStore(factory: IDBFactory | undefined = globalThis.indexedDB, name = IDB_NAME, timeoutMs = 4000): Promise<RecordStore> {
  return new Promise((resolve, reject) => {
    if (!factory) return reject(new Error("IndexedDB is unavailable"));
    const timer = setTimeout(() => reject(new Error("IndexedDB did not open")), timeoutMs);
    let req: IDBOpenDBRequest;
    try {
      req = factory.open(name, 1);
    } catch (e) {
      clearTimeout(timer);
      return reject(e);
    }
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(IDB_STORE)) req.result.createObjectStore(IDB_STORE);
    };
    req.onerror = () => {
      clearTimeout(timer);
      reject(req.error ?? new Error("IndexedDB open failed"));
    };
    req.onblocked = () => {
      clearTimeout(timer);
      reject(new Error("IndexedDB open blocked"));
    };
    req.onsuccess = () => {
      clearTimeout(timer);
      const db = req.result;
      db.onversionchange = () => db.close();
      const tx = <T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T> =>
        new Promise((res, rej) => {
          let t: IDBTransaction;
          try {
            t = db.transaction(IDB_STORE, mode);
          } catch (e) {
            return rej(e);
          }
          const r = fn(t.objectStore(IDB_STORE));
          t.oncomplete = () => res((r ? r.result : undefined) as T);
          t.onerror = () => rej(t.error ?? new Error("IndexedDB transaction failed"));
          t.onabort = () => rej(t.error ?? new Error("IndexedDB transaction aborted"));
        });
      resolve({
        get: (k) => tx("readonly", (s) => s.get(k)),
        keys: async () => (await tx("readonly", (s) => s.getAllKeys())).map(String),
        apply: ({ put = [], del = [] }) =>
          tx("readwrite", (s) => {
            for (const k of del) s.delete(k);
            for (const [k, v] of put) s.put(v, k);
          }),
      });
    };
  });
}

/** Open the browser's vault: IndexedDB + WebCrypto, else a memory vault with a reason. */
export async function openBrowserVault(): Promise<OpenResult> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return openVault({ store: null, subtle: null, unavailableReason: "WebCrypto isn't available (the page isn't in a secure context)." });
  let store: RecordStore;
  try {
    store = await idbRecordStore();
  } catch (e) {
    return openVault({ store: null, subtle, unavailableReason: `IndexedDB isn't available here (${e instanceof Error ? e.message : String(e)}).` });
  }
  return openVault({ store, subtle });
}
