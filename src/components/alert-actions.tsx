"use client";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { updateAlert } from "@/app/early-warning-actions";
import { Notice } from "@/components/ui";
import type { AlertStatus } from "@/lib/early-warning";

const BTN = "inline-flex h-9 items-center rounded-lg border border-line px-3 text-sm font-medium hover:bg-black/5 disabled:opacity-50";

function Act({ action, children, primary }: { action: string; children: string; primary?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" name="action" value={action} disabled={pending}
      className={primary ? `${BTN} border-transparent bg-brand text-brand-ink hover:bg-brand hover:opacity-90` : BTN}>
      {children}
    </button>
  );
}

/** Follow-up buttons for one alert. The note is used by "Add note" and required by "Dismiss". */
export function AlertActions({ id, status, assignedToMe }: { id: string; status: AlertStatus; assignedToMe: boolean }) {
  const [state, run] = useActionState(updateAlert, undefined);
  const live = status === "open" || status === "contacted";
  return (
    <form action={run} className="space-y-2">
      <input type="hidden" name="alert" value={id} />
      {live && (
        <textarea name="note" rows={2} maxLength={2000} aria-label="Note"
          placeholder="What happened? (needed to dismiss, optional otherwise)"
          className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm" />
      )}
      <div className="flex flex-wrap gap-2">
        {status === "open" && <Act action="contacted" primary>Mark contacted</Act>}
        {live && <Act action="resolved" primary={status === "contacted"}>Resolve</Act>}
        {live && <Act action="note">Add note</Act>}
        {live && (assignedToMe ? <Act action="unassign">Unassign me</Act> : <Act action="assign_me">Assign to me</Act>)}
        {live && <Act action="dismissed">Dismiss</Act>}
        {!live && <Act action="reopened">Reopen</Act>}
      </div>
      {state?.error && <Notice tone="bad">{state.error}</Notice>}
      {state?.ok && <Notice tone="ok">{state.ok}</Notice>}
    </form>
  );
}
