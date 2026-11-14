import Link from "next/link";
import { AppTitle } from "@/components/app-chrome";
import { ActionForm } from "@/components/form";
import { Icon, type IconName } from "@/components/icons";
import { LateChip } from "@/components/late";
import { Badge, Textarea, when } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { sastDay, sastMidnight, timeOf } from "@/lib/stats";
import { dispute } from "../actions";

export const metadata = { title: "History & disputes" };

type Rec = {
  id: string; status: string; minutes_late?: number | null; attendance_statuses?: { name: string; color: string } | null; checked_in_at: string | null; created_at: string; score: number | null; explanation: string[];
  class_sessions: { title: string; opens_at: string; modules: { code: string; title: string } } | null;
};

const LOOK: Record<string, [IconName, string, string]> = {
  present: ["check", "bg-ok/10 text-ok", "Present"],
  late: ["clock", "bg-warn/10 text-warn", "Late"],
  late_pending: ["clock", "bg-muted/15 text-muted", "Awaiting lecturer"],
  absent: ["x", "bg-bad/10 text-bad", "Absent"],
  excused: ["file", "bg-info/10 text-info", "Excused"],
  pending_verification: ["alert", "bg-warn/10 text-warn", "In review"],
  disputed: ["flag", "bg-violet/10 text-violet", "Disputed"],
};
const RANGES = [["today", "Today"], ["week", "This week"], ["all", "All"]] as const;

