import "server-only";
import type { ClassEvent } from "@/components/class-list";
import { sastMidnight } from "@/lib/stats";
import type { supabaseServer } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof supabaseServer>>;

/**
 * The next seven days of dated classes the signed-in person may see (RLS decides:
 * their modules as lecturer, their enrolments as student, or a class they substitute).
 * Empty before migration 0027.
 */
export async function upcomingClasses(supabase: Supabase, opts: { moduleIds?: string[]; myLecturerId?: string | null } = {}): Promise<ClassEvent[]> {
  const from = sastMidnight(0), to = new Date(Date.parse(from) + 7 * 86400_000).toISOString();
  let q = supabase.from("timetable_events")
    .select("id, module_id, starts_at, ends_at, status, kind, group_name, note, requires_attendance, edited, session_id, lecturer_id, modules(code, title), venues(name), lecturers(full_name), class_sessions(status)")
    .gte("ends_at", new Date().toISOString() < from ? from : new Date(Date.now() - 2 * 3600_000).toISOString()).lt("starts_at", to)
    .order("starts_at").limit(120);
  if (opts.moduleIds && opts.myLecturerId) q = q.or(`module_id.in.(${opts.moduleIds.join(",") || "00000000-0000-0000-0000-000000000000"}),lecturer_id.eq.${opts.myLecturerId}`);
  const { data, error } = await q;
  if (error || !data) return [];
  const mine = new Set(opts.moduleIds ?? []);
  return data.map((e) => ({
    id: e.id, starts_at: e.starts_at, ends_at: e.ends_at, status: e.status, kind: e.kind, group_name: e.group_name, note: e.note,
    requires_attendance: e.requires_attendance, edited: e.edited, session_id: e.session_id,
    session_status: (e.class_sessions as unknown as { status: string } | null)?.status ?? null,
    module: e.modules as unknown as { code: string; title: string } | null,
    venue: (e.venues as unknown as { name: string } | null)?.name ?? null,
    lecturer: (e.lecturers as unknown as { full_name: string } | null)?.full_name ?? null,
    // Only the module's own lecturers change a class; a substitute just runs it.
    canChange: mine.has(e.module_id as string),
  }));
}
