import "server-only";
import type { Slot } from "@/components/week-grid";
import type { getSession } from "@/lib/auth";

type Sb = NonNullable<Awaited<ReturnType<typeof getSession>>>["supabase"];

/** Timetable slots for the modules the signed-in student is enrolled in (RLS-scoped). */
export async function myTimetable(supabase: Sb, institutionId: string): Promise<(Slot & { venue_id: string | null; module_id: string })[]> {
  const { data: enrol } = await supabase.from("module_enrolments").select("module_id").eq("institution_id", institutionId).eq("status", "active");
  const ids = (enrol ?? []).map((e) => e.module_id as string);
  if (!ids.length) return [];
  const { data } = await supabase.from("timetables")
    .select("id, weekday, starts_at, ends_at, kind, group_name, venue_id, module_id, modules(code, title), venues(name)")
    .in("module_id", ids).order("weekday").order("starts_at");
  return (data ?? []).map((r) => {
    const m = r.modules as unknown as { code: string; title: string };
    return { id: r.id, weekday: r.weekday, starts_at: r.starts_at, ends_at: r.ends_at, kind: r.kind, group_name: r.group_name,
             venue_id: r.venue_id, module_id: r.module_id, code: m.code, title: m.title,
             venue: (r.venues as unknown as { name: string } | null)?.name ?? null };
  });
}

/** "HH:MM" now in South African time. */
export function nowHHMM(): string {
  const d = new Date(Date.now() + 2 * 3600_000);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}
