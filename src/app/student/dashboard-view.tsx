import type { ReactNode } from "react";
import { AppTitle } from "@/components/app-chrome";
import { Icon } from "@/components/icons";
import { LateChip } from "@/components/late";
import { CalmPanel, EmptyNote, Figure, FocusPanel, Glyph, Meter, Panel, Pill, Row, SectionTitle, Tile, WeekBars } from "@/components/minimal";
import { PushToggle } from "@/components/push-toggle";
import { pct } from "@/components/ui";
import { hhmm, type Slot } from "@/components/week-grid";
import { moduleShade } from "@/lib/palette";
import { timeOf } from "@/lib/stats";
import type { StudentCard, Theme } from "@/lib/theme";
import { LeaveButton } from "./leave-button";
import type { TrendSeries } from "./trend-card";

// The student dashboard's display, separate from its data loading (page.tsx).
// Minimal and grayscale: one dark panel for what to do now, quiet panels for the rest.

export type DashRow = { module_id: string; code: string; title: string; attended: number; absent: number;
  excused: number; unresolved: number; percent: number | null; min_pct: number; institution_id: string };
export type DashRec = { id: string; status: string; session_id: string; checked_in_at: string | null; created_at: string; module_id: string;
  minutes_late?: number | null; checked_out_at?: string | null; modules: { code: string; title: string } | null; class_sessions: { title: string; opens_at: string } | null };
export type DashLive = { id: string; title: string; late_after: string; modules: unknown; venues: unknown };
export type DashSlot = Slot & { id: string };

export type InClass = { session: string; code: string; title: string; since: string | null };
export type DashboardData = {
  inClass?: InClass[];
  theme: Theme; hello: string; first: string; studentNumber: string | null;
  rows: DashRow[]; recs: DashRec[]; live: DashLive[]; series: TrendSeries[];
  todaySlots: DashSlot[]; nextSlot: DashSlot | undefined; now: string; day: number;
  overall: number | null; att: number; tot: number; pending: number; atRisk: DashRow[];
  week: { wd: number; date: number; letter: string; kinds: Set<string> }[];
};

export const colorFor = moduleShade;
export const badgeOf = (code: string) => code.replace(/[^A-Z]/gi, "").slice(0, 3).toUpperCase() || code.slice(0, 2);

const STATUS_LABEL: Record<string, string> = {
  present: "Present", late: "Late", late_pending: "Awaiting lecturer", absent: "Absent", excused: "Excused",
  pending_verification: "In review", disputed: "Disputed",
};
const NEEDS_ATTENTION = new Set(["absent", "pending_verification", "disputed"]);

