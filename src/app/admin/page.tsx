import Link from "next/link";
import { AreaChart, Bar, Donut, StatTile } from "@/components/charts";
import { Icon } from "@/components/icons";
import { ActionForm } from "@/components/form";
import { announceToInstitution } from "@/app/push-actions";
import { Badge, Card, CardTitle, Input, LinkButton, Select, Table, Td, Textarea, pct } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { HOURS, loadDashboard } from "@/lib/dashboard";
import { dayLabel, greeting, timeOf } from "@/lib/stats";

export const metadata = { title: "Dashboard" };

type Overview = { students: number; lecturers: number; modules: number; pending_reviews: number; open_disputes: number };

const METHOD: Record<string, string> = { qr: "QR + GPS", code: "Typed code", manual: "Lecturer", system: "Auto (closed)", acoustic: "Sound" };

export default async function AdminHome() {
  const { supabase, institutionId, current, user } = await requireRole("institution_admin");
  const [d, { data: ov }, { data: sub }] = await Promise.all([
    loadDashboard(supabase, institutionId),
    supabase.rpc("institution_overview", { p_inst: institutionId }),
    supabase.from("institution_subscriptions").select("status, subscription_plans(name, max_students)")
      .eq("institution_id", institutionId).in("status", ["trialing", "active", "past_due", "suspended"]).maybeSingle(),
  ]);
  const o = ov as Overview | null;
  const { inside, outside, noLoc } = d.gps;
  const todayRate = d.today.rate, yRate = d.yesterdayRate;
  const delta = todayRate != null && yRate != null ? Math.round((todayRate - yRate) * 10) / 10 : null;
  const anyToday = d.hourly.present.at(-1)! + d.hourly.late.at(-1)! + d.hourly.pending_verification.at(-1)! > 0;
  const anyData = d.daily.some((x) => x.rate != null) || anyToday;
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
        <StatTile icon="userCheck" tone="blue" label="Present today" value={d.today.present} hint={`of ${o?.students ?? 0} registered students`} />
        <StatTile icon="userX" tone="red" label="Absent today" value={d.today.absent} hint="Recorded when sessions close" />
        <StatTile icon="clock" tone="amber" label="Late arrivals" value={d.today.late} hint={`${d.today.pending} awaiting review`} />
        <StatTile icon="chart" tone="violet" label="Attendance rate" value={pct(todayRate)}
          hint={delta == null ? "Resolved records only" : <span className={delta >= 0 ? "text-ok" : "text-bad"}>{delta >= 0 ? "▲" : "▼"} {Math.abs(delta)} pts vs yesterday</span>} />
      </div>

      <Card className="mb-6">
        <CardTitle>Send an announcement <span className="font-normal text-muted">· reaches inboxes and phones with notifications on</span></CardTitle>
        <ActionForm action={announceToInstitution} submit="Send announcement" pending="Sending…" className="grid gap-3 md:grid-cols-[1fr_12rem] [&>[role]]:md:col-span-2 [&>button]:md:w-fit">
          <Input name="title" placeholder="Lectures cancelled on Friday" required maxLength={120} />
          <Select name="audience" defaultValue="students">
            <option value="students">Students</option><option value="lecturers">Lecturers</option>
            <option value="admins">Administrators</option><option value="all">Everyone</option>
          </Select>
          <Textarea name="body" placeholder="Graduation takes place in the main hall. All lectures move online." required maxLength={2000} className="md:col-span-2" />
        </ActionForm>
      </Card>

      <div className="mb-6 grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        <Card>
          <CardTitle>{anyToday ? "Today's check-ins" : "Attendance rate, last 14 days"}</CardTitle>
          {anyToday
            ? <AreaChart labels={HOURS.map((h) => `${h}:00`)} series={[
                { label: "Present", color: "var(--ink)", points: d.hourly.present },
                { label: "Late", color: "var(--warn)", points: d.hourly.late },
                { label: "Pending review", color: "var(--muted)", points: d.hourly.pending_verification },
              ]} />
            : <AreaChart unit="%" max={100} labels={d.daily.map((x) => dayLabel(x.day))} series={[{ label: "Attendance %", color: "var(--ink)", points: d.daily.map((x) => x.rate ?? 0) }]} />}
          {!anyData && <p className="mt-2 text-center text-sm text-muted">No attendance yet. The chart fills in as lecturers run sessions.</p>}
        </Card>
        <Card>
          <CardTitle action={<Link href="/admin/structure" className="inline-flex items-center gap-1 text-sm font-medium text-accent">Venues <Icon name="arrowRight" size={14} /></Link>}>
            Location checks <span className="font-normal text-muted">· 30 days</span>
          </CardTitle>
          <Donut center={inside + outside + noLoc ? `${Math.round((100 * inside) / (inside + outside + noLoc))}%` : "—"} sub="inside venue" segments={[
            { label: "Inside venue", value: inside, color: "var(--ink)" },
            { label: "Outside venue", value: outside, color: "var(--bad)" },
            { label: "No location", value: noLoc, color: "var(--line)" },
          ]} />
          <p className="mt-4 text-xs text-muted">Outside or missing location sends a check-in to review. It never marks a student absent on its own.</p>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.2fr_1fr]">
        <Card>
          <CardTitle>Attendance by department <span className="font-normal text-muted">· 30 days</span></CardTitle>
          <Table head={["Department", "Present", "Late", "Absent", "Attendance"]} empty="No records yet.">
            {d.departments.map((d) => (
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
          {d.recent.length === 0 && <p className="py-6 text-center text-sm text-muted">None yet.</p>}
          <ul className="divide-y divide-line">
            {d.recent.map((r, i) => (
              <li key={i} className="flex items-center gap-3 py-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-full bg-accent/10 text-sm font-semibold text-accent">{r.full_name?.[0] ?? "?"}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{r.full_name}</p>
                  <p className="truncate text-xs text-muted">{r.student_number} · {r.code}</p>
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
