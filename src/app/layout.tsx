import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import "./globals.css";

// System font stack (see globals.css): no font download at build time or on a
// student's phone, which matters on slow campus networks.

export const metadata: Metadata = {
  title: { default: "UniAttend", template: "%s · UniAttend" },
  description: "Verified university attendance: QR, location and device checks with a fair review process.",
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = { themeColor: "#2d2f33", width: "device-width", initialScale: 1 };

// Runs before the page draws: if this device's app lock is due, hide the signed-in
// pages (data-lockable) until <AppLock> asks for the fingerprint/face. Same rules as
// shouldLock() in src/lib/app-lock.ts; <AppLock> removes the class when not needed.
const LOCK_EARLY = `try{var c=JSON.parse(localStorage.getItem("ua_lock")||"null");if(c&&c.v===1){var u=sessionStorage.getItem("ua_unlocked")==="1",h=+(sessionStorage.getItem("ua_hidden_at")||0);if(!u||(h&&Date.now()-h>=c.after*6e4))document.documentElement.classList.add("ua-locked")}}catch(e){}`;

// Also before the page draws: on a low-end phone (2 GB of memory or less, two cores or fewer)
// or with Data Saver on, mark the page "lite" so globals.css drops animations, transitions and
// blur. Old phones then scroll smoothly and the battery lasts. Nothing is sent anywhere.
const LITE_EARLY = `try{var n=navigator,k=n.connection;if((n.deviceMemory&&n.deviceMemory<=2)||(n.hardwareConcurrency&&n.hardwareConcurrency<=2)||(k&&k.saveData))document.documentElement.setAttribute("data-lite","")}catch(e){}`;

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // The Content Security Policy nonce for this request (set in middleware.ts; absent when CSP is off).
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang="en" suppressHydrationWarning>
      <head><script nonce={nonce} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: LOCK_EARLY + LITE_EARLY }} /></head>
      <body className="font-sans antialiased min-h-dvh">{children}</body>
    </html>
  );
}
