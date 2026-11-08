import Link from "next/link";
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
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">My timetable</h1>
          <p className="text-sm text-muted">Every class in the modules you&apos;re registered for, set by your faculty.</p>
        </div>
        <Link href="/student/map" className="inline-flex h-10 items-center gap-2 rounded-xl border border-line bg-surface px-4 text-sm font-medium hover:bg-bg">
          <Icon name="map" size={18} />Campus map
        </Link>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <NowCard label="Now" slot={current} empty="No class right now" tone="bg-gradient-to-br from-[#1d4ed8] to-[#0b2545] text-white" />
        <NowCard label="Next today" slot={next} empty={today.length ? "No more classes today" : "No classes today"} tone="bg-surface" />
      </div>

      <Card>
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
    <section className={`rounded-3xl p-5 shadow-card ${tone}`}>
      <p className={`text-xs font-semibold uppercase tracking-wider ${dark ? "opacity-80" : "text-muted"}`}>{label}</p>
      {slot ? (
        <>
          <p className="mt-2 text-lg font-semibold" style={dark ? undefined : { color: moduleColor(slot.code) }}>{slot.title}</p>
          <p className={`text-sm ${dark ? "opacity-90" : "text-muted"}`}>{slot.code} · {slot.kind} · {hhmm(slot.starts_at)}–{hhmm(slot.ends_at)}</p>
          <p className={`mt-1 flex items-center gap-1 text-sm ${dark ? "opacity-90" : "text-muted"}`}><Icon name="pin" size={15} />{slot.venue ?? "No venue set"}</p>
        </>
      ) : <p className={`mt-2 text-sm ${dark ? "opacity-90" : "text-muted"}`}>{empty}</p>}
    </section>
  );
}
