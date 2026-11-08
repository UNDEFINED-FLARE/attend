import "server-only";
import type { getSession } from "@/lib/auth";
import { groupBy, rate, sastDay, sastHour, sastMidnight } from "@/lib/stats";

type Sb = NonNullable<Awaited<ReturnType<typeof getSession>>>["supabase"];

export const HOURS = Array.from({ length: 13 }, (_, i) => 6 + i); // 06:00–18:00

export type Dashboard = {
  today: { present: number; late: number; absent: number; pending: number; rate: number | null };
  yesterdayRate: number | null;
  hourly: Record<"present" | "late" | "pending_verification", number[]>; // cumulative per HOURS
  daily: { day: string; rate: number | null }[];
  departments: { name: string; present: number; late: number; absent: number; rate: number | null }[];
  gps: { inside: number; outside: number; noLoc: number };
  recent: { status: string; method: string; checked_in_at: string; full_name: string; student_number: string; code: string }[];
  source: "sql" | "fallback";
};

type Rollup = {
  today: Dashboard["today"]; yesterday_rate: number | null;
  hourly: { h: number; status: string; n: number }[];
  daily: { day: string; rate: number | null }[];
  departments: Dashboard["departments"];
  gps: { inside: number; outside: number; no_location: number };
  recent: Dashboard["recent"];
};

const cumulative = (counts: Map<number, number>) => {
  let n = 0;
  return HOURS.map((h) => (n += counts.get(h) ?? 0));
};

/**
 * Dashboard figures. Uses the institution_dashboard() SQL rollup (one query,
 * constant payload at any size). If that function is not installed yet
 * (migration 0007 not applied), falls back to aggregating capped rows here.
 */
export async function loadDashboard(supabase: Sb, institutionId: string): Promise<Dashboard> {
  const { data, error } = await supabase.rpc("institution_dashboard", { p_inst: institutionId });
  if (!error && data) {
    const r = data as Rollup;
    const hourly = (s: string) => cumulative(new Map(r.hourly.filter((x) => x.status === s).map((x) => [x.h, Number(x.n)])));
    return {
      today: { ...r.today, rate: r.today.rate == null ? null : Number(r.today.rate) },
      yesterdayRate: r.yesterday_rate == null ? null : Number(r.yesterday_rate),
      hourly: { present: hourly("present"), late: hourly("late"), pending_verification: hourly("pending_verification") },
      daily: r.daily.map((d) => ({ day: d.day, rate: d.rate == null ? null : Number(d.rate) })),
      departments: r.departments.map((d) => ({ ...d, rate: d.rate == null ? null : Number(d.rate) })),
      gps: { inside: r.gps.inside, outside: r.gps.outside, noLoc: r.gps.no_location },
      recent: r.recent,
      source: "sql",
    };
  }
  return fallback(supabase, institutionId);
}

type Rec = {
  status: string; method: string; checked_in_at: string | null; created_at: string;
  students: { full_name: string; student_number: string } | null;
  modules: { code: string; departments: { name: string } | null } | null;
};

async function fallback(supabase: Sb, institutionId: string): Promise<Dashboard> {
  const today = sastMidnight(0), since30 = sastMidnight(29);
  const [{ data: recData }, { data: evData }] = await Promise.all([
    supabase.from("attendance_records")
      .select("status, method, checked_in_at, created_at, students(full_name, student_number), modules(code, departments(name))")
      .eq("institution_id", institutionId).gte("created_at", since30).order("created_at", { ascending: false }).limit(5000),
    supabase.from("attendance_verification_events").select("layers")
      .eq("institution_id", institutionId).gte("created_at", since30).neq("outcome", "duplicate").limit(5000),
  ]);
  const recs = (recData ?? []) as unknown as Rec[];
  const todays = recs.filter((r) => r.created_at >= today);
  const count = (rows: Rec[], s: string) => rows.filter((r) => r.status === s).length;
  const hourly = (s: string) => cumulative(new Map(HOURS.map((h) => [h, todays.filter((r) => r.status === s && r.checked_in_at && sastHour(r.checked_in_at) === h).length])));
  const byDay = groupBy(recs, (r) => sastDay(r.created_at));
  let inside = 0, outside = 0, noLoc = 0;
  for (const e of evData ?? []) {
    const g = (e.layers as { gps?: { required?: boolean; p_inside?: number } })?.gps;
    if (!g || g.required === false) continue;
    if (g.p_inside == null) noLoc++; else if (g.p_inside >= 0.5) inside++; else outside++;
  }
  return {
    today: { present: count(todays, "present"), late: count(todays, "late"), absent: count(todays, "absent"), pending: count(todays, "pending_verification"), rate: rate(todays) },
    yesterdayRate: rate(recs.filter((r) => r.created_at >= sastMidnight(1) && r.created_at < today)),
    hourly: { present: hourly("present"), late: hourly("late"), pending_verification: hourly("pending_verification") },
    daily: Array.from({ length: 14 }, (_, i) => sastDay(sastMidnight(13 - i))).map((day) => ({ day, rate: rate(byDay.get(day) ?? []) })),
    departments: [...groupBy(recs, (r) => r.modules?.departments?.name ?? "No department")]
      .map(([name, rows]) => ({ name, present: count(rows, "present"), late: count(rows, "late"), absent: count(rows, "absent"), rate: rate(rows) }))
      .sort((a, b) => (a.rate ?? -1) - (b.rate ?? -1)),
    gps: { inside, outside, noLoc },
    recent: recs.filter((r) => r.checked_in_at).slice(0, 6).map((r) => ({
      status: r.status, method: r.method, checked_in_at: r.checked_in_at!, full_name: r.students?.full_name ?? "", student_number: r.students?.student_number ?? "", code: r.modules?.code ?? "",
    })),
    source: "fallback",
  };
}
