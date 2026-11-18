import { readFileSync } from "node:fs";
import type { CapacitorConfig } from "@capacitor/cli";

// The Android app is a native shell around the deployed web app: every screen,
// check-in rule and permission check stays on the server, so the app never needs
// a store update when the web app changes. The address comes from mobile/app.json,
// or UNIATTEND_URL for a one-off build (e.g. http://10.0.2.2:3001 for the emulator).
const app = JSON.parse(readFileSync("mobile/app.json", "utf8")) as { url: string; appId: string; appName: string };
const url = new URL(process.env.UNIATTEND_URL || app.url);

const config: CapacitorConfig = {
  appId: app.appId,
  appName: app.appName,
  webDir: "mobile/www",
  server: {
    url: url.origin,
    // Plain http only for a local test server; production is https.
    cleartext: url.protocol === "http:",
    // Shown when the server can't be reached (no signal on campus), or when the phone's
    // System WebView is too old (see android.minWebViewVersion).
    errorPath: "offline.html",
    // Stay inside the app for UniAttend itself; anything else opens in the browser.
    allowNavigation: [url.host],
  },
  plugins: {
    // Class reminders scheduled on the phone (src/components/native-reminders.tsx).
    LocalNotifications: { smallIcon: "ic_stat_uniattend", iconColor: "#2f6fed" },
  },
  android: {
    allowMixedContent: false,
    // Chrome's remote inspector: left unset on purpose, so Capacitor turns it on for debug
    // builds only and it can never ship in a release, however the release was built.
    // The web app's styles need Chrome/WebView 111 or newer (Tailwind CSS 4). On an older
    // System WebView the app opens offline.html, which tells the person how to update it,
    // instead of showing broken pages.
    minWebViewVersion: 111,
  },
};

export default config;
