import { AppTitle } from "@/components/app-chrome";
import Link from "next/link";
import { Icon } from "@/components/icons";
import { CampusMap, type MapClass, type MapVenue } from "@/components/map/campus-map";
import { todayWeekday } from "@/components/week-grid";
import { requireRole } from "@/lib/auth";
import type { LatLng } from "@/lib/campuses";
import { timeOf } from "@/lib/stats";
import { loadCampuses } from "@/lib/shell-data";
import { nowHHMM } from "@/lib/student-data";

export const metadata = { title: "Campus map" };

type Row = { venue_id: string | null; module_id: string; weekday: number; kind: string; starts_at: string; ends_at: string;
  modules: { code: string; title: string } | null; venues: { name: string } | null; lecturers?: { full_name: string } | null };

export default async function StudentMap() {
  const { supabase, institutionId } = await requireRole("student");
  const today = todayWeekday(), tomorrow = (today % 7) + 1;

  // Lecturer names need database update 0008; without it, load classes without them.
  const slotQuery = (withLecturer: boolean) => supabase.from("timetables")
    .select(`venue_id, module_id, weekday, kind, starts_at, ends_at, modules(code, title), venues(name)${withLecturer ? ", lecturers(full_name)" : ""}`)
    .eq("institution_id", institutionId).in("weekday", [today, tomorrow]);
  let slots = await slotQuery(true);
  if (slots.error) slots = await slotQuery(false);

  const [{ data: venueRows }, { data: enrol }, { data: open }] = await Promise.all([
    supabase.from("venues").select("id, name, lat, lng, radius_m, polygon").eq("institution_id", institutionId).is("deleted_at", null).order("name"),
    supabase.from("module_enrolments").select("module_id").eq("institution_id", institutionId).eq("status", "active"),
    supabase.from("class_sessions").select("venue_id, module_id, opens_at, closes_at, modules(code, title), venues(name)")
      .eq("institution_id", institutionId).eq("status", "open"),
  ]);
  const campuses = await loadCampuses(supabase, institutionId);
  const mine = new Set((enrol ?? []).map((e) => e.module_id as string));
  const venues: MapVenue[] = (venueRows ?? []).map((v) => ({ ...v, polygon: (v.polygon as LatLng[] | null) ?? null }));
  const rows = (slots.data ?? []) as unknown as Row[];
  const toClass = (t: Row, day: "today" | "tomorrow"): MapClass => ({
    venue_id: t.venue_id, code: t.modules?.code ?? "", title: t.modules?.title ?? "", kind: t.kind,
    starts_at: t.starts_at, ends_at: t.ends_at, mine: mine.has(t.module_id), live: false,
    lecturer: t.lecturers?.full_name ?? null, venue_name: t.venues?.name ?? null, day,
  });

  // Everything on campus today (so students see what is in each venue), plus live attendance sessions.
  const classes: MapClass[] = [
    ...rows.filter((t) => t.weekday === today).map((t) => toClass(t, "today")),
    ...(open ?? []).map((s) => {
      const m = s.modules as unknown as { code: string; title: string };
      return { venue_id: s.venue_id as string | null, code: m.code, title: m.title, kind: "attendance", starts_at: timeOf(s.opens_at), ends_at: timeOf(s.closes_at),
               mine: true, live: true, venue_name: (s.venues as unknown as { name: string } | null)?.name ?? null, day: "today" as const };
    }),
  ];
  // The student's own next classes: the rest of today, then tomorrow.
  const upcoming = [
    ...rows.filter((t) => t.weekday === today && mine.has(t.module_id)).map((t) => toClass(t, "today")),
    ...rows.filter((t) => t.weekday === tomorrow && mine.has(t.module_id)).map((t) => toClass(t, "tomorrow")),
  ].sort((a, b) => (a.day === b.day ? a.starts_at.localeCompare(b.starts_at) : a.day === "today" ? -1 : 1));

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <AppTitle title="Campus map" eyebrow="What's on now" sub="Every venue's classes today, and where your next class is. Tap a venue for details." />
      <div className="grid grid-cols-2 gap-3 sm:flex">
        <Link href="/student/navigate" className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-accent px-5 text-sm font-semibold text-white shadow-[0_8px_20px_color-mix(in_srgb,var(--accent)_35%,transparent)]">
          <Icon name="pin" size={18} />Find my class
        </Link>
        <Link href="/student/location" className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-surface px-5 text-sm font-semibold shadow-card">
          <Icon name="shield" size={18} />Location sharing
        </Link>
      </div>
      {venues.length === 0
        ? <p className="rounded-[28px] bg-surface p-8 text-center text-sm text-muted shadow-card">Your institution hasn&apos;t mapped its venues yet.</p>
        : <CampusMap venues={venues} classes={classes} upcoming={upcoming} campuses={campuses} now={nowHHMM()} />}
    </div>
  );
}
