import Link from "next/link";
import { AppTitle } from "@/components/app-chrome";
import { TimetableActions } from "@/components/timetable-actions";
import { Icon } from "@/components/icons";
import { Card, CardTitle } from "@/components/ui";
import { hhmm, moduleColor, todayWeekday, WeekGrid } from "@/components/week-grid";
import { requireRole } from "@/lib/auth";
import { myTimetable, nowHHMM } from "@/lib/student-data";

export const metadata = { title: "Timetable" };

export default async function StudentTimetable() {
  const { supabase, institutionId } = await requireRole("student");
  const slots = await myTimetable(supabase, institutionId);
  const day = todayWeekday(), now = nowHHMM();
  const today = slots.filter((s) => s.weekday === day);
  const current = today.find((s) => hhmm(s.starts_at) <= now && now < hhmm(s.ends_at));
  const next = today.find((s) => hhmm(s.starts_at) > now);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <AppTitle title="Timetable" eyebrow={new Date().toLocaleDateString("en-ZA", { weekday: "long", day: "numeric", month: "long", timeZone: "Africa/Johannesburg" })}
        action={<Link href="/student/map" aria-label="Campus map" className="hidden h-11 items-center gap-2 rounded-2xl bg-surface px-4 text-sm font-semibold shadow-card sm:inline-flex"><Icon name="map" size={18} />Campus map</Link>} />

      <TimetableActions ics="/student/timetable/calendar.ics"
        hint="The calendar file adds every class as a weekly event with a 15-minute reminder in Google Calendar, Outlook or your phone's calendar. Download it again if your timetable changes." />

      <div className="grid gap-4 md:grid-cols-2 print:hidden">
        <NowCard label="Now" slot={current} empty="No class right now" tone="bg-gradient-to-br from-accent to-brand text-white" />
        <NowCard label="Next today" slot={next} empty={today.length ? "No more classes today" : "No classes today"} tone="bg-surface" />
      </div>

      <Card className="rounded-[28px]">
        <CardTitle>This week</CardTitle>
        {slots.length === 0
          ? <p className="py-10 text-center text-sm text-muted">No timetable yet. Your faculty adds classes for each module, and they appear here automatically.</p>
          : <WeekGrid slots={slots} />}
      </Card>
    </div>
  );
}

function NowCard({ label, slot, empty, tone }: { label: string; slot?: { code: string; title: string; starts_at: string; ends_at: string; venue: string | null; kind: string }; empty: string; tone: string }) {
  const dark = tone.includes("text-white");
  return (
    <section className={`rounded-[28px] p-5 shadow-card ${tone}`}>
      <p className={`text-[11px] font-bold uppercase tracking-[0.14em] ${dark ? "opacity-80" : "text-muted"}`}>{label}</p>
      {slot ? (
        <>
          <p className="mt-2 text-lg font-bold" style={dark ? undefined : { color: moduleColor(slot.code) }}>{slot.title}</p>
          <p className={`text-sm ${dark ? "opacity-90" : "text-muted"}`}>{slot.code} · {slot.kind} · {hhmm(slot.starts_at)}–{hhmm(slot.ends_at)}</p>
          <p className={`mt-1 flex items-center gap-1 text-sm ${dark ? "opacity-90" : "text-muted"}`}><Icon name="pin" size={15} />{slot.venue ?? "No venue set"}</p>
        </>
      ) : <p className={`mt-2 text-sm ${dark ? "opacity-90" : "text-muted"}`}>{empty}</p>}
    </section>
  );
}
