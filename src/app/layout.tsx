import type { Metadata, Viewport } from "next";
import { Barlow_Semi_Condensed } from "next/font/google";
import "./globals.css";

// Body text keeps the system font stack (see globals.css): nothing to download, which
// matters on slow campus networks. Only headings, module codes and big numbers use
// Barlow Semi Condensed, a typeface drawn from road signs. next/font fetches it once at
// build time and serves it from UniAttend itself (about 40 KB, cached), so a student's
// phone never contacts Google; until it loads, text shows in the fallback font.
const display = Barlow_Semi_Condensed({
  subsets: ["latin"], weight: ["500", "600", "700"], display: "swap", variable: "--font-barlow",
});

export const metadata: Metadata = {
  title: { default: "UniAttend", template: "%s · UniAttend" },
  description: "Verified university attendance: QR, location and device checks with a fair review process.",
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = { themeColor: "#0b2545", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={display.variable}>
      <body className="font-sans antialiased min-h-dvh">{children}</body>
    </html>
  );
}
