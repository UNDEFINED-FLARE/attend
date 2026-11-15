import "server-only";
import type { getSession, Role } from "@/lib/auth";
import type { Sheet } from "@/lib/xlsx";

type Sb = NonNullable<Awaited<ReturnType<typeof getSession>>>["supabase"];

/** Everyone who may open an institutional report (the database narrows it to their modules). */
export const REPORT_ROLES: Role[] = ["institution_admin", "attendance_officer", "auditor", "faculty_admin", "department_admin", "lecturer"];

export type ReportFilters = { from?: string; to?: string; faculty?: string; department?: string; module?: string };
export type Report = {
  from: string; to: string; default_min_pct: number; generated_at: string;
  totals: { modules: number; sessions: number; present: number; late: number; absent: number; excused: number; unresolved: number; rate: number | null };
  by_faculty: { name: string; modules: number; sessions: number; rate: number | null; late: number; unresolved: number }[];
  by_department: { name: string; faculty: string; modules: number; sessions: number; rate: number | null; late: number; unresolved: number }[];
  by_module: { id: string; code: string; title: string; department: string; min_pct: number; students: number; sessions: number;
    present: number; late: number; absent: number; excused: number; unresolved: number; rate: number | null }[];
  trend: { week: string; sessions: number; rate: number | null }[];
  at_risk: { student_number: string; full_name: string; module_code: string; min_pct: number; attended: number; absent: number;
    unresolved: number; consecutive_absences: number; worst_case: number | null }[];
  missing_registers: number; open_disputes: number;
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f-]{36}$/i;

/** Only well-formed values reach the database; anything else is ignored. */
export function parseFilters(sp: Record<string, string | string[] | undefined>): ReportFilters {
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string).trim() : "");
  const f: ReportFilters = {};
  if (DATE.test(one("from"))) f.from = one("from");
  if (DATE.test(one("to"))) f.to = one("to");
  for (const k of ["faculty", "department", "module"] as const) if (UUID.test(one(k))) f[k] = one(k);
  return f;
}

export function filterQuery(f: ReportFilters, extra: Record<string, string> = {}): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...f, ...extra })) if (v) q.set(k, v);
  return q.toString();
}

export async function loadReport(supabase: Sb, institutionId: string, f: ReportFilters) {
  const { data, error } = await supabase.rpc("institution_report", {
    p_inst: institutionId, p_from: f.from ?? null, p_to: f.to ?? null,
    p_faculty: f.faculty ?? null, p_department: f.department ?? null, p_module: f.module ?? null,
  });
  if (error) return { report: null, error: error.code === "PGRST202" ? "Reports need the latest database update (migration 0031)." : error.message };
  return { report: data as Report, error: null };
}

/** The options for the filter form: what this person can see in the institution. */
export async function loadFilterOptions(supabase: Sb, institutionId: string) {
  const [{ data: faculties }, { data: departments }, { data: modules }] = await Promise.all([
    supabase.from("faculties").select("id, name").eq("institution_id", institutionId).is("deleted_at", null).order("name"),
    supabase.from("departments").select("id, name").eq("institution_id", institutionId).is("deleted_at", null).order("name"),
    supabase.from("modules").select("id, code, title").eq("institution_id", institutionId).is("deleted_at", null).order("code").limit(2000),
  ]);
  return { faculties: faculties ?? [], departments: departments ?? [], modules: modules ?? [] };
}

const n = (v: number | null | undefined) => (v == null ? null : Number(v));

/** The report as workbook sheets (Excel) — also the source of the CSV sections. */
export function reportSheets(r: Report, institution: string): Sheet[] {
  const t = r.totals;
  return [
    { name: "Summary", header: ["Item", "Value"], rows: [
      ["Institution", institution], ["Period", `${r.from} to ${r.to}`], ["Generated", new Date(r.generated_at).toISOString()],
      ["Modules", n(t.modules)], ["Closed classes", n(t.sessions)], ["Attendance rate (%)", n(t.rate)],
      ["Present", n(t.present)], ["Late", n(t.late)], ["Absent", n(t.absent)], ["Excused", n(t.excused)],
      ["Unresolved (in review or disputed)", n(t.unresolved)], ["Classes without a register", n(r.missing_registers)],
      ["Open disputes", n(r.open_disputes)], ["Students at risk (rows)", r.at_risk.length],
      ["How the rate is counted", "Present + late over present + late + absent, closed classes only. Excused classes are left out; unresolved records are reported separately, never as absences."],
    ] },
    { name: "By faculty", header: ["Faculty", "Modules", "Classes", "Attendance %", "Late", "Unresolved"],
      rows: r.by_faculty.map((x) => [x.name, n(x.modules), n(x.sessions), n(x.rate), n(x.late), n(x.unresolved)]) },
    { name: "By department", header: ["Department", "Faculty", "Modules", "Classes", "Attendance %", "Late", "Unresolved"],
      rows: r.by_department.map((x) => [x.name, x.faculty, n(x.modules), n(x.sessions), n(x.rate), n(x.late), n(x.unresolved)]) },
    { name: "By module", header: ["Module", "Title", "Department", "Required %", "Students", "Classes", "Present", "Late", "Absent", "Excused", "Unresolved", "Attendance %"],
      rows: r.by_module.map((x) => [x.code, x.title, x.department, n(x.min_pct), n(x.students), n(x.sessions), n(x.present), n(x.late), n(x.absent), n(x.excused), n(x.unresolved), n(x.rate)]) },
    { name: "Weekly trend", header: ["Week starting", "Classes", "Attendance %"], rows: r.trend.map((x) => [x.week, n(x.sessions), n(x.rate)]) },
    { name: "Students at risk", header: ["Student number", "Name", "Module", "Required %", "Attended", "Absent", "Unresolved", "Absences in a row", "Worst-case %"],
      rows: r.at_risk.map((x) => [x.student_number, x.full_name, x.module_code, n(x.min_pct), n(x.attended), n(x.absent), n(x.unresolved), n(x.consecutive_absences), n(x.worst_case)]) },
  ];
}
