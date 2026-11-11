import { FeatureOff } from "@/components/feature-off";
import { loadTheme } from "@/lib/shell-data";
import { AppTitle } from "@/components/app-chrome";
import { Notice } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { loadCampuses } from "@/lib/shell-data";
import { Navigator, type Destination, type NextClass } from "./navigator";

export const metadata = { title: "Find my class" };

export default async function Navigate() {
  const { supabase, institutionId } = await requireRole("student");
  if (!(await loadTheme(supabase, institutionId)).features.directions) return <FeatureOff name="Walking directions" />;
  const [{ data: classes }, { data: venues }, campuses] = await Promise.all([
    supabase.rpc("my_next_classes", { p_inst: institutionId, p_limit: 5 }),
    supabase.from("venues").select("id, name, code, lat, lng, radius_m").eq("institution_id", institutionId)
      .is("deleted_at", null).not("lat", "is", null).order("name"),
    loadCampuses(supabase, institutionId),
  ]);
  const dests = (venues ?? []) as Destination[];
  return (
    <div className="mx-auto max-w-3xl">
      <AppTitle title="Find my class" eyebrow="Walking directions" sub="To your next class or any venue on campus." />
      {dests.length === 0 ? (
        <Notice>No venues have been placed on the map yet. Ask your administrator to add venue locations.</Notice>
      ) : (
        <Navigator classes={(classes ?? []) as NextClass[]} venues={dests}
          outlines={campuses.flatMap((c) => (c.outline && c.outline.length >= 3 ? [c.outline] : []))} />
      )}
    </div>
  );
}
