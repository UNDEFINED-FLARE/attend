"use client";
import Link from "next/link";
import { useActionState, useState } from "react";
import { changeClass, openClass } from "@/app/lecturer/class-actions";
import { Submit } from "@/components/form";
import { Icon } from "@/components/icons";
import { Badge, Input, Notice, Select } from "@/components/ui";

export type ClassEvent = {
  id: string; starts_at: string; ends_at: string; status: string; kind: string; group_name: string | null; note: string | null;
  requires_attendance: boolean; edited: boolean; session_id: string | null; session_status?: string | null;
  module: { code: string; title: string } | null; venue: string | null; lecturer: string | null; canChange?: boolean;
};
type Opt = { id: string; label: string };

const TZ = "Africa/Johannesburg";
const day = (iso: string) => new Date(iso).toLocaleDateString("en-ZA", { weekday: "long", day: "numeric", month: "long", timeZone: TZ });
const time = (iso: string) => new Date(iso).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", timeZone: TZ });
const ymd = (iso: string) => new Date(new Date(iso).toLocaleString("en-US", { timeZone: TZ })).toLocaleDateString("en-CA");
const KIND: Record<string, string> = { lecture: "Lecture", tutorial: "Tutorial", practical: "Practical", test: "Test", other: "Class" };

/** Upcoming dated classes, grouped by day. Lecturers get "Open attendance" and changes; students see what's on. */
export function ClassList({ events, role, venues = [], lecturers = [], now }: {
  events: ClassEvent[]; role: "lecturer" | "student"; venues?: Opt[]; lecturers?: Opt[]; now: number;
}) {
  if (!events.length) return <p className="text-sm text-muted">No classes in the next seven days.{role === "lecturer" ? " They appear here from the timetable." : ""}</p>;
  const days = [...new Set(events.map((e) => ymd(e.starts_at)))];
  return (
    <div className="space-y-5">
      {days.map((d) => (
        <section key={d}>
          <p className="mb-2 text-xs font-bold uppercase tracking-[0.12em] text-muted">{d === ymd(new Date(now).toISOString()) ? "Today" : day(`${d}T12:00:00+02:00`)}</p>
          <ul className="space-y-2">
            {events.filter((e) => ymd(e.starts_at) === d).map((e) => <ClassRow key={e.id} e={e} role={role} venues={venues} lecturers={lecturers} now={now} />)}
          </ul>
        </section>
      ))}
    </div>
  );
}

function ClassRow({ e, role, venues, lecturers, now }: { e: ClassEvent; role: "lecturer" | "student"; venues: Opt[]; lecturers: Opt[]; now: number }) {
  const cancelled = e.status === "cancelled";
  const start = Date.parse(e.starts_at), end = Date.parse(e.ends_at);
  const live = !cancelled && now >= start && now < end;
  const canOpen = role === "lecturer" && !cancelled && now >= start - 30 * 60_000 && now < end;
  const [opened, open] = useActionState(openClass, undefined);
  const [changing, setChanging] = useState(false);
  return (
    <li className={`rounded-2xl border p-3 ${live ? "border-ok/40 bg-ok/5" : "border-line bg-surface"} ${cancelled ? "opacity-75" : ""}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="w-24 shrink-0 font-mono text-sm font-semibold">{time(e.starts_at)}–{time(e.ends_at)}</span>
        <span className="min-w-0 flex-1">
          <span className={`block font-semibold ${cancelled ? "line-through" : ""}`}>{e.module?.code ?? "Module"} · {KIND[e.kind] ?? e.kind}{e.group_name ? ` · Group ${e.group_name}` : ""}</span>
          <span className="block text-xs text-muted">{e.module?.title}{e.venue ? ` · ${e.venue}` : " · No venue"}{e.lecturer ? ` · ${e.lecturer}` : ""}</span>
        </span>
        {cancelled ? <Badge status="absent">Cancelled</Badge> : live ? <Badge status="active">Now</Badge> : e.edited ? <Badge status="late">Changed</Badge> : null}
        {!cancelled && !e.requires_attendance && <Badge status="closed">No attendance</Badge>}
        {role === "lecturer" && e.session_id && (
          <Link href={`/lecturer/sessions/${e.session_id}`} className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-brand px-3 text-sm font-semibold text-brand-ink">
            <Icon name="qr" size={16} />{e.session_status === "open" ? "Continue" : "Register"}
          </Link>
        )}
        {canOpen && !e.session_id && (
          <form action={open}><input type="hidden" name="event" value={e.id} /><Submit label="Open attendance" pending="Opening…" /></form>
        )}
        {role === "lecturer" && e.canChange && !e.session_id && (
          <button type="button" onClick={() => setChanging((c) => !c)} aria-expanded={changing} className="h-9 rounded-xl border border-line px-3 text-sm font-medium hover:bg-bg">Change</button>
        )}
      </div>
      {e.note && <p className="mt-1.5 text-xs text-muted">{e.note}</p>}
      {opened?.error && <div className="mt-2"><Notice tone="bad">{opened.error}</Notice></div>}
      {changing && <ChangeForm e={e} venues={venues} lecturers={lecturers} />}
    </li>
  );
}

function ChangeForm({ e, venues, lecturers }: { e: ClassEvent; venues: Opt[]; lecturers: Opt[] }) {
  const [action, setAction] = useState(e.status === "cancelled" ? "restore" : "cancel");
  const [state, run] = useActionState(changeClass, undefined);
  return (
    <form action={run} className="mt-3 grid gap-2 border-t border-line pt-3 sm:grid-cols-2 [&>*]:min-w-0">
      <input type="hidden" name="event" value={e.id} />
      <Select name="action" value={action} onChange={(x) => setAction(x.target.value)} aria-label="Change">
        {e.status === "cancelled" ? <option value="restore">Restore the class</option> : <>
          <option value="cancel">Cancel the class</option><option value="venue">Move to another venue</option>
          <option value="time">Change the time</option><option value="substitute">Another lecturer takes it</option>
          {e.requires_attendance ? <option value="attendance_off">Don&apos;t take attendance</option> : <option value="attendance_on">Take attendance</option>}
        </>}
      </Select>
      {action === "venue" && <Select name="venue" required defaultValue="" aria-label="New venue"><option value="" disabled>Choose a venue…</option>{venues.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}</Select>}
      {action === "substitute" && <Select name="lecturer" required defaultValue="" aria-label="Lecturer"><option value="" disabled>Choose a lecturer…</option>{lecturers.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}</Select>}
      {action === "time" && (
        <div className="flex gap-2 sm:col-span-2">
          <Input name="date" type="date" required defaultValue={ymd(e.starts_at)} aria-label="Date" />
          <Input name="start" type="time" required defaultValue={time(e.starts_at)} aria-label="Starts" />
          <Input name="end" type="time" required defaultValue={time(e.ends_at)} aria-label="Ends" />
        </div>
      )}
      {["cancel", "restore", "venue", "time"].includes(action) && (
        <Input name="note" maxLength={300} placeholder="Message to students (optional)" className="sm:col-span-2" aria-label="Message to students" />
      )}
      <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
        <Submit label="Save change" pending="Saving…" />
        {["cancel", "restore", "venue", "time"].includes(action) && <span className="text-xs text-muted">Students in this class are notified.</span>}
      </div>
      {state?.error && <div className="sm:col-span-2"><Notice tone="bad">{state.error}</Notice></div>}
      {state?.ok && <div className="sm:col-span-2"><Notice tone="ok">{state.ok}</Notice></div>}
    </form>
  );
}
