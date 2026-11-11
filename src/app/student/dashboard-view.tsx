import Link from "next/link";
import type { ReactNode } from "react";
import { AppTitle } from "@/components/app-chrome";
import { Ring } from "@/components/charts";
import { Icon, type IconName } from "@/components/icons";
import { LateChip } from "@/components/late";
import { PushToggle } from "@/components/push-toggle";
import { LeaveButton } from "./leave-button";
import { pct } from "@/components/ui";
import { hhmm, type Slot } from "@/components/week-grid";
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

import { moduleShade } from "@/lib/palette";
export const colorFor = moduleShade;
export const badgeOf = (code: string) => code.replace(/[^A-Z]/gi, "").slice(0, 3).toUpperCase() || code.slice(0, 2);

export function DashboardView({ d }: { d: DashboardData }) {
  const { theme, hello, first, rows, recs, live, series, todaySlots, nextSlot, now, day, overall, att, tot, pending, atRisk, week } = d;
  const title = (id: StudentCard) => theme.student.cards.find((c) => c.id === id)?.title || id;
  const cards: Record<StudentCard, ReactNode> = {
    hero: <TrendCard title={title("hero") === "Attendance summary" ? "Attendance performance" : title("hero")} series={series} />,

    live: live.length > 0 ? (
      <section className="flex items-stretch gap-4 rounded-[28px] bg-surface p-5 shadow-card">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-ok"><span className="size-2 animate-pulse rounded-full bg-ok" />Attendance open</p>
          {live.slice(0, 1).map((s) => {
            const m = s.modules as unknown as { code: string; title: string };
            const late = new Date(s.late_after).getTime() < Date.now();
            return (
              <div key={s.id} className="mt-2 space-y-1">
                <p className="truncate text-lg font-bold">{m.title}</p>
                <Meta k="Module" v={m.code} />
                <Meta k="Venue" v={(s.venues as unknown as { name: string } | null)?.name ?? "Not set"} />
                <Meta k={late ? "Grace ended" : "On time until"} v={timeOf(s.late_after)} />
              </div>
            );
          })}
          <span className="mt-3 inline-flex items-center gap-1 rounded-full bg-ok px-3 py-1 text-xs font-semibold text-white"><Icon name="check" size={14} strokeWidth={3} />Scan to check in</span>
        </div>
        <Link href="/student/check-in" aria-label="Check in now"
          className="grid aspect-square w-28 shrink-0 place-items-center self-center rounded-3xl bg-gradient-to-br from-accent to-brand text-white shadow-[0_10px_30px_color-mix(in_srgb,var(--accent)_40%,transparent)] transition active:scale-95">
          <Icon name="scan" size={44} strokeWidth={1.8} />
        </Link>
      </section>
    ) : (
      <section className="flex items-stretch gap-4 rounded-[28px] bg-surface p-5 shadow-card">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted">{nextSlot ? (hhmm(nextSlot.starts_at) <= now ? "In class now" : "Next class") : "No session open"}</p>
          {nextSlot ? (
            <div className="mt-2 space-y-1">
              <p className="truncate text-lg font-bold">{nextSlot.title}</p>
              <Meta k="Module" v={nextSlot.code} />
              <Meta k="Venue" v={nextSlot.venue ?? "Not set"} />
              <Meta k="Time" v={`${hhmm(nextSlot.starts_at)}–${hhmm(nextSlot.ends_at)}`} />
            </div>
          ) : <p className="mt-2 text-sm text-muted">When your lecturer opens attendance it appears here. You can scan the code on the projector any time.</p>}
          <span className="mt-3 inline-flex items-center gap-1 rounded-full bg-bg px-3 py-1 text-xs font-semibold text-muted"><Icon name="clock" size={14} />Waiting for your lecturer</span>
        </div>
        <Link href={nextSlot ? "/student/map" : "/student/check-in"} aria-label={nextSlot ? "Show on the map" : "Open the scanner"}
          className="grid aspect-square w-28 shrink-0 place-items-center self-center rounded-3xl bg-gradient-to-br from-brand to-accent text-white">
          {nextSlot
            ? <span className="text-center"><span className="block text-3xl font-bold tabular-nums">{hhmm(nextSlot.starts_at)}</span><span className="text-[11px] font-semibold uppercase tracking-wider opacity-80">{nextSlot.kind}</span></span>
            : <Icon name="qr" size={44} strokeWidth={1.6} />}
        </Link>
      </section>
    ),

    quick: (
      <div className="grid grid-cols-2 gap-4">
        <section className="flex flex-col rounded-[28px] bg-surface p-4 shadow-card">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted">{theme.student.heroTitle || "Your attendance"}</p>
          <div className="my-3 grid flex-1 place-items-center">
            <Ring value={overall} size={112} stroke={11} color="var(--accent)" track="color-mix(in srgb, var(--accent) 14%, transparent)">
              <span className="text-[26px] font-bold tabular-nums tracking-tight">{overall == null ? "—" : `${Math.round(overall)}%`}</span>
            </Ring>
          </div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted">{atRisk.length ? "Below requirement" : "Status"}</p>
          <p className={`text-xs font-semibold ${atRisk.length ? "text-bad" : "text-accent"}`}>
            {atRisk.length ? atRisk.map((r) => r.code).join(", ") : rows.length ? `On track · ${att}/${tot} classes` : "No modules yet"}
          </p>
          {pending > 0 && <p className="mt-1 text-[11px] text-muted">{pending} awaiting a decision</p>}
        </section>
        <section className="rounded-[28px] bg-surface p-4 shadow-card">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted">This week</p>
          <div className="mt-3 grid grid-cols-7 gap-y-2 text-center">
            {week.map((d) => <span key={`l${d.wd}`} className="text-[10px] font-bold text-muted">{d.letter}</span>)}
            {week.map((d) => (
              <span key={d.wd} className="flex flex-col items-center gap-1">
                <span className={`grid size-7 place-items-center rounded-full text-xs font-semibold tabular-nums ${d.wd === day ? "bg-accent text-white shadow-[0_4px_10px_color-mix(in_srgb,var(--accent)_45%,transparent)]" : d.wd < day ? "text-muted" : ""}`}>{d.date}</span>
                <span className="flex h-1.5 gap-0.5">
                  {d.kinds.has("lecture") && <i className="size-1.5 rounded-full bg-accent" />}
                  {d.kinds.has("prac") && <i className="size-1.5 rounded-full bg-ok" />}
                  {d.kinds.has("test") && <i className="size-1.5 rounded-full bg-bad" />}
                </span>
              </span>
            ))}
          </div>
          <ul className="mt-3 space-y-1 text-[11px] text-muted">
            <li className="flex items-center gap-2"><i className="size-2 rounded-full bg-accent" />Lectures</li>
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
                  <Link key={t.id} href="/student/map" className={`relative min-w-60 snap-start overflow-hidden rounded-3xl bg-surface p-4 shadow-card ${past ? "opacity-55" : ""}`}>
                    <span className="absolute inset-y-0 left-0 w-1.5" style={{ background: colorFor(t.code) }} />
                    <div className="flex items-center justify-between">
                      <span className="rounded-full bg-bg px-2.5 py-1 text-xs font-bold tabular-nums">{hhmm(t.starts_at)} – {hhmm(t.ends_at)}</span>
                      {isLive && <span className="flex items-center gap-1 text-xs font-bold text-ok"><span className="size-1.5 animate-pulse rounded-full bg-ok" />Now</span>}
                    </div>
                    <p className="mt-3 truncate font-bold">{t.title}</p>
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">{t.code} · {t.kind}</p>
                    <p className="mt-2 flex items-center gap-1 text-xs text-muted"><Icon name="pin" size={14} />{t.venue ?? "No venue"}</p>
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
              <div key={r.module_id} className="flex items-center gap-4 rounded-3xl bg-surface p-4 shadow-card">
                <span className="grid size-14 shrink-0 place-items-center rounded-full text-sm font-bold text-white ring-4 ring-bg" style={{ background: `linear-gradient(135deg, ${c}, color-mix(in srgb, ${c} 60%, #000))` }}>{badgeOf(r.code)}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-bold">{r.title}</p>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">{r.code} · needs {r.min_pct}%</p>
                  <span className={`mt-1.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${none ? "bg-bg text-muted" : low ? "bg-bad/10 text-bad" : "bg-ok text-white"}`}>
                    {!none && !low && <Icon name="check" size={12} strokeWidth={3} />}{none ? "No classes yet" : low ? "At risk" : "On track"}
                  </span>
                </div>
                <div className="text-right">
                  <p className={`text-xl font-bold tabular-nums ${low ? "text-bad" : "text-accent"}`}>{pct(r.percent)}</p>
                  <p className="text-[11px] text-muted">{r.attended}/{r.attended + r.absent}</p>
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
              <div key={r.id} className="flex items-center gap-3 rounded-3xl bg-surface p-3 pr-4 shadow-card">
                <span className={`grid size-12 shrink-0 place-items-center rounded-2xl ${tone}`}><Icon name={icon} size={22} /></span>
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
        sub={d.studentNumber ? <span className="font-mono text-xs">{d.studentNumber}</span> : undefined} />
      <div className="space-y-6">
        {(d.inClass ?? []).map((c) => (
          <section key={c.session} className="flex items-center gap-3 rounded-[28px] bg-surface p-4 shadow-card ring-2 ring-ok/30">
            <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-ok/10 text-ok"><Icon name="userCheck" size={22} /></span>
            <Link href={theme.features.liveClass ? `/student/class/${c.session}` : "/student/history"} className="min-w-0 flex-1">
              <span className="flex items-center gap-2 truncate font-bold"><span className="size-2 shrink-0 animate-pulse rounded-full bg-ok" />In {c.code} · {c.title}</span>
              <span className="block text-xs text-muted">Checked in{c.since ? ` at ${timeOf(c.since)}` : ""}{theme.features.liveClass ? " · tap to open the live class" : ""}</span>
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

function Meta({ k, v }: { k: string; v: string }) {
  return <p className="truncate text-[11px] font-semibold uppercase tracking-wider text-muted">{k}: <span className="normal-case tracking-normal text-ink">{v}</span></p>;
}

function SectionHead({ title, href, link }: { title: string; href: string; link: string }) {
  return (
    <div className="mb-3 flex items-end justify-between">
      <h2 className="text-xl font-bold tracking-tight">{title}</h2>
      <Link href={href} className="text-sm font-semibold text-accent">{link}</Link>
    </div>
  );
}

function Empty({ icon, text }: { icon: IconName; text: string }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-3xl bg-surface p-8 text-center shadow-card">
      <span className="grid size-14 place-items-center rounded-full bg-accent/10 text-accent"><Icon name={icon} size={26} /></span>
      <p className="max-w-xs text-sm text-muted">{text}</p>
    </div>
  );
}
