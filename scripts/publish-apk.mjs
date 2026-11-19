// Puts the Android app on the website's "Get the app" page (/app).
//   npm run android:publish                  build, then copy the APK to public/downloads/ with its manifest
//   npm run android:publish -- --skip-build  publish the APK already in android/app/build/outputs
//   npm run android:publish -- --debug       publish a test (debug) build even when a release key exists
//   npm run android:publish -- --url https://…  build for another web address (passed to scripts/mobile.mjs)
//   npm run android:publish -- --host https://downloads.example.com/uniattend.apk
//        the APK will be hosted elsewhere: the page links there (the file is still written to public/downloads/
//        so it can be uploaded, and the checksum on the page is of that file)
//
// With android/keystore.properties (never committed) it builds a signed release APK; without it, a debug APK
// that the page labels "test build". Phones only accept an update signed with the same key as the installed app,
// so publish release builds from one machine (or CI) that holds the key.
//
// The website serves the APK as a static file from public/downloads/, so it goes live with the next deploy.
// Only the newest APK is kept there, and public/downloads/android.json describes it.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n) => (args.indexOf(n) >= 0 ? args[args.indexOf(n) + 1] : undefined);

const hasKey = existsSync("android/keystore.properties");
const release = hasKey && !flag("--debug");
if (!hasKey && !flag("--debug")) {
  console.warn("No android/keystore.properties: publishing a TEST (debug) build. See docs/android-app.md, section 3, to make a release key.");
}

if (!flag("--skip-build")) {
  const a = ["scripts/mobile.mjs", "build", ...(release ? ["--release", "--apk"] : [])];
  if (opt("--url")) a.push("--url", opt("--url"));
  const r = spawnSync(process.execPath, a, { stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

const built = release ? "android/app/build/outputs/apk/release/app-release.apk" : "android/app/build/outputs/apk/debug/app-debug.apk";
if (!existsSync(built)) { console.error(`No APK at ${built}. Build it first (drop --skip-build).`); process.exit(1); }

const gradle = readFileSync("android/app/build.gradle", "utf8");
const versionName = /versionName\s+"([^"]+)"/.exec(gradle)?.[1] ?? "1.0";
const versionCode = Number(/versionCode\s+(\d+)/.exec(gradle)?.[1] ?? 1);
const minSdk = Number(/minSdkVersion\s*=\s*(\d+)/.exec(readFileSync("android/variables.gradle", "utf8"))?.[1] ?? 24);
const app = JSON.parse(readFileSync("mobile/app.json", "utf8"));

const out = "public/downloads";
mkdirSync(out, { recursive: true });
const file = `uniattend-${versionName}-${versionCode}${release ? "" : "-test"}.apk`.replace(/[^A-Za-z0-9._-]/g, "_");
// Only the newest APK is served; older ones would just make every deploy bigger.
for (const f of readdirSync(out)) if (f.endsWith(".apk") && f !== file) rmSync(join(out, f));
copyFileSync(built, join(out, file));

const bytes = statSync(join(out, file)).size;
const sha256 = createHash("sha256").update(readFileSync(join(out, file))).digest("hex");
const host = opt("--host");
if (host && !/^https:\/\/[^\s]+$/.test(host)) { console.error("--host must be an https address."); process.exit(1); }

// Android API level → version people know.
const ANDROID = { 21: "5.0", 22: "5.1", 23: "6.0", 24: "7.0", 25: "7.1", 26: "8.0", 27: "8.1", 28: "9", 29: "10", 30: "11", 31: "12", 32: "12L", 33: "13", 34: "14", 35: "15", 36: "16" };
const manifest = {
  v: 1,
  platform: "android",
  appId: app.appId,
  version: versionName,
  versionCode,
  build: release ? "release" : "test",
  file,
  url: host ?? `/downloads/${file}`,
  bytes,
  sha256,
  minAndroid: ANDROID[minSdk] ?? `API ${minSdk}`,
  server: opt("--url") ?? app.url,
  publishedAt: new Date().toISOString(),
};
writeFileSync(join(out, "android.json"), JSON.stringify(manifest, null, 2) + "\n");

console.log(`Published ${file} (${(bytes / 1048576).toFixed(1)} MB, ${release ? "release" : "TEST build"})`);
console.log(`SHA-256 ${sha256}`);
console.log(host
  ? `The page links to ${host}: upload ${join(out, file)} there, then deploy the website.`
  : "Deploy the website to put it on /app.");
