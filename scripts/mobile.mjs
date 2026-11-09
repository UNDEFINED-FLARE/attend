// Builds the UniAttend Android app.
//   node scripts/mobile.mjs sync                 copy config into the Android project
//   node scripts/mobile.mjs build                debug APK  -> android/app/build/outputs/apk/debug/
//   node scripts/mobile.mjs build --release      signed AAB for Google Play (needs android/keystore.properties)
//   add --url http://10.0.2.2:3001 to point a test build at a dev server (10.0.2.2 = this PC from the emulator)
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const args = process.argv.slice(2);
const cmd = args[0] ?? "build";
const urlArg = args.indexOf("--url") >= 0 ? args[args.indexOf("--url") + 1] : undefined;
const release = args.includes("--release");
const env = { ...process.env, ...(urlArg ? { UNIATTEND_URL: urlArg } : {}), ...(release ? { NODE_ENV: "production" } : {}) };

const url = urlArg ?? JSON.parse(readFileSync("mobile/app.json", "utf8")).url;
if (/YOUR-UNIATTEND-ADDRESS/.test(url)) {
  console.error("Set your UniAttend web address in mobile/app.json (\"url\"), or pass --url.");
  process.exit(1);
}
if (release && url.startsWith("http:")) { console.error("Release builds must use an https address."); process.exit(1); }

const run = (bin, a, opts = {}) => {
  const r = spawnSync(bin, a, { stdio: "inherit", env, shell: process.platform === "win32", ...opts });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

console.log(`UniAttend app → ${url}`);
run("npx", ["cap", "sync", "android"]);
if (cmd === "sync") process.exit(0);

if (release && !existsSync("android/keystore.properties")) {
  console.error("Release builds need android/keystore.properties (see docs/android-app.md).");
  process.exit(1);
}
// An explicit path: Windows may not run programs from the current folder by name.
const gradlew = process.platform === "win32" ? ".\\gradlew.bat" : "./gradlew";
run(gradlew, [release ? "bundleRelease" : "assembleDebug"], { cwd: "android" });
console.log(release
  ? "Done: android/app/build/outputs/bundle/release/app-release.aab"
  : "Done: android/app/build/outputs/apk/debug/app-debug.apk");
