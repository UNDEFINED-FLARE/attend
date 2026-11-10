import { Notice, PageHeader } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { LocationSharing } from "./location-sharing";

export const metadata = { title: "Location sharing" };

export default async function StudentLocation() {
  const { supabase, institutionId, current, user } = await requireRole("student");
  const [{ data: s }, { data: consent }] = await Promise.all([
    supabase.from("institution_settings").select("location_sharing_enabled, location_interval_s").eq("institution_id", institutionId).single(),
    supabase.from("location_consents").select("granted_at, withdrawn_at").eq("institution_id", institutionId).eq("user_id", user.id).maybeSingle(),
  ]);
  return (
    <div className="mx-auto max-w-lg">
      <PageHeader title="Campus location sharing" subtitle={current.institution_name ?? undefined} />
      {!s?.location_sharing_enabled ? (
        <Notice>Your institution has not turned on campus location sharing. Nothing about your location is collected outside check-in.</Notice>
      ) : (
        <LocationSharing institutionId={institutionId} intervalS={s.location_interval_s}
          institutionName={current.institution_name ?? "your institution"}
          consented={!!consent && !consent.withdrawn_at} />
      )}
    </div>
  );
}
