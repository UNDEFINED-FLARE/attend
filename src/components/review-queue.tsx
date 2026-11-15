"use client";
import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { decideReview } from "@/app/lecturer/review-actions";
import { Badge, Input, Notice } from "@/components/ui";
import type { Decision, MissingRegister, ReviewItem } from "@/lib/review";

const TZ = "Africa/Johannesburg";
const at = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-ZA", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: TZ }) : "—");
const hm = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", timeZone: TZ }) : "—");

/** Why a check-in is waiting for a person, in plain words. */
export const KIND: Record<string, string> = {
  outside_venue: "Outside the venue",
  weak_location: "Imprecise location",
  no_location: "No location shared",
  device_reused: "Device used by another student",
  typed_code: "Typed code, not the live QR",
  offline: "Checked in without signal",
  refused_attempt: "Tried, but was refused",
  late: "Late arrival",
  low_score: "Weak evidence",
};

const DECISIONS = [
  { status: "present", label: "Present", tone: "bg-ok text-white" },
  { status: "late", label: "Late", tone: "bg-warn text-white" },
  { status: "absent", label: "Absent", tone: "bg-bad text-white" },
  { status: "excused", label: "Excused", tone: "bg-info text-white" },
] as const;

/** Check-ins waiting for a person: pick one or many, see the evidence, decide. */
/** `sessionBase`: where a class's register lives (lecturers), or nothing when the viewer has no register page. */
export function ReviewQueue({ items, sessionBase }: { items: ReviewItem[]; sessionBase?: string }) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [kind, setKind] = useState<string>("all");
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<{ error?: string; ok?: string }>();
  const [busy, start] = useTransition();

  const kinds = useMemo(() => [...new Set(items.map((i) => i.kind))], [items]);
  const shown = kind === "all" ? items : items.filter((i) => i.kind === kind);
  const sessions = [...new Set(shown.map((i) => i.session_id))];
  const toggle = (ids: string[], on: boolean) => setPicked((p) => { const n = new Set(p); ids.forEach((x) => (on ? n.add(x) : n.delete(x))); return n; });

  const decide = (status: string) => start(async () => {
    const r = await decideReview([...picked], status, note);
    setMsg(r);
    if (r.ok) { setPicked(new Set()); setNote(""); }
  });

  if (!items.length) return <p className="text-sm text-muted">Nothing is waiting for review. Check-ins with weak evidence, refused attempts and late arrivals appear here.</p>;

  return (
    <div>
      {kinds.length > 1 && (
        <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Show">
          {["all", ...kinds].map((k) => (
            <button key={k} type="button" onClick={() => setKind(k)} aria-pressed={kind === k}
              className={`h-8 rounded-full border px-3 text-xs font-medium ${kind === k ? "border-ink bg-ink text-surface" : "border-line hover:bg-bg"}`}>
              {k === "all" ? `All (${items.length})` : `${KIND[k] ?? k} (${items.filter((i) => i.kind === k).length})`}
            </button>
          ))}
        </div>
      )}

      <div className="space-y-5">
        {sessions.map((sid) => {
          const rows = shown.filter((i) => i.session_id === sid);
          const s = rows[0];
          const all = rows.every((r) => picked.has(r.record_id));
          return (
            <section key={sid} className="rounded-2xl border border-line">
              <header className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-2.5">
                <input type="checkbox" className="size-4" checked={all} aria-label={`Choose all from ${s.module_code} ${s.session_title}`}
                  onChange={(e) => toggle(rows.map((r) => r.record_id), e.target.checked)} />
                <span className="min-w-0 flex-1 text-sm">
                  <b>{s.module_code}</b> · {s.session_title} · {at(s.opens_at)}
                  {s.session_status === "open" && <span className="ml-2 text-xs text-ok">still open</span>}
                </span>
                {sessionBase && <Link href={`${sessionBase}/${sid}`} className="text-xs text-info hover:underline">Register →</Link>}
              </header>
              <ul className="divide-y divide-line">
                {rows.map((r) => <Row key={r.record_id} r={r} on={picked.has(r.record_id)} toggle={(on) => toggle([r.record_id], on)} />)}
              </ul>
            </section>
          );
        })}
      </div>

      <div className="sticky bottom-0 z-10 -mx-5 mt-5 border-t border-line bg-surface/95 px-5 py-3 backdrop-blur">
        {msg?.error && <div className="mb-2"><Notice tone="bad">{msg.error}</Notice></div>}
        {msg?.ok && <div className="mb-2"><Notice tone="ok">{msg.ok}</Notice></div>}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{picked.size ? `${picked.size} chosen` : "Choose check-ins to decide"}</span>
          <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="Reason (needed for absent or excused)"
            aria-label="Reason" className="h-10 min-w-48 flex-1" />
          {DECISIONS.map((d) => (
            <button key={d.status} type="button" disabled={busy || !picked.size} onClick={() => decide(d.status)}
              className={`h-10 rounded-xl px-4 text-sm font-semibold disabled:opacity-40 ${d.tone}`}>{busy ? "…" : d.label}</button>
          ))}
        </div>
      </div>
    </div>
  );
}

