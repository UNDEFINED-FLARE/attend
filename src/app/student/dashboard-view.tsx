import Link from "next/link";
import type { ReactNode } from "react";
import { AppTitle } from "@/components/app-chrome";
import { Ring } from "@/components/charts";
import { Icon, type IconName } from "@/components/icons";
import { LateChip } from "@/components/late";
import { PushToggle } from "@/components/push-toggle";
import { LeaveButton } from "./leave-button";
import { LinkButton, pct } from "@/components/ui";
import { hhmm, moduleColor, type Slot } from "@/components/week-grid";
import { timeOf } from "@/lib/stats";
import type { StudentCard, Theme } from "@/lib/theme";
import { TrendCard, type TrendSeries } from "./trend-card";

// The student dashboard's display, separate from its data loading (page.tsx).
// Patterns borrowed from the apps students already use: iClicker's "attendance is open"
// banner with one Join button, Edusign's day schedule as a plain list, and Canvas and
// Google Classroom's course cards with a band in the module's shade (lib/palette.ts).
// Colours come only from the theme, so Graphite, Navy and dark mode all apply.

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

/** A module's colour: the same one on the timetable, the home screen and the map. */
export const colorFor = moduleColor;
export const badgeOf = (code: string) => code.replace(/[^A-Z]/gi, "").slice(0, 3).toUpperCase() || code.slice(0, 2);

const shortDate = (iso: string) => new Date(iso).toLocaleDateString("en-ZA", { weekday: "short", day: "numeric", month: "short" });

