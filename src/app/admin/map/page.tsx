import { ActionForm } from "@/components/form";
import { Card, CardTitle, Field, Input, Notice, PageHeader } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { saveLocationSettings } from "../actions";
import { LiveMap, type Campus, type Venue } from "./live-map";

export const metadata = { title: "Live map" };

export default async function AdminMap() {
  const { supabase, institutionId } = await requireRole("institution_admin");
  const [{ data: s }, { data: campuses }, { data: venues }] = await Promise.all([
    supabase.from("institution_settings").select("location_sharing_enabled, location_interval_s").eq("institution_id", institutionId).single(),
    supabase.from("campuses").select("id, name, lat, lng, boundary").eq("institution_id", institutionId).is("deleted_at", null).order("name"),
    supabase.from("venues").select("id, name, code, lat, lng").eq("institution_id", institutionId).is("deleted_at", null).not("lat", "is", null),
  ]);
  if (!s) return null;
  const hasBoundary = (campuses ?? []).some((c) => c.boundary);

  return (
    <>
      <PageHeader title="Live map" subtitle="Students sharing their location on campus, and those who chose safety sharing off campus. Only the latest position is kept." />
      {!s.location_sharing_enabled && (
        <div className="mb-4"><Notice tone="warn">Campus location sharing is off. Draw your campus boundary, then turn it on below. Students must still agree before anything is shared.</Notice></div>
      )}
      {s.location_sharing_enabled && !hasBoundary && (
        <div className="mb-4"><Notice tone="warn">No campus has a boundary yet, so every student counts as off campus. Draw one with &ldquo;Edit boundary&rdquo;.</Notice></div>
      )}
      <LiveMap institutionId={institutionId} intervalS={s.location_interval_s}
        campuses={(campuses ?? []) as Campus[]} venues={(venues ?? []) as Venue[]} />
      <Card className="mt-6 max-w-xl">
        <CardTitle>Campus location sharing</CardTitle>
        <ActionForm action={saveLocationSettings} submit="Save">
          <label className="flex items-start gap-3 rounded-lg border border-line p-3">
            <input type="checkbox" name="location_sharing_enabled" defaultChecked={s.location_sharing_enabled} className="mt-1 size-4" />
            <span>
              <span className="block text-sm font-medium">Allow students to share their location on campus</span>
              <span className="text-xs text-muted">Each student still has to agree in the app. Sharing stops automatically when they leave campus unless they turn on safety sharing.</span>
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
