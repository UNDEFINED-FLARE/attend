import { Submit } from "@/components/form";
import { LateChip } from "@/components/late";
import { Card } from "@/components/ui";
import { decideLate } from "../../actions";

export type LateRow = {
  student_id: string; student_number: string; full_name: string; status: string;
  minutes_late: number; checked_in_at: string | null; score: number | null;
  gps: { p_inside?: number; accuracy_m?: number; outside_by_m?: number; required?: boolean } | null;
  decided_by_close: boolean;
};

const time = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" }) : "");
const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();

function Where({ gps }: { gps: LateRow["gps"] }) {
  if (!gps || gps.required === false) return <span className="text-muted">No location check</span>;
  if ((gps.p_inside ?? 0) >= 0.5) return <span className="text-ok">● In the venue{gps.accuracy_m != null ? ` · ±${gps.accuracy_m} m` : ""}</span>;
  return <span className="text-warn">● ~{gps.outside_by_m ?? "?"} m outside</span>;
}

function Decide({ session, students, accept, label, variant }: { session: string; students: string[]; accept: boolean; label: string; variant?: "secondary" | "danger" }) {
  return (
    <form action={decideLate}>
      <input type="hidden" name="session" value={session} />
      <input type="hidden" name="accept" value={accept ? "1" : "0"} />
      {students.map((s) => <input key={s} type="hidden" name="student" value={s} />)}
      <Submit label={label} pending="…" variant={variant} />
    </form>
  );
}

/**
 * Students who arrived after the grace period. Waiting ones are grey until the
 * lecturer accepts or denies; anything not denied is accepted when the session closes.
 */
export function LateArrivals({ session, rows }: { session: string; rows: LateRow[] }) {
  if (!rows.length) return null;
  const waiting = rows.filter((r) => r.status === "late_pending").sort((a, b) => a.minutes_late - b.minutes_late);
  const decided = rows.filter((r) => r.status !== "late_pending").sort((a, b) => a.student_number.localeCompare(b.student_number));

  return (
    <Card className="mb-6 overflow-hidden p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
        <div>
          <h2 className="text-base font-semibold">Late arrivals{waiting.length > 0 && <span className="ml-2 rounded-full bg-muted/15 px-2 py-0.5 text-xs text-muted">{waiting.length} waiting</span>}</h2>
          <p className="text-xs text-muted">
            Checked in after the grace period, with the live QR and location. You have the final say —
            {" "}anything you don&apos;t deny counts as attended (late) when the session closes.
          </p>
        </div>
        {waiting.length > 1 && (
          <div className="flex gap-2">
            <Decide session={session} students={waiting.map((w) => w.student_id)} accept label={`Accept all ${waiting.length}`} />
          </div>
        )}
      </div>

      {waiting.length > 0 && (
        <ul className="divide-y divide-line">
          {waiting.map((r) => (
            <li key={r.student_id} className="flex flex-wrap items-center gap-3 px-5 py-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-full bg-muted/20 text-sm font-semibold text-muted">{initials(r.full_name)}</span>
              <div className="min-w-40 flex-1">
                <p className="font-medium">{r.full_name} <span className="font-mono text-xs text-muted">{r.student_number}</span></p>
                <p className="flex flex-wrap items-center gap-x-2 text-xs">
                  <LateChip minutes={r.minutes_late} />
                  <span className="text-muted">arrived {time(r.checked_in_at)}</span>
                  <Where gps={r.gps} />
                </p>
              </div>
              <div className="flex gap-2">
                <Decide session={session} students={[r.student_id]} accept label="Accept" />
                <Decide session={session} students={[r.student_id]} accept={false} label="Deny" variant="secondary" />
              </div>
            </li>
          ))}
        </ul>
      )}
      {waiting.length === 0 && <p className="px-5 py-3 text-sm text-muted">No late arrivals waiting for a decision.</p>}

      {decided.length > 0 && (
        <details className="border-t border-line px-5 py-3 text-sm">
          <summary className="cursor-pointer text-muted">Decided ({decided.length})</summary>
          <ul className="mt-2 divide-y divide-line">
            {decided.map((r) => (
              <li key={r.student_id} className="flex flex-wrap items-center gap-3 py-2">
                <span className="min-w-40 flex-1">{r.full_name} <span className="font-mono text-xs text-muted">{r.student_number}</span></span>
                <LateChip minutes={r.minutes_late} />
                <span className={r.status === "late" ? "text-ok" : "text-bad"}>
                  {r.status === "late" ? (r.decided_by_close ? "Accepted when the session closed" : "Accepted") : "Denied (absent)"}
                </span>
                <Decide session={session} students={[r.student_id]} accept={r.status !== "late"}
                  label={r.status === "late" ? "Change to denied" : "Change to accepted"} variant="secondary" />
              </li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  );
}
