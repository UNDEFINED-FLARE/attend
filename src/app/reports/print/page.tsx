import { PrintDocument } from "@/components/print-document";
import { ReportError } from "@/components/report-view";
import { ReportPrint } from "@/components/report-print";
import { requireAnyRole } from "@/lib/auth";
import { auditExport } from "@/lib/audit-export";
import { loadReport, parseFilters, REPORT_ROLES } from "@/lib/report";
import { loadTheme } from "@/lib/shell-data";

export const metadata = { title: "Attendance report" };

const day = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric" });

// The institutional report on the institution's letterhead, for printing or
// "Save as PDF". Opening it is recorded in the audit log like any download.
export default async function PrintableReport({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { supabase, institutionId, current } = await requireAnyRole(REPORT_ROLES);
  const f = parseFilters(await searchParams);
  const [{ report, error }, theme] = await Promise.all([loadReport(supabase, institutionId, f), loadTheme(supabase, institutionId)]);
  if (!report) return <main className="p-8"><ReportError error={error ?? "Could not prepare the report."} /></main>;
  const refused = await auditExport(supabase, { kind: "institution_report", rows: report.by_module.length + report.at_risk.length, institutionId,
    details: { format: "pdf", from: report.from, to: report.to, scope: "all" } });
  if (refused) return <main className="p-8"><ReportError error="This report could not be recorded in the audit log, so it was not shown. Try again." /></main>;

  const scope = [f.faculty && "one faculty", f.department && "one department", f.module && "one module"].filter(Boolean).join(", ") || "All modules you may see";
  return (
    <PrintDocument institution={current.institution_name ?? "Institution"} logoUrl={theme.header.logoUrl || null} colour={theme.colors.primary}
      title="Attendance report" subtitle={`${day(report.from)} – ${day(report.to)}`}
      meta={[["Period", `${day(report.from)} – ${day(report.to)}`], ["Scope", scope], ["Modules", String(report.totals.modules)]]}>
      <ReportPrint r={report} colour={theme.colors.primary} />
    </PrintDocument>
  );
}
