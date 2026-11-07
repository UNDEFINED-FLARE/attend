import Link from "next/link";
import { Badge, Card, CardTitle, PageHeader, pct, Stat, Table, Td, when } from "@/components/ui";
import { requireRole } from "@/lib/auth";

export const metadata = { title: "Institution overview" };

type Overview = { students: number; lecturers: number; modules: number; sessions_30d: number; attendance_30d: number | null;
  pending_reviews: number; open_disputes: number; low_modules: { module_id: string; code: string; title: string; percent: number }[] };

export default async function AdminHome() {
  const { supabase, institutionId, current } = await requireRole("institution_admin");
  const [{ data }, { data: sub }] = await Promise.all([
    supabase.rpc("institution_overview", { p_inst: institutionId }),
    supabase.from("institution_subscriptions").select("status, current_period_end, subscription_plans(name, max_students, max_lecturers, max_modules)")
      .eq("institution_id", institutionId).in("status", ["trialing", "active", "past_due", "suspended"]).maybeSingle(),
  ]);
  const o = data as Overview | null;
  const plan = sub?.subscription_plans as unknown as { name: string; max_students: number | null; max_lecturers: number | null; max_modules: number | null } | undefined;
  const of = (n: number | undefined, max: number | null | undefined) => (max ? `${n ?? 0} / ${max}` : `${n ?? 0}`);

  return (
    <>
      <PageHeader title={current.institution_name ?? "Institution"} subtitle="Figures are calculated from live attendance records." />
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Students" value={of(o?.students, plan?.max_students)} />
        <Stat label="Lecturers" value={of(o?.lecturers, plan?.max_lecturers)} />
        <Stat label="Modules" value={of(o?.modules, plan?.max_modules)} />
        <Stat label="Attendance (30 days)" value={pct(o?.attendance_30d)} hint={`${o?.sessions_30d ?? 0} sessions`} />
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardTitle>Lowest-attendance modules</CardTitle>
          <Table head={["Module", "Attendance"]} empty="No closed sessions yet.">
            {(o?.low_modules ?? []).map((m) => (
              <tr key={m.module_id}><Td><b>{m.code}</b> {m.title}</Td><Td className="font-semibold">{pct(m.percent)}</Td></tr>
            ))}
          </Table>
        </Card>
        <div className="space-y-6">
          <Card>
            <CardTitle>Needs attention</CardTitle>
            <ul className="space-y-2 text-sm">
              <li className="flex justify-between"><span>Check-ins awaiting review</span><b>{o?.pending_reviews ?? 0}</b></li>
              <li className="flex justify-between"><span>Open disputes</span><b>{o?.open_disputes ?? 0}</b></li>
            </ul>
          </Card>
          <Card>
            <CardTitle>Subscription</CardTitle>
            {sub ? (
              <div className="space-y-1 text-sm">
                <p><b>{plan?.name}</b> <Badge status={sub.status} /></p>
                <p className="text-muted">Renews or ends {when(sub.current_period_end)}</p>
                <p className="text-muted">To change plan, contact UniAttend.</p>
              </div>
            ) : <p className="text-sm text-muted">No active subscription.</p>}
          </Card>
          <Card>
            <CardTitle>Getting started</CardTitle>
            <ol className="list-decimal space-y-1 pl-5 text-sm">
              <li><Link className="text-info hover:underline" href="/admin/structure">Add faculties, departments and venues</Link></li>
              <li><Link className="text-info hover:underline" href="/admin/modules">Create modules</Link></li>
              <li><Link className="text-info hover:underline" href="/admin/people">Add lecturers and import students</Link></li>
              <li><Link className="text-info hover:underline" href="/admin/modules">Assign lecturers to modules</Link></li>
            </ol>
          </Card>
        </div>
      </div>
    </>
  );
}
