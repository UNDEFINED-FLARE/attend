/* UniAttend service worker: shows push notifications and opens the right page when
   tapped, and keeps the app usable without signal (recent pages and the app's files). */
const STATIC = "ua-static-v1";   // /_next/static: named by content, safe to keep
const PAGES = "ua-pages-v1";     // last good copy of the signed-in pages below; cleared at sign-in
const OFFLINE_PAGES = /^\/(student|lecturer|notifications|settings)(\/|$)/;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k.startsWith("ua-") && k !== STATIC && k !== PAGES) await caches.delete(k);
  await self.clients.claim();
})()));

const OFFLINE_HTML = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Offline · UniAttend</title><body style="font:16px system-ui;background:#e7e8ea;color:#1d1e20;display:grid;place-items:center;min-height:100vh;margin:0;padding:24px;text-align:center">
<main style="max-width:22rem"><h1 style="font-size:1.4rem">You're offline</h1><p>This page hasn't been opened on this device with signal yet. Open UniAttend once while online, and its main pages will open without signal afterwards.</p>
<button onclick="location.reload()" style="font:inherit;padding:.7rem 1.4rem;border:0;border-radius:12px;background:#2d2f33;color:#fff">Try again</button></main>`;

function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms))]);
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // The app's own files: from the cache when we have them.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(caches.open(STATIC).then(async (c) => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) c.put(req, res.clone());
      return res;
    }));
    return;
  }

  // Signed-in pages: the network first; without signal, the last copy seen on this device.
  if (req.mode === "navigate" && OFFLINE_PAGES.test(url.pathname)) {
    event.respondWith((async () => {
      const c = await caches.open(PAGES);
      const key = url.origin + url.pathname;          // ?s=…&t=… from a QR is read by the page itself
      try {
        const res = await withTimeout(fetch(req), 8000);
        if (res.ok && !res.redirected) c.put(key, res.clone());
        return res;
      } catch {
        return (await c.match(key)) || new Response(OFFLINE_HTML, { headers: { "Content-Type": "text/html; charset=utf-8" } });
      }
    })());
  }
});

const ACTIONS = {
  class_reminder: [{ action: "map", title: "Show venue" }, { action: "timetable", title: "Timetable" }],
  session_open: [{ action: "checkin", title: "Check in now" }],
  announcement: [{ action: "open", title: "Read" }],
  class_update: [{ action: "timetable", title: "Timetable" }, { action: "open", title: "Read" }],
};
const ROUTES = { map: "/student/map", timetable: "/student/timetable", checkin: "/student/check-in" };

self.addEventListener("push", (event) => {
  let p = {};
  try { p = event.data ? event.data.json() : {}; } catch { p = { title: "UniAttend", body: event.data ? event.data.text() : "" }; }
  const title = p.title || "UniAttend";
  const body = [p.body, p.institution ? `— ${p.institution}` : ""].filter(Boolean).join("\n");
  event.waitUntil(self.registration.showNotification(title, {
    body,
    icon: p.icon || "/icons/icon-192.png",       // the institution's logo when it has one
    badge: p.badge || "/icons/badge-96.png",      // small monochrome mark in the status bar
    tag: p.kind === "class_reminder" ? `class-${p.id}` : p.id,
    renotify: p.kind === "session_open",
    requireInteraction: p.kind === "session_open" || p.kind === "class_update",
    vibrate: p.kind === "announcement" ? [60] : [90, 50, 90],
    timestamp: Date.now(),
    actions: ACTIONS[p.kind] || [],
    data: { url: p.url || "/notifications" },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const path = ROUTES[event.action] || (event.notification.data && event.notification.data.url) || "/notifications";
  const url = new URL(path, self.location.origin).href;
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const w of wins) {
      if (new URL(w.url).origin === self.location.origin) { await w.focus(); return w.navigate(url); }
    }
    return self.clients.openWindow(url);
  })());
});
