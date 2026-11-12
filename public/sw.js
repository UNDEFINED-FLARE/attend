/* UniAttend service worker: shows push notifications and opens the right page when tapped. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

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
