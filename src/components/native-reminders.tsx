"use client";
import { useEffect } from "react";

// In the UniAttend Android app (Capacitor), class reminders are scheduled on the
// phone itself from the student's timetable: they arrive even offline, and need
// no push service. Refreshed every time the student opens the app.

export type ReminderSlot = { id: string; weekday: number; starts_at: string; ends_at: string; code: string; title: string; kind: string; venue: string | null };

const BEFORE_MIN = 15;
const ID_BASE = 700_000;   // our notification ids, so we only ever cancel our own
const ID_MAX = 900;

export function NativeReminders({ slots, institution }: { slots: ReminderSlot[]; institution: string }) {
  useEffect(() => {
    const w = window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } };
    if (!w.Capacitor?.isNativePlatform?.()) return;
    const run = () => void (async () => {
      try {
        const { LocalNotifications } = await import("@capacitor/local-notifications");
        const perm = await LocalNotifications.checkPermissions();
        if (perm.display !== "granted") return; // the notification card asks for permission

        const pending = await LocalNotifications.getPending();
        const ours = pending.notifications.filter((n) => n.id >= ID_BASE && n.id < ID_BASE + ID_MAX);
        if (ours.length) await LocalNotifications.cancel({ notifications: ours.map((n) => ({ id: n.id })) });

        const notifications = slots.slice(0, ID_MAX).map((s, i) => {
          const [h, m] = s.starts_at.split(":").map(Number);
          let mins = h * 60 + m - BEFORE_MIN, weekday = s.weekday;
          if (mins < 0) { mins += 24 * 60; weekday = weekday === 1 ? 7 : weekday - 1; }
          return {
            id: ID_BASE + i,
            title: `${s.code} starts at ${s.starts_at.slice(0, 5)}`,
            body: `${s.kind[0].toUpperCase()}${s.kind.slice(1)} · ${s.venue ?? "venue not set"} · until ${s.ends_at.slice(0, 5)}\n${institution}`,
            largeBody: `${s.title}\n${s.kind[0].toUpperCase()}${s.kind.slice(1)} at ${s.venue ?? "a venue not set yet"}, ${s.starts_at.slice(0, 5)}–${s.ends_at.slice(0, 5)}.\n${institution}`,
            summaryText: institution,
            // ISO Monday=1 → Capacitor Sunday=1.
            schedule: { on: { weekday: (weekday % 7) + 1, hour: Math.floor(mins / 60), minute: mins % 60 }, allowWhileIdle: true },
            extra: { url: "/student/map" },
          };
        });
        if (notifications.length) await LocalNotifications.schedule({ notifications });
        await LocalNotifications.removeAllListeners();
        await LocalNotifications.addListener("localNotificationActionPerformed", (a) => {
          const url = (a.notification.extra as { url?: string } | undefined)?.url;
          if (url) window.location.href = url;
        });
      } catch { /* the app works without reminders */ }
    })();
    run();
    // The notification card fires this after the student allows notifications.
    window.addEventListener("ua-reminders", run);
    return () => window.removeEventListener("ua-reminders", run);
  }, [slots, institution]);
  return null;
}
