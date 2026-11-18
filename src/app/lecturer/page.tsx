import { loadTheme } from "@/lib/shell-data";
import Link from "next/link";
import { AppTitle } from "@/components/app-chrome";
import { Icon } from "@/components/icons";
import { EmptyNote, Figure, FocusPanel, Glyph, Meter, Panel, Pill, Row, SectionTitle, Tile, SchoolBanner } from "@/components/minimal";
import { pct } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { greeting, groupBy, rate, sastMidnight, timeOf } from "@/lib/stats";
import { ClassList } from "@/components/class-list";
import { upcomingClasses } from "@/lib/class-events";

export const metadata = { title: "Home" };


export default async function LecturerHome() {
  const { supabase, institutionId, user, current } = await requireRole("lecturer");
  const { data: me } = await supabase.from("lecturers").select("id, full_name")
    .eq("institution_id", institutionId).eq("user_id", user.id).maybeSingle();
  const { data: assigned } = await supabase.from("lecturer_assignments")
    .select("role, modules(id, code, title)").eq("lecturer_id", me?.id ?? "00000000-0000-0000-0000-000000000000");
  const modules = (assigned ?? []).map((a) => ({ role: a.role, ...(a.modules as unknown as { id: string; code: string; title: string }) }));
  const ids = modules.map((m) => m.id);
  const none = ["00000000-0000-0000-0000-000000000000"];

  const [{ data: sessions }, { data: recs }, { data: enrol }, { data: alerts }] = await Promise.all([
    supabase.from("class_sessions").select("id, title, status, join_code, opens_at, closes_at, module_id, modules(code), venues(name)")
      .in("module_id", ids.length ? ids : none).gte("opens_at", sastMidnight(29)).order("opens_at", { ascending: false }).limit(200),
    supabase.from("attendance_records").select("module_id, status").in("module_id", ids.length ? ids : none)
      .gte("created_at", sastMidnight(29)).limit(5000),
    supabase.from("module_enrolments").select("module_id").in("module_id", ids.length ? ids : none).eq("status", "active"),
    // Early warning (0015); empty if the institution hasn't run that update yet.
    supabase.rpc("list_student_alerts", { p_inst: institutionId, p_live_only: true }),
  ]);
  // Dated classes from the timetable (0027), with what's needed to change one.
  const [classes, { data: venueRows }, { data: lectRows }] = await Promise.all([
    upcomingClasses(supabase, { moduleIds: ids, myLecturerId: me?.id ?? null }),
    supabase.from("venues").select("id, name").eq("institution_id", institutionId).is("deleted_at", null).order("name").limit(500),
    supabase.from("lecturers").select("id, full_name").eq("institution_id", institutionId).is("deleted_at", null).eq("status", "active").order("full_name").limit(500),
  ]);
  const now = Date.now();
  const theme = await loadTheme(supabase, institutionId);
  const needFollowUp = theme.features.earlyWarning && Array.isArray(alerts) ? alerts.length : 0;
  const open = (sessions ?? []).filter((s) => s.status === "open");
  const week = (sessions ?? []).filter((s) => s.opens_at >= sastMidnight(6)).length;
  const byModule = groupBy(recs ?? [], (r) => r.module_id as string);
  const enrolled = groupBy(enrol ?? [], (e) => e.module_id as string);
  const toReview = (recs ?? []).filter((r) => r.status === "pending_verification" || r.status === "disputed" || r.status === "late_pending").length;

  const fullName = me?.full_name ?? "Welcome";
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {theme.dashboard.lecturers && <SchoolBanner style={theme.dashboard.banner} logo={theme.header.logoUrl || null}
        name={theme.header.title || current.institution_name || ""} line={theme.dashboard.message || theme.header.subtitle || (theme.header.title ? current.institution_name ?? "" : "")} />}
      <AppTitle eyebrow={greeting()} title={fullName.split(" ").slice(0, 2).join(" ")} sub={`${modules.length} module${modules.length === 1 ? "" : "s"} · ${(enrol ?? []).length} students`} />

      {open.map((s) => (
        <FocusPanel key={s.id} eyebrow="Attendance open" live title={`${(s.modules as unknown as { code: string }).code} · ${s.title}`}
          lines={[`${(s.venues as unknown as { name: string } | null)?.name ?? "No venue"} · closes ${timeOf(s.closes_at)}`]}
          action={{ href: `/lecturer/sessions/${s.id}`, label: "Show QR and register", icon: "qr" }}
          aside={<span className="hidden shrink-0 text-right sm:block"><span className="block text-[11px] font-semibold uppercase tracking-[0.14em] opacity-70">Code</span>
            <span className="font-mono text-3xl font-bold tracking-[0.2em]">{s.join_code}</span></span>} />
      ))}

      <div className="grid grid-cols-4 gap-2.5">
        <Tile href="/lecturer/timetable" icon="calendar" label="Timetable" />
        <Tile href="/lecturer/disputes" icon="flag" label="Reviews" />
        <Tile href="/lecturer/reports" icon="chart" label="Reports" />
        <Tile href="/notifications" icon="bell" label="Alerts" />
      </div>

      <Panel>
        <div className="grid grid-cols-2 gap-5 sm:grid-cols-4">
          <Figure label="Modules" value={modules.length} />
          <Figure label="Students" value={(enrol ?? []).length} hint="Active enrolments" />
          <Figure label="Classes this week" value={week} />
          <Figure label="To review" value={toReview} hint={toReview ? <Link href="/lecturer/disputes" className="font-semibold text-ink underline underline-offset-4">Open reviews</Link> : "Nothing waiting"} />
        </div>
      </Panel>

      {needFollowUp > 0 && (
        <Link href="/lecturer/early-warning" className="flex items-center gap-3 rounded-[20px] border border-ink bg-surface p-4 transition hover:bg-bg">
          <Glyph icon="alert" />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">{needFollowUp} student{needFollowUp === 1 ? "" : "s"} need{needFollowUp === 1 ? "s" : ""} follow-up</span>
            <span className="text-xs text-muted">Low attendance or several classes missed in a row.</span>
          </span>
          <Icon name="arrowRight" size={16} />
        </Link>
      )}

      {classes.length > 0 && (
        <section>
          <SectionTitle title="My classes" href="/lecturer/timetable" link="Timetable" />
          <Panel>
            <ClassList events={classes} role="lecturer" now={now}
              venues={(venueRows ?? []).map((v) => ({ id: v.id, label: v.name }))}
              lecturers={(lectRows ?? []).filter((l) => l.id !== me?.id).map((l) => ({ id: l.id, label: l.full_name }))} />
          </Panel>
        </section>
      )}

      <section>
        <SectionTitle title="My modules" href="/lecturer/reports" link="Reports" />
        {modules.length === 0 ? <EmptyNote icon="book" text="No modules are assigned to you yet. Your institution administrator assigns them." /> : (
          <div className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-3">
            {modules.map((m) => {
              const r = rate(byModule.get(m.id) ?? []);
              return (
                <Link key={m.id} href={`/lecturer/modules/${m.id}`} className="group rounded-[20px] border border-line bg-surface p-4 transition hover:bg-bg">
                  <div className="flex items-start gap-3">
                    <Glyph text={m.code.replace(/[^A-Z]/gi, "").slice(0, 3).toUpperCase() || m.code.slice(0, 2)} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{m.title}</p>
                      <p className="text-xs text-muted">{m.code} · {(enrolled.get(m.id) ?? []).length} students{m.role === "assistant" ? " · assistant" : ""}</p>
                    </div>
                    <p className="text-lg font-bold tabular-nums">{pct(r)}</p>
                  </div>
                  <div className="mt-3"><Meter value={r} /></div>
                  <p className="mt-2 flex items-center justify-between text-xs text-muted">Attendance, last 30 days
                    <span className="inline-flex items-center gap-1 font-semibold text-ink">Open <Icon name="arrowRight" size={13} className="transition group-hover:translate-x-0.5" /></span></p>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      <section>
        <SectionTitle title="Recent sessions" />
        {(sessions ?? []).length === 0 ? <EmptyNote icon="calendar" text="No sessions in the last 30 days." /> : (
          <Panel className="py-1">
            <ul>
              {(sessions ?? []).slice(0, 8).map((s) => (
                <Row key={s.id} href={`/lecturer/sessions/${s.id}`} lead={<Glyph icon="calendar" />}
                  title={`${(s.modules as unknown as { code: string }).code} · ${s.title}`}
                  sub={`${new Date(s.opens_at).toLocaleDateString("en-ZA", { weekday: "short", day: "numeric", month: "short" })} · ${timeOf(s.opens_at)}`}
                  end={<Pill strong={s.status === "open"}>{s.status === "open" ? "Open" : s.status === "closed" ? "Closed" : s.status}</Pill>} />
              ))}
            </ul>
          </Panel>
        )}
      </section>
    </div>
  );
}
