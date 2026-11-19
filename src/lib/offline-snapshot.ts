import "server-only";
import type { getSession } from "@/lib/auth";
import { upcomingClasses } from "@/lib/class-events";
import type { OfflineClass, OfflineModule, OfflineRecord, OfflineSession, OfflineSnapshot, OfflineVenue } from "@/lib/offline-data";
import { OFFLINE_VERSION } from "@/lib/offline-data";
import { sastMidnight } from "@/lib/stats";
import { myTimetable } from "@/lib/student-data";
import { teachingTimetable } from "@/lib/timetable-export";

type Sb = NonNullable<Awaited<ReturnType<typeof getSession>>>["supabase"];
type Ctx = { supabase: Sb; institutionId: string; institutionName: string; userId: string; fallbackName: string };

const NONE = ["00000000-0000-0000-0000-000000000000"];
const HISTORY = 60, SESSIONS = 60, VENUES = 400;

// Every query runs as the signed-in person, so RLS decides what goes into the copy,
// exactly as it does for the pages it stands in for.

const toClasses = (c: Awaited<ReturnType<typeof upcomingClasses>>): OfflineClass[] => c.map((e) => ({
  id: e.id, starts_at: e.starts_at, ends_at: e.ends_at, status: e.status, kind: e.kind, group_name: e.group_name, note: e.note,
  edited: e.edited, module: e.module, venue: e.venue, lecturer: e.lecturer,
}));

async function venues(supabase: Sb, institutionId: string): Promise<OfflineVenue[]> {
  const { data } = await supabase.from("venues").select("id, name, lat, lng")
    .eq("institution_id", institutionId).is("deleted_at", null).order("name").limit(VENUES);
  return (data ?? []).map((v) => ({ id: v.id, name: v.name, lat: v.lat == null ? null : Number(v.lat), lng: v.lng == null ? null : Number(v.lng) }));
}

const base = (c: Ctx, role: OfflineSnapshot["role"], name: string | null | undefined) => ({
  v: OFFLINE_VERSION, userId: c.userId, role, name: name || c.fallbackName,
  institution: { id: c.institutionId, name: c.institutionName }, savedAt: new Date().toISOString(),
});

export async function studentSnapshot(c: Ctx): Promise<OfflineSnapshot> {
  const { supabase, institutionId } = c;
  const { data: me } = await supabase.from("students").select("id, full_name")
    .eq("institution_id", institutionId).eq("user_id", c.userId).maybeSingle();
  const [slots, classes, { data: summary }, places, { data: recs }] = await Promise.all([
    myTimetable(supabase, institutionId),
    upcomingClasses(supabase),
    supabase.rpc("my_attendance"),
    venues(supabase, institutionId),
    // Their own records only (and by student, so the database uses its index).
    supabase.from("attendance_records").select("id, status, created_at, checked_in_at, modules(code, title)")
      .eq("institution_id", institutionId).eq("student_id", me?.id ?? NONE[0])
      .order("created_at", { ascending: false }).limit(HISTORY),
  ]);
  type Sum = { module_id: string; code: string; title: string; attended: number; absent: number; unresolved: number; percent: number | null; min_pct: number; institution_id: string };
  const rows = ((summary ?? []) as Sum[]).filter((r) => r.institution_id === institutionId);
  // Modules from the timetable too, in case one has no attendance yet.
  const modules = new Map<string, OfflineModule>(rows.map((r) => [r.module_id, {
    id: r.module_id, code: r.code, title: r.title, attended: r.attended, absent: r.absent, unresolved: r.unresolved,
    percent: r.percent == null ? null : Number(r.percent), min_pct: Number(r.min_pct),
  }]));
  for (const s of slots) if (!modules.has(s.module_id)) modules.set(s.module_id, { id: s.module_id, code: s.code, title: s.title });
  const history: OfflineRecord[] = (recs ?? []).map((r) => {
    const m = r.modules as unknown as { code: string; title: string } | null;
    return { id: r.id, status: r.status, at: (r.checked_in_at as string | null) ?? r.created_at, code: m?.code ?? null, title: m?.title ?? null };
  });
  return {
    ...base(c, "student", me?.full_name),
    timetable: slots.map((s) => ({
      id: s.id, weekday: s.weekday, starts_at: s.starts_at, ends_at: s.ends_at, kind: s.kind, group_name: s.group_name,
      code: s.code, title: s.title, venue: s.venue, venue_id: s.venue_id,
    })),
    classes: toClasses(classes), modules: [...modules.values()].sort((a, b) => a.code.localeCompare(b.code)),
    venues: places, history, sessions: [],
  };
}

export async function lecturerSnapshot(c: Ctx): Promise<OfflineSnapshot> {
  const { supabase, institutionId } = c;
  const { data: me } = await supabase.from("lecturers").select("id, full_name")
    .eq("institution_id", institutionId).eq("user_id", c.userId).maybeSingle();
  const { data: assigned } = await supabase.from("lecturer_assignments")
    .select("modules(id, code, title)").eq("lecturer_id", me?.id ?? NONE[0]);
  const mods = (assigned ?? []).map((a) => a.modules as unknown as { id: string; code: string; title: string }).filter(Boolean);
  const ids = mods.map((m) => m.id);
  const [slots, classes, places, { data: enrol }, { data: sess }] = await Promise.all([
    teachingTimetable(supabase, institutionId, c.userId),
    upcomingClasses(supabase, { moduleIds: ids, myLecturerId: me?.id ?? null }),
    venues(supabase, institutionId),
    supabase.from("module_enrolments").select("module_id").in("module_id", ids.length ? ids : NONE).eq("status", "active"),
    supabase.from("class_sessions").select("id, title, status, opens_at, closes_at, modules(code), venues(name)")
      .in("module_id", ids.length ? ids : NONE).gte("opens_at", sastMidnight(13))
      .order("opens_at", { ascending: false }).limit(SESSIONS),
  ]);
  const count = new Map<string, number>();
  for (const e of enrol ?? []) count.set(e.module_id as string, (count.get(e.module_id as string) ?? 0) + 1);
  const sessions: OfflineSession[] = (sess ?? []).map((s) => ({
    id: s.id, title: s.title, status: s.status, opens_at: s.opens_at, closes_at: s.closes_at,
    code: (s.modules as unknown as { code: string } | null)?.code ?? null, venue: (s.venues as unknown as { name: string } | null)?.name ?? null,
  }));
  return {
    ...base(c, "lecturer", me?.full_name),
    timetable: slots.filter((s) => s.mine).map((s) => ({
      id: s.id, weekday: s.weekday, starts_at: s.starts_at, ends_at: s.ends_at, kind: s.kind, group_name: s.group_name,
      code: s.code, title: s.title, venue: s.venue, venue_id: s.venue_id,
    })),
    classes: toClasses(classes),
    modules: mods.map((m) => ({ ...m, students: count.get(m.id) ?? 0 })).sort((a, b) => a.code.localeCompare(b.code)),
    venues: places, history: [], sessions,
  };
}
