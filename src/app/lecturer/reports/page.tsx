import { ReportPage } from "@/components/report-page";
import { requireRole } from "@/lib/auth";

export const metadata = { title: "Attendance reports" };

export default async function LecturerReports({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { supabase, institutionId } = await requireRole("lecturer");
  return <ReportPage supabase={supabase} institutionId={institutionId} searchParams={await searchParams} action="/lecturer/reports"
    subtitle="The modules you teach." />;
}
