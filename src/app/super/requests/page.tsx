import { DataRequestList } from "@/components/data-requests";
import { PageHeader } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { loadDataRequests } from "@/lib/data-requests";

export const metadata = { title: "Personal information requests" };

export default async function SuperRequests() {
  const { supabase } = await requireRole("super_admin");
  const { rows, error } = await loadDataRequests(supabase);
  return (
    <>
      <PageHeader title="Personal information requests"
        subtitle="Every request on the platform. Institutions answer for their records; deleting a login account is done here by support (Supabase → Authentication → Users), then marked done." />
      <DataRequestList rows={rows} error={error} />
    </>
  );
}
