// Defines window.MatchFeedNative (see types.ts) on top of Capacitor plugins. Bundled by
// scripts/build-bridge.mjs into www/native-bridge.js and loaded before app.js.
//
// Plugins (versions pinned in package.json; review notes in README.md):
//   secrets       @aparajita/capacitor-secure-storage  Android Keystore AES-GCM / iOS Keychain
//   background    @transistorsoft/capacitor-background-fetch
//   incoming      @capacitor/app (deep links; Android shares via MainActivity),
//                 @capgo/capacitor-share-target (iOS share extension handoff)
//   notifications @capacitor/local-notifications

import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";
import { SecureStorage, KeychainAccess } from "@aparajita/capacitor-secure-storage";
import { LocalNotifications } from "@capacitor/local-notifications";
import { BackgroundFetch } from "@transistorsoft/capacitor-background-fetch";
import { CapacitorShareTarget } from "@capgo/capacitor-share-target";
import brand from "../brand.json";
import { classifyLink, classifySharedText, parseShareHandoff } from "./links.ts";
import {
  MAX_SECRET_LENGTH,
  SECRET_NAMES,
  type Incoming,
  type MatchFeedNative,
  type NotificationPermission,
  type SecretName,
} from "./types.ts";

declare global {
  interface Window {
    MatchFeedNative?: MatchFeedNative;
  }
}

const platform = Capacitor.getPlatform();

