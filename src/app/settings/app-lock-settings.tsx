"use client";
import { useEffect, useState } from "react";
import { Icon } from "@/components/icons";
import { Notice } from "@/components/ui";
import { createPasskey, LockError, lockSupport, markUnlocked, readLock, verifyOwner, writeLock, type LockConfig, type Support } from "@/lib/app-lock";

const AFTER: [LockConfig["after"], string][] = [[0, "Every time I open it"], [1, "After 1 minute away"], [5, "After 5 minutes away"], [15, "After 15 minutes away"]];

/** Turn the fingerprint / face app lock on or off for this device. */
export function AppLockSettings({ userId, name }: { userId: string; name: string }) {
  const [support, setSupport] = useState<Support | null>(null);
  const [cfg, setCfg] = useState<LockConfig | null>(null);
  const [other, setOther] = useState(false);
  const [after, setAfter] = useState<LockConfig["after"]>(1);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);

  useEffect(() => {
    const c = readLock();
    setCfg(c && c.userId === userId ? c : null);
    setOther(!!c && c.userId !== userId);
    if (c && c.userId === userId) setAfter(c.after);
    void lockSupport().then(setSupport);
  }, [userId]);

  const run = async (f: () => Promise<void>) => {
    setBusy(true); setMsg(null);
    try { await f(); }
    catch (e) {
      const cancelled = e instanceof LockError ? e.kind === "cancelled" : (e as DOMException)?.name === "NotAllowedError";
      if (!cancelled) setMsg({ tone: "bad", text: e instanceof LockError && e.kind === "unavailable" ? e.message : "Your device didn't confirm it. Nothing was changed." });
    } finally { setBusy(false); }
  };

  const turnOn = () => run(async () => {
    if (!support?.method) return;
    const next: LockConfig = { v: 1, userId, method: support.method, after, label: support.label };
    if (support.method === "passkey") next.credId = await createPasskey(name);
    await verifyOwner(next, "Turn on app lock");   // proves it works before relying on it
    writeLock(next); markUnlocked(); setCfg(next); setOther(false);
    setMsg({ tone: "ok", text: `App lock is on. UniAttend asks for your ${support.label} ${after === 0 ? "every time you open it" : `after ${after} minute${after === 1 ? "" : "s"} away`}.` });
  });

  // Changing or removing the lock needs the owner too, so a borrowed, unlocked phone can't switch it off.
  const confirmThen = (f: () => void) => run(async () => {
    if (!cfg) return;
    try { await verifyOwner(cfg, "Confirm it's you"); }
    catch (e) { if (!(e instanceof LockError && e.kind === "unavailable")) throw e; }
    f();
  });
  const turnOff = () => confirmThen(() => { writeLock(null); setCfg(null); setMsg({ tone: "ok", text: "App lock is off on this device." }); });
  const saveAfter = (a: LockConfig["after"]) => cfg ? confirmThen(() => { const n = { ...cfg, after: a }; writeLock(n); setCfg(n); setAfter(a); setMsg({ tone: "ok", text: "Saved." }); }) : setAfter(a);

  return (
    <section className="space-y-4 rounded-3xl bg-surface p-5 shadow-card">
      <div className="flex items-start gap-3">
        <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-accent/10 text-accent"><Icon name="fingerprint" size={26} /></span>
        <div className="min-w-0">
          <h2 className="font-semibold">Fingerprint or face unlock</h2>
          <p className="text-sm text-muted">Stay signed in, and open UniAttend with your fingerprint, face or device PIN instead of your password.</p>
        </div>
      </div>

      {support === null ? (
        <p className="text-sm text-muted">Checking this device…</p>
      ) : cfg ? (
        <div className="space-y-3">
          <p className="flex items-center gap-2 text-sm font-medium text-ok"><Icon name="check" size={18} />On for this device ({cfg.label})</p>
          <label className="block space-y-1">
            <span className="text-xs font-medium">Ask again</span>
            <select value={after} disabled={busy} onChange={(e) => void saveAfter(Number(e.target.value) as LockConfig["after"])}
              className="h-11 w-full rounded-xl border border-line bg-bg px-3 text-sm">
              {AFTER.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <button type="button" onClick={() => void turnOff()} disabled={busy} className="h-11 rounded-xl border border-line px-4 text-sm font-medium text-bad hover:bg-bad/5 disabled:opacity-50">
            Turn off
          </button>
        </div>
      ) : support.method ? (
        <div className="space-y-3">
          {other && <Notice tone="warn">Someone else turned on the app lock on this device. Turning it on for you replaces theirs.</Notice>}
          <label className="block space-y-1">
            <span className="text-xs font-medium">Ask for it</span>
            <select value={after} onChange={(e) => setAfter(Number(e.target.value) as LockConfig["after"])} className="h-11 w-full rounded-xl border border-line bg-bg px-3 text-sm">
              {AFTER.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <button type="button" onClick={() => void turnOn()} disabled={busy}
            className="inline-flex h-11 items-center gap-2 rounded-xl bg-brand px-4 text-sm font-semibold text-brand-ink disabled:opacity-50">
            <Icon name="fingerprint" size={18} />{busy ? "Waiting for your device…" : `Turn on with ${support.label}`}
          </button>
        </div>
      ) : (
        <Notice tone="info">{support.reason}</Notice>
      )}

      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}

      <details className="text-xs text-muted">
        <summary className="cursor-pointer font-medium">How your fingerprint and face are handled</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>Your phone or computer checks your fingerprint or face itself. UniAttend only receives &ldquo;confirmed&rdquo; or &ldquo;not confirmed&rdquo;.</li>
          <li>No fingerprint image, face scan or biometric template is ever sent to UniAttend or stored by it.</li>
          <li>The setting is kept on this device only. Your password still works, and is needed on a new device or after signing out.</li>
          <li>If the lock can&rsquo;t confirm you, choose &ldquo;Use my password instead&rdquo; on the lock screen.</li>
        </ul>
      </details>
    </section>
  );
}
