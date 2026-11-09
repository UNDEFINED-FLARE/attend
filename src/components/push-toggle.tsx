"use client";
import { useCallback, useEffect, useState } from "react";
import { removePushSubscription, savePushSubscription, sendTestPush } from "@/app/push-actions";
import { Icon } from "@/components/icons";

type Prefs = { classes: boolean; announcements: boolean; attendance: boolean };
type State = "loading" | "unsupported" | "app" | "ios" | "denied" | "off" | "on";
const PREFS_KEY = "ua_push_prefs";
const KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

function urlB64(b64: string) {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}
const readPrefs = (): Prefs => {
  try { return { classes: true, announcements: true, attendance: true, ...JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") }; }
  catch { return { classes: true, announcements: true, attendance: true }; }
};

/**
 * Turns phone/browser notifications on for this device, with a choice of
 * class reminders, announcements and attendance updates.
 * `compact` is the dashboard banner, shown only while notifications are off.
 */
export function PushToggle({ compact = false, logo, institution }: { compact?: boolean; logo?: string | null; institution?: string }) {
  const [state, setState] = useState<State>("loading");
  const [prefs, setPrefs] = useState<Prefs>({ classes: true, announcements: true, attendance: true });
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [hidden, setHidden] = useState(false);

  const current = useCallback(async () => {
    const reg = await navigator.serviceWorker.getRegistration("/");
    return reg ? reg.pushManager.getSubscription() : null;
  }, []);

  useEffect(() => {
    void (async () => {
      setPrefs(readPrefs());
      try { if (compact && localStorage.getItem("ua_push_banner_hidden")) setHidden(true); } catch { /* ignore */ }
      const w = window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } };
      if (w.Capacitor?.isNativePlatform?.()) { setState("app"); return; }
      const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
      const standalone = matchMedia("(display-mode: standalone)").matches;
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !KEY) { setState(ios && !standalone ? "ios" : "unsupported"); return; }
      if (Notification.permission === "denied") { setState("denied"); return; }
      const sub = await current();
      if (sub && Notification.permission === "granted") {
        setState("on");
        // Keep the server copy current (e.g. after signing in with another account on this phone).
        void savePushSubscription(sub.toJSON(), readPrefs(), navigator.userAgent);
      } else setState("off");
    })();
  }, [compact, current]);

  async function enable(next = prefs) {
    setBusy(true); setMsg(null);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") { setState(perm === "denied" ? "denied" : "off"); return; }
      const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64(KEY) });
      const r = await savePushSubscription(sub.toJSON(), next, navigator.userAgent);
      if (r.error) { setMsg(r.error); return; }
      try { localStorage.setItem(PREFS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      setPrefs(next);
      setState("on");
    } catch {
      setMsg("Notifications couldn't be turned on in this browser.");
    } finally { setBusy(false); }
  }

  async function disable() {
    setBusy(true);
    const sub = await current();
    if (sub) { await removePushSubscription(sub.endpoint); await sub.unsubscribe(); }
    setState("off"); setBusy(false);
  }

  async function toggle(k: keyof Prefs) {
    const next = { ...prefs, [k]: !prefs[k] };
    setPrefs(next);
    const sub = await current();
    if (sub) {
      await savePushSubscription(sub.toJSON(), next, navigator.userAgent);
      try { localStorage.setItem(PREFS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
    }
  }

  async function test() {
    setBusy(true);
    const r = await sendTestPush();
    setMsg(r.error ?? r.ok ?? null);
    setBusy(false);
  }

  const mark = logo
    // eslint-disable-next-line @next/next/no-img-element -- the institution's logo from an admin-set https URL
    ? <img src={logo} alt="" className="size-12 shrink-0 rounded-2xl bg-white object-contain p-1 shadow-card" referrerPolicy="no-referrer" />
    : <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-accent text-white shadow-card"><Icon name="bell" size={24} /></span>;

  if (compact) {
    if (hidden || state !== "off") return null;
    return (
      <section className="flex items-center gap-3 rounded-[28px] bg-surface p-4 shadow-card">
        {mark}
        <div className="min-w-0 flex-1">
          <p className="font-bold">Never miss a class</p>
          <p className="text-xs text-muted">Reminders before class, announcements{institution ? ` from ${institution}` : ""} and attendance updates.</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <button type="button" onClick={() => enable()} disabled={busy} className="h-10 rounded-xl bg-accent px-4 text-sm font-semibold text-white disabled:opacity-60">{busy ? "…" : "Allow"}</button>
          <button type="button" onClick={() => { setHidden(true); try { localStorage.setItem("ua_push_banner_hidden", "1"); } catch { /* ignore */ } }} className="text-[11px] font-medium text-muted">Not now</button>
        </div>
      </section>
    );
  }

  const Row = ({ k, icon, label, hint }: { k: keyof Prefs; icon: "calendar" | "bell" | "userCheck"; label: string; hint: string }) => (
    <label className="flex cursor-pointer items-center gap-3 py-3">
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent/10 text-accent"><Icon name={icon} size={19} /></span>
      <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">{label}</span><span className="block text-xs text-muted">{hint}</span></span>
      <input type="checkbox" className="peer sr-only" checked={prefs[k]} onChange={() => toggle(k)} />
      <span aria-hidden className="relative h-7 w-12 shrink-0 rounded-full bg-line transition peer-checked:bg-accent after:absolute after:left-1 after:top-1 after:size-5 after:rounded-full after:bg-white after:shadow after:transition peer-checked:after:translate-x-5" />
    </label>
  );

  return (
    <section className="rounded-[28px] bg-surface p-5 shadow-card">
      <div className="flex items-center gap-3">
        {mark}
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted">On this device</p>
          <p className="text-lg font-bold">{state === "on" ? "Notifications are on" : "Phone notifications"}</p>
        </div>
        {state === "on" && <span className="rounded-full bg-ok px-2.5 py-1 text-xs font-semibold text-white">On</span>}
      </div>

      {state === "loading" && <p className="mt-3 text-sm text-muted">Checking this browser…</p>}
      {state === "app" && <p className="mt-3 text-sm text-muted">In the UniAttend Android app, class reminders are set on your phone automatically. Announcements and attendance updates appear in this list.</p>}
      {state === "ios" && <p className="mt-3 text-sm text-muted">On iPhone, tap <b className="text-ink">Share → Add to Home Screen</b>, open UniAttend from your home screen, then turn notifications on here.</p>}
      {state === "unsupported" && <p className="mt-3 text-sm text-muted">This browser can&apos;t receive notifications. Try Chrome, Edge or Firefox.</p>}
      {state === "denied" && <p className="mt-3 text-sm text-muted">Notifications are blocked for this site. Allow them in your browser&apos;s site settings (the lock icon next to the address), then come back.</p>}

      {state === "off" && (
        <>
          <p className="mt-3 text-sm text-muted">Get a reminder before each class, announcements from your institution, and updates when attendance opens or a decision is made.</p>
          <button type="button" onClick={() => enable()} disabled={busy} className="mt-4 h-12 w-full rounded-2xl bg-accent font-semibold text-white disabled:opacity-60">{busy ? "Turning on…" : "Allow notifications"}</button>
        </>
      )}

      {state === "on" && (
        <>
          <div className="mt-2 divide-y divide-line">
            <Row k="classes" icon="calendar" label="Class reminders" hint="Shortly before each class on your timetable" />
            <Row k="announcements" icon="bell" label="Announcements" hint="News and notices from your institution" />
            <Row k="attendance" icon="userCheck" label="Attendance updates" hint="Attendance open, results, late decisions" />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button type="button" onClick={test} disabled={busy} className="h-11 rounded-2xl bg-bg text-sm font-semibold disabled:opacity-60">Send a test</button>
            <button type="button" onClick={disable} disabled={busy} className="h-11 rounded-2xl bg-bg text-sm font-semibold text-bad disabled:opacity-60">Turn off</button>
          </div>
        </>
      )}
      {msg && <p className="mt-3 text-sm text-muted" role="status">{msg}</p>}
    </section>
  );
}
