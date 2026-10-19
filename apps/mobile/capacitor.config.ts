// Capacitor config. Name and id come from brand.json (one place to rename).
// Security notes are in README.md ("WebView model").
import type { CapacitorConfig } from "@capacitor/cli";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const brand = JSON.parse(readFileSync(join(__dirname, "brand.json"), "utf8"));

const config: CapacitorConfig = {
  appId: brand.appId,
  appName: brand.displayName,
  webDir: "www",
  // Logs only in debug builds; release builds stay quiet in logcat / the Xcode console.
  loggingBehavior: "debug",
  server: {
    // Android serves www/ at https://localhost (a secure context: WebCrypto, IndexedDB).
    // iOS serves it at capacitor://localhost. Never set server.url in a release build:
    // that would load remote code into the native bridge.
    androidScheme: "https",
    iosScheme: "capacitor",
    hostname: "localhost",
    cleartext: false,
    // No extra origins may navigate the main frame. External links open in the system browser.
    allowNavigation: [],
  },
  android: {
    allowMixedContent: false,
    captureInput: false,
    // Off by default; debug builds can turn it on locally with a config override.
    webContentsDebuggingEnabled: false,
    // Service workers are not used in the app shell (sync-web drops sw.js).
    resolveServiceWorkerRequests: false,
  },
  ios: {
    contentInset: "never",
    allowsLinkPreview: false,
    scrollEnabled: true,
    webContentsDebuggingEnabled: false,
    // App-bound domains would break PeerTube embeds from arbitrary instances.
    limitsNavigationsToAppBoundDomains: false,
    preferredContentMode: "mobile",
  },
  plugins: {
    // Keep fetch/XHR and cookies as plain WebView behavior: patched native HTTP would bypass
    // CORS and the page CSP's connect-src.
    CapacitorHttp: { enabled: false },
    CapacitorCookies: { enabled: false },
    LocalNotifications: {
      smallIcon: "ic_stat_notify",
      iconColor: "#7046c9",
    },
  },
};

export default config;
