"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { saveRegister } from "@/app/lecturer/actions";
import { checkInOffline } from "@/app/student/actions";
import { Icon } from "@/components/icons";
import { isNetworkError, markFailed, queued, QUEUE_EVENT, remove, type QueueItem } from "@/lib/offline-queue";

type Sent = { id: string; text: string; tone: "ok" | "bad" };

/**
 * Shows when the device is offline, how much is waiting to be sent, and sends it
 * (only the signed-in person's own items) as soon as the connection is back.
 * Also registers the service worker that keeps recent pages for offline opening.
 */
export function OfflineSync({ userId }: { userId: string }) {
  const [online, setOnline] = useState(true);
  const [items, setItems] = useState<QueueItem[]>([]);
  const [sent, setSent] = useState<Sent[]>([]);
  const [sending, setSending] = useState(false);
  const busy = useRef(false);

  const refresh = useCallback(() => setItems(queued(userId)), [userId]);

  const flush = useCallback(async () => {
    if (busy.current || !navigator.onLine) return;
    const todo = queued(userId).filter((i) => !i.error);
    if (!todo.length) return;
    busy.current = true; setSending(true);
    try {
      for (const item of todo) {
        let done: Sent | null = null;
        try {
          if (item.kind === "checkin") {
            const r = await checkInOffline(item.payload);
            if (r.ok) done = { id: item.id, tone: "ok", text: r.ok.outcome === "duplicate" ? `${r.ok.module_code ?? "Check-in"}: ${r.ok.reasons[0] ?? "already recorded."}` : `${r.ok.module_code ?? "Check-in"}: sent to your lecturer for review.` };
            else if (!r.retry) { markFailed(item.id, r.error ?? "Couldn't be sent."); continue; }
            else continue;                                  // try again later
          } else {
            const r = await saveRegister(item.payload.session, item.payload.entries, item.payload.note);
            if (r.error) { markFailed(item.id, r.error); continue; }
            done = { id: item.id, tone: "ok", text: `${item.payload.label}: register saved (${r.ok}).` };
          }
        } catch (e) {
          if (isNetworkError(e)) break;                     // still no connection: stop, keep everything
          markFailed(item.id, "Couldn't be sent.");
          continue;
        }
        remove(item.id);
        if (done) setSent((s) => [...s, done!].slice(-4));
      }
    } finally { busy.current = false; setSending(false); refresh(); }
  }, [refresh, userId]);

  useEffect(() => {
    setOnline(navigator.onLine);
    refresh();
    void flush();
    // Keep recent pages so the app opens without signal.
    if ("serviceWorker" in navigator && window.isSecureContext) navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
    const up = () => { setOnline(true); void flush(); };
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    window.addEventListener(QUEUE_EVENT, refresh);
    window.addEventListener("storage", refresh);
    const t = setInterval(() => { if (queued(userId).some((i) => !i.error)) void flush(); }, 30_000);
    return () => {
      window.removeEventListener("online", up); window.removeEventListener("offline", down);
      window.removeEventListener(QUEUE_EVENT, refresh); window.removeEventListener("storage", refresh); clearInterval(t);
    };
  }, [flush, refresh, userId]);

  const waiting = items.filter((i) => !i.error);
  const failed = items.filter((i) => i.error);
  if (online && !waiting.length && !failed.length && !sent.length) return null;

  const what = (n: number) => `${n} item${n === 1 ? "" : "s"}`;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[60] flex flex-col items-center gap-2 px-3 pt-[max(8px,env(safe-area-inset-top))] print:hidden">
      {(!online || waiting.length > 0) && (
        <div role="status" className={`pointer-events-auto flex max-w-md items-center gap-2 rounded-full px-4 py-2 text-xs font-semibold shadow-card ${online ? "bg-surface text-ink" : "bg-ink text-bg"}`}>
          <Icon name={online ? "clock" : "alert"} size={15} />
          {!online
            ? <span>You&apos;re offline.{waiting.length ? ` ${what(waiting.length)} saved on this device.` : " Check-ins and register marks are saved and sent later."}</span>
            : <span>{sending ? "Sending" : "Waiting to send"} {what(waiting.length)}…</span>}
        </div>
      )}
      {failed.map((i) => (
        <div key={i.id} role="alert" className="pointer-events-auto flex w-full max-w-md items-start gap-2 rounded-2xl bg-surface p-3 text-xs shadow-card">
          <Icon name="alert" size={16} className="mt-0.5 shrink-0 text-bad" />
          <span className="min-w-0 flex-1"><b>{i.kind === "checkin" ? "A saved check-in" : `Register: ${i.payload.label}`}</b> couldn&apos;t be sent: {i.error}</span>
          <button type="button" onClick={() => remove(i.id)} className="shrink-0 font-semibold text-accent">Dismiss</button>
        </div>
      ))}
      {sent.map((s) => (
        <div key={s.id} role="status" className="pointer-events-auto flex w-full max-w-md items-start gap-2 rounded-2xl bg-surface p-3 text-xs shadow-card">
          <Icon name="check" size={16} className="mt-0.5 shrink-0 text-ok" />
          <span className="min-w-0 flex-1">{s.text}</span>
          <button type="button" onClick={() => setSent((x) => x.filter((y) => y.id !== s.id))} className="shrink-0 font-semibold text-accent">OK</button>
        </div>
      ))}
    </div>
  );
}
