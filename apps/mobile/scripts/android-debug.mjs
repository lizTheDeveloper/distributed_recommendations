// Builds the debug APK (android/app/build/outputs/apk/debug/app-debug.apk) and prints its size
// and SHA-256. Needs ANDROID_HOME (or android/local.properties) and JDK 21. Retries when Maven
// Central answers 429 (rate limiting seen on shared CI egress).
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const android = join(dirname(fileURLToPath(import.meta.url)), "..", "android");
const task = process.argv[2] ?? "assembleDebug";
for (let attempt = 1; ; attempt++) {
  const r = spawnSync("./gradlew", ["--no-daemon", task], { cwd: android, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const out = (r.stdout ?? "") + (r.stderr ?? "");
  if (r.status === 0) break;
  if (attempt < 4 && /status code 429/.test(out)) {
    console.error(`Maven Central rate-limited the build (429); retry ${attempt}`);
    continue;
  }
  process.stdout.write(out);
  process.exit(r.status ?? 1);
}
const apk = join(android, "app/build/outputs/apk", task === "assembleRelease" ? "release/app-release-unsigned.apk" : "debug/app-debug.apk");
if (existsSync(apk)) {
  const sha = createHash("sha256").update(readFileSync(apk)).digest("hex");
  console.log(`${apk}\n${statSync(apk).size} bytes, sha256 ${sha}`);
}
