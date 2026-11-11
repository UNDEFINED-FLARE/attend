import type { Metadata, Viewport } from "next";
import "./globals.css";

// System font stack (see globals.css): no font download at build time or on a
// student's phone, which matters on slow campus networks.

export const metadata: Metadata = {
  title: { default: "UniAttend", template: "%s · UniAttend" },
  description: "Verified university attendance: QR, location and device checks with a fair review process.",
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = { themeColor: "#2d2f33", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="font-sans antialiased min-h-dvh">{children}</body>
    </html>
  );
}