export function DashboardView({ d }: { d: DashboardData }) {
  const { theme, hello, first, rows, recs, live, series, todaySlots, nextSlot, now, day, overall, att, tot, pending, atRisk, week } = d;
  const title = (id: StudentCard) => theme.student.cards.find((c) => c.id === id)?.title || id;

  const cards: Record<StudentCard, ReactNode> = {
    live: live.length > 0 ? (() => {
      const s = live[0];
      const m = s.modules as unknown as { code: string; title: string };
      const late = new Date(s.late_after).getTime() < Date.now();
      return (
        <FocusPanel eyebrow="Attendance open" live title={m.title}
          lines={[`${m.code} · ${(s.venues as unknown as { name: string } | null)?.name ?? "No venue"}`, `${late ? "Grace period ended" : "On time until"} ${timeOf(s.late_after)}`]}
          action={{ href: "/student/check-in", label: "Check in", icon: "scan" }}
          aside={<span className="hidden size-20 shrink-0 place-items-center rounded-[20px] bg-white/10 sm:grid"><Icon name="qr" size={36} /></span>} />
      );
    })() : (
      <CalmPanel eyebrow={nextSlot ? (hhmm(nextSlot.starts_at) <= now ? "In class now" : "Next class") : "No class open"}
        title={nextSlot ? nextSlot.title : "Nothing to check in to"}
        lines={nextSlot ? [`${hhmm(nextSlot.starts_at)}–${hhmm(nextSlot.ends_at)} · ${nextSlot.code} · ${nextSlot.venue ?? "No venue"}`]
          : ["When your lecturer opens attendance it shows here."]}
        action={nextSlot ? { href: "/student/map", label: "Find the venue", icon: "pin" } : { href: "/student/check-in", label: "Open the scanner", icon: "scan" }} />
    ),

    quick: (
      <div className="space-y-4">
        <div className="grid grid-cols-4 gap-2.5">
          <Tile href="/student/check-in" icon="scan" label="Check in" dark />
          <Tile href="/student/timetable" icon="calendar" label="Timetable" />
          <Tile href="/student/history" icon="history" label="History" />
          <Tile href="/student/map" icon="map" label="Map" />
        </div>
        <Panel>
          <div className="flex items-end justify-between gap-4">
            <Figure strong label={theme.student.heroTitle || "Your attendance"} value={overall == null ? "—" : `${Math.round(overall)}%`}
              hint={rows.length ? `${att} of ${tot} classes attended` : "No modules yet"} />
            <div className="text-right">
              {atRisk.length > 0 ? <Pill strong>Below requirement</Pill> : rows.length > 0 ? <Pill>On track</Pill> : null}
              {pending > 0 && <p className="mt-1 text-xs text-muted">{pending} awaiting a decision</p>}
            </div>
          </div>
          <div className="mt-4"><Meter value={overall} /></div>
          {atRisk.length > 0 && <p className="mt-3 text-xs"><b>At risk:</b> {atRisk.map((r) => r.code).join(", ")}</p>}
          <div className="mt-5 grid grid-cols-7 gap-1 text-center">
            {week.map((w) => (
              <span key={w.wd} className="flex flex-col items-center gap-1">
                <span className="text-[10px] font-semibold text-muted">{w.letter}</span>
                <span className={`grid size-8 place-items-center rounded-full text-xs font-semibold tabular-nums ${w.wd === day ? "bg-ink text-surface" : w.wd < day ? "text-muted" : ""}`}>{w.date}</span>
                <span className="flex h-1 gap-0.5">
                  {w.kinds.size > 0 && [...w.kinds].map((k) => <i key={k} className={`size-1 rounded-full ${k === "test" ? "bg-ink" : "bg-muted"}`} />)}
                </span>
              </span>
            ))}
          </div>
        </Panel>
      </div>
    ),

    hero: (
      <Panel>
        <SectionTitle title={title("hero") === "Attendance summary" ? "Weekly attendance" : title("hero")} href="/student/history" link="History" />
        <WeekBars points={series[0]?.points ?? []} />
        <p className="mt-2 text-xs text-muted">Percentage of classes attended each week; the darkest bar is this week.</p>
      </Panel>
    ),

    today: (
      <section>
        <SectionTitle title={title("today")} href="/student/timetable" link="Timetable" />
        {todaySlots.length === 0 ? <EmptyNote icon="calendar" text="No classes on your timetable today." /> : (
          <Panel className="py-1">
            <ul>
              {todaySlots.map((t) => {
                const isLive = hhmm(t.starts_at) <= now && now < hhmm(t.ends_at), past = hhmm(t.ends_at) <= now;
                return (
                  <Row key={t.id} href="/student/map" dim={past}
                    lead={<span className="w-12 shrink-0 text-sm font-bold tabular-nums">{hhmm(t.starts_at)}</span>}
                    title={t.title} sub={`${t.code} · ${t.kind} · ${t.venue ?? "No venue"} · until ${hhmm(t.ends_at)}`}
                    end={isLive ? <Pill strong>Now</Pill> : <Icon name="arrowRight" size={16} className="text-muted" />} />
                );
              })}
            </ul>
          </Panel>
        )}
      </section>
    ),

    modules: (
      <section>
        <SectionTitle title={title("modules")} href="/student/history" link="History" />
        {rows.length === 0 ? <EmptyNote icon="book" text="You are not enrolled in any modules yet. Your faculty office enrols you." /> : (
          <div className="grid gap-2.5 lg:grid-cols-2">
            {rows.map((r) => {
              const low = r.percent != null && r.percent < r.min_pct;
              return (
                <Panel key={r.module_id} className="p-4">
                  <div className="flex items-center gap-3">
                    <Glyph text={badgeOf(r.code)} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{r.title}</p>
                      <p className="text-xs text-muted">{r.code} · needs {r.min_pct}% · {r.attended}/{r.attended + r.absent}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-bold tabular-nums">{pct(r.percent)}</p>
                      {low ? <Pill strong>At risk</Pill> : r.percent == null ? <Pill>No classes</Pill> : null}
                    </div>
                  </div>
                  <div className="mt-3"><Meter value={r.percent} min={r.min_pct} /></div>
                </Panel>
              );
            })}
          </div>
        )}
      </section>
    ),

    recent: (
      <section>
        <SectionTitle title={title("recent")} href="/student/history" link="All" />
        {recs.length === 0 ? <EmptyNote icon="history" text="No attendance recorded yet." /> : (
          <Panel className="py-1">
            <ul>
              {recs.slice(0, 5).map((r) => (
                <Row key={r.id} lead={<Glyph text={badgeOf(r.modules?.code ?? "")} />}
                  title={`${r.modules?.code ?? ""} · ${r.class_sessions?.title ?? "Class"}`}
                  sub={`${new Date(r.created_at).toLocaleDateString("en-ZA", { weekday: "short", day: "numeric", month: "short" })} · ${timeOf(r.checked_in_at)}`}
                  end={<span className="flex flex-col items-end gap-1"><Pill strong={NEEDS_ATTENTION.has(r.status)}>{STATUS_LABEL[r.status] ?? r.status}</Pill><LateChip minutes={r.minutes_late} /></span>} />
              ))}
            </ul>
          </Panel>
        )}
      </section>
    ),
  };

  // Cards in the institution's order (Design page); on wide screens the first two sit side by side.
  const order = theme.student.cards.filter((c) => c.show).map((c) => c.id);
  const [a, b, ...rest] = order;

  return (
    <div className="mx-auto max-w-5xl">
      <AppTitle eyebrow={hello} title={first || "Dashboard"}
        sub={d.studentNumber ? <span className="font-mono text-xs">{d.studentNumber}</span> : undefined} />
      <div className="space-y-6">
        {(d.inClass ?? []).map((c) => (
          <Panel key={c.session} className="flex items-center gap-3 p-4">
            <Glyph icon="userCheck" />
            <a href={theme.features.liveClass ? `/student/class/${c.session}` : "/student/history"} className="min-w-0 flex-1">
              <span className="flex items-center gap-2 truncate text-sm font-semibold"><span className="size-1.5 shrink-0 animate-pulse rounded-full bg-ink" />In {c.code} · {c.title}</span>
              <span className="block text-xs text-muted">Checked in{c.since ? ` at ${timeOf(c.since)}` : ""}{theme.features.liveClass ? " · open the live class" : ""}</span>
            </a>
            {theme.features.checkOut && <LeaveButton session={c.session} />}
          </Panel>
        ))}
        <PushToggle compact logo={theme.header.logoUrl || null} institution={theme.header.title || undefined} />
        {a && (b ? <div className="grid gap-6 lg:grid-cols-2"><div>{cards[a]}</div><div>{cards[b]}</div></div> : cards[a])}
        {rest.map((id) => <div key={id}>{cards[id]}</div>)}
      </div>
    </div>
  );
}
