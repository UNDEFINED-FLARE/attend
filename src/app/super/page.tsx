import Link from "next/link";
import { ActionForm, Submit } from "@/components/form";
import { Badge, Card, CardTitle, Input, PageHeader, Select, Stat, Table, Td, Textarea, when } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { announce, changePlan, setStatus } from "./actions";

export const metadata = { title: "Platform" };

type Overview = { institutions: Record<string, number> | null; students: number; lecturers: number;
  sessions_30d: number; checkins_30d: number; rejected_30d: number };

export default async function SuperHome() {
  const { supabase } = await requireRole("super_admin");
  const [{ data: o }, { data: insts }, { data: subs }, { data: plans }] = await Promise.all([
    supabase.rpc("platform_overview"),
    supabase.from("institutions").select("id, name, slug, status, contact_email, created_at").order("created_at", { ascending: false }),
    supabase.from("institution_subscriptions").select("institution_id, status, current_period_end, subscription_plans(code, name)")
      .in("status", ["trialing", "active", "past_due", "suspended"]),
    supabase.from("subscription_plans").select("code, name").eq("is_active", true).order("sort_order"),
  ]);
  const ov = o as Overview | null;
  const subOf = new Map((subs ?? []).map((s) => [s.institution_id, s]));
  const pending = (insts ?? []).filter((i) => i.status === "pending");
  const inYear = new Date(Date.now() + 365 * 864e5).toISOString().slice(0, 10);

  return (
    <>
      <PageHeader title="Platform overview" />
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="Active institutions" value={ov?.institutions?.active ?? 0} hint={`${ov?.institutions?.pending ?? 0} pending`} />
        <Stat label="Students" value={ov?.students ?? 0} />
        <Stat label="Lecturers" value={ov?.lecturers ?? 0} />
        <Stat label="Sessions (30 d)" value={ov?.sessions_30d ?? 0} />
        <Stat label="Check-in attempts (30 d)" value={ov?.checkins_30d ?? 0} hint={`${ov?.rejected_30d ?? 0} rejected`} />
      </div>

      {pending.length > 0 && (
        <Card className="mb-6 border-warn/40">
          <CardTitle>Awaiting approval ({pending.length})</CardTitle>
          <ul className="divide-y divide-line">
            {pending.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div><b>{i.name}</b> <span className="text-muted">/{i.slug}</span><div className="text-xs text-muted">{i.contact_email} · applied {when(i.created_at)}</div></div>
                <span className="flex gap-2"><Link href={`/super/institutions/${i.id}`} className="inline-flex h-10 items-center rounded-xl border border-line px-3 text-sm font-medium hover:bg-bg">Set up map &amp; timetable</Link>
                <form action={setStatus}><input type="hidden" name="id" value={i.id} /><input type="hidden" name="status" value="active" /><Submit label="Approve" /></form></span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="mb-6">
        <CardTitle>Institutions</CardTitle>
        <Table head={["Institution", "Status", "Plan", "Change subscription", ""]}>
          {(insts ?? []).map((i) => {
            const s = subOf.get(i.id);
            const plan = s?.subscription_plans as unknown as { code: string; name: string } | undefined;
            return (
              <tr key={i.id}>
                <Td><Link href={`/super/institutions/${i.id}`} className="font-semibold hover:text-accent">{i.name}</Link><div className="text-xs text-muted">/{i.slug} · <Link href={`/super/institutions/${i.id}`} className="text-accent">set up</Link></div></Td>
                <Td><Badge status={i.status} /></Td>
                <Td className="text-sm">{plan ? <>{plan.name} <Badge status={s?.status} /><div className="text-xs text-muted">to {when(s?.current_period_end)}</div></> : "—"}</Td>
                <Td>
                  <ActionForm action={changePlan} submit="Apply" className="flex flex-wrap items-center gap-1 [&>[role]]:w-full [&>button]:h-8">
                    <input type="hidden" name="id" value={i.id} />
                    <Select name="plan" defaultValue={plan?.code ?? "starter"} className="h-8 w-28">{(plans ?? []).map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}</Select>
                    <Select name="status" defaultValue={s?.status ?? "active"} className="h-8 w-28">
                      {["trialing", "active", "past_due", "suspended", "cancelled"].map((x) => <option key={x}>{x}</option>)}</Select>
                    <Input name="until" type="date" defaultValue={s?.current_period_end?.slice(0, 10) ?? inYear} className="h-8 w-36" />
                  </ActionForm>
                </Td>
                <Td>
                  {i.status === "active" && <form action={setStatus}><input type="hidden" name="id" value={i.id} /><input type="hidden" name="status" value="suspended" /><Submit label="Suspend" variant="secondary" /></form>}
                  {i.status === "suspended" && <form action={setStatus}><input type="hidden" name="id" value={i.id} /><input type="hidden" name="status" value="active" /><Submit label="Reactivate" variant="secondary" /></form>}
                </Td>
              </tr>
            );
          })}
        </Table>
      </Card>

      <Card>
        <CardTitle>Platform announcement</CardTitle>
        <ActionForm action={announce} submit="Publish">
          <Input name="title" placeholder="Scheduled maintenance on Saturday" required />
          <Textarea name="body" required />
          <Select name="audience"><option value="all">Everyone</option><option value="admins">Administrators</option><option value="lecturers">Lecturers</option><option value="students">Students</option></Select>
        </ActionForm>
      </Card>
    </>
  );
}
