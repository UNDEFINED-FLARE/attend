import Link from "next/link";
import { Bar, StatTile } from "@/components/charts";
import { Icon } from "@/components/icons";
import { Badge, Card, CardTitle, pct } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { greeting, groupBy, rate, sastMidnight, timeOf } from "@/lib/stats";

export const metadata = { title: "Home" };

const COLORS = ["#2f6fed", "#16a34a", "#d97706", "#7c3aed", "#db2777", "#0891b2"];

export default async function LecturerHome() {
  const { supabase, institutionId, user } = await requireRole("lecturer");
  const { data: me } = await supabase.from("lecturers").select("id, full_name")
    .eq("institution_id", institutionId).eq("user_id", user.id).maybeSingle();
  const { data: assigned } = await supabase.from("lecturer_assignments")
    .select("role, modules(id, code, title)").eq("lecturer_id", me?.id ?? "00000000-0000-0000-0000-000000000000");
  const modules = (assigned ?? []).map((a) => ({ role: a.role, ...(a.modules as unknown as { id: string; code: string; title: string }) }));
  const ids = modules.map((m) => m.id);
  const none = ["00000000-0000-0000-0000-000000000000"];

  const [{ data: sessions }, { data: recs }, { data: enrol }] = await Promise.all([
    supabase.from("class_sessions").select("id, title, status, join_code, opens_at, closes_at, module_id, modules(code), venues(name)")
      .in("module_id", ids.length ? ids : none).gte("opens_at", sastMidnight(29)).order("opens_at", { ascending: false }).limit(200),
    supabase.from("attendance_records").select("module_id, status").in("module_id", ids.length ? ids : none)
      .gte("created_at", sastMidnight(29)).limit(5000),
    supabase.from("module_enrolments").select("module_id").in("module_id", ids.length ? ids : none).eq("status", "active"),
  ]);
  const open = (sessions ?? []).filter((s) => s.status === "open");
  const week = (sessions ?? []).filter((s) => s.opens_at >= sastMidnight(6)).length;
  const byModule = groupBy(recs ?? [], (r) => r.module_id as string);
  const enrolled = groupBy(enrol ?? [], (e) => e.module_id as string);
  const toReview = (recs ?? []).filter((r) => r.status === "pending_verification" || r.status === "disputed").length;

  return (
    <>
      <div className="mb-6">
        <p className="text-sm text-muted">{greeting()} 👋</p>
        <h1 className="text-2xl font-semibold tracking-tight">{me?.full_name ?? "Welcome"}</h1>
      </div>

      {open.length > 0 && (
        <section className="mb-6 overflow-hidden rounded-3xl bg-gradient-to-br from-[#14532d] via-[#16a34a] to-[#15803d] p-6 text-white shadow-card">
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider"><span className="size-2 animate-pulse rounded-full bg-white" />Live now</p>
          <ul className="mt-3 space-y-3">
            {open.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-lg font-semibold">{(s.modules as unknown as { code: string }).code} · {s.title}</p>
                  <p className="text-sm opacity-85">{(s.venues as unknown as { name: string } | null)?.name ?? "No venue"} · code <span className="font-mono font-semibold tracking-widest">{s.join_code}</span> · closes {timeOf(s.closes_at)}</p>
                </div>
                <Link href={`/lecturer/sessions/${s.id}`} className="inline-flex h-11 items-center gap-2 rounded-xl bg-white px-4 text-sm font-semibold text-[#15803d]">
                  <Icon name="qr" size={18} />Show QR & register
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile icon="book" tone="blue" label="My modules" value={modules.length} />
        <StatTile icon="users" tone="green" label="Students" value={(enrol ?? []).length} hint="Active enrolments" />
        <StatTile icon="calendar" tone="violet" label="Sessions this week" value={week} />
        <StatTile icon="flag" tone="amber" label="To review" value={toReview} hint={<Link href="/lecturer/disputes" className="text-accent">Open reviews →</Link>} />
      </div>

      <h2 className="mb-3 text-lg font-semibold">My modules</h2>
      {modules.length === 0 && <Card><p className="text-center text-sm text-muted">No modules are assigned to you yet. Your institution administrator assigns them.</p></Card>}
      <div className="mb-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {modules.map((m, i) => {
          const r = rate(byModule.get(m.id) ?? []);
          const c = COLORS[i % COLORS.length];
          return (
            <Link key={m.id} href={`/lecturer/modules/${m.id}`} className="group rounded-2xl bg-surface p-5 shadow-card transition hover:-translate-y-0.5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-base font-semibold" style={{ color: c }}>{m.title}</p>
                  <p className="text-sm text-muted">{m.code} · {(enrolled.get(m.id) ?? []).length} students</p>
                </div>
                <span className="rounded-lg bg-bg px-2 py-1 text-[11px] font-medium text-muted">{m.role}</span>
              </div>
              <div className="mt-4 flex items-center gap-3">
                <Bar value={r} color={c} />
                <span className="w-14 text-right text-sm font-semibold tabular-nums">{pct(r)}</span>
              </div>
              <p className="mt-1 text-xs text-muted">Attendance, last 30 days</p>
              <span className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-accent">Start session or view report <Icon name="arrowRight" size={14} className="transition group-hover:translate-x-0.5" /></span>
            </Link>
          );
        })}
      </div>

      <Card>
        <CardTitle>Recent sessions</CardTitle>
        {(sessions ?? []).length === 0 && <p className="py-4 text-center text-sm text-muted">No sessions in the last 30 days.</p>}
        <ul className="divide-y divide-line">
          {(sessions ?? []).slice(0, 8).map((s) => (
            <li key={s.id}>
              <Link href={`/lecturer/sessions/${s.id}`} className="flex items-center gap-3 py-3 hover:bg-bg/60">
                <span className="grid size-10 place-items-center rounded-xl bg-bg text-muted"><Icon name="calendar" size={18} /></span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{(s.modules as unknown as { code: string }).code} · {s.title}</p>
                  <p className="text-xs text-muted">{new Date(s.opens_at).toLocaleDateString("en-ZA", { weekday: "short", day: "numeric", month: "short" })} · {timeOf(s.opens_at)}</p>
                </div>
                <Badge status={s.status} />
              </Link>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
