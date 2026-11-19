"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { Badge } from "@/components/ui";
import { DAYS, hhmm, moduleColor, todayWeekday, WeekGrid } from "@/components/week-grid";
import { LockError, markUnlocked, readLock, shouldLock, verifyOwner } from "@/lib/app-lock";
import {
  nowAndNext, readSnapshot, safeReturn, tabFor, updatedAgo,
  type OfflineClass, type OfflineSnapshot, type OfflineTab,
} from "@/lib/offline-data";
import { queued, QUEUE_EVENT } from "@/lib/offline-queue";
import { BrandMark } from "@/components/brand-mark";

const TZ = "Africa/Johannesburg";
const dayLabel = (iso: string) => new Date(iso).toLocaleDateString("en-ZA", { weekday: "long", day: "numeric", month: "long", timeZone: TZ });
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", timeZone: TZ });
const dateTime = (iso: string) => new Date(iso).toLocaleString("en-ZA", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: TZ });
const ymd = (iso: string) => new Date(new Date(iso).toLocaleString("en-US", { timeZone: TZ })).toLocaleDateString("en-CA");
/** "HH:MM" now in South African time (as the online pages use). */
const nowHHMM = () => { const d = new Date(Date.now() + 2 * 3600_000); return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`; };

type State = { kind: "loading" } | { kind: "none" } | { kind: "locked"; snap: OfflineSnapshot } | { kind: "ready"; snap: OfflineSnapshot };

/**
 * The app without signal: home, timetable, modules, venues and recent attendance,
 * drawn from the copy saved on this device by the last signed-in sync. Asks for the
 * fingerprint, face or screen lock first when the person turned the app lock on.
 */
export function OfflineApp() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [online, setOnline] = useState(true);
  const [from, setFrom] = useState<string | null>(null);
  const [tab, setTab] = useState<OfflineTab>("home");

  useEffect(() => {
    const f = new URLSearchParams(window.location.search).get("from");
    setFrom(f); setTab(tabFor(f));
    setOnline(navigator.onLine);
    const snap = readSnapshot();
    if (!snap) setState({ kind: "none" });
    else setState({ kind: shouldLock(snap.userId) ? "locked" : "ready", snap });
    if (!snap || !shouldLock(snap.userId)) document.documentElement.classList.remove("ua-locked");
  }, []);

  // Signal back: return to the page that couldn't load.
  useEffect(() => {
    const up = () => { setOnline(true); if (from) window.location.replace(safeReturn(from)); };
    const down = () => setOnline(false);
    window.addEventListener("online", up); window.addEventListener("offline", down);
    return () => { window.removeEventListener("online", up); window.removeEventListener("offline", down); };
  }, [from]);

  if (state.kind === "loading") return <main className="min-h-dvh bg-bg" />;
  if (state.kind === "none") return <NoCopy online={online} from={from} />;
  if (state.kind === "locked") return <Lock snap={state.snap} onOpen={() => { document.documentElement.classList.remove("ua-locked"); setState({ kind: "ready", snap: state.snap }); }} />;
  return <Screens snap={state.snap} tab={tab} setTab={setTab} online={online} from={from} />;
}

function NoCopy({ online, from }: { online: boolean; from: string | null }) {
  return (
    <main className="grid min-h-dvh place-items-center bg-bg p-6 text-center font-sans">
      <div className="max-w-sm space-y-4">
        <BrandMark className="mx-auto size-16" rounded="rounded-2xl" />
        <h1 className="text-2xl font-semibold">{online ? "Nothing saved yet" : "You're offline"}</h1>
        <p className="text-sm text-muted">There&apos;s no offline copy on this device. Open UniAttend once with signal and sign in: your timetable,
          classes, modules, venues and recent attendance are then saved here and open without signal.</p>
        <button type="button" onClick={() => window.location.assign(safeReturn(from))}
          className="h-12 w-full rounded-2xl bg-brand text-sm font-semibold text-brand-ink">Try again</button>
      </div>
    </main>
  );
}

/** The app lock, offline: the device checks its owner; nothing leaves the phone. */
function Lock({ snap, onOpen }: { snap: OfflineSnapshot; onOpen: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [tries, setTries] = useState(0);
  const unlock = useCallback(async () => {
    const c = readLock();
    if (!c || c.userId !== snap.userId) { markUnlocked(); onOpen(); return; }
    setBusy(true); setErr(null);
    try { await verifyOwner(c); markUnlocked(); onOpen(); }
    catch (e) {
      const kind = e instanceof LockError ? e.kind : "failed";
      if (kind === "failed") setTries((n) => n + 1);
      setErr(kind === "cancelled" ? null : kind === "unavailable" ? (e as Error).message : "That didn't match. Try again.");
    } finally { setBusy(false); }
  }, [onOpen, snap.userId]);
  // Ask once, straight away; after that, the button.
  const asked = useRef(false);
  useEffect(() => { if (!asked.current) { asked.current = true; void unlock(); } }, [unlock]);
  const out = tries >= 5;
  return (
    <main role="dialog" aria-modal="true" aria-labelledby="lock-title"
      className="flex min-h-dvh flex-col items-center justify-between bg-bg px-6 pb-[max(32px,env(safe-area-inset-bottom))] pt-[max(48px,env(safe-area-inset-top))] text-center font-sans text-ink">
      <div className="flex flex-col items-center gap-3">
        <BrandMark className="size-16 shadow-card" rounded="rounded-2xl" />
        <p className="text-sm text-muted">{snap.institution.name}</p>
        <h1 id="lock-title" className="text-2xl font-semibold">UniAttend is locked</h1>
        <p className="text-sm text-muted">Signed in as {snap.name}</p>
      </div>
      <div className="flex w-full max-w-xs flex-col items-center gap-4">
        {!out && (
          <button type="button" onClick={() => void unlock()} disabled={busy} aria-label="Unlock with fingerprint, face or screen lock"
            className="grid size-24 place-items-center rounded-full bg-surface text-accent shadow-card transition active:scale-95 disabled:opacity-60">
            <Icon name="fingerprint" size={48} />
          </button>
        )}
        <p className="min-h-5 text-sm" aria-live="polite">
          {out ? "Too many tries. Sign in with your password when you have signal." : busy ? "Waiting for your device…" : err ?? "Touch to unlock"}
        </p>
      </div>
      <p className="max-w-xs text-xs text-muted">Signing in with your password instead needs signal.</p>
    </main>
  );
}

const TABS: { id: OfflineTab; label: string; icon: "dashboard" | "calendar" | "book" | "pin" | "history"; student?: boolean; lecturer?: boolean }[] = [
  { id: "home", label: "Home", icon: "dashboard" },
  { id: "timetable", label: "Timetable", icon: "calendar" },
  { id: "modules", label: "Modules", icon: "book" },
  { id: "venues", label: "Venues", icon: "pin" },
  { id: "history", label: "History", icon: "history", student: true },
  { id: "history", label: "Sessions", icon: "history", lecturer: true },
];

function Screens({ snap, tab, setTab, online, from }: { snap: OfflineSnapshot; tab: OfflineTab; setTab: (t: OfflineTab) => void; online: boolean; from: string | null }) {
  const [pending, setPending] = useState(0);
  useEffect(() => {
    const count = () => setPending(queued(snap.userId).length);
    count();
    window.addEventListener(QUEUE_EVENT, count);
    return () => window.removeEventListener(QUEUE_EVENT, count);
  }, [snap.userId]);
  const tabs = TABS.filter((t) => (snap.role === "student" ? !t.lecturer : !t.student));

  return (
    <div className="min-h-dvh bg-bg pb-24 font-sans text-ink">
      <header className="sticky top-0 z-10 border-b border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 pb-3 pt-[max(12px,env(safe-area-inset-top))]">
          <div className="min-w-0 leading-tight">
            <p className="truncate text-[15px] font-semibold">{snap.institution.name || "UniAttend"}</p>
            <p className="truncate text-xs text-muted">{snap.name}</p>
          </div>
          <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${online ? "bg-ok/10 text-ok" : "bg-warn/10 text-warn"}`}>
            <span className={`size-2 rounded-full ${online ? "bg-ok" : "bg-warn"}`} />{online ? "Online" : "Offline"}
          </span>
        </div>
        <p className="mx-auto max-w-3xl px-4 pb-2 text-xs text-muted">
          Saved copy · last updated {updatedAgo(snap.savedAt)}{online ? "" : " · refreshes when you're back online"}
        </p>
      </header>

      {online && (
        <div className="mx-auto mt-4 max-w-3xl px-4">
          <a href={safeReturn(from)} className="flex items-center justify-between gap-3 rounded-2xl bg-brand px-4 py-3 text-sm font-semibold text-brand-ink">
            You&apos;re back online. Open UniAttend <Icon name="arrowRight" size={18} />
          </a>
        </div>
      )}

      <main className="mx-auto max-w-3xl space-y-5 px-4 py-5">
        {tab === "home" && <Home snap={snap} pending={pending} />}
        {tab === "timetable" && <Timetable snap={snap} />}
        {tab === "modules" && <Modules snap={snap} />}
        {tab === "venues" && <Venues snap={snap} />}
        {tab === "history" && (snap.role === "student" ? <History snap={snap} pending={pending} /> : <Sessions snap={snap} />)}
      </main>

      <nav aria-label="Offline screens" className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
        <div className="mx-auto grid max-w-3xl" style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}>
          {tabs.map((t) => (
            <button key={t.label} type="button" onClick={() => { setTab(t.id); window.scrollTo(0, 0); }} aria-current={tab === t.id ? "page" : undefined}
              className={`flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium ${tab === t.id ? "text-accent" : "text-muted"}`}>
              <Icon name={t.icon} size={22} />{t.label}
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="rounded-3xl bg-surface p-5 shadow-card">
    <h2 className="mb-3 text-sm font-semibold">{title}</h2>
    {children}
  </section>
);

function SlotCard({ label, slot, empty, dark }: { label: string; slot: OfflineSnapshot["timetable"][number] | null; empty: string; dark?: boolean }) {
  return (
    <section className={`rounded-3xl p-5 shadow-card ${dark ? "bg-gradient-to-br from-accent to-brand text-white" : "bg-surface"}`}>
      <p className={`text-[11px] font-bold uppercase tracking-[0.14em] ${dark ? "opacity-80" : "text-muted"}`}>{label}</p>
      {slot ? (
        <>
          <p className="mt-2 text-lg font-bold" style={dark ? undefined : { color: moduleColor(slot.code) }}>{slot.title}</p>
          <p className={`text-sm ${dark ? "opacity-90" : "text-muted"}`}>{slot.code} · {slot.kind} · {hhmm(slot.starts_at)}–{hhmm(slot.ends_at)}</p>
          <p className={`mt-1 flex items-center gap-1 text-sm ${dark ? "opacity-90" : "text-muted"}`}><Icon name="pin" size={15} />{slot.venue ?? "No venue set"}</p>
        </>
      ) : <p className={`mt-2 text-sm ${dark ? "opacity-90" : "text-muted"}`}>{empty}</p>}
    </section>
  );
}

function Home({ snap, pending }: { snap: OfflineSnapshot; pending: number }) {
  const [clock, setClock] = useState(() => ({ day: todayWeekday(), now: nowHHMM() }));
  useEffect(() => { const t = setInterval(() => setClock({ day: todayWeekday(), now: nowHHMM() }), 30_000); return () => clearInterval(t); }, []);
  const { today, current, next } = nowAndNext(snap.timetable, clock.day, clock.now);
  const todayIso = ymd(new Date().toISOString());
  const changesToday = snap.classes.filter((c) => ymd(c.starts_at) === todayIso && (c.status === "cancelled" || c.edited));
  const tracked = snap.modules.filter((m) => m.attended != null);
  const att = tracked.reduce((a, m) => a + (m.attended ?? 0), 0), tot = tracked.reduce((a, m) => a + (m.attended ?? 0) + (m.absent ?? 0), 0);
  const first = snap.name.split(" ")[0];

  return (
    <>
      <div>
        <p className="text-sm text-muted">{new Date().toLocaleDateString("en-ZA", { weekday: "long", day: "numeric", month: "long", timeZone: TZ })}</p>
        <h1 className="text-2xl font-semibold">Hello{first ? `, ${first}` : ""}</h1>
      </div>
      {changesToday.length > 0 && (
        <p className="rounded-2xl bg-warn/10 px-4 py-3 text-sm text-warn">
          {changesToday.length} class{changesToday.length === 1 ? " has" : "es have"} changed today. See Timetable.
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <SlotCard label="Now" slot={current} empty="No class right now" dark />
        <SlotCard label="Next today" slot={next} empty={today.length ? "No more classes today" : "No classes today"} />
      </div>
      {snap.role === "student" && (
        <>
          <a href="/student/check-in" className="flex items-center justify-between gap-3 rounded-3xl bg-surface p-5 shadow-card">
            <span className="flex items-center gap-3">
              <span className="grid size-11 place-items-center rounded-2xl bg-accent/10 text-accent"><Icon name="scan" size={22} /></span>
              <span className="leading-tight">
                <span className="block font-semibold">Check in</span>
                <span className="block text-xs text-muted">Works without signal: saved on your phone and sent for your lecturer to confirm.</span>
              </span>
            </span>
            <Icon name="arrowRight" size={18} />
          </a>
          {pending > 0 && <p className="rounded-2xl bg-info/10 px-4 py-3 text-sm text-info">{pending} item{pending === 1 ? "" : "s"} waiting to send when you&apos;re back online.</p>}
          {tot > 0 && (
            <Section title="Attendance">
              <p className="text-3xl font-semibold tabular-nums">{Math.round((1000 * att) / tot) / 10}%</p>
              <p className="text-sm text-muted">{att} of {tot} classes, across {tracked.length} module{tracked.length === 1 ? "" : "s"}</p>
            </Section>
          )}
        </>
      )}
      {snap.role === "lecturer" && pending > 0 && (
        <p className="rounded-2xl bg-info/10 px-4 py-3 text-sm text-info">{pending} register save{pending === 1 ? "" : "s"} waiting to send when you&apos;re back online.</p>
      )}
      <Section title="Today">
        {today.length === 0 ? <p className="text-sm text-muted">No classes today.</p> : (
          <ul className="space-y-2">
            {today.map((s) => (
              <li key={s.id} className="flex items-center gap-3 rounded-2xl bg-bg p-3">
                <span className="w-1 self-stretch rounded-full" style={{ background: moduleColor(s.code) }} />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold">{hhmm(s.starts_at)}–{hhmm(s.ends_at)} · {s.code}</span>
                  <span className="block truncate text-xs text-muted">{s.title} · {s.kind}{s.venue ? ` · ${s.venue}` : ""}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}

function ClassRows({ events }: { events: OfflineClass[] }) {
  if (!events.length) return <p className="text-sm text-muted">No dated classes in the next seven days.</p>;
  const days = [...new Set(events.map((e) => ymd(e.starts_at)))];
  return (
    <div className="space-y-4">
      {days.map((d) => {
        const list = events.filter((e) => ymd(e.starts_at) === d);
        return (
          <div key={d}>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">{dayLabel(list[0].starts_at)}</h3>
            <ul className="space-y-2">
              {list.map((e) => {
                const off = e.status === "cancelled";
                return (
                  <li key={e.id} className="rounded-2xl bg-bg p-3">
                    <p className={`text-sm font-semibold ${off ? "line-through opacity-60" : ""}`}>
                      {timeOf(e.starts_at)}–{timeOf(e.ends_at)} · {e.module?.code ?? "Class"}
                    </p>
                    <p className="text-xs text-muted">{e.module?.title ?? ""}{e.venue ? ` · ${e.venue}` : ""}{e.lecturer ? ` · ${e.lecturer}` : ""}{e.group_name ? ` · ${e.group_name}` : ""}</p>
                    {(off || e.edited) && <p className={`mt-1 text-xs font-semibold ${off ? "text-bad" : "text-warn"}`}>{off ? "Cancelled" : "Changed"}{e.note ? `: ${e.note}` : ""}</p>}
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

function Timetable({ snap }: { snap: OfflineSnapshot }) {
  return (
    <>
      <h1 className="text-2xl font-semibold">Timetable</h1>
      <Section title="Next seven days"><ClassRows events={snap.classes} /></Section>
      <Section title="Every week">
        {snap.timetable.length === 0 ? <p className="text-sm text-muted">No timetable saved.</p> : <WeekGrid slots={snap.timetable} />}
      </Section>
    </>
  );
}

function Modules({ snap }: { snap: OfflineSnapshot }) {
  const slotsFor = (code: string) => snap.timetable.filter((s) => s.code === code);
  return (
    <>
      <h1 className="text-2xl font-semibold">Modules</h1>
      {snap.modules.length === 0 && <p className="text-sm text-muted">No modules saved.</p>}
      <ul className="space-y-3">
        {snap.modules.map((m) => {
          const low = m.percent != null && m.min_pct != null && m.percent < m.min_pct;
          return (
            <li key={m.id} className="rounded-3xl bg-surface p-5 shadow-card">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold" style={{ color: moduleColor(m.code) }}>{m.code}</p>
                  <p className="text-sm text-muted">{m.title}</p>
                </div>
                {m.percent != null && <span className={`shrink-0 text-lg font-semibold tabular-nums ${low ? "text-bad" : ""}`}>{m.percent}%</span>}
                {m.students != null && <span className="shrink-0 text-sm text-muted">{m.students} student{m.students === 1 ? "" : "s"}</span>}
              </div>
              {m.attended != null && (
                <p className="mt-2 text-xs text-muted">{m.attended} attended · {m.absent ?? 0} absent{m.unresolved ? ` · ${m.unresolved} awaiting review` : ""}{m.min_pct != null ? ` · minimum ${m.min_pct}%` : ""}</p>
              )}
              {slotsFor(m.code).length > 0 && (
                <p className="mt-2 text-xs text-muted">{slotsFor(m.code).map((s) => `${DAYS[s.weekday]} ${hhmm(s.starts_at)}${s.venue ? ` (${s.venue})` : ""}`).join(" · ")}</p>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}

function Venues({ snap }: { snap: OfflineSnapshot }) {
  const [q, setQ] = useState("");
  const mine = useMemo(() => new Set(snap.timetable.map((s) => s.venue_id).filter(Boolean) as string[]), [snap.timetable]);
  const list = snap.venues
    .filter((v) => !q || v.name.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => Number(mine.has(b.id)) - Number(mine.has(a.id)) || a.name.localeCompare(b.name));
  return (
    <>
      <h1 className="text-2xl font-semibold">Venues</h1>
      <p className="text-sm text-muted">Your class venues first. &ldquo;Open in maps&rdquo; uses your phone&apos;s map app, which works offline if you&apos;ve
        downloaded the area there. The campus map in UniAttend needs signal.</p>
      <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a venue" aria-label="Find a venue"
        className="h-11 w-full rounded-2xl border border-line bg-surface px-4 text-sm" />
      <ul className="space-y-2">
        {list.slice(0, 150).map((v) => (
          <li key={v.id} className="flex items-center justify-between gap-3 rounded-2xl bg-surface p-3 shadow-card">
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold">{v.name}</span>
              {mine.has(v.id) && <span className="block text-xs text-muted">One of your class venues</span>}
            </span>
            {v.lat != null && v.lng != null && (
              <a href={`geo:${v.lat},${v.lng}?q=${v.lat},${v.lng}(${encodeURIComponent(v.name)})`}
                className="inline-flex h-9 shrink-0 items-center gap-1 rounded-xl bg-bg px-3 text-xs font-semibold text-accent">
                <Icon name="map" size={15} /> Open in maps
              </a>
            )}
          </li>
        ))}
      </ul>
      {list.length === 0 && <p className="text-sm text-muted">No venues match.</p>}
    </>
  );
}

function History({ snap, pending }: { snap: OfflineSnapshot; pending: number }) {
  return (
    <>
      <h1 className="text-2xl font-semibold">Recent attendance</h1>
      {pending > 0 && <p className="rounded-2xl bg-info/10 px-4 py-3 text-sm text-info">{pending} check-in{pending === 1 ? "" : "s"} made offline will be sent when you&apos;re back online, for your lecturer to confirm.</p>}
      {snap.history.length === 0 ? <p className="text-sm text-muted">No attendance saved yet.</p> : (
        <ul className="space-y-2">
          {snap.history.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3 rounded-2xl bg-surface p-3 shadow-card">
              <span className="min-w-0">
                <span className="block text-sm font-semibold">{r.code ?? "Class"}</span>
                <span className="block truncate text-xs text-muted">{r.title ?? ""} · {dateTime(r.at)}</span>
              </span>
              <Badge status={r.status} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function Sessions({ snap }: { snap: OfflineSnapshot }) {
  return (
    <>
      <h1 className="text-2xl font-semibold">Attendance sessions</h1>
      <p className="text-sm text-muted">The last two weeks and any scheduled ahead. Registers you mark offline are sent when you&apos;re back online.</p>
      {snap.sessions.length === 0 ? <p className="text-sm text-muted">No sessions saved.</p> : (
        <ul className="space-y-2">
          {snap.sessions.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-3 rounded-2xl bg-surface p-3 shadow-card">
              <span className="min-w-0">
                <span className="block text-sm font-semibold">{s.code ?? ""} {s.title}</span>
                <span className="block truncate text-xs text-muted">{dateTime(s.opens_at)}{s.venue ? ` · ${s.venue}` : ""}</span>
              </span>
              <Badge status={s.status} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
