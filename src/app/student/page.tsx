import Link from "next/link";
import { Ring } from "@/components/charts";
import { Icon, type IconName } from "@/components/icons";
import { Badge, pct } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { greeting, timeOf } from "@/lib/stats";

export const metadata = { title: "Home" };

type Row = { module_id: string; code: string; title: string; attended: number; absent: number;
             excused: number; unresolved: number; percent: number | null; min_pct: number; institution_id: string };

const COLORS = ["#2f6fed", "#16a34a", "#d97706", "#7c3aed", "#db2777", "#0891b2", "#dc2626", "#4f46e5"];
const colorFor = (code: string) => COLORS[[...code].reduce((a, c) => a + c.charCodeAt(0), 0) % COLORS.length];

export default async function StudentHome() {
  const { supabase, institutionId, user } = await requireRole("student");
  const nowIso = new Date().toISOString();
  const [{ data }, { data: open }, { data: me }, { data: recent }] = await Promise.all([
    supabase.rpc("my_attendance"),
    supabase.from("class_sessions").select("id, title, closes_at, late_after, modules(code, title), venues(name)")
      .eq("status", "open").eq("institution_id", institutionId).gt("closes_at", nowIso).order("opens_at"),
    supabase.from("students").select("full_name, student_number").eq("institution_id", institutionId).eq("user_id", user.id).maybeSingle(),
    supabase.from("attendance_records").select("id, status, session_id, checked_in_at, created_at, modules(code)")
      .eq("institution_id", institutionId).order("created_at", { ascending: false }).limit(5),
  ]);
  const rows = ((data ?? []) as Row[]).filter((r) => r.institution_id === institutionId);
  const done = new Set((recent ?? []).map((r) => r.session_id));
  const live = (open ?? []).filter((s) => !done.has(s.id));
  const att = rows.reduce((a, r) => a + r.attended, 0), tot = rows.reduce((a, r) => a + r.attended + r.absent, 0);
  const overall = tot ? Math.round((1000 * att) / tot) / 10 : null;
  const pending = rows.reduce((a, r) => a + r.unresolved, 0);
  const atRisk = rows.filter((r) => r.percent != null && r.percent < r.min_pct);
  const first = (me?.full_name ?? (user.user_metadata as { full_name?: string })?.full_name ?? "").split(" ")[0];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <p className="text-sm text-muted">{greeting()} 👋</p>
        <h1 className="text-2xl font-semibold tracking-tight">{first || "Welcome"}</h1>
        {me?.student_number && <p className="text-sm text-muted">Student number {me.student_number}</p>}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        {/* Hero */}
        <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#1d4ed8] via-[#2f6fed] to-[#0b2545] p-6 text-white shadow-card">
          <div aria-hidden className="absolute -right-10 -top-10 size-44 rounded-full bg-white/10" />
          <div aria-hidden className="absolute -bottom-16 right-20 size-36 rounded-full bg-white/10" />
          <div className="relative flex items-center gap-6">
            <Ring value={overall} size={112}>
              <span className="text-center"><span className="block text-2xl font-semibold">{overall == null ? "—" : `${Math.round(overall)}%`}</span><span className="text-[11px] opacity-80">overall</span></span>
            </Ring>
            <div className="min-w-0">
              <p className="text-sm opacity-80">Your attendance</p>
              <p className="mt-1 text-lg font-semibold">{att} of {tot} sessions attended</p>
              <p className="mt-2 text-sm opacity-90">
                {atRisk.length ? `Below the requirement in ${atRisk.map((r) => r.code).join(", ")}` : rows.length ? "On track in every module" : "No modules yet"}
              </p>
              {pending > 0 && <p className="mt-1 text-xs opacity-80">{pending} awaiting review, not counted against you</p>}
            </div>
          </div>
        </section>

        {/* Live session or check-in prompt */}
        {live.length > 0 ? (
          <section className="rounded-3xl bg-surface p-5 shadow-card ring-2 ring-ok/40">
            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-ok"><span className="size-2 animate-pulse rounded-full bg-ok" />Happening now</p>
            {live.slice(0, 2).map((s) => {
              const m = s.modules as unknown as { code: string; title: string };
              return (
                <div key={s.id} className="mt-3">
                  <p className="text-lg font-semibold" style={{ color: colorFor(m.code) }}>{m.title}</p>
                  <p className="text-sm text-muted">{m.code} · {(s.venues as unknown as { name: string } | null)?.name ?? "Venue not set"} · until {timeOf(s.closes_at)}</p>
                </div>
              );
            })}
            <Link href="/student/check-in" className="mt-4 flex h-12 items-center justify-center gap-2 rounded-xl bg-accent font-medium text-white hover:opacity-90">
              <Icon name="scan" />Check in now
            </Link>
          </section>
        ) : (
          <section className="flex flex-col justify-between rounded-3xl bg-surface p-5 shadow-card">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted">No session open</p>
              <p className="mt-2 text-sm text-muted">When your lecturer opens attendance, it appears here. You can also scan the code on the projector at any time.</p>
            </div>
            <Link href="/student/check-in" className="mt-4 flex h-11 items-center justify-center gap-2 rounded-xl border border-line font-medium hover:bg-bg">
              <Icon name="qr" />Open scanner
            </Link>
          </section>
        )}
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-4 gap-3">
        <Quick href="/student/check-in" icon="scan" label="Check in" tone="text-accent bg-accent/10" />
        <Quick href="/student/history" icon="history" label="History" tone="text-ok bg-ok/10" />
        <Quick href="/student/history#dispute" icon="flag" label="Dispute" tone="text-warn bg-warn/10" />
        <Quick href="/notifications" icon="bell" label="Alerts" tone="text-violet bg-violet/10" />
      </div>

      {/* Modules */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">My modules</h2>
          <Link href="/student/history" className="text-sm font-medium text-accent">See all</Link>
        </div>
        {rows.length === 0 && <p className="rounded-2xl bg-surface p-6 text-center text-sm text-muted shadow-card">You are not enrolled in any modules yet. Your faculty office enrols you.</p>}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((r) => {
            const c = colorFor(r.code), low = r.percent != null && r.percent < r.min_pct;
            return (
              <div key={r.module_id} className="flex items-center gap-3 rounded-2xl bg-surface p-4 shadow-card">
                <span className="grid size-11 shrink-0 place-items-center rounded-full text-sm font-bold text-white" style={{ background: c }}>{r.code.replace(/[^A-Z]/gi, "").slice(0, 2).toUpperCase() || r.code[0]}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{r.title}</p>
                  <p className="text-xs text-muted">{r.code} · needs {r.min_pct}%</p>
                </div>
                <div className="text-right">
                  <p className={`font-semibold tabular-nums ${low ? "text-bad" : ""}`} style={low ? undefined : { color: c }}>{pct(r.percent)}</p>
                  <p className="text-[11px] text-muted">{r.attended}/{r.attended + r.absent}</p>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Recent */}
      <section>
        <h2 className="mb-3 text-lg font-semibold">Recent</h2>
        <div className="divide-y divide-line rounded-2xl bg-surface shadow-card">
          {(recent ?? []).length === 0 && <p className="p-6 text-center text-sm text-muted">No attendance recorded yet.</p>}
          {(recent ?? []).map((r) => {
            const code = (r.modules as unknown as { code: string } | null)?.code ?? "";
            return (
              <div key={r.id} className="flex items-center gap-3 p-4">
                <span className="h-9 w-1 rounded-full" style={{ background: colorFor(code) }} />
                <div className="flex-1">
                  <p className="text-sm font-medium">{code}</p>
                  <p className="text-xs text-muted">{new Date(r.created_at).toLocaleDateString("en-ZA", { weekday: "short", day: "numeric", month: "short" })} · {timeOf(r.checked_in_at)}</p>
                </div>
                <Badge status={r.status} />
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function Quick({ href, icon, label, tone }: { href: string; icon: IconName; label: string; tone: string }) {
  return (
    <Link href={href} className="flex flex-col items-center gap-2 rounded-2xl bg-surface p-3 text-xs font-medium shadow-card transition hover:-translate-y-0.5">
      <span className={`grid size-11 place-items-center rounded-full ${tone}`}><Icon name={icon} /></span>
      {label}
    </Link>
  );
}
