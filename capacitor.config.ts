import type { CapacitorConfig } from "@capacitor/cli";

// Android proof of concept: the native app is a shell around the existing
// Next.js site, so pages, server actions, middleware and Supabase auth all run
// unchanged on the server.
//
// Development: the WebView loads the local dev server through
// `adb reverse tcp:3000 tcp:3000`. Because the address is http://localhost,
// Android treats it as a secure context, so the camera (QR scan) and
// geolocation (check-in evidence) keep working without HTTPS.
//
// Capacitor documents `server.url` as a development feature. How a release
// build reaches the hosted site is a separate decision.
const serverUrl = process.env.CAP_SERVER_URL ?? "http://localhost:3000";

const config: CapacitorConfig = {
  appId: "com.uniattend.app",
  appName: "UniAttend",
  // Placeholder assets. Shown only when the server above cannot be reached.
  webDir: "capacitor-shell",
  server: {
    url: serverUrl,
    cleartext: serverUrl.startsWith("http://"),
    errorPath: "index.html",
  },
};

export default config;
