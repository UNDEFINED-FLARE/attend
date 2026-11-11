import "server-only";
import type { Slot } from "@/components/week-grid";
import type { getSession } from "@/lib/auth";
import { buildIcs, type IcsClass } from "@/lib/ics";

type Sb = NonNullable<Awaited<ReturnType<typeof getSession>>>["supabase"];

/** Today as a SAST calendar date (UTC midnight of that date). */
function sastToday(): Date {
  const d = new Date(Date.now() + 2 * 3600_000);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Repeat until the end of the current semester or term, or 20 weeks if none is set. */
async function repeatUntil(supabase: Sb, institutionId: string, today: Date): Promise<Date> {
  const iso = today.toISOString().slice(0, 10);
  const { data } = await supabase.from("academic_periods").select("ends_on, kind, is_current")
    .eq("institution_id", institutionId).lte("starts_on", iso).gte("ends_on", iso).order("ends_on");
  const best = (data ?? []).find((p) => p.kind !== "year") ?? (data ?? [])[0];
  return best ? new Date(`${best.ends_on}T00:00:00Z`) : new Date(today.getTime() + 20 * 7 * 864e5);
}

/** A timetable as a downloadable .ics response. */
export async function timetableIcs(supabase: Sb, institutionId: string, name: string, file: string,
                                   slots: (Slot & { lecturer?: string | null })[]): Promise<Response> {
  const today = sastToday();
  const until = await repeatUntil(supabase, institutionId, today);
  const classes: IcsClass[] = slots.map((s) => ({ id: s.id, weekday: s.weekday, starts_at: s.starts_at, ends_at: s.ends_at,
    code: s.code, title: s.title, kind: s.kind, venue: s.venue, lecturer: s.lecturer ?? null }));
  return new Response(buildIcs({ name, classes, from: today, until }), {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="${file}.ics"`,
      "Cache-Control": "private, no-store",
    },
  });
}

export type TeachingSlot = Slot & { venue_id: string | null; module_id: string; lecturer: string | null; mine: boolean };

/** Every timetabled class of the modules this lecturer teaches; `mine` when they are the named lecturer or none is named. */
export async function teachingTimetable(supabase: Sb, institutionId: string, userId: string): Promise<TeachingSlot[]> {
  const { data: me } = await supabase.from("lecturers").select("id").eq("institution_id", institutionId).eq("user_id", userId).maybeSingle();
  if (!me) return [];
  const { data: assigned } = await supabase.from("lecturer_assignments").select("module_id").eq("lecturer_id", me.id);
  const ids = (assigned ?? []).map((a) => a.module_id as string);
  if (!ids.length) return [];
  const q = (withLecturer: boolean) => supabase.from("timetables")
    .select(`id, weekday, starts_at, ends_at, kind, group_name, venue_id, module_id, modules(code, title), venues(name)${withLecturer ? ", lecturer_id, lecturers(full_name)" : ""}`)
    .in("module_id", ids).order("weekday").order("starts_at");
  let res = await q(true);
  if (res.error) res = await q(false);
  return ((res.data ?? []) as unknown as {
    id: string; weekday: number; starts_at: string; ends_at: string; kind: string; group_name: string | null; venue_id: string | null; module_id: string;
    modules: { code: string; title: string }; venues: { name: string } | null; lecturer_id?: string | null; lecturers?: { full_name: string } | null;
  }[]).map((r) => ({
    id: r.id, weekday: r.weekday, starts_at: r.starts_at, ends_at: r.ends_at, kind: r.kind, group_name: r.group_name,
    venue_id: r.venue_id, module_id: r.module_id, code: r.modules.code, title: r.modules.title, venue: r.venues?.name ?? null,
    lecturer: r.lecturers?.full_name ?? null, mine: !r.lecturer_id || r.lecturer_id === me.id,
  }));
}
