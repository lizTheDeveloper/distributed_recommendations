// window.MatchFeedNative: the contract between the web client (apps/web) and the native
// shells (apps/mobile with Capacitor, apps/desktop with Tauri). apps/web feature-detects it:
//
//   const native = (globalThis as any).MatchFeedNative as MatchFeedNative | undefined;
//
// In a plain browser it is undefined and the web app keeps its current behavior.
// The name is product-neutral on purpose (the product name lives in apps/mobile/brand.json).
// Version 1. Additive changes keep `version: 1`; breaking changes bump it.

export type NativePlatform = "android" | "ios" | "desktop";

/** The only secrets a shell will store. Anything else is refused. */
export type SecretName =
  /** The Match identity secret key (32-byte hex, as nostr-tools produces). */
  | "nostr-secret-key"
  /** Raw 256-bit AES key for the vault (base64), replacing the IndexedDB device key. */
  | "vault-key";

export interface NativeSecrets {
  /** Resolves null when the secret is not set. */
  get(name: SecretName): Promise<string | null>;
  /** value: at most 4096 characters. */
  set(name: SecretName, value: string): Promise<void>;
  remove(name: SecretName): Promise<void>;
}

export type IncomingKind = "nostr" | "peertube-watch";

/** Something another app handed us: a deep link or a share-sheet item. Never fetched by the shell. */
export interface Incoming {
  kind: IncomingKind;
  source: "deeplink" | "share";
  /**
   * kind "nostr": the bech32 entity without the "nostr:" prefix (npub1… or nprofile1…), only
   * shape-checked here; decode and verify the checksum with apps/web src/lib/bech32.ts.
   * kind "peertube-watch": the https watch URL, normalized (no userinfo, fragment or query
   * except PeerTube's start time `t`).
   */
  value: string;
  /** peertube-watch only. */
  host?: string;
  /** peertube-watch only: the uuid or short uuid from the path. */
  videoId?: string;
}

export interface NativeIncoming {
  /**
   * Register the one handler. Items that arrived before (cold start from a link or share) are
   * delivered right away, in order. Returns an unsubscribe function.
   */
  onIncoming(handler: (item: Incoming) => void): () => void;
}

export type NotificationPermission = "granted" | "denied" | "prompt";

export interface NativeNotifications {
  /** Current OS permission. Never prompts. */
  permission(): Promise<NotificationPermission>;
  /**
   * Prompts the OS dialog. Call only from a user action (the opt-in switch in Matches settings).
   */
  requestPermission(): Promise<NotificationPermission>;
  /**
   * Shows a local notification now, if permission is granted. Keep text generic: it shows on the
   * lock screen ("New match request", not a petname or npub). title ≤ 64, body ≤ 160 chars.
   * `route` is passed back to onOpen when the user taps it, e.g. "matches".
   */
  notify(n: { id: number; title: string; body: string; route?: string }): Promise<void>;
  onOpen(handler: (route: string | null) => void): () => void;
}

export interface NativeBackground {
  /**
   * Opt in to periodic background wake-ups (the OS decides when; at best every ~15 min, usually
   * hours; iOS may take days to start and stops after the user force-quits the app).
   * The handler gets about 25 s; it must resolve before that. Use it for due weekly sketches
   * (MatchClient.sendDueSketches) and a relay check. Calling enable again replaces the handler.
   */
  enable(handler: () => Promise<void>, opts?: { minimumIntervalMinutes?: number }): Promise<"available" | "denied" | "restricted">;
  disable(): Promise<void>;
}

export interface MatchFeedNative {
  version: 1;
  platform: NativePlatform;
  /** Present on every shell. */
  secrets: NativeSecrets;
  /** Mobile only. */
  incoming?: NativeIncoming;
  notifications?: NativeNotifications;
  background?: NativeBackground;
}

export const SECRET_NAMES: readonly SecretName[] = ["nostr-secret-key", "vault-key"];
export const MAX_SECRET_LENGTH = 4096;
