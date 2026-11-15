import { notFound } from "next/navigation";
import { DocFigure, PrintDocument } from "@/components/print-document";
import { ReportError } from "@/components/report-view";
import { requireAnyRole } from "@/lib/auth";
import { auditExport } from "@/lib/audit-export";
import { REPORT_ROLES } from "@/lib/report";
import { loadTheme } from "@/lib/shell-data";

export const metadata = { title: "Module attendance report" };

type Row = { student_number: string; full_name: string; sessions: number; attended: number; late: number; absent: number;
  excused: number; unresolved: number; percent: number | null; worst_case_percent: number | null; meets_requirement: boolean | null; at_risk: boolean | null };

const pct = (v: number | null) => (v == null ? "—" : `${Number(v).toFixed(1)}%`);

// One module's class list with each student's attendance, on the institution's
// letterhead. module_report() decides who may see it (lecturers of the module,
// the institution's administrators, officers, auditors and scoped admins).
export default async function ModuleReportPdf({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { supabase, institutionId, current } = await requireAnyRole(REPORT_ROLES);
  const [{ data: mod }, { data, error }, theme, { data: settings }, { data: teachers }] = await Promise.all([
    supabase.from("modules").select("id, code, title, min_attendance_pct, departments(name)").eq("id", id).maybeSingle(),
    supabase.rpc("module_report", { p_module: id }),
    loadTheme(supabase, institutionId),
    supabase.from("institution_settings").select("min_attendance_pct").eq("institution_id", institutionId).maybeSingle(),
    supabase.from("lecturer_assignments").select("role, lecturers(full_name)").eq("module_id", id),
  ]);
  if (!mod || error) notFound();
  const rows = (data ?? []) as Row[];
  const refused = await auditExport(supabase, { kind: "module_report", rows: rows.length, moduleId: id, details: { format: "pdf" } });
  if (refused) return <main className="p-8"><ReportError error="This report could not be recorded in the audit log, so it was not shown. Try again." /></main>;

  const min = mod.min_attendance_pct ?? settings?.min_attendance_pct ?? 75;
  const colour = theme.colors.primary;
  const lecturers = (teachers ?? []).map((t) => (t.lecturers as unknown as { full_name: string } | null)?.full_name).filter(Boolean).join(", ") || "—";
  const counted = rows.filter((r) => r.percent != null);
  const avg = counted.length ? counted.reduce((s, r) => s + Number(r.percent), 0) / counted.length : null;
  const atRisk = rows.filter((r) => r.at_risk).length;
  const classes = rows[0]?.sessions ?? 0;
  const department = (mod.departments as unknown as { name: string } | null)?.name ?? "—";

  return (
    <PrintDocument institution={current.institution_name ?? "Institution"} logoUrl={theme.header.logoUrl || null} colour={colour}
      title="Module attendance" subtitle={`${mod.code} · ${mod.title}`}
      meta={[["Module", `${mod.code} · ${mod.title}`], ["Department", department], ["Lecturer(s)", lecturers], ["Required attendance", `${min}%`]]}>
      <section className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <DocFigure label="Students" value={rows.length} />
        <DocFigure label="Closed classes" value={classes} />
        <DocFigure label="Average attendance" value={pct(avg)} colour={colour} />
        <DocFigure label="At risk" value={atRisk} colour={atRisk ? "#b42318" : undefined} />
      </section>
      <p className="mt-2 mb-5 text-[11px] text-[#6b6e74]">Attendance is present + late over present + late + absent. &quot;Worst case&quot; counts records still in review or
        disputed as missed. A student is at risk when the worst case is below {min}%.</p>
      {rows.length === 0 ? <p>No students are enrolled in this module.</p> : (
        <table>
          <thead><tr><th>Student</th><th>Name</th><th className="num">Attended</th><th className="num">Late</th><th className="num">Absent</th>
            <th className="num">Excused</th><th className="num">Unres.</th><th className="num">Attendance</th><th className="num">Worst case</th><th>Status</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.student_number}>
              <td className="font-mono">{r.student_number}</td><td>{r.full_name}</td>
              <td className="num">{r.attended}</td><td className="num">{r.late}</td><td className="num">{r.absent}</td><td className="num">{r.excused}</td>
              <td className="num">{r.unresolved || "—"}</td><td className="num">{pct(r.percent)}</td>
              <td className="num" style={r.at_risk ? { color: "#b42318", fontWeight: 600 } : undefined}>{pct(r.worst_case_percent)}</td>
              <td>{r.at_risk ? "At risk" : r.meets_requirement === false ? "Below" : r.meets_requirement ? "Meets" : "—"}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
      <p className="mt-6 text-[11px] text-[#6b6e74]">Signed: ______________________ (lecturer) &nbsp;&nbsp; Date: ______________</p>
    </PrintDocument>
  );
}
