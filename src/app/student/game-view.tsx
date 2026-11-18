import Link from "next/link";
import type { ReactNode } from "react";
import { GameTopBar } from "@/components/app-chrome";
import { Icon, type IconName } from "@/components/icons";
import { LookButton } from "@/components/look-button";
import { PushToggle } from "@/components/push-toggle";
import { hhmm } from "@/components/week-grid";
import { attendanceStreak, cardTier, slotState, type CardTier, type SlotState } from "@/lib/game";
import { sastDay, timeOf } from "@/lib/stats";
import type { StudentCard } from "@/lib/theme";
import { badgeOf, type DashboardData } from "./dashboard-view";
import { LeaveButton } from "./leave-button";

// The student home in the game look (lib/look.ts). Same data as DashboardView, arranged like a
// mobile game's main screen, drawn in the app's own minimal style: avatar and attendance bar on top, three
// counters, the dark panel (what to do now) with one big Check in button, today's classes as a row
// of slots, modules as a deck of cards, the week, and recent results. Styles: src/app/game-look.css.

const SLOT: Record<SlotState, { cls: string; label: string; icon?: IconName }> = {
  now: { cls: "g-slot-now", label: "Now", icon: "play" },
  next: { cls: "g-slot-next", label: "Next" },
  later: { cls: "", label: "Later" },
  ended: { cls: "g-slot-dim", label: "Ended" },
  present: { cls: "g-slot-green", label: "Present", icon: "check" },
  late: { cls: "g-slot-orange", label: "Late", icon: "clock" },
  absent: { cls: "g-slot-red", label: "Absent", icon: "x" },
  review: { cls: "g-slot-purple", label: "In review", icon: "alert" },
  excused: { cls: "g-slot-dim", label: "Excused", icon: "check" },
};

type Result = { tint: string; form: string; label: string; icon: IconName };
const RESULT: Record<string, Result> = {
  present: { tint: "g-tint-ok", form: "g-f-ok", label: "Present", icon: "check" },
  late: { tint: "g-tint-late", form: "g-f-late", label: "Late", icon: "clock" },
  late_pending: { tint: "g-tint-late", form: "g-f-late", label: "Awaiting lecturer", icon: "clock" },
  absent: { tint: "g-tint-bad", form: "g-f-bad", label: "Absent", icon: "x" },
  excused: { tint: "g-tint-slate", form: "g-f-slate", label: "Excused", icon: "check" },
  pending_verification: { tint: "g-tint-review", form: "g-f-review", label: "In review", icon: "alert" },
  disputed: { tint: "g-tint-review", form: "g-f-review", label: "Disputed", icon: "flag" },
};
const resultOf = (status: string): Result => RESULT[status] ?? { tint: "g-tint-slate", form: "g-f-slate", label: status, icon: "help" };

const SAST = "Africa/Johannesburg";

/**
 * Recent results, like a game's battle log: the last ten classes as a row of coloured squares,
 * then the last five as cards grouped by day, each with its result in a coloured pill.
 */
