import { ReportPage } from "@/components/report-page";
import { requireAnyRole, STAFF_ROLES } from "@/lib/auth";

export const metadata = { title: "Attendance reports" };

export default async function StaffReports({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { supabase, institutionId } = await requireAnyRole(STAFF_ROLES);
  return <ReportPage supabase={supabase} institutionId={institutionId} searchParams={await searchParams} action="/staff/reports"
    subtitle="The modules you oversee." />;
}
