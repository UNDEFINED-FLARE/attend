"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { signOut } from "@/app/actions";
import { Icon } from "@/components/icons";
import { HIDDEN_KEY, LockError, markLocked, markUnlocked, readLock, shouldLock, verifyOwner } from "@/lib/app-lock";

const MAX_TRIES = 5;

/**
 * Covers the signed-in app until the device confirms its owner (fingerprint,
 * face or screen lock), when this person turned the app lock on for this device.
 * Pages marked data-lockable stay hidden until then (see globals.css and the
 * early script in the root layout, which hides them before the page draws).
 */
export function AppLock({ userId, name, institution, logo }: { userId: string; name: string; institution: string; logo: string | null }) {
  const [locked, setLocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tries, setTries] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const prompted = useRef(false);

  const show = useCallback((on: boolean) => {
    setLocked(on);
    document.documentElement.classList.toggle("ua-locked", on);
  }, []);

  const unlock = useCallback(async () => {
    const c = readLock();
    if (!c || c.userId !== userId) { markUnlocked(); show(false); return; }
    setBusy(true); setErr(null);
    try {
      await verifyOwner(c);
      markUnlocked(); setTries(0); show(false);
    } catch (e) {
      const kind = e instanceof LockError ? e.kind : "failed";
      if (kind === "failed") setTries((n) => n + 1);
      setErr(kind === "cancelled" ? null : kind === "unavailable" ? (e as Error).message : "That didn't match. Try again.");
    } finally { setBusy(false); }
  }, [show, userId]);

  // On load: lock if needed and ask straight away.
  useEffect(() => {
    const on = shouldLock(userId);
    show(on);
    if (on && !prompted.current) { prompted.current = true; void unlock(); }
  }, [show, unlock, userId]);

  // Going to the background starts the clock; coming back locks if it ran out.
  useEffect(() => {
    const onVis = () => {
      if (!readLock()) return;
      if (document.visibilityState === "hidden") {
        try { if (!sessionStorage.getItem(HIDDEN_KEY)) sessionStorage.setItem(HIDDEN_KEY, String(Date.now())); } catch { /* storage blocked */ }
      } else if (shouldLock(userId)) {
        markLocked(); show(true); void unlock();
      } else {
        try { sessionStorage.removeItem(HIDDEN_KEY); } catch { /* storage blocked */ }
      }
    };
    // Leaving for another page of the app (a full load) is not "going away":
    // pagehide follows the hidden event on unload, but not when the app is just backgrounded.
    const onLeave = () => { try { sessionStorage.removeItem(HIDDEN_KEY); } catch { /* storage blocked */ } };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pagehide", onLeave);
    return () => { document.removeEventListener("visibilitychange", onVis); window.removeEventListener("pagehide", onLeave); };
  }, [show, unlock, userId]);

  if (!locked) return null;
  const outOfTries = tries >= MAX_TRIES;
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="lock-title"
      className="fixed inset-0 z-[100] flex flex-col items-center justify-between bg-bg px-6 pb-[max(32px,env(safe-area-inset-bottom))] pt-[max(48px,env(safe-area-inset-top))] text-ink">
      <div className="flex flex-col items-center gap-3 text-center">
        {logo
          // eslint-disable-next-line @next/next/no-img-element -- the institution's logo
          ? <img src={logo} alt="" className="size-16 rounded-2xl bg-white object-contain p-1.5 shadow-card" referrerPolicy="no-referrer" />
          : <span className="grid size-16 place-items-center rounded-2xl bg-brand text-brand-ink shadow-card"><Icon name="check" size={30} strokeWidth={2.6} /></span>}
        <p className="text-sm text-muted">{institution}</p>
        <h1 id="lock-title" className="text-2xl font-semibold">UniAttend is locked</h1>
        <p className="text-sm text-muted">Signed in as {name}</p>
      </div>

      <div className="flex w-full max-w-xs flex-col items-center gap-4">
        {!outOfTries && (
          <button type="button" onClick={() => void unlock()} disabled={busy} aria-label="Unlock with fingerprint or face"
            className="grid size-24 place-items-center rounded-full bg-surface text-accent shadow-card transition active:scale-95 disabled:opacity-60">
            <Icon name="fingerprint" size={48} />
          </button>
        )}
        <p className="min-h-5 text-center text-sm" aria-live="polite">
          {outOfTries ? "Too many tries. Sign in with your password." : busy ? "Waiting for your device…" : err ?? "Touch to unlock"}
        </p>
      </div>

      <form action={signOut} className="w-full max-w-xs">
        <button className={`h-12 w-full rounded-2xl text-sm font-semibold ${outOfTries ? "bg-brand text-brand-ink" : "bg-surface text-ink shadow-card"}`}>
          Use my password instead
        </button>
      </form>
    </div>
  );
}