function install(): void {
  if (!Capacitor.isNativePlatform() || (platform !== "android" && platform !== "ios")) return;

  // ---- secrets ---------------------------------------------------------------------------
  // iOS accessibility: the vault key must be readable by background wake-ups while the phone is
  // locked (after the first unlock since boot); the identity key is only needed in the foreground.
  // ThisDeviceOnly: never in iCloud Keychain or a backup restored to another device.
  const ACCESS: Record<SecretName, KeychainAccess> = {
    "vault-key": KeychainAccess.afterFirstUnlockThisDeviceOnly,
    "nostr-secret-key": KeychainAccess.whenUnlockedThisDeviceOnly,
  };
  const ready = (async () => {
    await SecureStorage.setKeyPrefix("mf_");
    await SecureStorage.setSynchronize(false);
  })();
  const checkName = (name: string): SecretName => {
    if (!(SECRET_NAMES as readonly string[]).includes(name)) throw new Error(`Unknown secret name: ${name}`);
    return name as SecretName;
  };
  const secrets: MatchFeedNative["secrets"] = {
    async get(name) {
      await ready;
      const v = await SecureStorage.get(checkName(name), false, false);
      return typeof v === "string" ? v : null;
    },
    async set(name, value) {
      await ready;
      if (typeof value !== "string" || value.length === 0 || value.length > MAX_SECRET_LENGTH) throw new Error("Secret must be a non-empty string of at most 4096 characters");
      const n = checkName(name);
      await SecureStorage.set(n, value, false, false, ACCESS[n]);
    },
    async remove(name) {
      await ready;
      await SecureStorage.remove(checkName(name), false);
    },
  };

  // ---- incoming: deep links and shares ------------------------------------------------------
  // Everything is queued until the web app registers its handler, so a cold start from a link
  // or a share isn't lost. Duplicates (the same item twice within 2 s) are dropped.
  const queue: Incoming[] = [];
  let handler: ((item: Incoming) => void) | null = null;
  let last = { key: "", at: 0 };
  const deliver = (item: Incoming | null) => {
    if (!item) return;
    const key = `${item.kind}:${item.value}`;
    const now = Date.now();
    if (key === last.key && now - last.at < 2000) return;
    last = { key, at: now };
    if (handler) handler(item);
    else if (queue.length < 16) queue.push(item);
  };
  const onUrl = (url: string) => {
    const handoff = parseShareHandoff(url, brand.customUrlScheme);
    if (handoff) {
      // Android: MainActivity put the shared text in ?text=. iOS: the payload comes through the
      // share-target plugin's shareReceived event; the URL only wakes the app.
      if (handoff.text) deliver(classifySharedText(handoff.text));
      return;
    }
    deliver(classifyLink(url, "deeplink"));
  };
  void App.getLaunchUrl().then((r) => r?.url && onUrl(r.url)).catch(() => {});
  void App.addListener("appUrlOpen", (e) => onUrl(e.url));
  if (platform === "ios") {
    void CapacitorShareTarget.addListener("shareReceived", (e) => {
      for (const t of e.texts ?? []) {
        const hit = classifySharedText(t);
        if (hit) return deliver(hit);
      }
      // Safari shares the page URL as the title on some iOS versions.
      deliver(classifySharedText(e.title ?? ""));
    });
  }
  const incoming: NonNullable<MatchFeedNative["incoming"]> = {
    onIncoming(h) {
      handler = h;
      for (const item of queue.splice(0)) h(item);
      return () => {
        if (handler === h) handler = null;
      };
    },
  };

  // ---- notifications (opt-in) ---------------------------------------------------------------
  const CHANNEL = "match-requests";
  const mapPerm = (p: string): NotificationPermission => (p === "granted" ? "granted" : p === "denied" ? "denied" : "prompt");
  let channelMade: Promise<void> | null = null;
  const ensureChannel = () =>
    (channelMade ??=
      platform === "android"
        ? LocalNotifications.createChannel({ id: CHANNEL, name: "Match requests", description: "New match requests and replies", importance: 3, visibility: 0 })
        : Promise.resolve());
  let openHandler: ((route: string | null) => void) | null = null;
  let pendingOpen: string | null | undefined;
  void LocalNotifications.addListener("localNotificationActionPerformed", (a) => {
    const route = typeof a.notification?.extra?.route === "string" ? a.notification.extra.route : null;
    if (openHandler) openHandler(route);
    else pendingOpen = route;
  });
  const notifications: NonNullable<MatchFeedNative["notifications"]> = {
    async permission() {
      return mapPerm((await LocalNotifications.checkPermissions()).display);
    },
    async requestPermission() {
      return mapPerm((await LocalNotifications.requestPermissions()).display);
    },
    async notify({ id, title, body, route }) {
      if ((await LocalNotifications.checkPermissions()).display !== "granted") return;
      if (!Number.isInteger(id) || id < 1 || id > 2 ** 31 - 1) throw new Error("id must be a positive 32-bit integer");
      await ensureChannel();
      await LocalNotifications.schedule({
        notifications: [
          {
            id,
            title: String(title).slice(0, 64),
            body: String(body).slice(0, 160),
            channelId: CHANNEL,
            // Inexact: no SCHEDULE_EXACT_ALARM permission, no "Alarms & reminders" settings screen.
            isExactNotification: false,
            extra: route ? { route: String(route).slice(0, 64) } : undefined,
          },
        ],
      });
    },
    onOpen(h) {
      openHandler = h;
      if (pendingOpen !== undefined) {
        h(pendingOpen);
        pendingOpen = undefined;
      }
      return () => {
        if (openHandler === h) openHandler = null;
      };
    },
  };

  // ---- background (opt-in) -----------------------------------------------------------------
  const BUDGET_MS = 25_000;
  let bgHandler: (() => Promise<void>) | null = null;
  const background: NonNullable<MatchFeedNative["background"]> = {
    async enable(h, opts) {
      bgHandler = h;
      const minutes = Math.max(15, Math.min(24 * 60, Math.round(opts?.minimumIntervalMinutes ?? 12 * 60)));
      const status = await BackgroundFetch.configure(
        {
          minimumFetchInterval: minutes,
          // Our work is JavaScript in the WebView, so nothing runs after the app is terminated
          // (Android headless tasks would have to be Java).
          stopOnTerminate: true,
          startOnBoot: false,
          enableHeadless: false,
          requiredNetworkType: BackgroundFetch.NETWORK_TYPE_ANY,
          requiresBatteryNotLow: true,
        },
        async (taskId) => {
          try {
            const run = bgHandler ? bgHandler() : Promise.resolve();
            await Promise.race([run, new Promise((r) => setTimeout(r, BUDGET_MS))]);
          } catch {
            // The web app logs its own failures; the task must still finish.
          } finally {
            await BackgroundFetch.finish(taskId);
          }
        },
        async (taskId) => {
          await BackgroundFetch.finish(taskId);
        },
      );
      return status === BackgroundFetch.STATUS_AVAILABLE ? "available" : status === BackgroundFetch.STATUS_DENIED ? "denied" : "restricted";
    },
    async disable() {
      bgHandler = null;
      await BackgroundFetch.stop();
    },
  };

  const api: MatchFeedNative = Object.freeze({
    version: 1 as const,
    platform: platform as "android" | "ios",
    secrets: Object.freeze(secrets),
    incoming: Object.freeze(incoming),
    notifications: Object.freeze(notifications),
    background: Object.freeze(background),
  });
  Object.defineProperty(window, "MatchFeedNative", { value: api, writable: false, configurable: false, enumerable: false });
}

install();
