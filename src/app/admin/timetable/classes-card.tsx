"use client";
import { useTransition, useState } from "react";
import { ActionForm } from "@/components/form";
import { Card, CardTitle, Notice } from "@/components/ui";
import { prepareClasses, saveAttendanceKinds } from "./class-actions";

const KINDS: [string, string][] = [["lecture", "Lectures"], ["tutorial", "Tutorials"], ["practical", "Practicals"], ["test", "Tests"], ["other", "Other"]];

/** Dated classes from the weekly timetable, and which kinds take attendance. */
export function ClassesCard({ kinds, upcoming, cancelled }: { kinds: string[] | null; upcoming: number | null; cancelled: number | null }) {
  const [msg, setMsg] = useState<{ error?: string; ok?: string } | undefined>();
  const [busy, start] = useTransition();
  return (
    <Card className="mb-6">
      <CardTitle>Classes and attendance</CardTitle>
      {kinds === null ? <Notice tone="warn">Classes from the timetable need the latest database update (migration 0027).</Notice> : (
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-3 text-sm">
            <p className="text-muted">Every night UniAttend turns the weekly timetable into dated classes for the next two weeks. Lecturers then press
              <b className="text-ink"> Open attendance</b> on a class, and can cancel it, move it or hand it to a substitute; students are told.</p>
            <p><b>{upcoming ?? 0}</b> classes in the next two weeks{cancelled ? <>, <b>{cancelled}</b> cancelled</> : null}.</p>
            <button type="button" disabled={busy} onClick={() => start(async () => setMsg(await prepareClasses()))}
              className="h-10 rounded-xl border border-line px-4 font-medium hover:bg-bg disabled:opacity-60">{busy ? "Preparing…" : "Prepare the next two weeks now"}</button>
            {msg?.error && <Notice tone="bad">{msg.error}</Notice>}
            {msg?.ok && <Notice tone="ok">{msg.ok}</Notice>}
          </div>
          <ActionForm action={saveAttendanceKinds} submit="Save" className="space-y-3 text-sm">
            <p className="font-medium">Which classes take attendance?</p>
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {KINDS.map(([k, l]) => (
                <label key={k} className="flex items-center gap-2"><input type="checkbox" name={k} defaultChecked={kinds.includes(k)} className="size-4" />{l}</label>
              ))}
            </div>
            <p className="text-xs text-muted">Applies to future classes nobody changed by hand. A lecturer can still take attendance at any class.</p>
          </ActionForm>
        </div>
      )}
    </Card>
  );
}
