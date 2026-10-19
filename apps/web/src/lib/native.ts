// window.MatchFeedNative: the native shells' bridge (apps/mobile with Capacitor,
// apps/desktop with Tauri). The contract is apps/mobile/bridge/types.ts; the types
// are copied here (not imported) so apps/web builds and typechecks on its own.
// test/native.test.ts checks this copy against that file when it is present.
//
// In a plain browser the bridge is undefined and every hook below is a no-op.

// ---- copy of apps/mobile/bridge/types.ts (version 1) ----
export type NativePlatform = "android" | "ios" | "desktop";
export type SecretName = "nostr-secret-key" | "vault-key";
export interface NativeSecrets {
  get(name: SecretName): Promise<string | null>;
  set(name: SecretName, value: string): Promise<void>;
  remove(name: SecretName): Promise<void>;
}
export type IncomingKind = "nostr" | "peertube-watch";
export interface Incoming {
  kind: IncomingKind;
  source: "deeplink" | "share";
  value: string;
  host?: string;
  videoId?: string;
}
export interface NativeIncoming {
  onIncoming(handler: (item: Incoming) => void): () => void;
}
export type NotificationPermission = "granted" | "denied" | "prompt";
export interface NativeNotifications {
  permission(): Promise<NotificationPermission>;
  requestPermission(): Promise<NotificationPermission>;
  notify(n: { id: number; title: string; body: string; route?: string }): Promise<void>;
  onOpen(handler: (route: string | null) => void): () => void;
}
export interface NativeBackground {
  enable(handler: () => Promise<void>, opts?: { minimumIntervalMinutes?: number }): Promise<"available" | "denied" | "restricted">;
  disable(): Promise<void>;
}
export interface MatchFeedNative {
  version: 1;
  platform: NativePlatform;
  secrets: NativeSecrets;
  incoming?: NativeIncoming;
  notifications?: NativeNotifications;
  background?: NativeBackground;
}
export const SECRET_NAMES: readonly SecretName[] = ["nostr-secret-key", "vault-key"];
export const MAX_SECRET_LENGTH = 4096;
// ---- end of copy ----

/** The bridge, if this page runs inside a native shell (version 1 only). */
export function nativeBridge(g: unknown = globalThis): MatchFeedNative | undefined {
  const n = (g as { MatchFeedNative?: MatchFeedNative }).MatchFeedNative;
  if (!n || typeof n !== "object" || n.version !== 1 || !n.secrets || typeof n.secrets.get !== "function") return undefined;
  if (n.platform !== "android" && n.platform !== "ios" && n.platform !== "desktop") return undefined;
  return n;
}

/** Where the vault key is kept, for the storage panel (mobile README hook 7). */
export function keyStoreLabel(platform: NativePlatform | undefined): string {
  if (platform === "android") return "Android Keystore";
  if (platform === "ios") return "iOS Keychain";
  if (platform === "desktop") return "the OS keychain";
  return "this browser";
}

/**
 * Notification id for an event: a stable 31-bit number, so a repeat of the same
 * event replaces the earlier notification instead of stacking (mobile README hook 5).
 */
export function notificationId(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619) >>> 0;
  return h & 0x7fffffff;
}

/**
 * Lock-screen text: generic on purpose. Never a petname, npub or video
 * (mobile README hook 5). `name` is the display name from src/brand.json.
 */
export function matchNotice(kind: "request" | "accept", name: string): { title: string; body: string; route: string } {
  return kind === "request"
    ? { title: "New match request", body: `Open ${name} to review it.`, route: "matches" }
    : { title: "Match accepted", body: `Open ${name} to see it.`, route: "matches" };
}
