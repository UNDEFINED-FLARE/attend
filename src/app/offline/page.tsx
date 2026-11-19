import { OfflineApp } from "./offline-app";

export const metadata = { title: "Offline" };
// The same page for everyone: it holds no personal data. The service worker keeps a
// copy and opens it when a main screen can't load; it then draws that screen from the
// copy saved on this device for the person signed in (src/lib/offline-data.ts).
// Rendered per request (not static) so its scripts carry the Content Security Policy
// nonce; the kept copy keeps the matching nonce and header together.

export default function Offline() {
  return <OfflineApp />;
}
