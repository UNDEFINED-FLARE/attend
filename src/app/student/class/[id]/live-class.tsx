"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { LateChip } from "@/components/late";
import { supabaseBrowser } from "@/lib/supabase/client";
import { LeaveButton } from "../../leave-button";

type Session = { id: string; title: string; status: string; opens_at: string; closes_at: string; code: string; module: string; venue: string | null };
type Rec = { id: string; status: string; checked_in_at: string | null; minutes_late: number | null; checked_out_at: string | null;
  custom: { name: string; color: string } | null };

const STATUS: Record<string, [string, string]> = {
  present: ["Present", "bg-ok text-white"], late: ["Late", "bg-warn text-white"], late_pending: ["Late · lecturer deciding", "bg-muted/15 text-muted"],
  pending_verification: ["Being reviewed", "bg-warn/15 text-warn"], absent: ["Absent", "bg-bad text-white"], excused: ["Excused", "bg-info text-white"],
};
// Always South African time, so the server and the phone show the same clock.
const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Johannesburg" });
function left(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
}

/**
 * Stays live for the whole class: counts down to the end, keeps the screen on,
 * and updates by itself when the lecturer decides on a late arrival or closes the session.
 */
export function LiveClass({ session, record, checkOut = true }: { session: Session; record: Rec; checkOut?: boolean }) {
  const router = useRouter();
  // Starts on the phone (not the server), so the first render matches and the clock is the phone's.
  const [mounted, setMounted] = useState(false);
  const [tick, setNow] = useState(0);
  const now = mounted ? tick : Date.parse(session.opens_at);
  const [keepOn, setKeepOn] = useState(true);
  const [awake, setAwake] = useState(false);
  const lock = useRef<{ release: () => Promise<void> } | null>(null);
  const start = Date.parse(session.opens_at), end = Date.parse(session.closes_at);
  const ended = session.status === "closed" || session.status === "cancelled" || (mounted && now >= end);
  const out = !!record.checked_out_at;
  const live = !ended && !out;

  // Tick every second.
  useEffect(() => { setNow(Date.now()); setMounted(true); const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);

  // Follow the record and the session live; a slow poll covers dropped connections.
  useEffect(() => {
    if (!live) return;
    const sb = supabaseBrowser();
    let pending: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => { pending ??= setTimeout(() => { pending = null; router.refresh(); }, 500); };
    const ch = sb.channel(`class-${session.id}-${record.id}`)
      .on("postgres_changes", { event: "UPDATE", schema: "uniattend", table: "attendance_records", filter: `id=eq.${record.id}` }, refresh)
      .on("postgres_changes", { event: "UPDATE", schema: "uniattend", table: "class_sessions", filter: `id=eq.${session.id}` }, refresh)
      .subscribe();
    const poll = setInterval(() => router.refresh(), 30_000);
    return () => { void sb.removeChannel(ch); clearInterval(poll); if (pending) clearTimeout(pending); };
  }, [live, session.id, record.id, router]);

  // When the countdown reaches the end, fetch the final state once.
  useEffect(() => {
    if (mounted && now >= end && session.status === "open") { const t = setTimeout(() => router.refresh(), 1500); return () => clearTimeout(t); }
  }, [mounted && now >= end, end, session.status, router]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the screen on while in class (where the browser allows it).
  useEffect(() => {
    const nav = navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } };
    if (!nav.wakeLock || !keepOn || !live) { void lock.current?.release().catch(() => {}); lock.current = null; setAwake(false); return; }
    const get = async () => {
      if (document.visibilityState !== "visible" || lock.current) return;
      try { lock.current = await nav.wakeLock!.request("screen"); setAwake(true); } catch { setAwake(false); }
    };
    const onVis = () => { if (document.visibilityState === "visible") { lock.current = null; void get(); } };
    void get();
    document.addEventListener("visibilitychange", onVis);
    return () => { document.removeEventListener("visibilitychange", onVis); void lock.current?.release().catch(() => {}); lock.current = null; };
  }, [keepOn, live]);

  const pct = Math.min(100, Math.max(0, ((now - start) / Math.max(1, end - start)) * 100));
  const [label, tone] = record.custom ? [record.custom.name, "text-white"] : STATUS[record.status] ?? [record.status, "bg-white/25 text-white"];
  const inUntil = record.checked_out_at ?? (ended ? new Date(Math.min(now, end)).toISOString() : null);
  const minutesIn = record.checked_in_at ? Math.max(0, Math.round(((inUntil ? Date.parse(inUntil) : now) - Date.parse(record.checked_in_at)) / 60000)) : null;

  return (
    <div className="mx-auto max-w-md space-y-4">
      <section className={`relative overflow-hidden rounded-[32px] p-6 text-white shadow-card ${live ? "bg-gradient-to-br from-accent to-brand" : "bg-gradient-to-br from-slate-500 to-slate-700"}`}>
        <span aria-hidden className="absolute -right-10 -top-10 size-40 rounded-full bg-white/10" />
        <div className="relative">
          <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] opacity-90">
            {live && <span className="size-2 animate-pulse rounded-full bg-white" />}
            {live ? "Live · you're in class" : out ? "You checked out" : "Class ended"}
          </p>
          <h1 className="mt-2 text-2xl font-bold leading-tight">{session.code}</h1>
          <p className="text-sm opacity-90">{session.module} · {session.title}</p>
          {session.venue && <p className="mt-1 flex items-center gap-1 text-sm opacity-90"><Icon name="pin" size={15} />{session.venue}</p>}

          <div className="mt-6 text-center">
            <p className="text-5xl font-bold tabular-nums tracking-tight" aria-live="off">{!mounted ? "··:··" : live ? left(end - now) : minutesIn != null ? `${minutesIn} min` : "—"}</p>
            <p className="mt-1 text-sm opacity-85">{live ? `left · ends ${clock(session.closes_at)}` : "in class"}</p>
          </div>
          <div className="mt-5 h-2 overflow-hidden rounded-full bg-white/25">
            <div className="h-full rounded-full bg-white transition-[width] duration-1000" style={{ width: `${live ? pct : 100}%` }} />
          </div>
          <div className="mt-2 flex justify-between text-[11px] opacity-80"><span>{clock(session.opens_at)}</span><span>{clock(session.closes_at)}</span></div>
        </div>
      </section>

      <section className="space-y-3 rounded-[28px] bg-surface p-5 shadow-card">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-muted">Your attendance</span>
          <span className={`rounded-full px-3 py-1 text-sm font-semibold ${tone}`} style={record.custom ? { background: record.custom.color } : undefined}>{label}</span>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          {record.checked_in_at && <span><span className="text-muted">In</span> <b className="tabular-nums">{clock(record.checked_in_at)}</b></span>}
          {record.checked_out_at && <span><span className="text-muted">Out</span> <b className="tabular-nums">{clock(record.checked_out_at)}</b></span>}
          <LateChip minutes={record.minutes_late} />
        </div>
        {record.status === "late_pending" && live && <p className="text-xs text-muted">Your lecturer decides whether the late arrival counts. This updates by itself.</p>}
        {record.status === "pending_verification" && live && <p className="text-xs text-muted">Your check-in is being reviewed. This updates by itself.</p>}
      </section>

      {live ? (
        <section className="space-y-3 rounded-[28px] bg-surface p-5 shadow-card">
          <label className="flex cursor-pointer items-center gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent/10 text-accent"><Icon name="clock" size={19} /></span>
            <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">Keep the screen on</span>
              <span className="block text-xs text-muted">{awake ? "On until the class ends." : "Your phone may lock the screen; this page still updates when you come back."}</span></span>
            <input type="checkbox" className="peer sr-only" checked={keepOn} onChange={(e) => setKeepOn(e.target.checked)} />
            <span aria-hidden className="relative h-7 w-12 shrink-0 rounded-full bg-line transition peer-checked:bg-accent after:absolute after:left-1 after:top-1 after:size-5 after:rounded-full after:bg-white after:shadow after:transition peer-checked:after:translate-x-5" />
          </label>
          {checkOut && (
            <div className="flex items-center justify-between gap-3 border-t border-line pt-3">
              <span className="text-sm text-muted">Leaving before the end?</span>
              <LeaveButton session={session.id} />
            </div>
          )}
        </section>
      ) : (
        <Link href="/student" className="flex h-12 items-center justify-center rounded-2xl bg-accent font-semibold text-white">Back to my dashboard</Link>
      )}
    </div>
  );
}
