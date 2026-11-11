import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// localhost counts as a secure context, so notifications, geolocation and
// Web Bluetooth work in the browser during development without HTTPS.
export default defineConfig({
  plugins: [react()],
  server: { host: "localhost", port: 5173 },
  preview: { host: "localhost", port: 4173 },
});
