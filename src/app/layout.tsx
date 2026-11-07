import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "UniAttend", template: "%s · UniAttend" },
  description: "Verified university attendance: QR, location and device checks with a fair review process.",
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = { themeColor: "#0b2545", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${inter.variable} font-sans antialiased min-h-dvh`}>{children}</body>
    </html>
  );
}
