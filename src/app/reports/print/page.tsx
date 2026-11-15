import { ReportBody, ReportError } from "@/components/report-view";
import { requireAnyRole } from "@/lib/auth";
import { auditExport } from "@/lib/audit-export";
import { loadReport, parseFilters, REPORT_ROLES } from "@/lib/report";
import { PrintReport } from "./print-report";

export const metadata = { title: "Attendance report" };

// The report on plain pages for printing or "Save as PDF". Opening it is recorded in
// the audit log like any other report download.
export default async function PrintableReport({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { supabase, institutionId, current } = await requireAnyRole(REPORT_ROLES);
  const f = parseFilters(await searchParams);
  const { report, error } = await loadReport(supabase, institutionId, f);
  if (report) {
    const refused = await auditExport(supabase, { kind: "institution_report", rows: report.by_module.length + report.at_risk.length, institutionId,
      details: { format: "pdf", from: report.from, to: report.to, scope: "all" } });
    if (refused) return <main className="p-8"><ReportError error="This report could not be recorded in the audit log, so it was not shown. Try again." /></main>;
  }
  return (
    <main className="mx-auto max-w-5xl bg-bg p-6 print:max-w-none print:bg-white print:p-0">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3 border-b border-line pb-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">{current.institution_name}</p>
          <h1 className="text-2xl font-semibold">Attendance report</h1>
          {report && <p className="text-xs text-muted">Generated {new Date(report.generated_at).toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg" })} by UniAttend</p>}
        </div>
        <PrintReport />
      </header>
      {error && <ReportError error={error} />}
      {report && <ReportBody r={report} f={f} print />}
      <p className="mt-8 text-xs text-muted">Attendance is present + late over present + late + absent, closed classes only. Excused classes are left out.
        Records still in review or disputed are shown separately and never counted as absences. Contains personal information: handle under the institution&apos;s POPIA policy.</p>
    </main>
  );
}
