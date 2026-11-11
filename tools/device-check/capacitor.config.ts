import type { CapacitorConfig } from "@capacitor/cli";

// The Android app bundles the built web app (dist/) inside the APK, which is
// Capacitor's standard, production-supported setup. Same code as the web app.
const config: CapacitorConfig = {
  appId: "com.uniattend.devicecheck",
  appName: "UniAttend Check",
  webDir: "dist",
};

export default config;
