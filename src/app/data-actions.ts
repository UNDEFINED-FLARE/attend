"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";

type S = { error?: string; ok?: string } | undefined;
const NEEDS_0023 = "This needs the latest database update (migration 0023).";

/** A person asks about their own information (deletion, correction, objection). */
export async function requestDataAction(_: S, f: FormData): Promise<S> {
  const p = z.object({
    kind: z.enum(["deletion", "correction", "objection", "other"]),
    details: z.string().trim().min(5, "Say what you'd like us to do.").max(2000),
  }).safeParse(Object.fromEntries(f));
  if (!p.success) return { error: p.error.issues[0].message };
  const supabase = await supabaseServer();
  const { error } = await supabase.rpc("request_data_action", { p_kind: p.data.kind, p_details: p.data.details });
  if (error) return { error: error.code === "PGRST202" ? NEEDS_0023 : error.message };
  revalidatePath("/settings");
  return { ok: "Sent. Your institution and UniAttend will answer within 30 days; you'll get a notification." };
}

/** An admin (institution or platform) records what was done about a request. */
export async function answerDataRequest(_: S, f: FormData): Promise<S> {
  const p = z.object({
    id: z.string().uuid(),
    status: z.enum(["in_progress", "done", "declined"]),
    response: z.string().trim().max(2000),
  }).safeParse(Object.fromEntries(f));
  if (!p.success) return { error: "Choose an outcome." };
  const supabase = await supabaseServer();
  const { error } = await supabase.rpc("answer_data_request", { p_id: p.data.id, p_status: p.data.status, p_response: p.data.response });
  if (error) return { error: error.message };
  revalidatePath("/admin/requests");
  revalidatePath("/super/requests");
  return { ok: "Saved, and the person has been told." };
}

/** Institution admins: delete everything past the retention period now. */
export async function applyRetention(_: S, f: FormData): Promise<S> {
  if (f.get("confirm") !== "on") return { error: "Tick the box to confirm." };
  const { supabase, institutionId } = await requireRole("institution_admin");
  const { data, error } = await supabase.rpc("apply_retention", { p_inst: institutionId });
  if (error) return { error: error.code === "PGRST202" ? NEEDS_0023 : error.message };
  revalidatePath("/admin/settings");
  const c = data as Record<string, number>;
  return { ok: `Deleted ${c.sessions} session(s) with ${c.attendance_records} attendance record(s), ${c.notifications} notification(s), ${c.audit_entries} audit entr${c.audit_entries === 1 ? "y" : "ies"} and ${c.removed_students} removed student(s).` };
}

export async function setAutoRetention(_: S, f: FormData): Promise<S> {
  const { supabase, institutionId } = await requireRole("institution_admin");
  const on = f.get("auto") === "on";
  const { error } = await supabase.rpc("set_auto_retention", { p_inst: institutionId, p_on: on });
  if (error) return { error: error.code === "PGRST202" ? NEEDS_0023 : error.message };
  revalidatePath("/admin/settings");
  return { ok: on ? "Old records will now be deleted automatically every night." : "Automatic deletion is off." };
}
