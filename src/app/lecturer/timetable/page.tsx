import { loadTheme } from "@/lib/shell-data";
import Link from "next/link";
import { TimetableActions } from "@/components/timetable-actions";
import { Card, CardTitle, PageHeader } from "@/components/ui";
import { hhmm, moduleColor, todayWeekday, WeekGrid } from "@/components/week-grid";
import { requireRole } from "@/lib/auth";
import { nowHHMM } from "@/lib/student-data";
import { teachingTimetable } from "@/lib/timetable-export";

export const metadata = { title: "Timetable" };

/** The lecturer's teaching week, with download and print. */
export default async function LecturerTimetable({ searchParams }: { searchParams: Promise<{ all?: string }> }) {
  const all = (await searchParams).all === "1";
  const { supabase, institutionId, user } = await requireRole("lecturer");
  const [every, theme] = await Promise.all([teachingTimetable(supabase, institutionId, user.id), loadTheme(supabase, institutionId)]);
  const features = theme.features;
  const slots = all ? every : every.filter((s) => s.mine);
  const others = every.length - every.filter((s) => s.mine).length;
  const day = todayWeekday(), now = nowHHMM();
  const today = slots.filter((s) => s.weekday === day);
  const hours = slots.reduce((h, s) => h + (+s.ends_at.slice(0, 2) * 60 + +s.ends_at.slice(3, 5) - (+s.starts_at.slice(0, 2) * 60 + +s.starts_at.slice(3, 5))) / 60, 0);

  return (
    <div className="space-y-6">
      <PageHeader title="My timetable"
        subtitle={`${slots.length} classes a week · ${hours.toFixed(1).replace(".0", "")} teaching hours${all ? " · including colleagues" : ""}`} />
      <TimetableActions ics={features.calendarDownload ? `/lecturer/timetable/calendar.ics${all ? "?all=1" : ""}` : null}
        hint="Adds each class as a weekly event with a 15-minute reminder. Download it again when the timetable changes." />
      {others > 0 && (
        <p className="text-sm print:hidden">
          {all
            ? <Link href="/lecturer/timetable" className="font-semibold text-accent">Show only the classes I teach</Link>
            : <>{others} more class{others === 1 ? "" : "es"} in your modules {others === 1 ? "is" : "are"} taught by colleagues. <Link href="/lecturer/timetable?all=1" className="font-semibold text-accent">Show all</Link></>}
        </p>
      )}

      <Card className="print:hidden">
        <CardTitle>Today</CardTitle>
        {today.length === 0 ? <p className="text-sm text-muted">No classes today.</p> : (
          <ul className="divide-y divide-line">
            {today.map((s) => {
              const live = hhmm(s.starts_at) <= now && now < hhmm(s.ends_at), past = hhmm(s.ends_at) <= now;
              return (
                <li key={s.id} className={`flex flex-wrap items-center gap-3 py-3 ${past ? "opacity-60" : ""}`}>
                  <span className="h-10 w-1.5 rounded-full" style={{ background: moduleColor(s.code) }} />
                  <span className="w-24 font-mono text-sm tabular-nums">{hhmm(s.starts_at)}–{hhmm(s.ends_at)}</span>
                  <span className="min-w-0 flex-1"><b>{s.code}</b> <span className="text-muted">{s.title}</span>
                    <span className="block text-xs text-muted">{s.kind}{s.venue ? ` · ${s.venue}` : ""}{s.lecturer && !s.mine ? ` · ${s.lecturer}` : ""}</span></span>
                  {live && <span className="rounded-full bg-ok/15 px-2.5 py-1 text-xs font-semibold text-ok">Now</span>}
                  {!past && <Link href={`/lecturer/modules/${s.module_id}`} className="text-sm font-semibold text-accent">Open session →</Link>}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card>
        <CardTitle>This week</CardTitle>
        {slots.length === 0
          ? <p className="py-10 text-center text-sm text-muted">No timetable for your modules yet. Your administrator imports or adds it under Timetable.</p>
          : <WeekGrid slots={slots} />}
      </Card>
    </div>
  );
}
