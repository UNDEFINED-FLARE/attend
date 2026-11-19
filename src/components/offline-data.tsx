"use client";
import { useEffect } from "react";
import { isSnapshot, purgeOthers, saveSnapshot, syncDue, tellServiceWorker } from "@/lib/offline-data";

// Pages kept ready for no signal after each sync, besides the offline screen.
// The check-in page is the one that matters: offline check-ins start there.
const WARM: Record<string, string[]> = {
  student: ["/offline", "/student/check-in"],
  lecturer: ["/offline"],
};

/**
 * Keeps this person's offline copy (src/lib/offline-data.ts) fresh while there is signal:
 * on opening the app, on coming back online, and on returning to it, at most every ten
 * minutes. Removes anyone else's copy first. Draws nothing.
 */
export function OfflineData({ userId, role }: { userId: string; role: string }) {
  useEffect(() => {
    purgeOthers(userId);
    tellServiceWorker({ type: "user", id: userId });
    if (role !== "student" && role !== "lecturer") return;

    let running = false;
    const sync = async () => {
      if (running || !navigator.onLine || !syncDue(userId)) return;
      running = true;
      try {
        const r = await fetch(`/api/offline?role=${role}`, { credentials: "same-origin", cache: "no-store", redirect: "manual" });
        if (!r.ok) return;
        const s: unknown = await r.json();
        // Only ever this person's copy, whatever the network handed back.
        if (!isSnapshot(s) || s.userId !== userId) return;
        if (saveSnapshot(s)) tellServiceWorker({ type: "warm", paths: WARM[role] });
      } catch { /* no signal after all: next time */ }
      finally { running = false; }
    };

    void sync();
    const onVisible = () => { if (document.visibilityState === "visible") void sync(); };
    window.addEventListener("online", sync);
    document.addEventListener("visibilitychange", onVisible);
    return () => { window.removeEventListener("online", sync); document.removeEventListener("visibilitychange", onVisible); };
  }, [userId, role]);
  return null;
}
