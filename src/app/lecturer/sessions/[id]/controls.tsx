"use client";
import Link from "next/link";
import { useActionState } from "react";
import { Submit } from "@/components/form";
import { Icon } from "@/components/icons";
import { sessionControl } from "../../actions";

type State = { error?: string; ok?: string } | undefined;

/** Pause or resume, regenerate, change the window, allow a printed QR, and the card scanner. */
export function SessionControls({ session, status, requireGps, printed, closesAt, lateAfter }: {
  session: string; status: string; requireGps: boolean; printed: boolean; closesAt: string; lateAfter: string;
}) {
  const [state, run] = useActionState<State, FormData>(sessionControl, undefined);
  const paused = status === "scheduled";
  const t = (iso: string) => new Date(iso).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" });
  const Action = ({ action, label, variant }: { action: string; label: string; variant?: "secondary" | "danger" }) => (
    <form action={run}><input type="hidden" name="session" value={session} /><input type="hidden" name="action" value={action} />
      <Submit label={label} pending="…" variant={variant} /></form>
  );

  return (
    <section className="space-y-4 rounded-[28px] bg-surface p-5 shadow-card">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-bold">Check-in controls</h2>
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${paused ? "bg-warn/15 text-warn" : "bg-ok/15 text-ok"}`}>{paused ? "Paused" : "Open"}</span>
      </div>

      <div className="flex flex-wrap gap-2">
        {paused ? <Action action="resume" label="Resume check-in" /> : <Action action="pause" label="Pause" variant="secondary" />}
        <Action action="regenerate" label="New QR & code" variant="secondary" />
      </div>

      <form action={run} className="grid grid-cols-2 gap-2 text-sm">
        <input type="hidden" name="session" value={session} /><input type="hidden" name="action" value="window" />
        <label className="space-y-1"><span className="block text-xs text-muted">Closes {t(closesAt)} · close in (min)</span>
          <input name="closes" type="number" min={1} max={480} placeholder="e.g. 20" className="h-10 w-full rounded-xl border border-line bg-bg px-3" /></label>
        <label className="space-y-1"><span className="block text-xs text-muted">Late after {t(lateAfter)} · late in (min)</span>
          <input name="late" type="number" min={0} max={480} placeholder="e.g. 5" className="h-10 w-full rounded-xl border border-line bg-bg px-3" /></label>
        <div className="col-span-2"><Submit label="Update times" pending="Saving…" variant="secondary" /></div>
      </form>

      <div className="rounded-2xl bg-bg p-3 text-sm">
        <p className="font-semibold">Printed QR</p>
        <p className="mt-0.5 text-xs text-muted">
          A fixed code to print or show without a laptop. Anyone can photograph it, so it only counts together with the location check.
          &ldquo;New QR &amp; code&rdquo; cancels it.
        </p>
        {!requireGps ? <p className="mt-2 text-xs font-medium text-warn">Not available: this session&apos;s venue isn&apos;t on the map, so location can&apos;t be checked.</p> : (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {printed ? <Action action="printed_off" label="Switch off" variant="secondary" /> : <Action action="printed_on" label="Allow printed QR" variant="secondary" />}
            {printed && <Link href={`/lecturer/sessions/${session}/print`} target="_blank" className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-accent px-3 font-semibold text-white"><Icon name="download" size={16} />Print / download</Link>}
          </div>
        )}
      </div>

      <Link href={`/lecturer/sessions/${session}/scan`} className="flex items-center gap-3 rounded-2xl border border-line p-3 hover:bg-bg">
        <span className="grid size-10 place-items-center rounded-xl bg-accent/10 text-accent"><Icon name="scan" size={20} /></span>
        <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">Scan student cards</span>
          <span className="block text-xs text-muted">Phone camera, webcam or USB scanner · check in and out</span></span>
        <Icon name="arrowRight" size={16} className="text-muted" />
      </Link>

      {state?.error && <p role="alert" className="text-sm text-bad">{state.error}</p>}
      {state?.ok && <p role="status" className="text-sm text-ok">{state.ok}</p>}
    </section>
  );
}
