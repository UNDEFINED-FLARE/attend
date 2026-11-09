import { hhmm, todayWeekday } from "@/components/week-grid";
import { requireRole } from "@/lib/auth";
import { loadTheme } from "@/lib/shell-data";
import { greeting, sastDay } from "@/lib/stats";
import { myTimetable, nowHHMM } from "@/lib/student-data";
import { badgeOf, colorFor, DashboardView, type DashRec, type DashRow } from "./dashboard-view";
import type { TrendSeries } from "./trend-card";

export const metadata = { title: "Home" };

type Row = DashRow;
type Rec = DashRec;

const ATTENDED = new Set(["present", "late"]), RESOLVED = new Set(["present", "late", "absent"]);

/** Monday (SAST) of the week containing this date, as YYYY-MM-DD. */
function weekOf(iso: string) {
  const d = new Date(`${sastDay(iso)}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

export default async function StudentHome() {
  const { supabase, institutionId, user } = await requireRole("student");
  const nowIso = new Date().toISOString();
  const since = new Date(Date.now() - 8 * 7 * 864e5).toISOString();
  const recSelect = (late: boolean) => supabase.from("attendance_records")
    .select(`id, status, session_id, checked_in_at, created_at, module_id${late ? ", minutes_late" : ""}, modules(code, title), class_sessions(title, opens_at)`)
    .eq("institution_id", institutionId).gte("created_at", since).order("created_at", { ascending: false }).limit(600);
  const [{ data }, { data: open }, { data: me }, recRes, theme, slots] = await Promise.all([
    supabase.rpc("my_attendance"),
    supabase.from("class_sessions").select("id, title, opens_at, closes_at, late_after, modules(code, title), venues(name)")
      .eq("status", "open").eq("institution_id", institutionId).gt("closes_at", nowIso).order("opens_at"),
    supabase.from("students").select("full_name, student_number").eq("institution_id", institutionId).eq("user_id", user.id).maybeSingle(),
    recSelect(true),
    loadTheme(supabase, institutionId),
    myTimetable(supabase, institutionId),
  ]);
  // minutes_late needs database update 0010; older databases still load.
  const recs = ((recRes.error ? (await recSelect(false)).data : recRes.data) ?? []) as unknown as Rec[];

  const rows = ((data ?? []) as Row[]).filter((r) => r.institution_id === institutionId);
  const now = nowHHMM(), day = todayWeekday();
  const todaySlots = slots.filter((t) => t.weekday === day);
  const done = new Set(recs.map((r) => r.session_id));
  const live = (open ?? []).filter((s) => !done.has(s.id));
  const att = rows.reduce((a, r) => a + r.attended, 0), tot = rows.reduce((a, r) => a + r.attended + r.absent, 0);
  const overall = tot ? Math.round((1000 * att) / tot) / 10 : null;
  const pending = rows.reduce((a, r) => a + r.unresolved, 0);
  const atRisk = rows.filter((r) => r.percent != null && r.percent < r.min_pct);
  const first = (me?.full_name ?? (user.user_metadata as { full_name?: string })?.full_name ?? "").split(" ")[0];
  const hello = (theme.student.greeting || "{greeting}").replace("{greeting}", greeting()).replace("{name}", first || "");
  const nextSlot = todaySlots.find((t) => hhmm(t.ends_at) > now);

  // Weekly series for the trend chart: overall and per module, last 8 weeks.
  const weeks = Array.from({ length: 8 }, (_, k) => weekOf(new Date(Date.now() - (7 - k) * 7 * 864e5).toISOString()));
  const wkLabel = (w: string) => new Date(`${w}T12:00:00Z`).toLocaleDateString("en-ZA", { day: "numeric", month: "short" });
  const seriesFor = (filter: (r: Rec) => boolean) => weeks.map((w) => {
    const inWeek = recs.filter((r) => filter(r) && RESOLVED.has(r.status) && weekOf(r.class_sessions?.opens_at ?? r.created_at) === w);
    return { label: wkLabel(w), att: inWeek.filter((r) => ATTENDED.has(r.status)).length, tot: inWeek.length };
  });
  const series: TrendSeries[] = [
    { key: "all", label: "All modules", badge: "", color: "var(--accent)", points: seriesFor(() => true) },
    ...rows.map((r) => ({ key: r.module_id, label: r.code, badge: badgeOf(r.code), color: colorFor(r.code), points: seriesFor((x) => x.module_id === r.module_id) })),
  ];

  // This week, Monday to Sunday, with a dot per kind of class that day.
  const monday = new Date(`${weekOf(nowIso)}T12:00:00Z`);
  const week = Array.from({ length: 7 }, (_, k) => {
    const d = new Date(monday); d.setUTCDate(monday.getUTCDate() + k);
    const kinds = new Set(slots.filter((s) => s.weekday === k + 1).map((s) => (/test|exam/i.test(s.kind) ? "test" : /prac|tut|lab/i.test(s.kind) ? "prac" : "lecture")));
    return { wd: k + 1, date: d.getUTCDate(), letter: "MTWTFSS"[k], kinds };
  });
  return <DashboardView d={{ theme, hello, first, studentNumber: me?.student_number ?? null, rows, recs, live, series, todaySlots, nextSlot, now, day,
    overall, att, tot, pending, atRisk, week }} />;
}
