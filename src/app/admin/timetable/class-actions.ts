"use server";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";

type S = { error?: string; ok?: string } | undefined;
const NEEDS = "Classes from the timetable need the latest database update (migration 0027).";
const KINDS = ["lecture", "tutorial", "practical", "test", "other"] as const;

/** Make the dated classes for the next two weeks now (it also happens every night). */
export async function prepareClasses(): Promise<S> {
  const { supabase, institutionId } = await requireRole("institution_admin");
  const { data, error } = await supabase.rpc("generate_timetable_events", { p_inst: institutionId, p_days: 14 });
  if (error) return { error: error.code === "PGRST202" ? NEEDS : error.message };
  revalidatePath("/admin/timetable");
  const r = data as { created: number; updated: number; cancelled: number; from: string; to: string };
  return { ok: `Classes from ${r.from} to ${r.to}: ${r.created} new, ${r.updated} updated to match the timetable, ${r.cancelled} cancelled because their slot was removed.` };
}

export async function saveAttendanceKinds(_: S, f: FormData): Promise<S> {
  const kinds = KINDS.filter((k) => f.get(k) === "on");
  const { supabase, institutionId } = await requireRole("institution_admin");
  const { error } = await supabase.rpc("set_attendance_kinds", { p_inst: institutionId, p_kinds: kinds });
  if (error) return { error: error.code === "PGRST202" ? NEEDS : error.message };
  revalidatePath("/admin/timetable");
  return { ok: kinds.length ? `Attendance is taken at: ${kinds.join(", ")}.` : "No kind of class takes attendance automatically now. Lecturers can still take it at any class." };
}
