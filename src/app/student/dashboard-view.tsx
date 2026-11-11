import Link from "next/link";
import type { ReactNode } from "react";
import { AppTitle } from "@/components/app-chrome";
import { Ring } from "@/components/charts";
import { Icon, type IconName } from "@/components/icons";
import { LateChip } from "@/components/late";
import { PushToggle } from "@/components/push-toggle";
import { LeaveButton } from "./leave-button";
import { LinkButton, pct } from "@/components/ui";
import { hhmm, moduleColor, moduleColorOnDark, type Slot } from "@/components/week-grid";
import { timeOf } from "@/lib/stats";
import type { StudentCard, Theme } from "@/lib/theme";
import { TrendCard, type TrendSeries } from "./trend-card";

// The student dashboard's display, separate from its data loading (page.tsx).

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

/** A module's zone colour: the same one as on the timetable and the map. */
export const colorFor = moduleColor;
export const badgeOf = (code: string) => code.replace(/[^A-Z]/gi, "").slice(0, 3).toUpperCase() || code.slice(0, 2);

export function DashboardView({ d }: { d: DashboardData }) {
  const { theme, hello, first, rows, recs, live, series, todaySlots, nextSlot, now, day, overall, att, tot, pending, atRisk, week } = d;
  const title = (id: StudentCard) => theme.student.cards.find((c) => c.id === id)?.title || id;
  const cards: Record<StudentCard, ReactNode> = {
    hero: <TrendCard title={title("hero") === "Attendance summary" ? "Attendance performance" : title("hero")} series={series} />,

    // The one loud thing on the screen: a navy sign for the class that is open now, readable
    // at arm's length in sunlight, with the check-in as a big yellow button.
    live: live.length > 0 ? (() => {
      const s = live[0];
      const m = s.modules as unknown as { code: string; title: string };
      const venue = (s.venues as unknown as { name: string } | null)?.name;
      const late = new Date(s.late_after).getTime() < Date.now();
      return (
        <section aria-labelledby="now-code" className="relative overflow-hidden rounded-2xl bg-brand p-5 text-brand-ink sm:p-6">
          <span aria-hidden className="absolute inset-x-0 top-0 h-2" style={{ background: moduleColorOnDark(m.code) }} />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="inline-flex items-center gap-2 rounded-md bg-signal px-2.5 py-1 font-display text-base font-bold text-signal-ink">
              <span className="size-2 rounded-full bg-signal-ink motion-safe:animate-pulse" />Attendance open
            </span>
            <span className="text-sm font-medium opacity-85">{late ? `Counted as late since ${timeOf(s.late_after)}` : `On time until ${timeOf(s.late_after)}`}</span>
          </div>
          <p id="now-code" className="mt-5 font-display text-[56px] font-bold leading-[0.9] tracking-tight">{m.code}</p>
          <p className="mt-1.5 truncate text-base opacity-90">{m.title}</p>
          <p className="mt-4 flex items-center gap-2 font-display text-2xl font-semibold"><Icon name="pin" size={22} />{venue ?? "Venue not set"}</p>
          <Link href="/student/check-in"
            className="mt-5 flex h-14 items-center justify-center gap-2.5 rounded-xl bg-signal font-display text-xl font-bold text-signal-ink transition active:scale-[0.99]">
            <Icon name="scan" size={24} strokeWidth={2.4} />Scan to check in
          </Link>
          {live.length > 1 && <p className="mt-3 text-sm opacity-85">{live.length - 1} more {live.length === 2 ? "class is" : "classes are"} open now. Scan the code in the venue you are in.</p>}
        </section>
      );
    })() : (() => {
      // Nothing open: the next class as a quiet sign in its module colour, and where to go.
      const zone = nextSlot ? colorFor(nextSlot.code) : "var(--line-strong)";
      const inClass = nextSlot && hhmm(nextSlot.starts_at) <= now;
      return (
        <section className="rounded-2xl bg-surface p-5 sm:p-6" style={{ boxShadow: `inset 6px 0 0 ${zone}, var(--shadow-card)` }}>
          <p className="text-sm font-semibold text-muted">{nextSlot ? (inClass ? "In class now" : "Next class") : "No class open right now"}</p>
          {nextSlot ? (
            <>
              <div className="mt-2 flex items-end justify-between gap-4">
                <div className="min-w-0">
                  <p className="font-display text-[44px] font-bold leading-[0.9] tracking-tight" style={{ color: zone }}>{nextSlot.code}</p>
                  <p className="mt-1.5 truncate text-base">{nextSlot.title}</p>
                </div>
                <p className="shrink-0 text-right">
                  <span className="block font-display text-[32px] font-bold leading-none tabular-nums">{hhmm(nextSlot.starts_at)}</span>
                  <span className="text-sm text-muted">to {hhmm(nextSlot.ends_at)}</span>
                </p>
              </div>
              <p className="mt-4 flex items-center gap-2 font-display text-xl font-semibold"><Icon name="pin" size={20} />{nextSlot.venue ?? "Venue not set"}</p>
              <p className="mt-2 text-sm text-muted">Check-in opens when your lecturer starts the class.</p>
              <LinkButton href="/student/map" variant="secondary" className="mt-4"><Icon name="map" size={18} />Find the venue</LinkButton>
            </>
          ) : (
            <>
              <p className="mt-2 text-base">When your lecturer opens attendance, it shows here. You can also scan the code on the projector at any time.</p>
              <LinkButton href="/student/check-in" variant="secondary" className="mt-4"><Icon name="qr" size={18} />Open the scanner</LinkButton>
            </>
          )}
        </section>
      );
    })(),

    quick: (
      <div className="grid grid-cols-2 gap-4">
        <section className="flex flex-col rounded-2xl bg-surface p-4 shadow-card">
          <h2 className="text-base font-semibold text-muted">{theme.student.heroTitle || "Your attendance"}</h2>
          <div className="my-3 grid flex-1 place-items-center">
            <Ring value={overall} size={112} stroke={12} color="var(--brand)" track="color-mix(in srgb, var(--brand) 12%, transparent)">
              <span className="font-display text-[32px] font-bold tabular-nums tracking-tight">{overall == null ? "—" : `${Math.round(overall)}%`}</span>
            </Ring>
          </div>
          <p className={`text-sm font-semibold ${atRisk.length ? "text-bad" : "text-ok"}`}>
            {atRisk.length ? `Below the requirement in ${atRisk.map((r) => r.code).join(", ")}` : rows.length ? `On track: ${att} of ${tot} classes` : "No modules yet"}
          </p>
          {pending > 0 && <p className="mt-1 text-xs text-muted">{pending} waiting for your lecturer</p>}
        </section>
        <section className="rounded-2xl bg-surface p-4 shadow-card">
          <h2 className="text-base font-semibold text-muted">This week</h2>
          <div className="mt-3 grid grid-cols-7 gap-y-2 text-center">
            {week.map((d) => <span key={`l${d.wd}`} className="text-[11px] font-semibold text-muted">{d.letter}</span>)}
            {week.map((d) => (
              <span key={d.wd} className="flex flex-col items-center gap-1">
                <span className={`grid size-7 place-items-center rounded-md font-display text-sm font-semibold tabular-nums ${d.wd === day ? "bg-brand text-brand-ink" : d.wd < day ? "text-muted" : ""}`}
                  aria-current={d.wd === day ? "date" : undefined}>{d.date}</span>
                <span className="flex h-1.5 gap-0.5">
                  {d.kinds.has("lecture") && <i className="size-1.5 rounded-full bg-brand" />}
                  {d.kinds.has("prac") && <i className="size-1.5 rounded-full bg-ok" />}
                  {d.kinds.has("test") && <i className="size-1.5 rounded-full bg-bad" />}
                </span>
              </span>
            ))}
          </div>
          <ul className="mt-3 space-y-1 text-xs text-muted">
            <li className="flex items-center gap-2"><i className="size-2 rounded-full bg-brand" />Lectures</li>
            <li className="flex items-center gap-2"><i className="size-2 rounded-full bg-ok" />Practicals &amp; tutorials</li>
            <li className="flex items-center gap-2"><i className="size-2 rounded-full bg-bad" />Tests</li>
          </ul>
        </section>
      </div>
    ),

    today: (
      <section>
        <SectionHead title={title("today")} href="/student/timetable" link="Timetable" />
        {todaySlots.length === 0
          ? <Empty icon="calendar" text="No classes on your timetable today." />
          : <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 lg:mx-0 lg:px-0">
              {todaySlots.map((t) => {
                const isLive = hhmm(t.starts_at) <= now && now < hhmm(t.ends_at), past = hhmm(t.ends_at) <= now;
                return (
                  <Link key={t.id} href="/student/map" className={`relative min-w-60 snap-start overflow-hidden rounded-2xl bg-surface p-4 pl-5 shadow-card ${past ? "opacity-60" : ""}`}>
                    <span aria-hidden className="absolute inset-y-0 left-0 w-1.5" style={{ background: colorFor(t.code) }} />
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-display text-lg font-semibold tabular-nums">{hhmm(t.starts_at)}–{hhmm(t.ends_at)}</span>
                      {isLive && <span className="rounded-md bg-signal px-2 py-0.5 font-display text-sm font-bold text-signal-ink">Now</span>}
                      {past && <span className="text-xs font-medium text-muted">Done</span>}
                    </div>
                    <p className="mt-2 font-display text-xl font-bold leading-tight" style={{ color: colorFor(t.code) }}>{t.code}</p>
                    <p className="truncate text-sm font-medium">{t.title}</p>
                    <p className="mt-2 flex items-center gap-1 text-sm text-muted"><Icon name="pin" size={15} />{t.venue ?? "No venue"}<span className="ml-auto capitalize">{t.kind}</span></p>
                  </Link>
                );
              })}
            </div>}
      </section>
    ),

    modules: (
      <section>
        <SectionHead title={title("modules")} href="/student/history" link="History" />
        {rows.length === 0 && <Empty icon="book" text="You are not enrolled in any modules yet. Your faculty office enrols you." />}
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {rows.map((r) => {
            const c = colorFor(r.code), low = r.percent != null && r.percent < r.min_pct, none = r.percent == null;
            return (
              <div key={r.module_id} className="flex items-center gap-4 rounded-2xl bg-surface p-4 shadow-card">
                {/* The module's zone plate, as on a campus sign. */}
                <span aria-hidden className="grid size-14 shrink-0 place-items-center rounded-xl font-display text-lg font-bold text-white" style={{ background: c }}>{badgeOf(r.code)}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{r.title}</p>
                  <p className="text-sm text-muted"><span className="font-display font-semibold" style={{ color: c }}>{r.code}</span>, needs {r.min_pct}%</p>
                  <span className={`mt-1.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${none ? "bg-bg text-muted" : low ? "bg-bad/10 text-bad" : "bg-ok/10 text-ok"}`}>
                    {!none && !low && <Icon name="check" size={12} strokeWidth={3} />}{none ? "No classes yet" : low ? "At risk" : "On track"}
                  </span>
                </div>
                <div className="text-right">
                  <p className={`font-display text-[28px] font-bold leading-none tabular-nums ${low ? "text-bad" : ""}`}>{pct(r.percent)}</p>
                  <p className="mt-1 text-xs text-muted">{r.attended} of {r.attended + r.absent}</p>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    ),

    recent: (
      <section>
        <SectionHead title={title("recent")} href="/student/history" link="All" />
        {recs.length === 0 && <Empty icon="history" text="No attendance recorded yet." />}
        <div className="space-y-2.5">
          {recs.slice(0, 5).map((r) => {
            const [icon, tone] = STATUS_LOOK[r.status] ?? STATUS_LOOK.absent;
            return (
              <div key={r.id} className="flex items-center gap-3 rounded-2xl bg-surface p-3 pr-4 shadow-card">
                <span className={`grid size-12 shrink-0 place-items-center rounded-xl ${tone}`}><Icon name={icon} size={22} /></span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold">{r.modules?.code} · {r.class_sessions?.title ?? "Class"}</p>
                  <p className="text-xs text-muted">{new Date(r.created_at).toLocaleDateString("en-ZA", { weekday: "short", day: "numeric", month: "short" })} · {timeOf(r.checked_in_at)}</p>
                </div>
                <span className="flex flex-col items-end gap-1">
                  <span className={`text-xs font-bold ${tone.split(" ").find((x) => x.startsWith("text-"))}`}>{STATUS_LABEL[r.status] ?? r.status}</span>
                  <LateChip minutes={r.minutes_late} />
                </span>
              </div>
            );
          })}
        </div>
      </section>
    ),
  };

  // Cards in the institution's order (Design page); the trend and the live card pair up on wide screens.
  const order = theme.student.cards.filter((c) => c.show).map((c) => c.id);
  const blocks: ReactNode[] = [];
  for (let i = 0; i < order.length; i++) {
    const id = order[i], next = order[i + 1];
    if ((id === "hero" && next === "live") || (id === "live" && next === "hero") || (id === "live" && next === "quick") || (id === "quick" && next === "live")) {
      blocks.push(<div key={id} className="grid grid-cols-1 gap-5 lg:grid-cols-2">{cards[id]}{cards[next]}</div>);
      i++;
    } else {
      blocks.push(<div key={id}>{cards[id]}</div>);
    }
  }

  return (
    <div className="mx-auto max-w-5xl">
      <AppTitle eyebrow={`${hello}${first ? `, ${first}` : ""} 👋`} title="Dashboard"
        sub={d.studentNumber ? <span className="tabular-nums">Student number {d.studentNumber}</span> : undefined} />
      <div className="space-y-6">
        {(d.inClass ?? []).map((c) => (
          // Checked in: a green plate, quieter than the navy "open now" sign.
          <section key={c.session} className="flex items-center gap-3 rounded-2xl bg-surface p-4 pl-5" style={{ boxShadow: "inset 6px 0 0 var(--ok), var(--shadow-card)" }}>
            <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-ok text-white"><Icon name="userCheck" size={22} /></span>
            <Link href={`/student/class/${c.session}`} className="min-w-0 flex-1">
              <span className="block font-display text-xl font-bold leading-tight">You&apos;re in {c.code}</span>
              <span className="block truncate text-sm text-muted">{c.title}{c.since ? `, checked in at ${timeOf(c.since)}` : ""}. Tap to open the live class.</span>
            </Link>
            <LeaveButton session={c.session} />
          </section>
        ))}
        <PushToggle compact logo={theme.header.logoUrl || null} institution={theme.header.title || undefined} />
        {blocks}
      </div>
    </div>
  );
}

const STATUS_LOOK: Record<string, [IconName, string]> = {
  present: ["check", "bg-ok/10 text-ok"],
  late: ["clock", "bg-warn/10 text-warn"],
  late_pending: ["clock", "bg-muted/15 text-muted"],
  absent: ["x", "bg-bad/10 text-bad"],
  excused: ["file", "bg-info/10 text-info"],
  pending_verification: ["alert", "bg-warn/10 text-warn"],
  disputed: ["flag", "bg-violet/10 text-violet"],
};
const STATUS_LABEL: Record<string, string> = {
  present: "Present", late: "Late", late_pending: "Awaiting lecturer", absent: "Absent", excused: "Excused",
  pending_verification: "In review", disputed: "Disputed",
};

function SectionHead({ title, href, link }: { title: string; href: string; link: string }) {
  return (
    <div className="mb-3 flex items-end justify-between">
      <h2 className="text-2xl font-bold leading-none tracking-tight">{title}</h2>
      <Link href={href} className="text-sm font-semibold text-accent hover:underline">{link}</Link>
    </div>
  );
}

function Empty({ icon, text }: { icon: IconName; text: string }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl bg-surface p-8 text-center shadow-card">
      <span className="grid size-14 place-items-center rounded-xl bg-bg text-muted"><Icon name={icon} size={26} /></span>
      <p className="max-w-xs text-sm text-muted">{text}</p>
    </div>
  );
}
