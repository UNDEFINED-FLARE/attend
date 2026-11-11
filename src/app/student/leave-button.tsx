"use client";
import { useState, useTransition } from "react";
import { checkOut } from "./actions";

/** "I'm leaving": records the student's check-out time. */
export function LeaveButton({ session }: { session: string }) {
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [ask, setAsk] = useState(false);
  if (msg) return <span className="max-w-32 text-right text-xs font-semibold text-ok">{msg}</span>;
  return ask ? (
    <span className="flex flex-col items-end gap-1">
      <button type="button" disabled={pending} onClick={() => start(async () => { const r = await checkOut(session); setMsg(r.error ?? r.ok ?? null); })}
        className="h-10 rounded-xl bg-ink px-3 text-sm font-semibold text-surface disabled:opacity-50">{pending ? "…" : "Yes, check out"}</button>
      <button type="button" onClick={() => setAsk(false)} className="text-[11px] font-medium text-muted">Cancel</button>
    </span>
  ) : (
    <button type="button" onClick={() => setAsk(true)} className="h-10 shrink-0 rounded-xl bg-bg px-3 text-sm font-semibold">I&apos;m leaving</button>
  );
}
