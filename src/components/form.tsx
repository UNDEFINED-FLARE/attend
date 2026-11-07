"use client";
import { useActionState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Button, Notice } from "@/components/ui";

type State = { error?: string; ok?: string } | undefined;

/** A form bound to a server action that reports errors and success inline. */
export function ActionForm({
  action, children, submit, className, pending = "Working…",
}: {
  action: (s: State, f: FormData) => Promise<State>;
  children: ReactNode;
  submit: string;
  className?: string;
  pending?: string;
}) {
  const [state, run] = useActionState(action, undefined);
  return (
    <form action={run} className={className ?? "space-y-4"}>
      {children}
      {state?.error && <Notice tone="bad">{state.error}</Notice>}
      {state?.ok && <Notice tone="ok">{state.ok}</Notice>}
      <Submit label={submit} pending={pending} />
    </form>
  );
}

export function Submit({ label, pending = "Working…", variant }: { label: string; pending?: string; variant?: "primary" | "secondary" | "danger" }) {
  const { pending: busy } = useFormStatus();
  return <Button type="submit" variant={variant} disabled={busy} aria-busy={busy}>{busy ? pending : label}</Button>;
}
