import Link from "next/link";
import { OnboardingChecklist, type Onboarding } from "@/components/onboarding-checklist";
import { Card, CardTitle, Notice, PageHeader } from "@/components/ui";
import { requireRole } from "@/lib/auth";

export const metadata = { title: "Go-live checklist" };

export default async function OnboardingPage() {
  const { supabase, institutionId } = await requireRole("institution_admin");
  const { data, error } = await supabase.rpc("onboarding_status", { p_inst: institutionId });
  const o = data as Onboarding | null;
  const done = o ? o.steps.filter((s) => s.done).length : 0;
  return (
    <>
      <PageHeader title="Go-live checklist" subtitle={o ? `${done} of ${o.steps.length} steps done${o.live ? " · live" : ""}` : undefined} />
      {error && <Notice tone={error.code === "PGRST202" ? "warn" : "bad"}>{error.code === "PGRST202" ? "This needs the latest database update (migration 0032)." : error.message}</Notice>}
      {o && (
        <Card className="mb-6">
          <CardTitle>From registration to go-live</CardTitle>
          <p className="mb-4 text-sm text-muted">Steps marked &quot;from your data&quot; tick themselves when the records are there. You sign off the attendance
            policy and training; UniAttend verifies your institution and approves go-live.</p>
          <OnboardingChecklist data={o} institutionId={institutionId} viewer="admin" />
        </Card>
      )}
      <p className="text-sm text-muted">Your data, exports and leaving UniAttend: <Link href="/admin/exit" className="text-info hover:underline">Your data and leaving</Link>.</p>
    </>
  );
}
