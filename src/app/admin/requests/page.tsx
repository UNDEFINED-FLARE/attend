import { DataRequestList } from "@/components/data-requests";
import { PageHeader } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { loadDataRequests } from "@/lib/data-requests";

export const metadata = { title: "Personal information requests" };

export default async function AdminRequests() {
  const { supabase } = await requireRole("institution_admin");
  const { rows, error } = await loadDataRequests(supabase);
  return (
    <>
      <PageHeader title="Personal information requests"
        subtitle="Students and staff at your institution asking to see, correct or delete their information, or objecting to how it's used. Your institution decides (it is the responsible party); record the outcome here so the person is told." />
      <DataRequestList rows={rows} error={error} />
    </>
  );
}
