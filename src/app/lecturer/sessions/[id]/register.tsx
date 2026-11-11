"use client";
import { useMemo, useState, useTransition } from "react";
import { Icon } from "@/components/icons";
import { LateChip } from "@/components/late";
import { finaliseSession, recordHistory, saveRegister, type HistoryItem } from "../../actions";

// The lecturer's register: search, tap a status per student, bulk actions,
// save in one go, and finalise with a confirmation. Built for phones first.

export type Base = "present" | "late" | "absent" | "excused";
export type CustomStatus = { id: string; name: string; color: string; category: Base };
export type RegisterRow = {
  student_id: string; student_number: string; full_name: string; record_id: string | null;
  status: string | null; custom_status_id: string | null; checked_in_at: string | null; method: string | null; minutes_late: number | null;
  checked_out_at?: string | null;
};
type Choice = { status: Base; custom: string | null };

const BASE: { key: Base; label: string; short: string; tone: string; on: string }[] = [
  { key: "present", label: "Present", short: "P", tone: "text-ok", on: "bg-ok text-white" },
  { key: "late", label: "Late", short: "L", tone: "text-warn", on: "bg-warn text-white" },
  { key: "absent", label: "Absent", short: "A", tone: "text-bad", on: "bg-bad text-white" },
  { key: "excused", label: "Excused", short: "E", tone: "text-info", on: "bg-info text-white" },
];
const SAVED_LABEL: Record<string, string> = {
  present: "Present", late: "Late", absent: "Absent", excused: "Excused",
  pending_verification: "In review", late_pending: "Late · awaiting you", disputed: "Disputed",
};
const METHOD: Record<string, string> = { qr: "QR", code: "Code", manual: "Manual", system: "Auto", acoustic: "Sound", card: "Card" };
const time = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" }) : "");

