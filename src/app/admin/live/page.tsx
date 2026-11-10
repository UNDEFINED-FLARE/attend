import { ActionForm } from "@/components/form";
import { Card, CardTitle, Field, Input, Notice, PageHeader } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import type { LatLng } from "@/lib/campuses";
import { loadCampuses } from "@/lib/shell-data";
import { saveLocationSettings } from "../actions";
import { LiveMap, type LiveVenue } from "./live-map";

export const metadata = { title: "Live map" };

export default async function AdminLive() {
  const { supabase, institutionId } = await requireRole("institution_admin");
  const [{ data: s }, { data: venueRows }, campuses] = await Promise.all([
    supabase.from("institution_settings").select("location_sharing_enabled, location_interval_s").eq("institution_id", institutionId).single(),
    supabase.from("venues").select("id, name, lat, lng, radius_m, polygon").eq("institution_id", institutionId).is("deleted_at", null),
    loadCampuses(supabase, institutionId),
  ]);
  if (!s) {
    return <Notice tone="warn">Campus location sharing needs database update 0013. Run it in the Supabase SQL editor, then reload.</Notice>;
  }
  const venues: LiveVenue[] = (venueRows ?? []).map((v) => ({ ...v, polygon: (v.polygon as LatLng[] | null) ?? null }));
  const hasOutline = campuses.some((c) => c.outline && c.outline.length >= 3);

  return (
    <>
      <PageHeader title="Live map" subtitle="Students sharing their location on campus, and those who chose safety sharing off campus. Only each student's latest position is kept." />
      {!s.location_sharing_enabled && (
        <div className="mb-4"><Notice tone="warn">Campus location sharing is off. Turn it on below. Each student must still agree in the app before anything is shared.</Notice></div>
      )}
      {s.location_sharing_enabled && !hasOutline && (
        <div className="mb-4"><Notice tone="warn">No campus has an outline yet, so every student counts as off campus. Draw it under Venues &amp; map.</Notice></div>
      )}
      <LiveMap institutionId={institutionId} intervalS={s.location_interval_s} campuses={campuses} venues={venues} />
      <Card className="mt-6 max-w-xl">
        <CardTitle>Campus location sharing</CardTitle>
        <ActionForm action={saveLocationSettings} submit="Save">
          <label className="flex items-start gap-3 rounded-lg border border-line p-3">
            <input type="checkbox" name="location_sharing_enabled" defaultChecked={s.location_sharing_enabled} className="mt-1 size-4" />
            <span>
              <span className="block text-sm font-medium">Allow students to share their location on campus</span>
              <span className="text-xs text-muted">Each student still has to agree. Sharing stops automatically when they leave campus unless they turn on safety sharing.</span>
            </span>
          </label>
          <Field label="Update every (seconds)" hint="15–900. Shorter is more live but uses more battery.">
            <Input name="location_interval_s" type="number" min={15} max={900} defaultValue={s.location_interval_s} />
          </Field>
        </ActionForm>
      </Card>
    </>
  );
}
