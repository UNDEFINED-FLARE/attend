import Link from "next/link";
import { Card, CardTitle, Notice, PageHeader, pct, Table, Td } from "@/components/ui";
import { requireAnyRole, ROLE_LABEL, STAFF_ROLES } from "@/lib/auth";

export const metadata = { title: "Attendance oversight" };

type Row = { id: string; code: string; title: string; department: string | null; students: number; sessions: number; rate: number | null; unresolved: number };

export default async function StaffHome() {
  const { supabase, institutionId, roles } = await requireAnyRole(STAFF_ROLES);
  const { data, error } = await supabase.rpc("scope_overview", { p_inst: institutionId });
  const rows = (data ?? []) as Row[];
  const scope = roles.map((r) => `${ROLE_LABEL[r.role]}${r.scope_name ? ` · ${r.scope_name}` : ""}`).join(", ");
  const unresolved = rows.reduce((n, r) => n + Number(r.unresolved), 0);
  return (
    <>
      <PageHeader title="Attendance oversight" subtitle={scope} />
      {error && (
        <div className="mb-6"><Notice tone={error.code === "PGRST202" ? "warn" : "bad"}>
          {error.code === "PGRST202" ? "This needs the latest database update (migration 0030)." : error.message}
        </Notice></div>
      )}
      {unresolved > 0 && (
        <div className="mb-6"><Notice>
          {unresolved} record{unresolved === 1 ? "" : "s"} still waiting for a decision. <Link href="/staff/review" className="font-semibold underline">Open reviews</Link>
        </Notice></div>
      )}
      <Card>
        <CardTitle>Modules ({rows.length})</CardTitle>
        <p className="mb-3 text-sm text-muted">Attendance over closed classes, lowest first. Records still under review are counted separately, never as absences.</p>
        <Table head={["Module", "Department", "Students", "Classes", "Attendance", "Unresolved", ""]} empty="No modules in your scope yet.">
          {rows.map((r) => (
            <tr key={r.id}>
              <Td><b>{r.code}</b> <span className="text-muted">{r.title}</span></Td>
              <Td className="text-muted">{r.department ?? "—"}</Td>
              <Td className="tabular-nums">{r.students}</Td>
              <Td className="tabular-nums">{r.sessions}</Td>
              <Td className={`tabular-nums font-medium ${r.rate != null && Number(r.rate) < 75 ? "text-bad" : ""}`}>{pct(r.rate)}</Td>
              <Td className="tabular-nums">{Number(r.unresolved) || "—"}</Td>
              <Td>{Number(r.sessions) > 0 && <span className="flex gap-3 text-xs"><a href={`/reports/module/${r.id}`} className="text-info hover:underline">PDF</a><a href={`/lecturer/modules/${r.id}/export`} className="text-info hover:underline">CSV</a></span>}</Td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}
