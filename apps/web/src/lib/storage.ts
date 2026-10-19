// Local persistence. Everything lives in this browser only. localStorage can be
// missing or throw (private windows, blocked site data, sandboxes), so every access
// is wrapped and an in-memory store takes over when it fails.

export interface KV {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
  /** True when writes survive a reload. */
  readonly persistent: boolean;
}

export const PREFIX = "mf.v1.";

export function memoryKV(): KV {
  const m = new Map<string, string>();
  return {
    persistent: false,
    get: (k) => (m.has(k) ? m.get(k)! : null),
    set: (k, v) => void m.set(k, v),
    remove: (k) => void m.delete(k),
  };
}

/** localStorage if it works, else memory. Each call is guarded separately. */
export function browserKV(): KV {
  let ls: Storage | undefined;
  try {
    ls = globalThis.localStorage;
    const probe = PREFIX + "probe";
    ls.setItem(probe, "1");
    ls.removeItem(probe);
  } catch {
    ls = undefined;
  }
  if (!ls) return memoryKV();
  const fallback = memoryKV();
  const store = ls;
  return {
    persistent: true,
    get(k) {
      try {
        return store.getItem(k);
      } catch {
        return fallback.get(k);
      }
    },
    set(k, v) {
      try {
        store.setItem(k, v);
      } catch {
        fallback.set(k, v); // quota exceeded etc.: keep it for this session
      }
    },
    remove(k) {
      try {
        store.removeItem(k);
      } catch {
        /* ignore */
      }
      fallback.remove(k);
    },
  };
}

/** Read JSON, returning `fallback` when missing, unparseable or rejected by `check`. */
export function readJson<T>(kv: KV, key: string, fallback: T, check?: (x: unknown) => T): T {
  const raw = kv.get(PREFIX + key);
  if (raw === null) return fallback;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return check ? check(parsed) : (parsed as T);
  } catch {
    return fallback;
  }
}

export function writeJson(kv: KV, key: string, value: unknown): void {
  kv.set(PREFIX + key, JSON.stringify(value));
}