function RecentResults({ recs, today }: { recs: DashboardData["recs"]; today: string }) {
  if (recs.length === 0) {
    return (
      <section>
        <Heading>Recent results</Heading>
        <p className="g-panel p-4 text-sm text-[var(--g-muted)]">No attendance recorded yet. Your results show here after your first check-in.</p>
      </section>
    );
  }
  const form = recs.slice(0, 10);
  const counts = new Map<string, number>();
  for (const r of form) counts.set(resultOf(r.status).label, (counts.get(resultOf(r.status).label) ?? 0) + 1);
  const formLabel = `Last ${form.length} classes, newest first: ${[...counts].map(([l, n]) => `${n} ${l.toLowerCase()}`).join(", ")}`;

  const yesterday = sastDay(new Date(Date.now() - 864e5).toISOString());
  const days = new Map<string, DashboardData["recs"]>();
  for (const r of recs.slice(0, 5)) days.set(sastDay(r.created_at), [...(days.get(sastDay(r.created_at)) ?? []), r]);
  const dayName = (ymd: string, iso: string) => ymd === today ? "Today" : ymd === yesterday ? "Yesterday"
    : new Date(iso).toLocaleDateString("en-ZA", { weekday: "long", day: "numeric", month: "long", timeZone: SAST });

  return (
    <section>
      <Heading href="/student/history" link="All">Recent results</Heading>
      <div className="mb-4 flex items-center justify-between gap-3">
        <span className="g-form" role="img" aria-label={formLabel}>
          {form.map((r) => <i key={r.id} className={resultOf(r.status).form} />)}
        </span>
        <span className="shrink-0 text-xs text-[var(--g-muted)]">Last {form.length} classes</span>
      </div>
      <div className="space-y-4">
        {[...days].map(([ymd, list]) => (
          <div key={ymd}>
            <p className="mb-2 text-xs font-semibold text-[var(--g-muted)]">{dayName(ymd, list[0].created_at)}</p>
            <ul className="space-y-2">
              {list.map((r) => {
                const k = resultOf(r.status);
                return (
                  <li key={r.id}>
                    <Link href="/student/history" className="g-result">
                      <span className={`g-res ${k.tint}`}><Icon name={k.icon} size={18} strokeWidth={2.5} /></span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm"><b className="font-bold">{r.modules?.code ?? ""}</b> <span className="text-[var(--g-muted)]">{r.class_sessions?.title ?? "Class"}</span></span>
                        <span className="g-num block truncate text-xs text-[var(--g-muted)]">{r.checked_in_at && r.status !== "absent" ? `Checked in at ${timeOf(r.checked_in_at)}` : `Class at ${timeOf(r.class_sessions?.opens_at ?? r.created_at)}`}</span>
                      </span>
                      <span className="flex shrink-0 flex-col items-end gap-1">
                        <span className={`g-pill ${k.tint}`}>{k.label}</span>
                        {r.minutes_late ? <span className="g-num text-[11px] text-[var(--g-muted)]">{r.minutes_late} min late</span> : null}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

const TIER: Record<CardTier, { cls: string; word: string }> = {
  top: { cls: "g-card-gold", word: "90% or more" },
  ok: { cls: "g-card-blue", word: "On track" },
  risk: { cls: "g-card-red", word: "Below requirement" },
  none: { cls: "g-card-grey", word: "No classes yet" },
};

function Heading({ children, href, link }: { children: ReactNode; href?: string; link?: string }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="text-[17px] font-bold tracking-tight">{children}</h2>
      {href && <Link href={href} className="g-btn g-btn-sm g-quiet h-10 px-3.5">{link}</Link>}
    </div>
  );
}

function Counter({ icon, tint, value, label }: { icon: IconName; tint: string; value: ReactNode; label: string }) {
  return (
    <div className="g-chip">
      <span className={`g-chip-icon ${tint}`}><Icon name={icon} size={17} strokeWidth={2.4} /></span>
      <span className="min-w-0">
        <span className="g-num block truncate text-[17px] font-bold leading-tight">{value}</span>
        <span className="block truncate text-[11.5px] font-medium text-[var(--g-muted)]">{label}</span>
      </span>
    </div>
  );
}

/** The venue's boundary as soft rings around a pin; a gold ring pulses outwards while attendance is open. */
function Rings({ live }: { live: boolean }) {
  return (
    <div className="g-rings" aria-hidden>
      <svg viewBox="0 0 200 200">
        {[94, 68, 44].map((r, i) => <circle key={r} cx="100" cy="100" r={r} fill="none" stroke="currentColor" strokeOpacity={0.1 + i * 0.07} strokeWidth="1.5" />)}
        {live && <circle className="g-pulse" cx="100" cy="100" r="94" fill="none" stroke="currentColor" strokeWidth="2" />}
      </svg>
      <span className="g-pin"><Icon name="pin" size={22} strokeWidth={2.4} /></span>
    </div>
  );
}

export function GameView({ d }: { d: DashboardData }) {
  const { theme, first, rows, recs, live, todaySlots, nextSlot, now, day, overall, att, tot, pending, atRisk, week } = d;
  const shown = new Set<StudentCard>(theme.student.cards.filter((c) => c.show).map((c) => c.id));
  const streak = attendanceStreak(recs);
  const today = sastDay(new Date().toISOString());

  // The hero: an open register first, then the next class today, then nothing.
  const open = live[0];
  const om = open ? (open.modules as unknown as { code: string; title: string }) : null;
  const ended = open ? new Date(open.late_after).getTime() < Date.now() : false;
  const hero = open && om ? {
    status: "Attendance open", title: om.title, code: om.code,
    venue: (open.venues as unknown as { name: string } | null)?.name ?? null,
    line: ended ? `Grace period ended at ${timeOf(open.late_after)}` : `On time until ${timeOf(open.late_after)}`,
  } : nextSlot ? {
    status: hhmm(nextSlot.starts_at) <= now ? "In class now" : `Next class at ${hhmm(nextSlot.starts_at)}`,
    title: nextSlot.title, code: nextSlot.code, venue: nextSlot.venue, line: `${hhmm(nextSlot.starts_at)} to ${hhmm(nextSlot.ends_at)}`,
  } : {
    status: "No class open", title: "Nothing to check in to", code: null, venue: null,
    line: "When your lecturer opens attendance, it shows here.",
  };

  const nextIdx = todaySlots.findIndex((t) => hhmm(t.starts_at) > now);
  const slots = todaySlots.map((t, i) => ({ t, state: slotState({ code: t.code, start: hhmm(t.starts_at), end: hhmm(t.ends_at) }, now, today, recs, i === nextIdx) }));

  return (
    <div className="g-home relative mx-auto max-w-xl space-y-6">
      <GameTopBar name={first || "Student"} percent={overall} />

      {shown.has("quick") && (
        <div className="grid grid-cols-3 gap-2">
          <Counter icon="trendUp" tint="g-tint-plain" value={streak} label="Streak" />
          <Counter icon="check" tint="g-tint-plain" value={tot ? `${att}/${tot}` : "0"} label="Attended" />
          <Counter icon="clock" tint="g-tint-plain" value={pending} label="In review" />
        </div>
      )}

      {(d.inClass ?? []).map((c) => (
        <section key={c.session} className="g-panel flex items-center gap-3 p-3">
          <span className="g-res g-tint-ok"><Icon name="userCheck" size={18} strokeWidth={2.3} /></span>
          <a href={theme.features.liveClass ? `/student/class/${c.session}` : "/student/history"} className="min-w-0 flex-1">
            <span className="block truncate text-sm font-bold">In {c.code}, {c.title}</span>
            <span className="block truncate text-xs text-[var(--g-muted)]">Checked in{c.since ? ` at ${timeOf(c.since)}` : ""}{theme.features.liveClass ? ". Open the live class" : ""}</span>
          </a>
          {theme.features.checkOut && <LeaveButton session={c.session} />}
        </section>
      ))}

      {/* What to do now, and the one big button. */}
      <section aria-label="Now" className="space-y-4">
        <div className="g-hero">
          <Rings live={!!open} />
          <div className="relative max-w-[64%] space-y-3">
            <span className={`g-status ${open ? "g-status-live" : ""}`}>{hero.status}</span>
            <p className="line-clamp-2 text-[26px] font-bold leading-[1.12] tracking-[-0.02em]">{hero.title}</p>
            {(hero.code || hero.venue) && (
              <div className="flex flex-wrap gap-1.5">
                {hero.code && <span className="g-tag">{hero.code}</span>}
                {hero.venue && <span className="g-tag"><Icon name="pin" size={12} strokeWidth={2.4} />{hero.venue}</span>}
              </div>
            )}
            <p className="text-sm opacity-75">{hero.line}</p>
          </div>
        </div>
        <div className="flex gap-3">
          <Link href="/student/check-in" className="g-btn g-primary h-[60px] flex-1 text-[18px]">
            <Icon name="scan" size={22} strokeWidth={2.2} />{open ? "Check in" : "Scan QR code"}
          </Link>
          <Link href="/student/map" aria-label="Find the venue" className="g-btn g-secondary size-[60px] shrink-0"><Icon name="map" size={22} strokeWidth={2} /></Link>
        </div>
      </section>

      {/* Today's classes as slots, filled up to four with free ones. */}
      {shown.has("today") && (
        <section>
          <Heading href="/student/timetable" link="Timetable">Today</Heading>
          <ul className="-mb-1 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {slots.map(({ t, state }) => {
              const s = SLOT[state];
              return (
                <li key={t.id} className="w-[calc((100%-1.5rem)/4)] shrink-0">
                  <Link href="/student/timetable" className={`g-slot ${s.cls}`} aria-label={`${hhmm(t.starts_at)} ${t.code} ${t.title}: ${s.label}`}>
                    <span className="g-num text-xs font-medium opacity-70">{hhmm(t.starts_at)}</span>
                    <span className="truncate text-[15px] font-bold tracking-tight">{t.code}</span>
                    <span className="g-slot-tag">{s.icon && <Icon name={s.icon} size={12} strokeWidth={2.8} />}<span className="truncate">{s.label}</span></span>
                  </Link>
                </li>
              );
            })}
            {Array.from({ length: Math.max(0, 4 - slots.length) }, (_, k) => (
              <li key={`free-${k}`} className="w-[calc((100%-1.5rem)/4)] shrink-0">
                <span className="g-slot g-slot-empty text-xs font-semibold">Free</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Modules as a deck of cards: the colour shows how each one is going. */}
      {shown.has("modules") && (
        <section>
          <Heading href="/student/history" link="History">Modules</Heading>
          {rows.length === 0 ? (
            <p className="g-panel p-4 text-sm text-[var(--g-muted)]">You are not enrolled in any modules yet. Your faculty office enrols you.</p>
          ) : (
            <>
              <ul className="grid grid-cols-4 gap-2">
                {rows.map((r) => {
                  const tier = cardTier(r.percent, r.min_pct);
                  const value = r.percent == null ? "–" : `${Math.round(r.percent)}%`;
                  return (
                    <li key={r.module_id}>
                      <Link href="/student/history" className={`g-card ${TIER[tier].cls}`} title={`${r.title}, needs ${r.min_pct}%`}>
                        <span className="sr-only">{r.code} {r.title}: {value}, {TIER[tier].word}, needs {r.min_pct}%</span>
                        {tier === "risk" && <span aria-hidden className="g-card-alert">!</span>}
                        <span aria-hidden>
                          <span className="block text-[19px] font-bold leading-none tracking-[-0.02em]">{badgeOf(r.code)}</span>
                          <span className="g-num mt-1 block text-[11px] font-medium text-[var(--g-muted)]">{r.code.replace(/^[A-Za-z]+/, "") || r.code}</span>
                        </span>
                        <span aria-hidden className="space-y-1.5">
                          <span className="g-num block text-[17px] font-bold leading-none">{value}</span>
                          <span className="g-card-meter block"><span style={{ width: `${Math.max(0, Math.min(100, r.percent ?? 0))}%` }} /></span>
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
              <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs font-medium text-[var(--g-muted)]">
                <span><i className="g-key g-card-gold" />90% or more</span>
                <span><i className="g-key g-card-blue" />On track</span>
                <span><i className="g-key g-card-red" />Below requirement</span>
                <span><i className="g-key g-card-grey" />No classes yet</span>
              </p>
            </>
          )}
        </section>
      )}

      {/* This week, and anything below its requirement. */}
      {shown.has("quick") && (
        <section className="g-panel p-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-[17px] font-bold tracking-tight">This week</h2>
            {atRisk.length > 0 ? <span className="g-status g-tint-bad">Below requirement</span>
              : rows.length > 0 ? <span className="g-status g-tint-ok">On track</span> : null}
          </div>
          {atRisk.length > 0 && <p className="mt-2 text-xs text-[var(--g-muted)]">At risk: <b className="font-bold text-[var(--g-text)]">{atRisk.map((r) => r.code).join(", ")}</b></p>}
          <div className="mt-4 grid grid-cols-7 gap-1 text-center">
            {week.map((w) => (
              <span key={w.wd} className="flex flex-col items-center gap-1.5">
                <span className="text-[11px] font-semibold text-[var(--g-muted)]">{w.letter}</span>
                <span className={`g-day g-num ${w.wd === day ? "g-day-today" : w.wd < day ? "text-[var(--g-muted)]" : ""}`}>{w.date}</span>
                <span className="flex h-1.5 gap-1">{[...w.kinds].map((k) => <i key={k} className={`size-1.5 rounded-full ${k === "test" ? "bg-[var(--ink)]" : "bg-[var(--muted)]"}`} />)}</span>
              </span>
            ))}
          </div>
        </section>
      )}

      {shown.has("recent") && <RecentResults recs={recs} today={today} />}

      <PushToggle compact logo={theme.header.logoUrl || null} institution={theme.header.title || undefined} />

      <div className="flex justify-center pb-2">
        <LookButton to="simple" className="g-btn g-btn-sm g-quiet h-11 px-4 disabled:opacity-70">Switch to simple look</LookButton>
      </div>
    </div>
  );
}
