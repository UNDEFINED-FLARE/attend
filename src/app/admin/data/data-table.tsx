"use client";
import { useActionState, useEffect, useState } from "react";
import { bulkData, updateModule, updatePerson, updateVenue } from "@/app/admin/data-actions";
import { ActionForm } from "@/components/form";
import { Field, Input, Notice } from "@/components/ui";
import type { Column, DataKind, DataRow } from "@/lib/data-manager";

type S = { error?: string; ok?: string } | undefined;

/** The Data page table: tick rows for bulk actions, or edit one row inline. */
export function DataTable({ kind, archived, columns, rows, singular }: { kind: DataKind; archived: boolean; columns: Column[]; rows: DataRow[]; singular: string }) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const [state, run] = useActionState(bulkData, undefined as S);
  const [confirm, setConfirm] = useState(false);
  // Clear the selection when the rows shown change (new page, search or after an action).
  const rowKey = rows.map((r) => r.id).join();
  useEffect(() => { setPicked(new Set()); setConfirm(false); }, [rowKey]);
  const all = rows.length > 0 && rows.every((r) => picked.has(r.id));
  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const people = kind === "students" || kind === "lecturers";

  return (
    <div className="space-y-3">
      <form action={run} className={`flex flex-wrap items-center gap-2 rounded-xl p-2 text-sm ${picked.size ? "bg-bg" : "hidden"}`}>
        <input type="hidden" name="kind" value={kind} />
        {[...picked].map((id) => <input key={id} type="hidden" name="id" value={id} />)}
        <span className="mr-1 font-semibold">{picked.size} selected</span>
        {archived ? (
          <button name="op" value="restore" className="h-9 rounded-lg bg-brand px-3 font-semibold text-brand-ink">Restore</button>
        ) : (
          <>
            {people && (
              <span className="flex items-center gap-1">
                <select name="status" defaultValue="" className="h-9 rounded-lg border border-line bg-surface px-2">
                  <option value="" disabled>Set status…</option>
                  {(kind === "students" ? ["active", "suspended", "graduated", "withdrawn"] : ["active", "suspended", "left"]).map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                <button name="op" value="status" className="h-9 rounded-lg border border-line bg-surface px-3 font-medium">Apply</button>
              </span>
            )}
            {!confirm
              ? <button type="button" onClick={() => setConfirm(true)} className="h-9 rounded-lg border border-bad/40 px-3 font-medium text-bad">Delete…</button>
              : <span className="flex items-center gap-1">
                  <span className="text-xs text-muted">Records with attendance history are archived, not erased.</span>
                  <button name="op" value="delete" className="h-9 rounded-lg bg-bad px-3 font-semibold text-white">Delete {picked.size}</button>
                  <button type="button" onClick={() => setConfirm(false)} className="h-9 rounded-lg border border-line px-3">Cancel</button>
                </span>}
          </>
        )}
        <button type="button" onClick={() => setPicked(new Set())} className="ml-auto text-xs font-medium text-muted">Clear</button>
      </form>
      {state?.error && <Notice tone="bad">{state.error}</Notice>}
      {state?.ok && <Notice tone="ok">{state.ok}</Notice>}

      <div className="-mx-5 overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
              <th className="w-10 px-5 py-2"><input type="checkbox" aria-label="Select all on this page" checked={all}
                onChange={(e) => setPicked(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())} className="size-4" /></th>
              {columns.map((c) => <th key={c.key} className="px-2 py-2 font-medium">{c.label}</th>)}
              {kind !== "timetable" && !archived && <th className="px-5 py-2" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.length === 0 && <tr><td colSpan={columns.length + 2} className="px-5 py-10 text-center text-muted">Nothing here.</td></tr>}
            {rows.map((r) => (
              <FragmentRow key={r.id} r={r} kind={kind} columns={columns} archived={archived} picked={picked.has(r.id)} onPick={() => toggle(r.id)}
                editing={editing === r.id} onEdit={() => setEditing(editing === r.id ? null : r.id)} singular={singular} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FragmentRow({ r, kind, columns, archived, picked, onPick, editing, onEdit, singular }: {
  r: DataRow; kind: DataKind; columns: Column[]; archived: boolean; picked: boolean; onPick: () => void; editing: boolean; onEdit: () => void; singular: string;
}) {
  return (
    <>
      <tr className={picked ? "bg-bg" : ""}>
        <td className="px-5 py-2"><input type="checkbox" checked={picked} onChange={onPick} aria-label={`Select ${singular}`} className="size-4" /></td>
        {columns.map((c) => <td key={c.key} className={`px-2 py-2 ${c.mono ? "font-mono text-xs" : ""}`}>{r.cells[c.key] === "" || r.cells[c.key] == null ? <span className="text-muted">—</span> : String(r.cells[c.key])}</td>)}
        {kind !== "timetable" && !archived && (
          <td className="px-5 py-2 text-right"><button type="button" onClick={onEdit} className="text-xs font-semibold text-accent">{editing ? "Close" : "Edit"}</button></td>
        )}
      </tr>
      {editing && (
        <tr><td colSpan={columns.length + 2} className="bg-bg px-5 py-3"><EditForm kind={kind} r={r} /></td></tr>
      )}
    </>
  );
}

function EditForm({ kind, r }: { kind: DataKind; r: DataRow }) {
  const c = r.cells as Record<string, string>;
  if (kind === "students" || kind === "lecturers") {
    return (
      <ActionForm action={updatePerson} submit="Save" className="grid gap-2 sm:grid-cols-4 [&>[role]]:sm:col-span-4">
        <input type="hidden" name="kind" value={kind === "students" ? "student" : "lecturer"} /><input type="hidden" name="id" value={r.id} />
        <Field label={kind === "students" ? "Student no." : "Staff no."}><Input name="number" defaultValue={c.student_number ?? c.staff_number} required /></Field>
        <Field label="Name"><Input name="full_name" defaultValue={c.full_name} required /></Field>
        <Field label="Email"><Input name="email" type="email" defaultValue={c.email} /></Field>
      </ActionForm>
    );
  }
  if (kind === "modules") {
    return (
      <ActionForm action={updateModule} submit="Save" className="grid gap-2 sm:grid-cols-4 [&>[role]]:sm:col-span-4">
        <input type="hidden" name="id" value={r.id} />
        <Field label="Code"><Input name="code" defaultValue={c.code} required /></Field>
        <Field label="Title"><Input name="title" defaultValue={c.title} required /></Field>
        <Field label="Required %"><Input name="min_attendance_pct" type="number" min={0} max={100} defaultValue={c.min_attendance_pct === "default" ? "" : c.min_attendance_pct} /></Field>
        <p className="self-end pb-2 text-xs text-muted">Department and class size: on the Modules page.</p>
      </ActionForm>
    );
  }
  return (
    <ActionForm action={updateVenue} submit="Save" className="grid gap-2 sm:grid-cols-4 [&>[role]]:sm:col-span-4">
      <input type="hidden" name="id" value={r.id} />
      <Field label="Name"><Input name="name" defaultValue={c.name} required /></Field>
      <Field label="Code"><Input name="code" defaultValue={c.code} /></Field>
      <Field label="Building"><Input name="building" defaultValue={c.building} /></Field>
      <Field label="Capacity"><Input name="capacity" type="number" min={1} defaultValue={c.capacity} /></Field>
    </ActionForm>
  );
}

