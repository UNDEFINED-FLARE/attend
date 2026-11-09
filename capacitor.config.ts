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
    // Shown when the server can't be reached (no signal on campus).
    errorPath: "offline.html",
    // Stay inside the app for UniAttend itself; anything else opens in the browser.
    allowNavigation: [url.host],
  },
  android: {
    allowMixedContent: false,
    // Chrome's remote inspector only for debug builds.
    webContentsDebuggingEnabled: process.env.NODE_ENV !== "production",
  },
};

export default config;