export function Register({ session, open, rows, statuses }: { session: string; open: boolean; rows: RegisterRow[]; statuses: CustomStatus[] }) {
  const [changes, setChanges] = useState<Map<string, Choice>>(new Map());
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "unmarked" | "changed" | Base>("all");
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [history, setHistory] = useState<{ id: string; items: HistoryItem[] | null; error?: string } | null>(null);
  const [pending, start] = useTransition();
  const customById = useMemo(() => new Map(statuses.map((s) => [s.id, s])), [statuses]);

  const current = (r: RegisterRow): Choice | null => changes.get(r.student_id)
    ?? (r.status && ["present", "late", "absent", "excused"].includes(r.status) ? { status: r.status as Base, custom: r.custom_status_id } : null);
  const set = (r: RegisterRow, c: Choice) => setChanges((m) => {
    const n = new Map(m);
    const saved = r.status === c.status && (r.custom_status_id ?? null) === c.custom;
    if (saved) n.delete(r.student_id); else n.set(r.student_id, c);
    return n;
  });
  const markUnmarked = (status: Base) => setChanges((m) => {
    const n = new Map(m);
    for (const r of rows) if (!r.status && !n.has(r.student_id)) n.set(r.student_id, { status, custom: null });
    return n;
  });

  const q = query.trim().toLowerCase();
  const shown = rows.filter((r) => {
    if (q && !`${r.student_number} ${r.full_name}`.toLowerCase().includes(q)) return false;
    const c = current(r);
    if (filter === "unmarked") return !c && !r.status;
    if (filter === "changed") return changes.has(r.student_id);
    if (filter !== "all") return c?.status === filter;
    return true;
  });
  const counts = BASE.map((b) => ({ ...b, n: rows.filter((r) => current(r)?.status === b.key).length }));
  const unmarked = rows.filter((r) => !current(r) && !r.status).length;
  const waiting = rows.filter((r) => !changes.has(r.student_id) && ["pending_verification", "late_pending", "disputed"].includes(r.status ?? "")).length;

  function save() {
    setMsg(null);
    const entries = [...changes.entries()].map(([student, c]) => ({ student, status: c.status, custom: c.custom }));
    start(async () => {
      const r = await saveRegister(session, entries, note);
      if (r.error) setMsg({ tone: "bad", text: r.error });
      else { setMsg({ tone: "ok", text: r.ok! }); setChanges(new Map()); setNote(""); }
    });
  }
  function finalise() {
    start(async () => {
      if (changes.size) {
        const s = await saveRegister(session, [...changes.entries()].map(([student, c]) => ({ student, status: c.status, custom: c.custom })), note);
        if (s.error) { setMsg({ tone: "bad", text: s.error }); setConfirm(false); return; }
        setChanges(new Map());
      }
      const r = await finaliseSession(session);
      setConfirm(false);
      setMsg(r.error ? { tone: "bad", text: r.error } : { tone: "ok", text: r.ok! });
    });
  }
  async function showHistory(id: string) {
    if (history?.id === id) { setHistory(null); return; }
    setHistory({ id, items: null });
    const r = await recordHistory(id);
    setHistory("error" in r ? { id, items: [], error: r.error } : { id, items: r });
  }

  return (
    <section className="rounded-[28px] bg-surface shadow-card">
      {/* Summary + tools */}
      <div className="space-y-3 border-b border-line p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-bold">Register <span className="font-normal text-muted">· {rows.length} students</span></h2>
          <div className="flex flex-wrap gap-1.5 text-xs font-semibold">
            {counts.map((c) => <span key={c.key} className={`rounded-full bg-bg px-2.5 py-1 ${c.tone}`}>{c.n} {c.label.toLowerCase()}</span>)}
            <span className="rounded-full bg-bg px-2.5 py-1 text-muted">{unmarked} not marked</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <label className="relative min-w-48 flex-1">
            <Icon name="users" size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name or student number"
              className="h-11 w-full rounded-2xl border border-line bg-bg pl-9 pr-3 text-sm" aria-label="Search students" />
          </label>
          <select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} className="h-11 rounded-2xl border border-line bg-bg px-3 text-sm" aria-label="Show">
            <option value="all">Everyone</option><option value="unmarked">Not marked</option><option value="changed">Unsaved changes</option>
            {BASE.map((b) => <option key={b.key} value={b.key}>{b.label}</option>)}
          </select>
        </div>
        <div className="flex flex-wrap gap-2 text-sm">
          <button type="button" onClick={() => markUnmarked("present")} disabled={!unmarked} className="h-10 rounded-xl bg-ok/10 px-3 font-semibold text-ok disabled:opacity-40">Mark all not-marked present</button>
          <button type="button" onClick={() => markUnmarked("absent")} disabled={!unmarked} className="h-10 rounded-xl bg-bad/10 px-3 font-semibold text-bad disabled:opacity-40">…absent</button>
          <button type="button" onClick={() => { setChanges(new Map()); setMsg(null); }} disabled={!changes.size} className="h-10 rounded-xl bg-bg px-3 font-semibold disabled:opacity-40">Reset changes</button>
        </div>
        {waiting > 0 && <p className="text-xs text-muted">{waiting} check-in{waiting > 1 ? "s are" : " is"} awaiting your decision. Pick a status to settle {waiting > 1 ? "them" : "it"}.</p>}
      </div>

      {/* Students */}
      <ul className="divide-y divide-line">
        {shown.length === 0 && <li className="p-8 text-center text-sm text-muted">No students match.</li>}
        {shown.map((r) => {
          const c = current(r), changed = changes.has(r.student_id);
          const custom = c?.custom ? customById.get(c.custom) : null;
          return (
            <li key={r.student_id} className={`p-3 sm:px-5 ${changed ? "bg-accent/5" : ""}`}>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <div className="min-w-0 flex-1 basis-48">
                  <p className="truncate font-semibold">{r.full_name}</p>
                  <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted">
                    <span className="font-mono">{r.student_number}</span>
                    {r.checked_in_at && <span>{time(r.checked_in_at)}{r.checked_out_at ? `–${time(r.checked_out_at)}` : ""}{r.method ? ` · ${METHOD[r.method] ?? r.method}` : ""}</span>}
                    {r.status && !changed && <span className="font-semibold">{SAVED_LABEL[r.status] ?? r.status}{r.custom_status_id && customById.get(r.custom_status_id) ? ` · ${customById.get(r.custom_status_id)!.name}` : ""}</span>}
                    {changed && <span className="font-semibold text-accent">unsaved</span>}
                    <LateChip minutes={r.minutes_late} />
                  </p>
                </div>
                <div className="flex items-center gap-1.5" role="radiogroup" aria-label={`Status for ${r.full_name}`}>
                  {BASE.map((b) => {
                    const on = c?.status === b.key && !c.custom;
                    return (
                      <button key={b.key} type="button" role="radio" aria-checked={on} title={b.label}
                        onClick={() => set(r, { status: b.key, custom: null })}
                        className={`size-11 rounded-xl text-sm font-bold transition active:scale-95 ${on ? b.on : `bg-bg ${b.tone}`}`}>{b.short}</button>
                    );
                  })}
                  {statuses.length > 0 && (
                    <select value={custom?.id ?? ""} onChange={(e) => { const s = customById.get(e.target.value); if (s) set(r, { status: s.category, custom: s.id }); }}
                      className="h-11 max-w-28 rounded-xl border-2 bg-bg px-2 text-xs font-semibold" style={custom ? { borderColor: custom.color, color: custom.color } : { borderColor: "transparent" }}
                      aria-label="Other status">
                      <option value="">More…</option>
                      {statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  )}
                  {r.record_id && (
                    <button type="button" onClick={() => showHistory(r.record_id!)} aria-label="History" aria-expanded={history?.id === r.record_id}
                      className="grid size-11 place-items-center rounded-xl text-muted hover:bg-bg"><Icon name="history" size={18} /></button>
                  )}
                </div>
              </div>
              {history?.id === r.record_id && (
                <ol className="mt-3 space-y-2 rounded-2xl bg-bg p-3 text-xs">
                  {history.items === null && <li className="text-muted">Loading…</li>}
                  {history.error && <li className="text-bad">{history.error}</li>}
                  {history.items?.length === 0 && !history.error && <li className="text-muted">No history yet.</li>}
                  {history.items?.map((h, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="w-24 shrink-0 tabular-nums text-muted">{new Date(h.at).toLocaleString("en-ZA", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                      <span><b className="font-semibold">{h.summary}</b>{h.by_name ? ` · ${h.by_name}` : ""}{h.note ? <span className="block text-muted">{h.note}</span> : null}</span>
                    </li>
                  ))}
                </ol>
              )}
            </li>
          );
        })}
      </ul>

      {/* Save / finalise */}
      <div className="sticky bottom-24 z-10 space-y-2 rounded-b-[28px] border-t border-line bg-surface/95 p-4 backdrop-blur lg:bottom-0 sm:px-5">
        {msg && <p role="status" className={`text-sm font-medium ${msg.tone === "ok" ? "text-ok" : "text-bad"}`}>{msg.text}</p>}
        {!open && changes.size > 0 && (
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reason for the changes (required after closing)" maxLength={300}
            className="h-11 w-full rounded-2xl border border-line bg-bg px-3 text-sm" />
        )}
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={save} disabled={pending || !changes.size || (!open && note.trim().length < 3)}
            className="h-12 flex-1 rounded-2xl bg-accent px-5 font-semibold text-white disabled:opacity-40">
            {pending ? "Saving…" : changes.size ? `Save ${changes.size} change${changes.size > 1 ? "s" : ""}` : "No changes"}
          </button>
          {open && (
            <button type="button" onClick={() => setConfirm(true)} disabled={pending} className="h-12 rounded-2xl bg-ink px-5 font-semibold text-surface disabled:opacity-40">
              Finalise
            </button>
          )}
        </div>
      </div>

      {confirm && (
        <div role="dialog" aria-modal="true" aria-labelledby="fin-title" className="fixed inset-0 z-50 grid place-items-end bg-black/40 p-4 sm:place-items-center" onClick={() => !pending && setConfirm(false)}>
          <div className="w-full max-w-md rounded-[28px] bg-surface p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 id="fin-title" className="text-lg font-bold">Finalise this session?</h3>
            <p className="mt-2 text-sm text-muted">Check-ins close. {changes.size ? `Your ${changes.size} unsaved change${changes.size > 1 ? "s are" : " is"} saved first. ` : ""}
              <b className="text-ink">{unmarked} student{unmarked === 1 ? "" : "s"} not marked</b> will be recorded as absent, and late arrivals you haven&apos;t denied count as attended.
              You can still correct records afterwards, with a reason.</p>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setConfirm(false)} disabled={pending} className="h-12 rounded-2xl bg-bg font-semibold">Cancel</button>
              <button type="button" onClick={finalise} disabled={pending} className="h-12 rounded-2xl bg-ink font-semibold text-surface">{pending ? "Finalising…" : "Finalise"}</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
