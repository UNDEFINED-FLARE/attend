// The offline copy: what the app shows without signal (timetable, dated classes,
// modules, venues, recent attendance), saved on the device after a signed-in sync.
//
// One person's copy at a time. It is stored under that person's id, every other
// person's copy is deleted whenever someone syncs, and all of it is deleted on the
// sign-in page (where signing out lands). So on a shared phone the next person
// never sees the last person's classes or attendance, online or off.
//
// Client-safe: no server imports. The server side is src/lib/offline-snapshot.ts.

import type { Slot } from "@/components/week-grid";

export const OFFLINE_VERSION = 1 as const;
export const SNAPSHOT_PREFIX = "ua_offline_v1:";   // + user id
export const CURRENT_KEY = "ua_offline_user";      // whose copy the offline screen may show
export const SYNCED_KEY = "ua_offline_synced_at";  // last successful sync (ms), to avoid syncing on every page

export type OfflineRole = "student" | "lecturer";
export type OfflineSlot = Slot & { venue_id: string | null };
export type OfflineClass = {
  id: string; starts_at: string; ends_at: string; status: string; kind: string; group_name: string | null; note: string | null;
  edited: boolean; module: { code: string; title: string } | null; venue: string | null; lecturer: string | null;
};
export type OfflineModule = {
  id: string; code: string; title: string;
  // Student: their own attendance in the module. Lecturer: how many students are enrolled.
  attended?: number; absent?: number; unresolved?: number; percent?: number | null; min_pct?: number; students?: number;
};
export type OfflineVenue = { id: string; name: string; lat: number | null; lng: number | null };
export type OfflineRecord = { id: string; status: string; at: string; code: string | null; title: string | null };
export type OfflineSession = { id: string; title: string; status: string; opens_at: string; closes_at: string | null; code: string | null; venue: string | null };

export type OfflineSnapshot = {
  v: typeof OFFLINE_VERSION;
  userId: string;
  role: OfflineRole;
  name: string;
  institution: { id: string; name: string };
  savedAt: string;                 // when the server made it
  timetable: OfflineSlot[];
  classes: OfflineClass[];         // dated classes, the next seven days
  modules: OfflineModule[];
  venues: OfflineVenue[];
  history: OfflineRecord[];        // student: recent attendance
  sessions: OfflineSession[];      // lecturer: recent and upcoming attendance sessions
};

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;
const local = (): Store | null => { try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; } };

const arr = (v: unknown) => Array.isArray(v);
/** Only a whole, current-format copy counts; anything else is ignored. */
export function isSnapshot(v: unknown): v is OfflineSnapshot {
  if (!v || typeof v !== "object") return false;
  const s = v as Record<string, unknown>;
  return s.v === OFFLINE_VERSION && typeof s.userId === "string" && (s.role === "student" || s.role === "lecturer")
    && typeof s.savedAt === "string" && !!s.institution && typeof s.institution === "object"
    && arr(s.timetable) && arr(s.classes) && arr(s.modules) && arr(s.venues) && arr(s.history) && arr(s.sessions);
}

function keys(store: Store): string[] {
  const out: string[] = [];
  for (let i = 0; i < store.length; i++) { const k = store.key(i); if (k) out.push(k); }
  return out;
}

/** Delete every copy that isn't this person's. */
export function purgeOthers(userId: string, store: Store | null = local()) {
  if (!store) return;
  for (const k of keys(store)) if (k.startsWith(SNAPSHOT_PREFIX) && k !== SNAPSHOT_PREFIX + userId) store.removeItem(k);
  if (store.getItem(CURRENT_KEY) && store.getItem(CURRENT_KEY) !== userId) { store.removeItem(CURRENT_KEY); store.removeItem(SYNCED_KEY); }
}

/** Save this person's copy; it becomes the one the offline screen shows. */
export function saveSnapshot(s: OfflineSnapshot, store: Store | null = local()): boolean {
  if (!store || !isSnapshot(s)) return false;
  purgeOthers(s.userId, store);
  try {
    store.setItem(SNAPSHOT_PREFIX + s.userId, JSON.stringify(s));
    store.setItem(CURRENT_KEY, s.userId);
    store.setItem(SYNCED_KEY, String(Date.now()));
    return true;
  } catch { return false; }        // storage full or blocked: keep working online
}

