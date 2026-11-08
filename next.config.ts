import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  // Camera for QR scanning and geolocation for check-in, on this origin only.
  { key: "Permissions-Policy", value: "camera=(self), geolocation=(self), microphone=(self)" },
];

export default function config(phase: string): NextConfig {
  return {
    // `next dev` writes to its own folder, so a dev server left running can
    // never corrupt a production build's .next folder (or the other way round).
    distDir: phase === PHASE_DEVELOPMENT_SERVER ? ".next-dev" : ".next",
    poweredByHeader: false,
    // pdf.js loads its worker and data files at runtime; bundling breaks that.
    serverExternalPackages: ["pdfjs-dist"],
    async headers() {
      return [{ source: "/(.*)", headers: securityHeaders }];
    },
    experimental: { serverActions: { bodySizeLimit: "6mb" } },
  };
}