function Row({ r, on, toggle }: { r: ReviewItem; on: boolean; toggle: (on: boolean) => void }) {
  const e = r.evidence;
  const chips: string[] = [];
  if (r.checked_in_at) chips.push(`Checked in ${hm(r.checked_in_at)}`);
  if (r.score != null) chips.push(`Score ${r.score}/100`);
  if (r.minutes_late) chips.push(`${r.minutes_late} min late`);
  if (e.location_required && e.outside_by_m != null) chips.push(Number(e.outside_by_m) > 0 ? `${e.outside_by_m} m outside` : "Inside the venue");
  if (e.accuracy_m != null) chips.push(`GPS ±${e.accuracy_m} m`);
  if (e.device_points === 0) chips.push("Device shared this class");
  if (r.method === "code") chips.push("Typed code");
  if (r.method === "offline") chips.push("Sent later (offline)");
  chips.push(`${e.attempts} attempt${e.attempts === 1 ? "" : "s"}${e.refused_attempts ? `, ${e.refused_attempts} refused` : ""}`);
  return (
    <li className={`flex gap-3 px-4 py-3 ${on ? "bg-brand/5" : ""}`}>
      <input type="checkbox" className="mt-1 size-4 shrink-0" checked={on} onChange={(x) => toggle(x.target.checked)} aria-label={`Choose ${r.full_name}`} />
      <div className="min-w-0 flex-1 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <b className="font-mono">{r.student_number}</b> <span>{r.full_name}</span>
          <Badge status={r.status === "late_pending" ? "late_pending" : "pending_verification"}>{KIND[r.kind] ?? r.kind}</Badge>
        </div>
        {r.reasons?.length > 0 && <p className="mt-1 text-muted">{r.reasons.join(" ")}</p>}
        <p className="mt-1 flex flex-wrap gap-1.5">
          {chips.map((c) => <span key={c} className="rounded-md bg-bg px-2 py-0.5 text-xs text-muted">{c}</span>)}
        </p>
      </div>
    </li>
  );
}

/** The last 30 days of decisions: who decided what, and why. */
export function DecisionLog({ items }: { items: Decision[] }) {
  if (!items.length) return <p className="text-sm text-muted">No decisions in the last 30 days.</p>;
  return (
    <ul className="divide-y divide-line text-sm">
      {items.map((d) => (
        <li key={d.decision_id} className="flex flex-wrap items-start justify-between gap-2 py-2.5">
          <div className="min-w-0">
            <p><b className="font-mono">{d.student_number}</b> {d.full_name} · {d.module_code} · {at(d.opens_at)}</p>
            <p className="text-xs text-muted">{d.note}</p>
          </div>
          <div className="text-right text-xs text-muted">
            <Badge status={d.decision} /> <span className="ml-1">by {d.decided_by}</span>
            <p>{at(d.decided_at)}{d.status_now !== d.decision ? ` · now ${d.status_now.replace("_", " ")}` : ""}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Timetable classes that ended without anyone taking attendance. */
export function MissingRegisters({ items }: { items: MissingRegister[] }) {
  if (!items.length) return <p className="text-sm text-muted">Every class that needed attendance in the last two weeks has a register.</p>;
  return (
    <ul className="divide-y divide-line text-sm">
      {items.map((m) => (
        <li key={m.event_id} className="flex flex-wrap justify-between gap-2 py-2.5">
          <span><b>{m.module_code}</b> · {at(m.starts_at)}–{hm(m.ends_at)}{m.group_name ? ` · Group ${m.group_name}` : ""}</span>
          <span className="text-xs text-muted">{m.venue ?? "No venue"}{m.lecturer ? ` · ${m.lecturer}` : ""}</span>
        </li>
      ))}
    </ul>
  );
}
