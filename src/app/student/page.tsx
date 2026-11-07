import { Card, CardTitle, LinkButton, Notice, PageHeader, pct, Stat, Table, Td } from "@/components/ui";
import { requireRole } from "@/lib/auth";

export const metadata = { title: "My attendance" };

type Row = { module_id: string; code: string; title: string; attended: number; absent: number;
             excused: number; unresolved: number; percent: number | null; min_pct: number; institution_id: string };

export default async function StudentHome() {
  const { supabase, institutionId, user } = await requireRole("student");
  const [{ data }, { data: open }] = await Promise.all([
    supabase.rpc("my_attendance"),
    supabase.from("class_sessions").select("id, title, closes_at, modules(code)")
      .eq("status", "open").eq("institution_id", institutionId).gt("closes_at", new Date().toISOString()),
  ]);
  const rows = ((data ?? []) as Row[]).filter((r) => r.institution_id === institutionId);
  const atRisk = rows.filter((r) => r.percent != null && r.percent < r.min_pct);
  const overall = rows.reduce((a, r) => ({ att: a.att + r.attended, tot: a.tot + r.attended + r.absent }), { att: 0, tot: 0 });

  return (
    <>
      <PageHeader title="My attendance" subtitle={user.email} action={<LinkButton href="/student/check-in">Check in now</LinkButton>} />
      {(open ?? []).length > 0 && (
        <div className="mb-4"><Notice tone="ok">
          Attendance is open for {(open ?? []).map((s) => (s.modules as unknown as { code: string })?.code).join(", ")}.
          Scan the code on screen or tap <b>Check in now</b>.
        </Notice></div>
      )}
      {atRisk.length > 0 && (
        <div className="mb-4"><Notice tone="warn">
          You are below the required attendance in {atRisk.map((r) => r.code).join(", ")}.
        </Notice></div>
      )}
      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <Stat label="Overall" value={overall.tot ? pct((100 * overall.att) / overall.tot) : "—"} hint="Resolved sessions only" />
        <Stat label="Modules" value={rows.length} />
        <Stat label="Awaiting review" value={rows.reduce((a, r) => a + r.unresolved, 0)} hint="Not counted against you" />
      </div>
      <Card>
        <CardTitle>Modules</CardTitle>
        <Table head={["Module", "Attended", "Absent", "Excused", "Pending", "Attendance", "Required"]} empty="You are not enrolled in any modules yet.">
          {rows.map((r) => (
            <tr key={r.module_id}>
              <Td><b>{r.code}</b> <span className="text-muted">{r.title}</span></Td>
              <Td>{r.attended}</Td><Td>{r.absent}</Td><Td>{r.excused}</Td><Td>{r.unresolved}</Td>
              <Td className={r.percent != null && r.percent < r.min_pct ? "font-semibold text-bad" : "font-semibold"}>{pct(r.percent)}</Td>
              <Td>{r.min_pct}%</Td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}
