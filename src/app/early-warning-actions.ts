"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSession, requireRole } from "@/lib/auth";
import { ACTION_DONE, ALERT_ACTIONS, friendlyAlertError, type AlertAction } from "@/lib/early-warning";

// Early warning (migration 0015). Permissions are enforced in the database:
// update_student_alert() only lets an institution admin or the module's
// lecturer act, and recheck_alerts() is admin-only.

type S = { error?: string; ok?: string } | undefined;

function refresh() {
  revalidatePath("/admin/early-warning");
  revalidatePath("/lecturer/early-warning");
  revalidatePath("/lecturer");
}

export async function updateAlert(_: S, f: FormData): Promise<S> {
  const p = z.object({
    alert: z.string().uuid(),
    action: z.enum(ALERT_ACTIONS as [AlertAction, ...AlertAction[]]),
    note: z.string().max(2000, "The note is too long (2,000 characters at most).").optional(),
  }).safeParse(Object.fromEntries(f));
  if (!p.success) return { error: p.error.issues[0].message };
  const s = await getSession();
  if (!s) return { error: "Your session has ended. Sign in again." };
  const { error } = await s.supabase.rpc("update_student_alert", {
    p_alert: p.data.alert, p_action: p.data.action, p_note: p.data.note?.trim() || null,
  });
  refresh();
  return error ? { error: friendlyAlertError(error.message) } : { ok: ACTION_DONE[p.data.action] };
}

export async function recheckAlerts(): Promise<S> {
  const { supabase, institutionId } = await requireRole("institution_admin");
  const { data, error } = await supabase.rpc("recheck_alerts", { p_inst: institutionId });
  refresh();
  if (error) return { error: error.message };
  const n = Number(data ?? 0);
  return { ok: n ? `Checked every module: ${n} new alert${n === 1 ? "" : "s"}.` : "Checked every module: nothing new." };
}

export async function saveAlertSettings(_: S, f: FormData): Promise<S> {
  const p = z.object({
    alerts_enabled: z.preprocess((v) => v === "on", z.boolean()),
    alert_min_sessions: z.coerce.number().int().min(1, "At least 1 class.").max(50),
    alert_consecutive_absences: z.coerce.number().int().min(2, "At least 2 classes in a row.").max(20),
  }).safeParse({ ...Object.fromEntries(f), alerts_enabled: f.get("alerts_enabled") });
  if (!p.success) return { error: p.error.issues[0].message };
  const { supabase, institutionId } = await requireRole("institution_admin");
  const { error } = await supabase.from("institution_settings").update(p.data).eq("institution_id", institutionId);
  if (error) return { error: error.message };
  if (!p.data.alerts_enabled) {
    refresh();
    return { ok: "Early warning is off. Existing alerts stay until you close them." };
  }
  // New thresholds apply straight away.
  const { data } = await supabase.rpc("recheck_alerts", { p_inst: institutionId });
  refresh();
  const n = Number(data ?? 0);
  return { ok: `Saved. Checked every module: ${n ? `${n} new alert${n === 1 ? "" : "s"}` : "nothing new"}.` };
}
