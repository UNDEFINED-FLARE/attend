import { ReportBody, ReportError, ReportFiltersForm } from "@/components/report-view";
import { PageHeader } from "@/components/ui";
import type { getSession } from "@/lib/auth";
import { loadFilterOptions, loadReport, parseFilters } from "@/lib/report";

type Sb = NonNullable<Awaited<ReturnType<typeof getSession>>>["supabase"];

/** The reports page, shared by administrators, staff and lecturers; the database decides the scope. */
export async function ReportPage({ supabase, institutionId, searchParams, action, subtitle }: {
  supabase: Sb; institutionId: string; searchParams: Record<string, string | string[] | undefined>; action: string; subtitle: string;
}) {
  const f = parseFilters(searchParams);
  const [{ report, error }, opts] = await Promise.all([loadReport(supabase, institutionId, f), loadFilterOptions(supabase, institutionId)]);
  return (
    <>
      <PageHeader title="Attendance reports" subtitle={subtitle} />
      <ReportFiltersForm f={f} r={report} faculties={opts.faculties} departments={opts.departments}
        modules={report ? opts.modules.filter((m) => report.by_module.some((x) => x.id === m.id) || m.id === f.module) : opts.modules} action={action} />
      {error && <ReportError error={error} />}
      {report && <ReportBody r={report} f={f} exportBase="/reports/export" />}
    </>
  );
}
