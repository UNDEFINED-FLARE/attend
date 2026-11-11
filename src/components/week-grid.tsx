import type { ReactNode } from "react";

export type Slot = {
  id: string; weekday: number; starts_at: string; ends_at: string; kind: string; group_name: string | null;
  code: string; title: string; venue: string | null;
};

export const DAYS = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
// Module "zone" colours, like the colour-coded zones on campus signs: a module keeps its
// colour everywhere (timetable, home, map). Each passes 4.5:1 as text on white and on the
// background, so a module code may be written in its own colour.
export const ZONE_COLORS = ["#c8102e", "#00704a", "#00727a", "#6a1b9a", "#b0177a", "#b54a00", "#5c6b00", "#0057b8"];
// djb2: codes that differ by one character (CSC111, CSC112, MAT101) land far apart. A plain sum
// of character codes put most first-year codes on the same colour.
const zoneIndex = (code: string) => {
  let h = 5381;
  for (const ch of code.toUpperCase()) h = ((h * 33) ^ ch.charCodeAt(0)) >>> 0;
  return h % ZONE_COLORS.length;
};
export const moduleColor = (code: string) => ZONE_COLORS[zoneIndex(code)];
/** The zone colour lifted for navy sign panels, where the deep version would disappear. */
export const moduleColorOnDark = (code: string) => `color-mix(in srgb, ${moduleColor(code)} 65%, #ffffff)`;
export const hhmm = (t: string) => t.slice(0, 5);

/** Today as ISO weekday (1 = Monday) in South African time. */
export function todayWeekday(): number {
  const d = new Date(Date.now() + 2 * 3600_000).getUTCDay();
  return d === 0 ? 7 : d;
}

/** A week of timetable slots: columns on desktop, a day-by-day list on phones. */
export function WeekGrid({ slots, action, highlightToday = true }: { slots: Slot[]; action?: (s: Slot) => ReactNode; highlightToday?: boolean }) {
  const lastDay = slots.some((s) => s.weekday === 7) ? 7 : slots.some((s) => s.weekday === 6) ? 6 : 5;
  const days = Array.from({ length: lastDay }, (_, i) => i + 1);
  const today = todayWeekday();
  const byDay = (d: number) => slots.filter((s) => s.weekday === d).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  return (
    <div className="grid gap-3 md:grid-cols-[repeat(var(--cols),minmax(0,1fr))]" style={{ ["--cols" as string]: days.length }}>
      {days.map((d) => {
        const isToday = highlightToday && d === today;
        return (
          <section key={d} aria-label={DAYS[d]} className={`rounded-2xl p-2 ${isToday ? "bg-accent/5 ring-1 ring-accent/30" : "bg-bg"}`}>
            <h3 className={`mb-2 px-1 text-xs font-semibold uppercase tracking-wider ${isToday ? "text-accent" : "text-muted"}`}>
              {DAYS[d]}{isToday && " · today"}
            </h3>
            <div className="space-y-2">
              {byDay(d).length === 0 && <p className="px-1 py-3 text-xs text-muted">No classes</p>}
              {byDay(d).map((s) => (
                <article key={s.id} className="flex gap-2 rounded-xl bg-surface p-2.5 shadow-card">
                  <span className="w-1 shrink-0 rounded-full" style={{ background: moduleColor(s.code) }} />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold tabular-nums">{hhmm(s.starts_at)}–{hhmm(s.ends_at)}</p>
                    <p className="truncate text-sm font-medium" style={{ color: moduleColor(s.code) }} title={s.title}>{s.code}</p>
                    <p className="truncate text-xs text-muted">{s.kind}{s.group_name ? ` · ${s.group_name}` : ""}</p>
                    <p className="truncate text-xs text-muted">{s.venue ?? "No venue"}</p>
                  </div>
                  {action?.(s)}
                </article>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
