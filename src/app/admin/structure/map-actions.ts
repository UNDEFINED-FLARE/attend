"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth";

type S = { error?: string; ok?: string } | undefined;

const Placement = z.object({
  id: z.string().uuid(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  radius_m: z.number().int().min(5).max(2000),
  polygon: z.array(z.tuple([z.number().min(-90).max(90), z.number().min(-180).max(180)])).min(3).max(500).nullable(),
});

/** Auto-map: place many existing venues at once on the building outlines/points chosen by the admin. */
export async function mapVenuesBulk(_: S, f: FormData): Promise<S> {
  let rows: z.infer<typeof Placement>[];
  try {
    const r = z.array(Placement).min(1).max(1000).safeParse(JSON.parse(String(f.get("placements") ?? "[]")));
    if (!r.success) return { error: "Tick at least one venue to place." };
    rows = r.data;
  } catch { return { error: "Tick at least one venue to place." }; }
  const { supabase, institutionId } = await requireRole("institution_admin");
  let done = 0;
  for (const v of rows) {
    // RLS limits updates to this admin's institution; the extra filter keeps the intent explicit.
    const { error, count } = await supabase.from("venues")
      .update({ lat: v.lat, lng: v.lng, radius_m: v.radius_m, polygon: v.polygon }, { count: "exact" })
      .eq("id", v.id).eq("institution_id", institutionId);
    if (error) return { error: `${done} placed, then: ${error.message}` };
    done += count ?? 0;
  }
  revalidatePath("/admin/structure");
  revalidatePath("/student/map");
  return { ok: `${done} venue${done === 1 ? "" : "s"} placed on the map. Students now see them on the campus map.` };
}
