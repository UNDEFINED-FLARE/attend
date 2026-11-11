// Early warning (migration 0015): shared types and wording for the admin and lecturer pages.

export type AlertKind = "low_attendance" | "missed_in_a_row";
export type AlertStatus = "open" | "contacted" | "resolved" | "dismissed";
export type AlertAction = "contacted" | "resolved" | "dismissed" | "reopened" | "assign_me" | "unassign" | "note";

export type StudentAlert = {
  id: string;
  kind: AlertKind;
  status: AlertStatus;
  percent: number | string | null;
  missed_in_a_row: number | null;
  required_pct: number | null;
  created_at: string;
  updated_at: string;
  student_id: string;
  student_number: string;
  student_name: string;
  module_id: string;
  module_code: string;
  module_title: string;
  assigned_to: string | null;
  assignee_name: string | null;
  last_note: string | null;
};

export const ALERT_ACTIONS: AlertAction[] = ["contacted", "resolved", "dismissed", "reopened", "assign_me", "unassign", "note"];

export const STATUS_LABEL: Record<AlertStatus, string> = {
  open: "Open",
  contacted: "Contacted",
  resolved: "Resolved",
  dismissed: "Dismissed",
};

export const STATUS_TONE: Record<AlertStatus, string> = {
  open: "bg-bad/10 text-bad",
  contacted: "bg-warn/10 text-warn",
  resolved: "bg-ok/10 text-ok",
  dismissed: "bg-muted/15 text-muted",
};

export const ACTION_DONE: Record<AlertAction, string> = {
  contacted: "Marked as contacted.",
  resolved: "Resolved.",
  dismissed: "Dismissed.",
  reopened: "Reopened.",
  assign_me: "Assigned to you.",
  unassign: "No longer assigned.",
  note: "Note added.",
};

export const HISTORY_LABEL: Record<string, string> = {
  opened: "Opened",
  contacted: "Marked contacted",
  resolved: "Resolved",
  dismissed: "Dismissed",
  reopened: "Reopened",
  assigned: "Assigned",
  unassigned: "Unassigned",
  note: "Note",
  auto_resolved: "Closed automatically",
};

/** "62.5%" or "0%": trailing ".0" dropped. */
export function percentText(v: number | string | null): string {
  if (v == null) return "—";
  const n = Number(v);
  return `${Number.isInteger(n) ? n : n.toFixed(1)}%`;
}

/** One line saying why the alert exists, e.g. "Attendance 40% · needs 75%". */
export function alertReason(a: Pick<StudentAlert, "kind" | "percent" | "missed_in_a_row" | "required_pct">): string {
  if (a.kind === "missed_in_a_row") {
    const n = a.missed_in_a_row ?? 0;
    return `Missed ${n} class${n === 1 ? "" : "es"} in a row${a.percent != null ? ` · attendance ${percentText(a.percent)}` : ""}`;
  }
  return `Attendance ${percentText(a.percent)}${a.required_pct != null ? ` · needs ${a.required_pct}%` : ""}`;
}

/** Turn database errors from update_student_alert() into plain sentences. */
export function friendlyAlertError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("not your alert")) return "You can only follow up alerts for your own modules.";
  if (m.includes("say why")) return "Write a reason before dismissing it.";
  if (m.includes("write the note")) return "Write the note first.";
  if (m.includes("only an open alert")) return "It's already marked as contacted.";
  if (m.includes("already closed")) return "This alert is already closed.";
  if (m.includes("still open")) return "This alert is still open.";
  if (m.includes("already an open alert")) return "The student already has an open alert like this one.";
  if (m.includes("too long")) return "The note is too long (2,000 characters at most).";
  return message;
}
