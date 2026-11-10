import { Notice, PageHeader } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { Navigator, type Destination, type NextClass } from "./navigator";

export const metadata = { title: "Find my class" };

export default async function Navigate() {
  const { supabase, institutionId } = await requireRole("student");
  const [{ data: classes }, { data: venues }, { data: campuses }] = await Promise.all([
    supabase.rpc("my_next_classes", { p_inst: institutionId, p_limit: 5 }),
    supabase.from("venues").select("id, name, code, lat, lng, radius_m").eq("institution_id", institutionId)
      .is("deleted_at", null).not("lat", "is", null).order("name"),
    supabase.from("campuses").select("boundary").eq("institution_id", institutionId).is("deleted_at", null).not("boundary", "is", null),
  ]);
  const dests = (venues ?? []) as Destination[];
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Find my class" subtitle="Walking directions to your next class or any venue on campus." />
      {dests.length === 0 ? (
        <Notice>No venues have been placed on the map yet. Ask your administrator to add venue locations.</Notice>
      ) : (
        <Navigator classes={(classes ?? []) as NextClass[]} venues={dests}
          boundaries={(campuses ?? []).map((c) => c.boundary)} />
      )}
    </div>
  );
}
