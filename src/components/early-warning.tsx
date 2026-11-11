import Link from "next/link";
import { AlertActions } from "@/components/alert-actions";
import { Card, when } from "@/components/ui";
import type { getSession } from "@/lib/auth";
import { alertReason, HISTORY_LABEL, STATUS_LABEL, STATUS_TONE, type StudentAlert } from "@/lib/early-warning";

type Supabase = NonNullable<Awaited<ReturnType<typeof getSession>>>["supabase"];

/** Every alert the signed-in user may see in this institution (admins: all, lecturers: their modules). */
export async function loadAlerts(supabase: Supabase, institutionId: string, liveOnly: boolean) {
  const { data, error } = await supabase.rpc("list_student_alerts", { p_inst: institutionId, p_live_only: liveOnly });
  return { alerts: (data ?? []) as StudentAlert[], missing: !!error && /list_student_alerts/.test(error.message), error };
}

async function History({ supabase, id }: { supabase: Supabase; id: string }) {
  const { data } = await supabase.rpc("alert_history", { p_alert: id });
  const rows = (data ?? []) as { at: string; action: string; note: string | null; actor_name: string }[];
  return (
    <ol className="mt-3 space-y-2 border-l-2 border-line pl-4 text-sm">
      {rows.map((e, i) => (
        <li key={i}>
          <span className="font-medium">{HISTORY_LABEL[e.action] ?? e.action}</span>
          <span className="text-muted"> · {e.actor_name} · {when(e.at)}</span>
          {e.note && <p className="mt-0.5 whitespace-pre-line text-muted">{e.note}</p>}
        </li>
      ))}
    </ol>
  );
}

/** The case list: one card per alert with its reason, status, last note, actions and (when opened) history. */
export function EarlyWarningList({ supabase, alerts, me, basePath, openId, show }: {
  supabase: Supabase;
  alerts: StudentAlert[];
  me: string;
  basePath: string;
  openId?: string;
  show: "live" | "closed";
}) {
  if (!alerts.length) {
    return (
      <Card className="text-center text-sm text-muted">
        {show === "live" ? "No students need follow-up right now." : "No closed alerts yet."}
      </Card>
    );
  }
  return (
    <ul className="space-y-3">
      {alerts.map((a) => {
        const open = openId === a.id;
        const qs = new URLSearchParams({ ...(show === "closed" ? { show } : {}), ...(open ? {} : { open: a.id }) }).toString();
        return (
          <li key={a.id}>
            <Card className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold">{a.student_name} <span className="font-normal text-muted">· {a.student_number}</span></p>
                  <p className="text-sm text-muted">{a.module_code} · {a.module_title}</p>
                  <p className="mt-1 text-sm font-medium">{alertReason(a)}</p>
                </div>
                <div className="flex flex-col items-end gap-1 text-right">
                  <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_TONE[a.status]}`}>{STATUS_LABEL[a.status]}</span>
                  <span className="text-xs text-muted">Opened {when(a.created_at)}</span>
                  {a.assignee_name && <span className="text-xs text-muted">Assigned to {a.assigned_to === me ? "you" : a.assignee_name}</span>}
                </div>
              </div>
              {a.last_note && <p className="mt-3 rounded-lg bg-bg px-3 py-2 text-sm"><span className="text-muted">Latest note: </span>{a.last_note}</p>}
              <div className="mt-3">
                <AlertActions id={a.id} status={a.status} assignedToMe={a.assigned_to === me} />
              </div>
              <Link href={`${basePath}${qs ? `?${qs}` : ""}`} scroll={false} className="mt-3 inline-block text-sm font-medium text-accent">
                {open ? "Hide history" : "Show history"}
              </Link>
              {open && <History supabase={supabase} id={a.id} />}
            </Card>
          </li>
        );
      })}
    </ul>
  );
}
