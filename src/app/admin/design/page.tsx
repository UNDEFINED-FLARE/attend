import { PageHeader } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { loadTheme } from "@/lib/shell-data";
import { Designer } from "./designer";

export const metadata = { title: "Design" };

export default async function DesignPage() {
  const { supabase, institutionId, current } = await requireRole("institution_admin");
  const theme = await loadTheme(supabase, institutionId);
  return (
    <>
      <PageHeader title="Design your platform"
        subtitle="Colours, header, footer and every card students see. Changes preview live and apply to everyone at your institution when you save." />
      <Designer initial={theme} institutionName={current.institution_name ?? "Your institution"} />
    </>
  );
}
