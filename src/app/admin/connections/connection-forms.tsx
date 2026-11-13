"use client";
import { useActionState, useState } from "react";
import { Submit } from "@/components/form";
import { Field, Input, Notice, Select } from "@/components/ui";
import { connectionAction, saveConnection, testConnection } from "./actions";

type S = { error?: string; ok?: string; key?: string } | undefined;
type Kind = "moodle" | "feed" | "api";
export type ConnectionRow = { id: string; kind: Kind; name: string; base_url: string | null; schedule: string; options: Record<string, unknown> };

function Result({ s }: { s: S }) {
  if (!s) return null;
  return (
    <>
      {s.error && <Notice tone="bad">{s.error}</Notice>}
      {s.ok && <Notice tone="ok">{s.ok}</Notice>}
      {s.key && (
        <div className="rounded-xl border border-line bg-bg p-3">
          <p className="text-xs font-medium text-muted">API key (shown once)</p>
          <p className="mt-1 select-all break-all font-mono text-sm">{s.key}</p>
          <button type="button" className="mt-2 text-xs font-semibold text-accent" onClick={() => void navigator.clipboard?.writeText(s.key!)}>Copy</button>
        </div>
      )}
    </>
  );
}

function Check({ name, label, hint, on }: { name: string; label: string; hint: string; on: boolean }) {
  return (
    <label className="flex items-start gap-2 text-sm">
      <input type="checkbox" name={name} defaultChecked={on} className="mt-0.5 size-4" />
      <span><span className="font-medium">{label}</span><span className="block text-xs text-muted">{hint}</span></span>
    </label>
  );
}

/** Add a connection, or edit one (the token is never shown again; leave it empty to keep it). */
export function ConnectionForm({ existing }: { existing?: ConnectionRow }) {
  const [kind, setKind] = useState<Kind>(existing?.kind ?? "moodle");
  const [state, run] = useActionState(saveConnection, undefined as S);
  const o = existing?.options ?? {};
  const opt = (k: string, fallback: boolean) => (typeof o[k] === "boolean" ? (o[k] as boolean) : fallback);
  return (
    <form action={run} className="space-y-4">
      {existing && <input type="hidden" name="id" value={existing.id} />}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Where does the data come from?">
          {existing ? <><input type="hidden" name="kind" value={kind} /><Input value={{ moodle: "Moodle", feed: "Roster link", api: "Our system sends it (API)" }[kind]} readOnly /></> : (
            <Select name="kind" value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
              <option value="moodle">Moodle</option>
              <option value="feed">A roster link (CSV or JSON)</option>
              <option value="api">Our system sends it (API)</option>
            </Select>
          )}
        </Field>
        <Field label="Name"><Input name="name" required maxLength={80} defaultValue={existing?.name} placeholder={{ moodle: "Campus Moodle", feed: "ITS nightly export", api: "Student system" }[kind]} /></Field>
      </div>

      {kind === "moodle" && (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Moodle address" hint="The address people use to open Moodle."><Input name="base_url" type="url" required defaultValue={existing?.base_url ?? ""} placeholder="https://moodle.example.ac.za" /></Field>
            <Field label="Web-service token" hint={existing ? "Leave empty to keep the current token." : "From Moodle: Site administration → Server → Web services → Manage tokens."}>
              <Input name="token" type="password" autoComplete="off" required={!existing} placeholder={existing ? "••••••••" : ""} />
            </Field>
            <Field label="Student number is Moodle's">
              <Select name="student_number_from" defaultValue={(o.student_number_from as string) ?? "idnumber"}>
                <option value="idnumber">ID number field</option><option value="username">Username</option><option value="email">Email, before the @</option>
              </Select>
            </Field>
            <Field label="Module code is the course's">
              <Select name="course_code_from" defaultValue={(o.course_code_from as string) ?? "shortname"}>
                <option value="shortname">Short name</option><option value="idnumber">ID number</option>
              </Select>
            </Field>
          </div>
          <Check name="trim_course_code" on={opt("trim_course_code", true)} label="Read “CSC1541_2026_S1” as CSC1541" hint="Uses the module code at the start of the course name." />
        </>
      )}
      {kind === "feed" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Link to the roster file" hint="An https address your student system publishes."><Input name="base_url" type="url" required defaultValue={existing?.base_url ?? ""} placeholder="https://sis.example.ac.za/exports/roster.csv" /></Field>
          <Field label="Access token (optional)" hint={existing ? "Leave empty to keep the current one." : "Sent as “Authorization: Bearer …” if the link needs it."}>
            <Input name="token" type="password" autoComplete="off" placeholder={existing ? "••••••••" : ""} />
          </Field>
        </div>
      )}
      {kind === "api" && !existing && (
        <p className="text-sm text-muted">You get an API key. Your student system sends the roster to UniAttend whenever it changes; see “Sending a roster” below.</p>
      )}

      {kind !== "api" && (
        <Field label="Refresh">
          <Select name="schedule" defaultValue={existing?.schedule ?? "daily"} className="sm:w-60">
            <option value="daily">Every day</option><option value="hourly">Every hour</option><option value="manual">Only when I press Sync</option>
          </Select>
        </Field>
      )}
      <div className="space-y-2">
        <Check name="create_modules" on={opt("create_modules", false)} label="Create modules that aren't in UniAttend yet" hint="Off: only people in modules you already have are loaded, and other codes are listed for you." />
        <Check name="drop_missing" on={opt("drop_missing", false)} label="Remove enrolments that disappear at the source" hint="Only enrolments this connection made, only after a complete sync, and never a mass removal. Attendance already recorded is kept." />
      </div>
      <Result s={state} />
      <Submit label={existing ? "Save changes" : kind === "api" ? "Create key" : "Test and save"} pending={kind === "api" ? "Saving…" : "Testing…"} />
    </form>
  );
}

export function ConnectionButtons({ id, kind, status }: { id: string; kind: Kind; status: string }) {
  const [state, run] = useActionState(connectionAction, undefined as S);
  const [tested, test] = useActionState(testConnection, undefined as S);
  const Btn = ({ action, label, tone = "" }: { action: string; label: string; tone?: string }) => (
    <button name="action" value={action} className={`h-9 rounded-xl border border-line px-3 text-sm font-medium hover:bg-bg ${tone}`}>{label}</button>
  );
  return (
    <div className="space-y-2">
      <form action={run} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="id" value={id} />
        {kind !== "api" && <Btn action="sync" label="Sync now" tone="bg-brand text-brand-ink border-transparent hover:bg-brand" />}
        {status === "active" ? <Btn action="pause" label="Pause" /> : <Btn action="resume" label="Resume" />}
        {kind === "api" && <Btn action="new_key" label="New key" />}
      </form>
      {kind !== "api" && (
        <form action={test}>
          <input type="hidden" name="id" value={id} />
          <Submit label="Test connection" pending="Testing…" variant="secondary" />
        </form>
      )}
      <Result s={tested} />
      <details className="text-sm">
        <summary className="cursor-pointer text-xs font-medium text-bad">Remove this connection</summary>
        <form action={run} className="mt-2 space-y-2">
          <input type="hidden" name="id" value={id} /><input type="hidden" name="action" value="delete" />
          <label className="flex items-start gap-2 text-xs"><input type="checkbox" name="confirm" className="mt-0.5 size-4" />Stop syncing from here. Everyone and everything already loaded stays.</label>
          <Submit label="Remove" variant="danger" />
        </form>
      </details>
      <Result s={state} />
    </div>
  );
}
