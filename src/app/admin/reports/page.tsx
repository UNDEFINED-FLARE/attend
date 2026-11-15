import { ReportPage } from "@/components/report-page";
import { requireRole } from "@/lib/auth";

export const metadata = { title: "Attendance reports" };

export default async function AdminReports({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { supabase, institutionId } = await requireRole("institution_admin");
  return <ReportPage supabase={supabase} institutionId={institutionId} searchParams={await searchParams} action="/admin/reports"
    subtitle="The whole institution, by faculty, department and module." />;
}
