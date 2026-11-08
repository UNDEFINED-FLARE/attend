import { CampusMap, type MapClass, type MapVenue } from "@/components/map/campus-map";
import { todayWeekday } from "@/components/week-grid";
import { requireRole } from "@/lib/auth";
import type { LatLng } from "@/lib/campuses";
import { timeOf } from "@/lib/stats";
import { nowHHMM } from "@/lib/student-data";

export const metadata = { title: "Campus map" };

export default async function StudentMap() {
  const { supabase, institutionId, current } = await requireRole("student");
  const [{ data: venueRows }, { data: today }, { data: enrol }, { data: open }] = await Promise.all([
    supabase.from("venues").select("id, name, lat, lng, radius_m, polygon").eq("institution_id", institutionId).is("deleted_at", null).order("name"),
    // Every class on campus today, so students can see what is in each venue.
    supabase.from("timetables").select("venue_id, module_id, kind, starts_at, ends_at, modules(code, title)")
      .eq("institution_id", institutionId).eq("weekday", todayWeekday()).not("venue_id", "is", null),
    supabase.from("module_enrolments").select("module_id").eq("institution_id", institutionId).eq("status", "active"),
    supabase.from("class_sessions").select("venue_id, module_id, opens_at, closes_at, modules(code, title)")
      .eq("institution_id", institutionId).eq("status", "open").not("venue_id", "is", null),
  ]);
  const mine = new Set((enrol ?? []).map((e) => e.module_id as string));
  const venues: MapVenue[] = (venueRows ?? []).map((v) => ({ ...v, polygon: (v.polygon as LatLng[] | null) ?? null }));
  const classes: MapClass[] = [
    ...(today ?? []).map((t) => {
      const m = t.modules as unknown as { code: string; title: string };
      return { venue_id: t.venue_id as string, code: m.code, title: m.title, kind: t.kind, starts_at: t.starts_at, ends_at: t.ends_at, mine: mine.has(t.module_id), live: false };
    }),
    // Sessions a lecturer has opened right now (only the student's own modules are visible).
    ...(open ?? []).map((s) => {
      const m = s.modules as unknown as { code: string; title: string };
      return { venue_id: s.venue_id as string, code: m.code, title: m.title, kind: "attendance", starts_at: timeOf(s.opens_at), ends_at: timeOf(s.closes_at), mine: true, live: true };
    }),
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Campus map</h1>
        <p className="text-sm text-muted">Every lecture venue and what&apos;s on in it today. Tap a venue for its classes.</p>
      </div>
      {venues.length === 0
        ? <p className="rounded-2xl bg-surface p-8 text-center text-sm text-muted shadow-card">Your institution hasn&apos;t mapped its venues yet.</p>
        : <CampusMap venues={venues} classes={classes} institutionName={current.institution_name} now={nowHHMM()} />}
    </div>
  );
}
