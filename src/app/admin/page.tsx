import Link from "next/link";
import { AreaChart, Bar, Donut, StatTile } from "@/components/charts";
import { Icon } from "@/components/icons";
import { Badge, Card, CardTitle, LinkButton, Table, Td, pct } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { dayLabel, greeting, groupBy, rate, sastDay, sastHour, sastMidnight, timeOf } from "@/lib/stats";

export const metadata = { title: "Dashboard" };

type Rec = {
  status: string; method: string; checked_in_at: string | null; created_at: string; score: number | null;
  students: { full_name: string; student_number: string } | null;
  modules: { code: string; departments: { name: string } | null } | null;
};
type Overview = { students: number; lecturers: number; modules: number; pending_reviews: number; open_disputes: number };

const METHOD: Record<string, string> = { qr: "QR + GPS", code: "Typed code", manual: "Lecturer", system: "Auto (closed)", acoustic: "Sound" };

export default async function AdminHome() {
  const { supabase, institutionId, current, user } = await requireRole("institution_admin");
  const today = sastMidnight(0), since = sastMidnight(13), since30 = sastMidnight(29);

  // One read of the last 30 days. RLS limits it to this institution; the cap
  // keeps the page fast at pilot scale (a SQL rollup replaces it at full scale).
  const [{ data: recData }, { data: evData }, { data: ov }, { data: sub }] = await Promise.all([
    supabase.from("attendance_records")
      .select("status, method, checked_in_at, created_at, score, students(full_name, student_number), modules(code, departments(name))")
      .eq("institution_id", institutionId).gte("created_at", since30).order("created_at", { ascending: false }).limit(5000),
    supabase.from("attendance_verification_events").select("layers, outcome")
      .eq("institution_id", institutionId).gte("created_at", since30).neq("outcome", "duplicate").limit(5000),
    supabase.rpc("institution_overview", { p_inst: institutionId }),
    supabase.from("institution_subscriptions").select("status, subscription_plans(name, max_students)")
      .eq("institution_id", institutionId).in("status", ["trialing", "active", "past_due", "suspended"]).maybeSingle(),
  ]);
  const recs = (recData ?? []) as unknown as Rec[];
  const o = ov as Overview | null;
  const todays = recs.filter((r) => r.created_at >= today);
  const count = (rows: Rec[], s: string) => rows.filter((r) => r.status === s).length;
  const yesterday = recs.filter((r) => r.created_at >= sastMidnight(1) && r.created_at < today);

  // Today's check-ins by hour, 06:00–18:00, cumulative.
  const hours = Array.from({ length: 13 }, (_, i) => 6 + i);
  const cum = (s: string) => {
    let n = 0;
    return hours.map((h) => (n += todays.filter((r) => r.status === s && r.checked_in_at && sastHour(r.checked_in_at) === h).length));
  };
  // 14-day daily rate.
  const days = Array.from({ length: 14 }, (_, i) => sastDay(sastMidnight(13 - i)));
  const byDay = groupBy(recs.filter((r) => r.created_at >= since), (r) => sastDay(r.created_at));
  const dailyRate = days.map((d) => rate(byDay.get(d) ?? []) ?? 0);

  // By department, 30 days.
  const byDept = [...groupBy(recs, (r) => r.modules?.departments?.name ?? "No department")]
    .map(([name, rows]) => ({ name, present: count(rows, "present"), late: count(rows, "late"), absent: count(rows, "absent"), rate: rate(rows) }))
    .sort((a, b) => (a.rate ?? 101) - (b.rate ?? 101));

  // Location check outcomes, 30 days.
  let inside = 0, outside = 0, noLoc = 0;
  for (const e of evData ?? []) {
    const g = (e.layers as { gps?: { required?: boolean; shared?: boolean; p_inside?: number } })?.gps;
    if (!g || g.required === false) continue;
    if (g.shared === false || g.p_inside == null) noLoc++;
    else if (g.p_inside >= 0.5) inside++;
    else outside++;
  }

  const recent = recs.filter((r) => r.checked_in_at).slice(0, 6);
  const todayRate = rate(todays), yRate = rate(yesterday);
  const delta = todayRate != null && yRate != null ? Math.round((todayRate - yRate) * 10) / 10 : null;
  const plan = sub?.subscription_plans as unknown as { name: string } | undefined;
  const name = (user.user_metadata as { full_name?: string })?.full_name?.split(" ")[0];

  return (
    <>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{greeting()}{name ? `, ${name}` : ""}</h1>
          <p className="mt-1 text-sm text-muted">Here&apos;s what&apos;s happening at {current.institution_name} today.</p>
        </div>
        <div className="flex gap-2">
          <LinkButton href="/admin/people" variant="secondary"><Icon name="users" size={16} />Import students</LinkButton>
          <LinkButton href="/admin/structure"><Icon name="map" size={16} />Map venues</LinkButton>
        </div>
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile icon="userCheck" tone="blue" label="Present today" value={count(todays, "present")} hint={`of ${o?.students ?? 0} registered students`} />
        <StatTile icon="userX" tone="red" label="Absent today" value={count(todays, "absent")} hint="Recorded when sessions close" />
        <StatTile icon="clock" tone="amber" label="Late arrivals" value={count(todays, "late")} hint={`${count(todays, "pending_verification")} awaiting review`} />
        <StatTile icon="chart" tone="violet" label="Attendance rate" value={pct(todayRate)}
          hint={delta == null ? "Resolved records only" : <span className={delta >= 0 ? "text-ok" : "text-bad"}>{delta >= 0 ? "▲" : "▼"} {Math.abs(delta)} pts vs yesterday</span>} />
      </div>

      <div className="mb-6 grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        <Card>
          <CardTitle>{todays.some((r) => r.checked_in_at) ? "Today's check-ins" : "Attendance rate, last 14 days"}</CardTitle>
          {todays.some((r) => r.checked_in_at)
            ? <AreaChart labels={hours.map((h) => `${h}:00`)} series={[
                { label: "Present", color: "#2f6fed", points: cum("present") },
                { label: "Late", color: "#d97706", points: cum("late") },
                { label: "Pending review", color: "#7c3aed", points: cum("pending_verification") },
              ]} />
            : <AreaChart unit="%" max={100} labels={days.map(dayLabel)} series={[{ label: "Attendance %", color: "#2f6fed", points: dailyRate }]} />}
          {recs.length === 0 && <p className="mt-2 text-center text-sm text-muted">No attendance yet. The chart fills in as lecturers run sessions.</p>}
        </Card>
        <Card>
          <CardTitle action={<Link href="/admin/structure" className="inline-flex items-center gap-1 text-sm font-medium text-accent">Venues <Icon name="arrowRight" size={14} /></Link>}>
            Location checks <span className="font-normal text-muted">· 30 days</span>
          </CardTitle>
          <Donut center={inside + outside + noLoc ? `${Math.round((100 * inside) / (inside + outside + noLoc))}%` : "—"} sub="inside venue" segments={[
            { label: "Inside venue", value: inside, color: "#16a34a" },
            { label: "Outside venue", value: outside, color: "#dc2626" },
            { label: "No location", value: noLoc, color: "#94a3b8" },
          ]} />
          <p className="mt-4 text-xs text-muted">Outside or missing location sends a check-in to review. It never marks a student absent on its own.</p>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.2fr_1fr]">
        <Card>
          <CardTitle>Attendance by department <span className="font-normal text-muted">· 30 days</span></CardTitle>
          <Table head={["Department", "Present", "Late", "Absent", "Attendance"]} empty="No records yet.">
            {byDept.map((d) => (
              <tr key={d.name}>
                <Td className="font-medium">{d.name}</Td>
                <Td className="text-ok">{d.present}</Td><Td className="text-warn">{d.late}</Td><Td className="text-bad">{d.absent}</Td>
                <Td><div className="flex items-center gap-3"><span className="w-12 tabular-nums">{pct(d.rate)}</span><Bar value={d.rate} /></div></Td>
              </tr>
            ))}
          </Table>
        </Card>
        <Card>
          <CardTitle>Recent check-ins</CardTitle>
          {recent.length === 0 && <p className="py-6 text-center text-sm text-muted">None yet.</p>}
          <ul className="divide-y divide-line">
            {recent.map((r, i) => (
              <li key={i} className="flex items-center gap-3 py-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-full bg-accent/10 text-sm font-semibold text-accent">{r.students?.full_name?.[0] ?? "?"}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{r.students?.full_name}</p>
                  <p className="truncate text-xs text-muted">{r.students?.student_number} · {r.modules?.code}</p>
                </div>
                <Badge status={r.status} />
                <div className="hidden w-24 text-right text-xs text-muted sm:block">{timeOf(r.checked_in_at)}<br />{METHOD[r.method] ?? r.method}</div>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MiniLink href="/admin/people" icon="users" label="Students" value={o?.students ?? 0} />
        <MiniLink href="/admin/people" icon="user" label="Lecturers" value={o?.lecturers ?? 0} />
        <MiniLink href="/admin/modules" icon="book" label="Modules" value={o?.modules ?? 0} />
        <MiniLink href="/admin/settings" icon="card" label={`Plan${plan ? `: ${plan.name}` : ""}`} value={sub?.status ? <Badge status={sub.status} /> : "—"} />
      </div>
    </>
  );
}

function MiniLink({ href, icon, label, value }: { href: string; icon: Parameters<typeof Icon>[0]["name"]; label: string; value: React.ReactNode }) {
  return (
    <Link href={href} className="flex items-center gap-3 rounded-2xl bg-surface p-4 shadow-card transition hover:-translate-y-0.5">
      <span className="grid size-10 place-items-center rounded-xl bg-bg text-muted"><Icon name={icon} /></span>
      <span className="text-sm text-muted">{label}</span>
      <span className="ml-auto text-lg font-semibold tabular-nums">{value}</span>
    </Link>
  );
}