/** The copy of whoever last synced on this device and hasn't signed out. */
export function readSnapshot(store: Store | null = local()): OfflineSnapshot | null {
  if (!store) return null;
  try {
    const who = store.getItem(CURRENT_KEY);
    if (!who) return null;
    const s = JSON.parse(store.getItem(SNAPSHOT_PREFIX + who) ?? "null") as unknown;
    return isSnapshot(s) && s.userId === who ? s : null;
  } catch { return null; }
}

/** Sign-out: forget every offline copy on this device. */
export function clearSnapshots(store: Store | null = local()) {
  if (!store) return;
  for (const k of keys(store)) if (k.startsWith(SNAPSHOT_PREFIX)) store.removeItem(k);
  store.removeItem(CURRENT_KEY);
  store.removeItem(SYNCED_KEY);
}

/** Whether it's time to refresh the copy (on every visit would be wasteful on a phone plan). */
export function syncDue(userId: string, now = Date.now(), everyMs = 10 * 60_000, store: Store | null = local()): boolean {
  if (!store) return false;
  if (store.getItem(CURRENT_KEY) !== userId) return true;
  const last = Number(store.getItem(SYNCED_KEY) || 0);
  return !last || now - last >= everyMs;
}

/** "Last updated …" in words people use. */
export function updatedAgo(iso: string, now = Date.now()): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "unknown";
  const min = Math.round((now - t) / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} minute${min === 1 ? "" : "s"} ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d} day${d === 1 ? "" : "s"} ago`;
  return new Date(t).toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Johannesburg" });
}

/** The class on now and the next one today, from the weekly timetable ("HH:MM" times, SAST). */
export function nowAndNext<T extends { weekday: number; starts_at: string; ends_at: string }>(slots: T[], weekday: number, hhmm: string) {
  const today = slots.filter((s) => s.weekday === weekday).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  return {
    today,
    current: today.find((s) => s.starts_at.slice(0, 5) <= hhmm && hhmm < s.ends_at.slice(0, 5)) ?? null,
    next: today.find((s) => s.starts_at.slice(0, 5) > hhmm) ?? null,
  };
}

export type OfflineTab = "home" | "timetable" | "modules" | "venues" | "history";
/** Which part of the offline screen answers the page someone tried to open. */
export function tabFor(path: string | null | undefined): OfflineTab {
  const p = (path ?? "").split("?")[0];
  if (/^\/(student|lecturer)\/timetable/.test(p)) return "timetable";
  if (/^\/student\/history/.test(p)) return "history";
  if (/^\/student\/(map|navigate)/.test(p)) return "venues";
  if (/^\/lecturer\/modules/.test(p)) return "modules";
  return "home";
}

/** Only our own pages are worth going back to when the signal returns. */
export function safeReturn(path: string | null | undefined): string {
  return typeof path === "string" && /^\/(?!\/)[A-Za-z0-9/_\-.?=&%]*$/.test(path) && !path.startsWith("/offline") ? path : "/dashboard";
}

/** A message for the service worker (public/sw.js), once it's running. Does nothing where there is none. */
export function tellServiceWorker(msg: { type: "user"; id: string } | { type: "signout" } | { type: "warm"; paths: string[] }) {
  try {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    const now = navigator.serviceWorker.controller;
    if (now) { now.postMessage(msg); return; }
    void navigator.serviceWorker.ready.then((r) => r.active?.postMessage(msg)).catch(() => {});
  } catch { /* no service worker here */ }
}

/** Sign-out (and the sign-in page): nothing personal stays behind for the next person. */
export function forgetOfflineData() {
  clearSnapshots();
  tellServiceWorker({ type: "signout" });
  // Also when the service worker isn't running: its page copies, by name.
  try { if (typeof caches !== "undefined") void caches.keys().then((ks) => ks.filter((k) => k.startsWith("ua-pages-")).forEach((k) => void caches.delete(k))).catch(() => {}); }
  catch { /* storage blocked */ }
}