export default async function History({ searchParams }: { searchParams: Promise<{ when?: string }> }) {
  const range = ((await searchParams).when ?? "all") as (typeof RANGES)[number][0];
  const { supabase, institutionId } = await requireRole("student");
  const select = (late: boolean) => supabase.from("attendance_records")
    .select(`id, status, ${late ? "minutes_late, attendance_statuses(name, color), " : ""}checked_in_at, created_at, score, explanation, class_sessions(title, opens_at, modules(code, title))`)
    .eq("institution_id", institutionId).order("created_at", { ascending: false }).limit(200);
  const [recRes, { data: disputes }] = await Promise.all([
    select(true),
    supabase.from("attendance_disputes").select("id, record_id, status, reason, resolution_note, created_at")
      .eq("institution_id", institutionId).order("created_at", { ascending: false }),
  ]);
  // minutes_late and custom statuses need database updates 0010 and 0014.
  const all = ((recRes.error ? (await select(false)).data : recRes.data) ?? []) as unknown as Rec[];
  const from = range === "today" ? sastMidnight(0) : range === "week" ? sastMidnight(6) : null;
  const records = from ? all.filter((r) => r.created_at >= from) : all;
  const disputable = all.filter((r) => ["absent", "late", "pending_verification"].includes(r.status));
  const att = all.filter((r) => r.status === "present" || r.status === "late").length;
  const res = all.filter((r) => ["present", "late", "absent"].includes(r.status)).length;

  // Group by day for the list.
  const days = new Map<string, Rec[]>();
  for (const r of records) days.set(sastDay(r.created_at), [...(days.get(sastDay(r.created_at)) ?? []), r]);

  return (
    <div className="mx-auto max-w-3xl">
      <AppTitle title="History" eyebrow="Your attendance" sub={res ? `${att} of ${res} classes attended` : undefined} />

      <div className="mb-5 flex gap-2" role="tablist" aria-label="Period">
        {RANGES.map(([k, label]) => (
          <Link key={k} href={k === "all" ? "/student/history" : `/student/history?when=${k}`} role="tab" aria-selected={range === k}
            className={`h-11 flex-1 rounded-full text-center text-sm font-semibold leading-[44px] transition sm:flex-none sm:px-6 ${range === k ? "bg-accent text-white shadow-[0_8px_20px_color-mix(in_srgb,var(--accent)_35%,transparent)]" : "bg-surface text-muted shadow-card"}`}>
            {label}
          </Link>
        ))}
      </div>

      {records.length === 0 && (
        <div className="flex flex-col items-center gap-3 rounded-3xl bg-surface p-10 text-center shadow-card">
          <span className="grid size-14 place-items-center rounded-full bg-accent/10 text-accent"><Icon name="history" size={26} /></span>
          <p className="text-sm text-muted">{range === "all" ? "No attendance recorded yet." : "Nothing recorded in this period."}</p>
        </div>
      )}

      <div className="space-y-6">
        {[...days.entries()].map(([d, list]) => (
          <section key={d}>
            <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-muted">
              {new Date(`${d}T12:00:00Z`).toLocaleDateString("en-ZA", { weekday: "long", day: "numeric", month: "long" })}
            </p>
            <div className="space-y-2.5">
              {list.map((r) => {
                const [icon, tone, label] = LOOK[r.status] ?? LOOK.absent;
                const m = r.class_sessions?.modules;
                return (
                  <details key={r.id} className="group rounded-3xl bg-surface shadow-card [&_summary::-webkit-details-marker]:hidden">
                    <summary className="flex cursor-pointer list-none items-center gap-3 p-3 pr-4">
                      <span className={`grid size-12 shrink-0 place-items-center rounded-2xl ${tone}`}><Icon name={icon} size={22} /></span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-bold">{m?.code} · {r.class_sessions?.title ?? "Class"}</span>
                        <span className="block truncate text-xs text-muted">{m?.title} · {timeOf(r.checked_in_at ?? r.created_at)}</span>
                      </span>
                      <span className="flex flex-col items-end gap-1">
                        {r.attendance_statuses
                          ? <span className="text-xs font-bold" style={{ color: r.attendance_statuses.color }}>{r.attendance_statuses.name}</span>
                          : <span className={`text-xs font-bold ${tone.split(" ").find((x) => x.startsWith("text-"))}`}>{label}</span>}
                        <LateChip minutes={r.minutes_late} />
                      </span>
                      <Icon name="arrowRight" size={16} className="shrink-0 text-muted transition group-open:rotate-90" />
                    </summary>
                    <div className="border-t border-line px-4 py-3 text-xs text-muted">
                      {(r.explanation ?? []).length ? <ul className="list-disc space-y-1 pl-4">{r.explanation.map((e) => <li key={e}>{e}</li>)}</ul> : <p>No notes on this record.</p>}
                      {r.score != null && <p className="mt-2">Confidence {r.score}/100</p>}
                      {["absent", "late", "pending_verification"].includes(r.status) && <Link href="#dispute" className="mt-2 inline-flex items-center gap-1 font-semibold text-accent"><Icon name="flag" size={14} />Dispute this</Link>}
                    </div>
                  </details>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      <div className="mt-8 grid gap-5 md:grid-cols-2">
        <section id="dispute" className="scroll-mt-24 rounded-[28px] bg-surface p-5 shadow-card">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted">Something wrong?</p>
          <h2 className="mt-1 text-lg font-bold">Dispute a record</h2>
          {disputable.length === 0 ? <p className="mt-2 text-sm text-muted">Nothing to dispute.</p> : (
            <div className="mt-3">
              <ActionForm action={dispute} submit="Submit dispute" pending="Submitting…">
                <select name="record" className="h-12 w-full rounded-2xl border border-line bg-bg px-3 text-sm" required>
                  {disputable.map((r) => (
                    <option key={r.id} value={r.id}>{r.class_sessions?.modules.code} · {when(r.class_sessions?.opens_at)} · {(LOOK[r.status] ?? LOOK.absent)[2]}</option>
                  ))}
                </select>
                <Textarea name="reason" placeholder="What happened? e.g. I was in the back row and my phone's location was off." required minLength={10} className="rounded-2xl" />
              </ActionForm>
            </div>
          )}
        </section>
        <section className="rounded-[28px] bg-surface p-5 shadow-card">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted">Your requests</p>
          <h2 className="mt-1 text-lg font-bold">My disputes</h2>
          <ul className="mt-2 divide-y divide-line text-sm">
            {(disputes ?? []).length === 0 && <li className="py-2 text-muted">None.</li>}
            {(disputes ?? []).map((d) => (
              <li key={d.id} className="space-y-1 py-3">
                <div className="flex justify-between"><Badge status={d.status === "open" ? "pending" : d.status} /><span className="text-xs text-muted">{when(d.created_at)}</span></div>
                <p>{d.reason}</p>
                {d.resolution_note && <p className="text-muted">Response: {d.resolution_note}</p>}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
