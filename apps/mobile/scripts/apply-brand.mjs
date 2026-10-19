// Writes brand.json (display name, app id, URL scheme) into the native projects, so renaming the
// product is: edit brand.json, run `npm run apply-brand`, rebuild. The app id is also the Android
// applicationId/namespace and the iOS bundle id; changing it after a store release creates a
// new, separate app listing. The Java package directory (android/app/src/main/java/<appId as path>/) has to be moved by hand.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const app = join(dirname(fileURLToPath(import.meta.url)), "..");
const brand = JSON.parse(readFileSync(join(app, "brand.json"), "utf8"));
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/'/g, "\\'").replace(/"/g, '\\"');
const edit = (rel, fn) => {
  const p = join(app, rel);
  if (!existsSync(p)) return console.log(`skip ${rel} (not generated yet)`);
  const before = readFileSync(p, "utf8");
  const after = fn(before);
  if (after !== before) writeFileSync(p, after);
  console.log(`${after !== before ? "updated" : "unchanged"} ${rel}`);
};
const setString = (xml, name, value) => xml.replace(new RegExp(`(<string name="${name}">)[^<]*(</string>)`), `$1${esc(value)}$2`);

edit("android/app/src/main/res/values/strings.xml", (s) => {
  s = setString(s, "app_name", brand.displayName);
  s = setString(s, "title_activity_main", brand.displayName);
  s = setString(s, "package_name", brand.appId);
  s = setString(s, "custom_url_scheme", brand.customUrlScheme);
  return setString(s, "share_label", `Share to ${brand.displayName}`);
});
edit("android/app/build.gradle", (s) =>
  s.replace(/namespace = "[^"]+"/, `namespace = "${brand.appId}"`).replace(/applicationId "[^"]+"/, `applicationId "${brand.appId}"`),
);
edit("ios/App/App/Info.plist", (s) =>
  s
    .replace(/(<key>CFBundleDisplayName<\/key>\s*<string>)[^<]*(<\/string>)/, `$1${brand.displayName}$2`)
    .replace(/(<key>MVCustomURLScheme<\/key>\s*<string>)[^<]*(<\/string>)/, `$1${brand.customUrlScheme}$2`)
    .replace(/(<string>__CUSTOM_SCHEME__<\/string>|<string>memevideo<\/string>)/, `<string>${brand.customUrlScheme}</string>`),
);
edit("ios/App/App.xcodeproj/project.pbxproj", (s) => s.replace(/PRODUCT_BUNDLE_IDENTIFIER = [^;]+;/g, (m) => (m.includes(".ShareExtension") ? `PRODUCT_BUNDLE_IDENTIFIER = ${brand.appId}.ShareExtension;` : `PRODUCT_BUNDLE_IDENTIFIER = ${brand.appId};`)));
edit("ios-share-extension/ShareViewController.swift", (s) =>
  s.replace(/appGroupId = "[^"]+"/, `appGroupId = "group.${brand.appId}"`).replace(/Open [^"]+ to see it\./, `Open ${brand.displayName} to see it.`),
);
edit("ios-share-extension/Info.plist", (s) => s.replace(/(<key>CFBundleDisplayName<\/key>\s*<string>)[^<]*(<\/string>)/, `$1${brand.displayName}$2`));
edit("../desktop/src-tauri/tauri.conf.json", (s) => {
  const j = JSON.parse(s);
  j.productName = brand.displayName;
  j.identifier = brand.appId;
  if (j.app?.windows?.[0]) j.app.windows[0].title = brand.displayName;
  if (j.bundle) j.bundle.publisher = brand.publisher;
  return JSON.stringify(j, null, 2) + "\n";
});
