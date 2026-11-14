import Link from "next/link";
import { ActionForm } from "@/components/form";
import { Badge, Card, CardTitle, Input, Notice, PageHeader, Stat } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { env } from "@/lib/env";
import { uploadRoster } from "./actions";
import { ConnectionButtons, ConnectionForm, type ConnectionRow } from "./connection-forms";

export const metadata = { title: "Connections" };

type Row = ConnectionRow & { status: string; connection_status?: string; last_tested_at?: string | null; last_test_message?: string | null; key_hint: string | null; last_run_at: string | null; last_status: string | null;
  last_summary: Record<string, number | string> | null; next_run_at: string; run_id: string | null; sync_requested_at: string | null };
type Run = { id: string; integration_id: string | null; trigger: string; status: string; summary: Record<string, number>; unknown_modules: string[];
  errors: { who: string; error: string }[]; error: string | null; started_at: string };

const KIND = { moodle: "Moodle", feed: "Roster link", api: "API" } as const;
const CONN: Record<string, string> = {
  not_configured: "Not tested yet", incomplete: "Configuration incomplete", testing: "Testing…", connected: "Connected",
  auth_failed: "Authentication failed", connection_failed: "Connection failed", permission_denied: "Permission denied",
  unavailable: "Service unavailable", suspended: "Suspended",
};
const at = (iso: string | null) => iso ? new Date(iso).toLocaleString("en-ZA", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Johannesburg" }) : "never";
const n = (v: unknown) => Number(v ?? 0);
const changed = (s: Record<string, number | string> | null) => !s ? "" : [
  n(s.students_added) && `${n(s.students_added)} students added`, n(s.lecturers_added) && `${n(s.lecturers_added)} lecturers added`,
  n(s.enrolments_added) && `${n(s.enrolments_added)} enrolments added`, n(s.assignments_added) && `${n(s.assignments_added)} teaching assignments`,
  n(s.modules_created) && `${n(s.modules_created)} modules created`, n(s.students_updated) + n(s.lecturers_updated) > 0 && `${n(s.students_updated) + n(s.lecturers_updated)} updated`,
  n(s.enrolments_dropped) && `${n(s.enrolments_dropped)} enrolments removed`, n(s.held_back) && `${n(s.held_back)} removals held back`, n(s.skipped) && `${n(s.skipped)} skipped`,
].filter(Boolean).join(" · ") || "Nothing changed";

export default async function Connections() {
  const { supabase, institutionId, current } = await requireRole("institution_admin");
  const [{ data: rows, error }, { data: runRows }, students, lecturers, modules, enrolled, taught] = await Promise.all([
    supabase.from("integrations").select("*")
      .eq("institution_id", institutionId).order("created_at"),
    supabase.from("integration_runs").select("id, integration_id, trigger, status, summary, unknown_modules, errors, error, started_at")
      .eq("institution_id", institutionId).order("started_at", { ascending: false }).limit(12),
    supabase.from("students").select("id", { count: "exact", head: true }).eq("institution_id", institutionId).is("deleted_at", null),
    supabase.from("lecturers").select("id", { count: "exact", head: true }).eq("institution_id", institutionId).is("deleted_at", null),
    supabase.from("modules").select("id", { count: "exact", head: true }).eq("institution_id", institutionId).is("deleted_at", null),
    supabase.from("module_enrolments").select("module_id").eq("institution_id", institutionId).eq("status", "active").limit(50000),
    supabase.from("lecturer_assignments").select("module_id").eq("institution_id", institutionId).limit(50000),
  ]);
  const list = (rows ?? []) as Row[];
  const runs = (runRows ?? []) as Run[];
  const nameOf = new Map(list.map((r) => [r.id, r.name]));
  const total = modules.count ?? 0;
  const withStudents = new Set((enrolled.data ?? []).map((e) => e.module_id)).size;
  const withLecturer = new Set((taught.data ?? []).map((e) => e.module_id)).size;
  const endpoint = `${env.siteUrl.replace(/\/+$/, "")}/api/roster`;

  return (
    <>
      <PageHeader title="Connections"
        subtitle="Keep students, lecturers, modules and enrolments in step with your own systems automatically, instead of typing or uploading them." />
      {error && <div className="mb-6"><Notice tone="warn">Connections need the latest database update (migration 0024).</Notice></div>}
      {current.institution_status !== "active" && <div className="mb-6"><Notice tone="info">You can set connections up now. They start syncing once your institution is approved.</Notice></div>}

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Students" value={(students.count ?? 0).toLocaleString("en-ZA")} />
        <Stat label="Lecturers" value={(lecturers.count ?? 0).toLocaleString("en-ZA")} />
        <Stat label="Modules" value={total.toLocaleString("en-ZA")} />
        <Stat label="Modules with students" value={`${withStudents} of ${total}`} hint={total && withStudents < total ? "The rest can't take attendance yet" : undefined} />
        <Stat label="Modules with a lecturer" value={`${withLecturer} of ${total}`} hint={total && withLecturer < total ? "Nobody can open their sessions" : undefined} />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <div className="space-y-6">
          {list.map((c) => (
            <Card key={c.id}>
              <CardTitle action={<Badge status={c.status === "paused" ? "suspended" : c.last_status === "failed" ? "failed" : "active"}>{c.status === "paused" ? "paused" : c.last_status === "failed" ? "needs attention" : "on"}</Badge>}>
                {c.name} <span className="text-sm font-normal text-muted">· {KIND[c.kind]}</span>
              </CardTitle>
              <dl className="mb-4 space-y-1 text-sm">
                {c.base_url && <div className="flex gap-2"><dt className="w-24 shrink-0 text-muted">Source</dt><dd className="min-w-0 break-all">{c.base_url}</dd></div>}
                <div className="flex gap-2"><dt className="w-24 shrink-0 text-muted">{c.kind === "api" ? "Key" : "Token"}</dt><dd>{c.key_hint ? `ends in …${c.key_hint}` : "none"}</dd></div>
                {c.kind !== "api" && <div className="flex gap-2"><dt className="w-24 shrink-0 text-muted">Connection</dt>
                  <dd>{CONN[c.connection_status ?? "not_configured"] ?? c.connection_status}{c.last_tested_at && <span className="text-muted"> · tested {at(c.last_tested_at)}</span>}
                    {c.last_test_message && <span className="block text-xs text-muted">{c.last_test_message}</span>}</dd></div>}
                <div className="flex gap-2"><dt className="w-24 shrink-0 text-muted">Last sync</dt><dd>{at(c.last_run_at)}{c.last_run_at && <> · {changed(c.last_summary)}</>}</dd></div>
                {c.kind !== "api" && <div className="flex gap-2"><dt className="w-24 shrink-0 text-muted">Next</dt>
                  <dd>{c.run_id || c.sync_requested_at ? "Syncing now…" : c.status === "paused" ? "Paused" : c.schedule === "manual" ? "When you press Sync" : at(c.next_run_at)}</dd></div>}
              </dl>
              {c.last_status === "failed" && typeof c.last_summary?.error === "string" && <div className="mb-4"><Notice tone="bad">{c.last_summary.error}</Notice></div>}
              <ConnectionButtons id={c.id} kind={c.kind} status={c.status} />
              <details className="mt-4 border-t border-line pt-3">
                <summary className="cursor-pointer text-sm font-medium text-accent">Edit</summary>
                <div className="mt-3"><ConnectionForm existing={c} /></div>
              </details>
            </Card>
          ))}

          <Card>
            <CardTitle>{list.length ? "Add another connection" : "Connect your first system"}</CardTitle>
            <ConnectionForm />
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardTitle action={<Link href="/admin/integrations/import" className="text-sm font-medium text-accent">Import Centre →</Link>}>Upload a roster file</CardTitle>
            <p className="mb-3 text-sm text-muted">Students <b>and</b> lecturers with their modules, in one file. One row per person per module. Uploading again only adds what&apos;s new.</p>
            <pre className="mb-3 overflow-x-auto rounded-xl bg-bg p-3 text-xs leading-relaxed">{`role,number,full_name,email,module_code
student,22012345,Thabo Nkosi,22012345@example.ac.za,CSC1541
student,22012345,Thabo Nkosi,22012345@example.ac.za,MAT1541
lecturer,E1042,Dr N Mudau,n.mudau@example.ac.za,CSC1541`}</pre>
            <ActionForm action={uploadRoster} submit="Upload" pending="Loading…">
              <Input name="file" type="file" accept=".csv,.json,text/csv,application/json" required />
            </ActionForm>
            <p className="mt-3 text-xs text-muted">Only students? <Link href="/admin/people" className="text-accent underline">People</Link> also takes a simple student list. People get access when they sign up with the email in the file.</p>
          </Card>

          <Card>
            <CardTitle>Recent syncs</CardTitle>
            {runs.length === 0 ? <p className="text-sm text-muted">Nothing yet.</p> : (
              <ul className="space-y-2 text-sm">
                {runs.map((r) => (
                  <li key={r.id} className="rounded-xl border border-line p-3">
                    <p className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium">{r.integration_id ? nameOf.get(r.integration_id) ?? "Removed connection" : "File upload"}</span>
                      <span className="text-xs text-muted">{at(r.started_at)} · <Badge status={r.status === "ok" ? "active" : r.status === "failed" ? "failed" : "pending"}>{r.status === "ok" ? "done" : r.status}</Badge></span>
                    </p>
                    <p className="mt-1 text-muted">{r.error ?? changed(r.summary)}</p>
                    {r.unknown_modules.length > 0 && <p className="mt-1 text-xs text-warn">Module codes not in UniAttend: {r.unknown_modules.slice(0, 12).join(", ")}{r.unknown_modules.length > 12 ? "…" : ""}</p>}
                    {r.errors.length > 0 && (
                      <details className="mt-1 text-xs"><summary className="cursor-pointer text-warn">{r.summary.skipped ?? r.errors.length} skipped</summary>
                        <ul className="mt-1 list-disc pl-5 text-muted">{r.errors.slice(0, 20).map((e, i) => <li key={i}>{e.who}: {e.error}</li>)}</ul>
                      </details>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardTitle>How each connection works</CardTitle>
            <div className="space-y-4 text-sm">
              <details open={list.length === 0}>
                <summary className="cursor-pointer font-medium">Moodle</summary>
                <ol className="mt-2 list-decimal space-y-1 pl-5 text-muted">
                  <li>In Moodle, as an administrator: <i>Site administration → Advanced features</i> → turn on <b>Web services</b>; then under <i>Server → Web services → Manage protocols</i> enable <b>REST</b>.</li>
                  <li><i>External services → Add</i>: name it “UniAttend”, and add these functions: <code>core_webservice_get_site_info</code>, <code>core_course_get_courses</code>, <code>core_enrol_get_enrolled_users</code>.</li>
                  <li>Create a user for it with a role that can view courses and participants (no editing rights are needed), and add that user to the service.</li>
                  <li><i>Manage tokens → Create token</i> for that user and service. Paste the token here.</li>
                </ol>
                <p className="mt-2 text-muted">UniAttend only reads: each course becomes its module (by code), students and teachers are loaded with their enrolments. Nothing is written to Moodle.</p>
              </details>
              <details>
                <summary className="cursor-pointer font-medium">Roster link</summary>
                <p className="mt-2 text-muted">Most student systems (ITS, PeopleSoft, Banner, SITS) can save a report to a web address on a schedule. Point UniAttend at that https link and it reads the file every day or hour. Same columns as the upload file, or JSON: <code>{`{ "modules": [...], "people": [...] }`}</code>.</p>
              </details>
              <details>
                <summary className="cursor-pointer font-medium">Sending a roster (API)</summary>
                <p className="mt-2 text-muted">Your system sends the roster whenever it changes. The key decides the institution.</p>
                <pre className="mt-2 overflow-x-auto rounded-xl bg-bg p-3 text-xs leading-relaxed">{`POST ${endpoint}
Authorization: Bearer ua_…
Content-Type: application/json

{ "complete": true,
  "modules": [{ "code": "CSC1541", "title": "Programming 1" }],
  "people": [
    { "role": "student", "number": "22012345", "full_name": "Thabo Nkosi",
      "email": "22012345@example.ac.za", "module_codes": ["CSC1541"] },
    { "role": "lecturer", "number": "E1042", "full_name": "Dr N Mudau",
      "email": "n.mudau@example.ac.za", "module_codes": ["CSC1541"] } ] }`}</pre>
                <p className="mt-2 text-muted">Send <code>&quot;complete&quot;: true</code> only when the request holds the whole roster. Up to 20,000 people per request, 120 requests an hour. CSV works too (<code>Content-Type: text/csv</code>).</p>
              </details>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
