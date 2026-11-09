"use client";
import { useActionState, useState, type ReactNode } from "react";
import { deleteRecord } from "@/app/admin/data-actions";
import { Icon } from "@/components/icons";

type S = { error?: string; ok?: string } | undefined;

/** Small delete button with a confirmation step and an inline result. */
export function DeleteButton({ kind, id, label, confirm: question }: { kind: string; id: string; label: string; confirm?: string }) {
  const [state, run, pending] = useActionState(deleteRecord, undefined as S);
  const [asking, setAsking] = useState(false);
  if (state?.ok) return <span className="text-xs text-ok">{state.ok}</span>;
  return (
    <span className="inline-flex flex-wrap items-center justify-end gap-1">
      {!asking ? (
        <button type="button" onClick={() => setAsking(true)} aria-label={`Delete ${label}`}
          className="grid size-8 place-items-center rounded-lg text-muted hover:bg-bad/10 hover:text-bad"><Icon name="x" size={16} /></button>
      ) : (
        <form action={run} className="inline-flex items-center gap-1">
          <input type="hidden" name="kind" value={kind} />
          <input type="hidden" name="id" value={id} />
          <span className="text-xs text-muted">{question ?? `Delete ${label}?`}</span>
          <button disabled={pending} className="h-7 rounded-lg bg-bad px-2 text-xs font-medium text-white disabled:opacity-50">{pending ? "…" : "Delete"}</button>
          <button type="button" onClick={() => setAsking(false)} className="h-7 rounded-lg border border-line px-2 text-xs">Cancel</button>
        </form>
      )}
      {state?.error && <span className="w-full text-right text-xs text-bad">{state.error}</span>}
    </span>
  );
}

/** "Edit" toggle that reveals an inline form under a row. */
export function EditToggle({ children, label = "Edit" }: { children: ReactNode; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
        className="h-8 rounded-lg px-2 text-xs font-medium text-accent hover:bg-accent/10">{open ? "Close" : label}</button>
      {open && <div className="col-span-full mt-2 w-full">{children}</div>}
    </>
  );
}
