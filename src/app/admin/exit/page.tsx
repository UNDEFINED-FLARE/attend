import { ActionForm } from "@/components/form";
import { Card, CardTitle, Notice, PageHeader, when } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { requestExit, revokeCredentials, withdrawExit } from "../onboarding/actions";

export const metadata = { title: "Your data and leaving" };

// A university must never feel trapped: take everything, cut off connections, ask to leave.
export default async function ExitPage() {
  const { supabase, institutionId } = await requireRole("institution_admin");
  const [{ data: reqs, error }, { data: lastExport }, { count: connections }] = await Promise.all([
    supabase.from("institution_exit_requests").select("id, reason, status, created_at, credentials_revoked_at, closed_at")
      .eq("institution_id", institutionId).order("created_at", { ascending: false }).limit(5),
    supabase.from("audit_logs").select("created_at").eq("institution_id", institutionId).eq("action", "export").eq("entity", "institution_export")
      .order("created_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("integrations").select("id", { count: "exact", head: true }).eq("institution_id", institutionId).eq("status", "active"),
  ]);
  const open = (reqs ?? []).find((r) => r.status === "requested");
  return (
    <>
      <PageHeader title="Your data and leaving" subtitle="Your institution owns its data. Take it whenever you like; leave whenever you decide to." />
      {error && <div className="mb-6"><Notice tone="warn">Leaving and the full export need the latest database update (migration 0032).</Notice></div>}

      <Card className="mb-6">
        <CardTitle>1. Download everything</CardTitle>
        <p className="mb-3 text-sm text-muted">Every table — structure, people, enrolments, timetable, classes, attendance with its evidence, disputes, decisions,
          integration runs and the audit log — as CSV files in one ZIP. Stored credentials are never included. The download is recorded in the audit log.</p>
        <a href="/admin/data/export-all" className="inline-flex h-10 items-center rounded-xl bg-ink px-4 text-sm font-semibold text-surface">Download all data (ZIP)</a>
        {lastExport && <p className="mt-2 text-xs text-muted">Last full export: {when(lastExport.created_at)}</p>}
      </Card>

      <Card className="mb-6">
        <CardTitle>2. Cut off your systems</CardTitle>
        <p className="mb-3 text-sm text-muted">Deletes every Moodle token, roster-link token and API key UniAttend holds for you, and pauses every connection.
          {connections ? ` ${connections} connection${connections === 1 ? " is" : "s are"} active now.` : " No connection is active."} You can reconnect later by entering new credentials.</p>
        <ActionForm action={revokeCredentials} submit="Delete all stored credentials" pending="Deleting…" className="space-y-3">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="confirm" className="size-4" /> I understand our systems stop sending data to UniAttend.</label>
        </ActionForm>
      </Card>

      <Card>
        <CardTitle>3. Ask to leave UniAttend</CardTitle>
        {open ? (
          <div className="space-y-3 text-sm">
            <Notice>You asked to leave on {when(open.created_at)}. UniAttend will agree the closing date with you; until then everything keeps working.
              {open.credentials_revoked_at ? " Your stored credentials have been deleted." : ""}</Notice>
            <p className="text-muted">Reason given: {open.reason}</p>
            <ActionForm action={withdrawExit} submit="Withdraw the request" pending="…"><span /></ActionForm>
          </div>
        ) : (
          <>
            <p className="mb-3 text-sm text-muted">When the account is closed, it is archived: nobody can sign in to it or check in, and your data is kept
              until it is deleted under your retention schedule and the operator agreement — never without your instruction. Download your data first.</p>
            <ActionForm action={requestExit} submit="Ask to leave" pending="Sending…" className="space-y-3">
              <textarea name="reason" required minLength={5} maxLength={2000} rows={3} placeholder="Why you are leaving, and the date you would like it closed"
                className="w-full rounded-xl border border-line bg-surface p-3 text-sm" />
            </ActionForm>
          </>
        )}
        {(reqs ?? []).filter((r) => r.status !== "requested").length > 0 && (
          <ul className="mt-4 space-y-1 text-xs text-muted">
            {(reqs ?? []).filter((r) => r.status !== "requested").map((r) => <li key={r.id}>{when(r.created_at)}: {r.status}{r.closed_at ? ` on ${when(r.closed_at)}` : ""}</li>)}
          </ul>
        )}
      </Card>
    </>
  );
}
