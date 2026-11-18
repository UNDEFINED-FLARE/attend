import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, CardTitle, Notice, PageHeader } from "@/components/ui";
import { INTEGRATION_ROLES, requireAnyRole } from "@/lib/auth";
import { env } from "@/lib/env";
import { providerOf, runCounts } from "@/lib/integrations/providers";
import { ConnectionButtons, ConnectionForm, KIND_LABEL, type ConnectionRow } from "../connection-forms";

export const metadata = { title: "Connection" };

type Row = ConnectionRow & { status: string; connection_status?: string; last_tested_at?: string | null; last_test_message?: string | null;
  key_hint: string | null; last_run_at: string | null; last_status: string | null; last_success_at?: string | null;
  last_summary: Record<string, unknown> | null; next_run_at: string; run_id: string | null; sync_requested_at: string | null; created_at: string };
type Run = { id: string; trigger: string; status: string; summary: Record<string, unknown> | null; error: string | null; started_at: string; finished_at: string | null };

const CONN: Record<string, [string, string]> = {
  not_configured: ["Not tested yet", "pending"], incomplete: ["Configuration incomplete", "pending"], testing: ["Testing…", "pending"],
  connected: ["Connected", "active"], auth_failed: ["Sign-in failed", "absent"], connection_failed: ["Can't connect", "absent"],
  permission_denied: ["Permission denied", "absent"], unavailable: ["Service unavailable", "late"], suspended: ["Paused", "closed"],
};
const at = (iso: string | null | undefined) => iso ? new Date(iso).toLocaleString("en-ZA", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Johannesburg" }) : "never";
const RUN: Record<string, string> = { ok: "Done", warnings: "Done, with rejected rows", failed: "Failed", running: "Running", later: "Continuing", staging: "Waiting for confirmation", cancelled: "Cancelled", queued: "Queued" };

export default async function ConnectionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { supabase } = await requireAnyRole(INTEGRATION_ROLES);
  const [{ data: row }, { data: runRows }] = await Promise.all([
    supabase.from("integrations").select("*").eq("id", id).maybeSingle(),
    supabase.from("integration_runs").select("id, trigger, status, summary, error, started_at, finished_at").eq("integration_id", id)
      .order("started_at", { ascending: false }).limit(15),
  ]);
  if (!row) notFound();
  const c = row as Row;
  const runs = (runRows ?? []) as Run[];
  const p = providerOf(c.kind, c.options);
  const [connLabel, connTone] = c.kind === "api"
    ? (c.last_run_at ? ["Receiving rosters", "active"] : ["Waiting for the first roster", "pending"])
    : CONN[c.connection_status ?? "not_configured"] ?? [c.connection_status ?? "", "pending"];
  const endpoint = `${env.siteUrl.replace(/\/+$/, "")}/api/v1/roster`;

  return (
    <>
      <Link href="/admin/integrations" className="text-sm text-info hover:underline">← Integration Centre</Link>
      <PageHeader title={c.name} subtitle={`${p?.name ?? "Connection"} · ${KIND_LABEL[c.kind]}`}
        action={<Badge status={c.status === "paused" ? "closed" : connTone}>{c.status === "paused" ? "Paused" : connLabel}</Badge>} />

      {c.last_status === "failed" && typeof c.last_summary?.error === "string" && <div className="mb-6"><Notice tone="bad">The last sync failed: {c.last_summary.error}</Notice></div>}
      {c.kind !== "api" && ["auth_failed", "connection_failed", "permission_denied", "unavailable"].includes(c.connection_status ?? "") && c.last_test_message && (
        <div className="mb-6"><Notice tone="bad">{c.last_test_message}</Notice></div>
      )}

      <div className="grid gap-6 xl:grid-cols-[3fr_2fr]">
        <div className="space-y-6">
          <Card>
            <CardTitle>Status</CardTitle>
            <dl className="mb-5 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              {c.base_url && <div className="sm:col-span-2"><dt className="text-xs text-muted">Address</dt><dd className="break-all">{c.base_url}</dd></div>}
              <div><dt className="text-xs text-muted">{c.kind === "api" ? "Key" : "Credential"}</dt><dd>{c.key_hint ? `ends in …${c.key_hint}` : "none saved"}</dd></div>
              {c.kind !== "api" && <div><dt className="text-xs text-muted">Last test</dt><dd>{at(c.last_tested_at)}{c.last_test_message && <span className="block text-xs text-muted">{c.last_test_message}</span>}</dd></div>}
              <div><dt className="text-xs text-muted">Last successful sync</dt><dd>{at(c.last_success_at)}</dd></div>
              <div><dt className="text-xs text-muted">Next</dt>
                <dd>{c.run_id || c.sync_requested_at ? "Syncing now…" : c.status === "paused" ? "Paused" : c.kind === "api" ? "When your system sends a roster" : c.schedule === "manual" ? "When you press Sync now" : at(c.next_run_at)}</dd></div>
            </dl>
            <ConnectionButtons id={c.id} kind={c.kind} status={c.status} />
          </Card>

          <Card>
            <CardTitle action={<Link href="/admin/integrations/activity" className="text-sm font-medium text-accent">All activity →</Link>}>Recent runs</CardTitle>
            {runs.length === 0 ? <p className="text-sm text-muted">No runs yet.</p> : (
              <ul className="divide-y divide-line text-sm">
                {runs.map((r) => {
                  const n = runCounts(r.summary);
                  return (
                    <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                      <Link href={`/admin/integrations/activity/${r.id}`} className="min-w-0 flex-1 hover:underline">
                        <span className="block font-medium">{at(r.started_at)} <span className="font-normal text-muted">· {r.trigger}</span></span>
                        <span className="block text-xs text-muted">{r.error ?? `${n.inserted} added · ${n.updated} updated · ${n.rejected} rejected`}</span>
                      </Link>
                      <Badge status={r.status === "ok" ? "active" : r.status === "failed" ? "absent" : "pending"}>{RUN[r.status] ?? r.status}</Badge>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <Card>
            <CardTitle>Settings</CardTitle>
            <ConnectionForm existing={c} />
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardTitle>How this connection works</CardTitle>
            <div className="space-y-2 text-sm text-muted">
              {c.kind === "moodle" && <>
                <p>UniAttend only reads: each course becomes its module (by code); students and teachers come with their enrolments. Nothing is written to Moodle.</p>
                <ol className="list-decimal space-y-1 pl-5">
                  <li>In Moodle: <i>Site administration → Advanced features</i> → turn on <b>Web services</b>; under <i>Server → Web services → Manage protocols</i> enable <b>REST</b>.</li>
                  <li><i>External services → Add</i> a service “UniAttend” with <code>core_webservice_get_site_info</code>, <code>core_course_get_courses</code> and <code>core_enrol_get_enrolled_users</code>.</li>
                  <li>Create a user with a role that can view courses and participants, and add it to the service.</li>
                  <li><i>Manage tokens → Create token</i> for that user and service; paste it under Settings.</li>
                </ol>
              </>}
              {c.kind === "feed" && <p>Your system publishes a CSV or JSON roster at this address; UniAttend reads it on the schedule. CSV columns: <code>role, number, full_name, email, module_code, module_title</code>. JSON: <code>{`{ "modules": [...], "people": [...] }`}</code>.</p>}
              {c.kind === "rest" && <>
                <p>UniAttend calls your system&apos;s API on the schedule, follows its pages, and reads each record as one person with their modules, using the field mapping under Settings.</p>
                <p>A test reads only the first page. Page-number and offset paging can carry on across runs for very large systems; a &quot;next link&quot; must fit in one run.</p>
              </>}
              {c.kind === "api" && <>
                <p>Your system sends the roster whenever it changes, with the key for this connection. The key decides the institution.</p>
                <pre className="overflow-x-auto rounded-xl bg-bg p-3 text-xs leading-relaxed text-ink">{`POST ${endpoint}
Authorization: Bearer ua_…
Idempotency-Key: <unique per roster>
Content-Type: application/json

{ "complete": true,
  "modules": [{ "code": "CSC1541", "title": "Programming 1" }],
  "people": [{ "role": "student", "number": "22012345",
    "full_name": "Thabo Nkosi", "email": "22012345@example.ac.za",
    "module_codes": ["CSC1541"] }] }`}</pre>
                <p>Full documentation, errors and limits: <a href="/developers" className="text-accent underline">/developers</a>. Check a new key with <code>GET /api/v1/status</code>.</p>
              </>}
            </div>
          </Card>
          <Card>
            <CardTitle>What a sync may change</CardTitle>
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
              <li>Adds and updates students, lecturers, enrolments and who teaches what.</li>
              <li>{c.options?.create_modules ? "Creates modules that UniAttend doesn't have yet." : "Only uses modules UniAttend already has; other codes are listed in the run."}</li>
              <li>{c.options?.drop_missing ? "Removes enrolments this connection made that disappear at the source — only after a complete sync, and never a mass removal." : "Never removes enrolments."}</li>
              <li>Never deletes people or attendance records.</li>
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