export function DashboardView({ d }: { d: DashboardData }) {
  const { theme, hello, first, rows, recs, live, series, todaySlots, nextSlot, now, day, overall, att, tot, pending, atRisk, week } = d;
  const title = (id: StudentCard) => theme.student.cards.find((c) => c.id === id)?.title || id;
  const cards: Record<StudentCard, ReactNode> = {
    hero: <TrendCard title={title("hero") === "Attendance summary" ? "Attendance performance" : title("hero")} series={series} />,

    // Attendance open: a plain card with the module's colour along the top, what and where,
    // and one clear "Check in" button (the way iClicker shows a running session).
    live: live.length > 0 ? (() => {
      const s = live[0];
      const m = s.modules as unknown as { code: string; title: string };
      const venue = (s.venues as unknown as { name: string } | null)?.name;
      const late = new Date(s.late_after).getTime() < Date.now();
      return (
        <section aria-labelledby="open-title" className="overflow-hidden rounded-3xl bg-surface shadow-card">
          <div aria-hidden className="h-1.5" style={{ background: colorFor(m.code) }} />
          <div className="p-4 sm:p-5">
            <p className="flex items-center gap-2 text-sm font-semibold text-ok">
              <span className="size-2 rounded-full bg-ok motion-safe:animate-pulse" />Attendance is open
            </p>
            <p className="mt-3 text-sm font-semibold text-muted">{m.code}</p>
            <h2 id="open-title" className="text-xl font-semibold leading-snug">{m.title}</h2>
            <ul className="mt-2 space-y-1 text-sm text-muted">
              <li className="flex items-center gap-2"><Icon name="pin" size={16} />{venue ?? "Venue not set"}</li>
              <li className={`flex items-center gap-2 ${late ? "text-warn" : ""}`}><Icon name="clock" size={16} />
                {late ? `Counted as late since ${timeOf(s.late_after)}` : `On time until ${timeOf(s.late_after)}`}</li>
            </ul>
            <LinkButton href="/student/check-in" className="mt-4 h-12 w-full text-base"><Icon name="scan" size={20} />Check in</LinkButton>
            {live.length > 1 && <p className="mt-3 text-sm text-muted">{live.length - 1} more {live.length === 2 ? "class is" : "classes are"} open. Scan the code in the room you are in.</p>}
          </div>
        </section>
      );
    })() : (() => {
      const zone = nextSlot ? colorFor(nextSlot.code) : "var(--line)";
      const inClass = nextSlot && hhmm(nextSlot.starts_at) <= now;
      return (
        <section className="overflow-hidden rounded-3xl bg-surface shadow-card">
          <div aria-hidden className="h-1.5" style={{ background: zone }} />
          <div className="p-4 sm:p-5">
            <p className="text-sm font-semibold text-muted">{nextSlot ? (inClass ? "In class now" : "Next class") : "No class open right now"}</p>
            {nextSlot ? (
              <>
                <p className="mt-3 text-sm font-semibold text-muted">{nextSlot.code}</p>
                <h2 className="text-xl font-semibold leading-snug">{nextSlot.title}</h2>
                <ul className="mt-2 space-y-1 text-sm text-muted">
                  <li className="flex items-center gap-2"><Icon name="pin" size={16} />{nextSlot.venue ?? "Venue not set"}</li>
                  <li className="flex items-center gap-2"><Icon name="clock" size={16} />{hhmm(nextSlot.starts_at)} to {hhmm(nextSlot.ends_at)}</li>
                </ul>
                <p className="mt-3 text-sm">Check-in opens when your lecturer starts the class.</p>
                <LinkButton href="/student/map" variant="secondary" className="mt-4 w-full sm:w-auto"><Icon name="map" size={18} />Find the venue</LinkButton>
              </>
            ) : (
              <>
                <p className="mt-2 text-sm">When your lecturer opens attendance, it appears here. You can also scan the code on the projector at any time.</p>
                <LinkButton href="/student/check-in" variant="secondary" className="mt-4 w-full sm:w-auto"><Icon name="qr" size={18} />Open the scanner</LinkButton>
              </>
            )}
          </div>
        </section>
      );
    })(),

    quick: (
      <div className="grid grid-cols-2 gap-3">
        <section className="flex flex-col rounded-3xl bg-surface p-4 shadow-card">
          <h2 className="text-sm font-semibold text-muted">{theme.student.heroTitle || "Your attendance"}</h2>
          <div className="my-3 grid flex-1 place-items-center">
            <Ring value={overall} size={104} stroke={10} color="var(--brand)" track="color-mix(in srgb, var(--brand) 12%, transparent)">
              <span className="text-2xl font-semibold tabular-nums">{overall == null ? "—" : `${Math.round(overall)}%`}</span>
            </Ring>
          </div>
          <p className={`text-sm font-medium ${atRisk.length ? "text-bad" : "text-ok"}`}>
            {atRisk.length ? `Below the requirement in ${atRisk.map((r) => r.code).join(", ")}` : rows.length ? `On track: ${att} of ${tot} classes` : "No modules yet"}
          </p>
          {pending > 0 && <p className="mt-1 text-xs text-muted">{pending} waiting for your lecturer</p>}
        </section>
        <section className="rounded-3xl bg-surface p-4 shadow-card">
          <h2 className="text-sm font-semibold text-muted">This week</h2>
          <div className="mt-3 grid grid-cols-7 gap-y-2 text-center">
            {week.map((d) => <span key={`l${d.wd}`} className="text-[11px] font-medium text-muted">{d.letter}</span>)}
            {week.map((d) => (
              <span key={d.wd} className="flex flex-col items-center gap-1">
                <span className={`grid size-7 place-items-center rounded-full text-sm tabular-nums ${d.wd === day ? "bg-brand font-semibold text-brand-ink" : d.wd < day ? "text-muted" : ""}`}
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

    // The day as one list, the way a schedule app shows it.
    today: (
      <section>
        <SectionHead title={title("today")} href="/student/timetable" link="Timetable" />
        {todaySlots.length === 0
          ? <Empty icon="calendar" text="No classes on your timetable today." />
          : (
            <ul className="divide-y divide-line overflow-hidden rounded-3xl bg-surface shadow-card">
              {todaySlots.map((t) => {
                const isLive = hhmm(t.starts_at) <= now && now < hhmm(t.ends_at), past = hhmm(t.ends_at) <= now;
                return (
                  <li key={t.id}>
                    <Link href="/student/map" className="flex items-center gap-3 px-4 py-3 transition hover:bg-bg">
                      <span className={`w-11 shrink-0 tabular-nums ${past ? "text-muted" : ""}`}>
                        <span className="block text-sm font-semibold">{hhmm(t.starts_at)}</span>
                        <span className="block text-xs text-muted">{hhmm(t.ends_at)}</span>
                      </span>
                      <span aria-hidden className="h-9 w-1 shrink-0 rounded-full" style={{ background: past ? "var(--line)" : colorFor(t.code) }} />
                      <span className="min-w-0 flex-1">
                        <span className={`block truncate font-medium ${past ? "text-muted" : ""}`}>{t.title}</span>
                        <span className="block truncate text-sm text-muted">{t.code}, {t.venue ?? "no venue set"}</span>
                      </span>
                      {isLive && <span className="shrink-0 rounded-full bg-ok/10 px-2.5 py-0.5 text-xs font-semibold text-ok">Now</span>}
                      {past && <span className="shrink-0 text-xs text-muted">Done</span>}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
      </section>
    ),

    // Course cards with a band in the module's colour, as in Canvas and Google Classroom.
    modules: (
      <section>
        <SectionHead title={title("modules")} href="/student/history" link="History" />
        {rows.length === 0 && <Empty icon="book" text="You are not enrolled in any modules yet. Your faculty office enrols you." />}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          {rows.map((r) => {
            const c = colorFor(r.code), low = r.percent != null && r.percent < r.min_pct, none = r.percent == null;
            return (
              <div key={r.module_id} className="overflow-hidden rounded-3xl bg-surface shadow-card">
                <div className="flex h-14 items-end px-3 pb-2" style={{ background: c }}>
                  <span className="text-sm font-semibold text-white">{r.code}</span>
                </div>
                <div className="p-3">
                  <p className="line-clamp-2 min-h-10 text-sm font-medium leading-5">{r.title}</p>
                  <p className={`mt-2 text-2xl font-semibold tabular-nums ${low ? "text-bad" : ""}`}>{pct(r.percent)}</p>
                  <p className={`text-xs font-medium ${none ? "text-muted" : low ? "text-bad" : "text-ok"}`}>
                    {none ? "No classes yet" : low ? `Below the ${r.min_pct}% needed` : `On track (needs ${r.min_pct}%)`}
                  </p>
                  {!none && <p className="mt-0.5 text-xs text-muted">{r.attended} of {r.attended + r.absent} classes</p>}
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
        {recs.length > 0 && (
          <ul className="divide-y divide-line overflow-hidden rounded-3xl bg-surface shadow-card">
            {recs.slice(0, 5).map((r) => {
              const [icon, tone] = STATUS_LOOK[r.status] ?? STATUS_LOOK.absent;
              return (
                <li key={r.id} className="flex items-center gap-3 px-4 py-3">
                  <span className={`grid size-9 shrink-0 place-items-center rounded-full ${tone}`}><Icon name={icon} size={18} /></span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{r.modules?.code}, {r.class_sessions?.title ?? "class"}</p>
                    <p className="text-xs text-muted">{shortDate(r.created_at)}{r.checked_in_at ? `, ${timeOf(r.checked_in_at)}` : ""}</p>
                  </div>
                  <span className="flex flex-col items-end gap-1">
                    <span className={`text-xs font-semibold ${tone.split(" ").find((x) => x.startsWith("text-"))}`}>{STATUS_LABEL[r.status] ?? r.status}</span>
                    <LateChip minutes={r.minutes_late} />
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    ),
  };

  // Cards in the institution's order (Design page); the trend and the live card pair up on wide screens.
  const order = theme.student.cards.filter((c) => c.show).map((c) => c.id);
  const blocks: ReactNode[] = [];
  for (let i = 0; i < order.length; i++) {
    const id = order[i], next = order[i + 1];
    if ((id === "hero" && next === "live") || (id === "live" && next === "hero") || (id === "live" && next === "quick") || (id === "quick" && next === "live")) {
      blocks.push(<div key={id} className="grid grid-cols-1 gap-4 lg:grid-cols-2">{cards[id]}{cards[next]}</div>);
      i++;
    } else {
      blocks.push(<div key={id}>{cards[id]}</div>);
    }
  }

  return (
    <div className="mx-auto max-w-5xl">
      <AppTitle eyebrow={`${hello}${first ? `, ${first}` : ""}`} title="Home"
        sub={d.studentNumber ? <span className="tabular-nums">Student number {d.studentNumber}</span> : undefined} />
      <div className="space-y-6">
        {(d.inClass ?? []).map((c) => (
          <section key={c.session} className="flex items-center gap-3 rounded-3xl bg-surface p-4 shadow-card">
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-ok/10 text-ok"><Icon name="userCheck" size={20} /></span>
            {/* Live class and check-out can be switched off on the Design page. */}
            <Link href={theme.features.liveClass ? `/student/class/${c.session}` : "/student/history"} className="min-w-0 flex-1">
              <span className="block font-semibold">You’re checked in to {c.code}</span>
              <span className="block truncate text-sm text-muted">{c.title}{c.since ? `, since ${timeOf(c.since)}` : ""}.{theme.features.liveClass ? " Tap to open the class." : ""}</span>
            </Link>
            {theme.features.checkOut && <LeaveButton session={c.session} />}
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
    <div className="mb-2.5 flex items-baseline justify-between">
      <h2 className="text-lg font-semibold">{title}</h2>
      <Link href={href} className="text-sm font-medium text-accent hover:underline">{link}</Link>
    </div>
  );
}

function Empty({ icon, text }: { icon: IconName; text: string }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-3xl bg-surface p-8 text-center shadow-card">
      <span className="grid size-12 place-items-center rounded-full bg-bg text-muted"><Icon name={icon} size={24} /></span>
      <p className="max-w-xs text-sm text-muted">{text}</p>
    </div>
  );
}
