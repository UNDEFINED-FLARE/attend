/* UniAttend service worker: shows push notifications and opens the right page when
   tapped, and keeps the app usable without signal. The same file runs in browsers
   (installed or not) and inside the Android app, whose screens come from this site.

   Without signal:
   * the main screens (home, timetable, modules, venues, history) open the offline
     screen, /offline, which draws them from the copy the app saved on this device
     (src/lib/offline-data.ts);
   * other signed-in pages, the check-in page among them, open as last seen with signal;
   * nothing personal is kept for anyone but the person signed in: the page copies are
     dropped when another person syncs, and on the sign-in page (where signing out lands). */
const STATIC = "ua-static-v1";   // /_next/static: named by content, safe to keep
const SHELL = "ua-shell-v1";     // the offline screen itself: the same for everyone, no personal data
const PAGES = "ua-pages-v2";     // last good copy of signed-in pages, for the person in META only
const META = "ua-meta-v1";       // whose pages PAGES holds
const KEEP = [STATIC, SHELL, PAGES, META];

const SIGNED_IN = /^\/(student|lecturer|notifications|settings)(\/|$)/;
// Answered by the offline screen when there's no signal (its copy is fresher than a stored page).
const OFFLINE_SCREEN = /^\/($|dashboard$|student\/?$|student\/(timetable|history|map|navigate)(\/|$)|lecturer\/?$|lecturer\/(timetable|modules)(\/|$))/;
const USER_KEY = "/__ua/user";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k.startsWith("ua-") && !KEEP.includes(k)) await caches.delete(k);
  await self.clients.claim();
})()));

const OFFLINE_HTML = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Offline · UniAttend</title><body style="font:16px system-ui;background:#e7e8ea;color:#1d1e20;display:grid;place-items:center;min-height:100vh;margin:0;padding:24px;text-align:center">
<main style="max-width:22rem"><h1 style="font-size:1.4rem">You're offline</h1><p>UniAttend hasn't been opened on this device with signal yet. Open it once while online and sign in, and your timetable, classes and attendance will open without signal afterwards.</p>
<button onclick="location.reload()" style="font:inherit;padding:.7rem 1.4rem;border:0;border-radius:12px;background:#2d2f33;color:#fff">Try again</button></main>`;
const offlineHtml = () => new Response(OFFLINE_HTML, { headers: { "Content-Type": "text/html; charset=utf-8" } });

function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms))]);
}

async function currentUser() {
  const hit = await (await caches.open(META)).match(USER_KEY);
  return hit ? hit.text() : null;
}
async function setUser(id) {
  const before = await currentUser();
  if (before !== id) await caches.delete(PAGES);   // another person's pages: gone before anything of the new person's is kept
  const meta = await caches.open(META);
  if (id) await meta.put(USER_KEY, new Response(id)); else await meta.delete(USER_KEY);
}

/** The offline screen, for a page that couldn't load. Its own address, so the page knows where to return. */
async function offlineScreen(url) {
  const shell = await (await caches.open(SHELL)).match("/offline");
  if (!shell) return offlineHtml();
  return Response.redirect(new URL(`/offline?from=${encodeURIComponent(url.pathname + url.search)}`, self.location.origin).href, 302);
}

/** The app's files a page needs, so it also opens without signal. */
async function cacheAssets(html) {
  const c = await caches.open(STATIC);
  const urls = [...new Set(html.match(/\/_next\/static\/[^"'\s)\\]+/g) || [])];
  await Promise.all(urls.map(async (u) => { if (!(await c.match(u))) { try { const r = await fetch(u); if (r.ok) await c.put(u, r); } catch { /* next time */ } } }));
}

/** After a sync: keep the offline screen and the given pages (e.g. check-in) ready for no signal. */
async function warm(paths) {
  const user = await currentUser();
  for (const p of paths) {
    if (typeof p !== "string" || !p.startsWith("/") || p.startsWith("//")) continue;
    try {
      const res = await withTimeout(fetch(p, { credentials: "same-origin", cache: "no-store" }), 15000);
      if (!res.ok || res.redirected) continue;                  // signed out, or not this person's page
      const html = await res.clone().text();
      if (p === "/offline") await (await caches.open(SHELL)).put("/offline", res);
      else if (user && SIGNED_IN.test(p)) await (await caches.open(PAGES)).put(self.location.origin + p, res);
      await cacheAssets(html);
    } catch { /* no signal: next sync */ }
  }
}

self.addEventListener("message", (event) => {
  const m = event.data || {};
  if (m.type === "user" && typeof m.id === "string") event.waitUntil(setUser(m.id));
  else if (m.type === "signout") event.waitUntil(Promise.all([caches.delete(PAGES), caches.open(META).then((c) => c.delete(USER_KEY))]));
  else if (m.type === "warm" && Array.isArray(m.paths)) event.waitUntil(warm(m.paths.slice(0, 10)));
});

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

  if (req.mode !== "navigate") return;
  const path = url.pathname;

  // The offline screen: fresh when online (and kept), the kept copy when not.
  if (path === "/offline") {
    event.respondWith((async () => {
      const kept = await (await caches.open(SHELL)).match("/offline");
      if (kept && !self.navigator.onLine) return kept;   // known to be offline: don't wait for the network
      try {
        const res = await withTimeout(fetch(req), 8000);
        if (res.ok && !res.redirected) await (await caches.open(SHELL)).put("/offline", res.clone());
        return res;
      } catch {
        return kept || offlineHtml();
      }
    })());
    return;
  }

  // Main screens: the network; without signal, the offline screen.
  if (OFFLINE_SCREEN.test(path)) {
    event.respondWith((async () => {
      try { return await withTimeout(fetch(req), 8000); }
      catch { return offlineScreen(url); }
    })());
    return;
  }

  // Other signed-in pages: the network first; without signal, the last copy seen on this device.
  if (SIGNED_IN.test(path)) {
    event.respondWith((async () => {
      const c = await caches.open(PAGES);
      const key = url.origin + path;          // ?s=…&t=… from a QR is read by the page itself
      try {
        const res = await withTimeout(fetch(req), 8000);
        if (res.ok && !res.redirected && (await currentUser())) c.put(key, res.clone());
        return res;
      } catch {
        return (await c.match(key)) || offlineScreen(url);
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
