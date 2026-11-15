import Link from "next/link";
import { closeInstitution } from "@/app/admin/onboarding/actions";
import { ActionForm } from "@/components/form";
import { Badge, Card, CardTitle, Notice, Table, Td, when } from "@/components/ui";
import { requireRole } from "@/lib/auth";

type Row = { id: string; name: string; status: string; done: number; total: number; live: boolean; exit_requested: boolean };
type Exit = { id: string; institution_id: string; institution: string; reason: string; status: string; created_at: string;
  credentials_revoked_at: string | null; closed_at: string | null; closing_note: string | null; last_export: string | null };

/** The platform's view: how far each institution is, and requests to leave. */
export async function OnboardingPanel() {
  const { supabase } = await requireRole("super_admin");
  const [{ data: ov, error }, { data: ex }, { data: sa }] = await Promise.all([
    supabase.rpc("onboarding_overview"), supabase.rpc("exit_requests"), supabase.rpc("support_access_overview"),
  ]);
  const access = (sa ?? []) as { institution_id: string; institution: string; reason: string; expires_at: string }[];
  if (error) return <Card className="mb-6"><Notice tone="warn">Onboarding and exits need the latest database update (migration 0032).</Notice></Card>;
  const rows = (ov ?? []) as Row[];
  const exits = (ex ?? []) as Exit[];
  const open = exits.filter((e) => e.status === "requested");
  return (
    <>
      <Card className="mb-6">
        <CardTitle>Support access</CardTitle>
        <p className="mb-2 text-sm text-muted">You see an institution&apos;s students and attendance only while its administrators allow it. Everything you do then is in their audit log.</p>
        {access.length === 0 ? <p className="text-sm text-muted">No institution has given access right now.</p> : (
          <ul className="divide-y divide-line text-sm">
            {access.map((a) => <li key={a.institution_id} className="py-2"><b>{a.institution}</b> until {when(a.expires_at)} · {a.reason}</li>)}
          </ul>
        )}
      </Card>
      {open.length > 0 && (
        <Card className="mb-6 border-warn/40">
          <CardTitle>Asked to leave ({open.length})</CardTitle>
          <ul className="divide-y divide-line">
            {open.map((e) => (
              <li key={e.id} className="grid gap-3 py-3 lg:grid-cols-2">
                <div className="text-sm">
                  <p className="font-semibold">{e.institution} <span className="font-normal text-muted">· asked {when(e.created_at)}</span></p>
                  <p className="text-muted">{e.reason}</p>
                  <p className="text-xs text-muted">Full export: {e.last_export ? when(e.last_export) : "not downloaded yet"} · credentials: {e.credentials_revoked_at ? "deleted" : "still stored"}</p>
                </div>
                <ActionForm action={closeInstitution} submit="Close the account" pending="Closing…" className="space-y-2">
                  <input type="hidden" name="institution" value={e.institution_id} />
                  <textarea name="note" required minLength={5} rows={2} placeholder="How and when the closure was agreed"
                    className="w-full rounded-xl border border-line bg-surface p-2 text-sm" />
                  <p className="text-xs text-muted">Archives the institution and deletes its stored credentials. Deletes no records.</p>
                </ActionForm>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Card className="mb-6">
        <CardTitle>Onboarding</CardTitle>
        <Table head={["Institution", "Status", "Steps", ""]} empty="No institutions yet.">
          {rows.map((r) => (
            <tr key={r.id}>
              <Td>{r.name}{r.exit_requested && <span className="ml-2 text-xs text-warn">asked to leave</span>}</Td>
              <Td><Badge status={r.status} /></Td>
              <Td className="tabular-nums">{r.live ? <span className="font-semibold text-ok">Live</span> : `${r.done} of ${r.total}`}</Td>
              <Td><Link href={`/super/institutions/${r.id}`} className="text-xs text-info hover:underline">Checklist and setup →</Link></Td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}
