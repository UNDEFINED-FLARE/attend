"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";

const NEEDS = "Classes from the timetable need the latest database update (migration 0027).";

/** "Open attendance" on a class: the database checks it is this lecturer's class and the right time. */
export async function openClass(_: unknown, f: FormData): Promise<{ error?: string }> {
  const ev = z.string().uuid().safeParse(f.get("event"));
  if (!ev.success) return { error: "Unknown class." };
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("open_event_session", { p_event: ev.data });
  if (error) return { error: error.code === "PGRST202" ? NEEDS : error.message };
  redirect(`/lecturer/sessions/${(data as { id: string }).id}`);
}

const Change = z.object({
  event: z.string().uuid(),
  action: z.enum(["cancel", "restore", "venue", "time", "substitute", "attendance_on", "attendance_off"]),
  venue: z.string().uuid().optional(),
  lecturer: z.string().uuid().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  start: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  end: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  note: z.string().trim().max(300).optional(),
});

/** Cancel, restore, move, re-time or hand over a class. Students are told by the database. */
export async function changeClass(_: unknown, f: FormData): Promise<{ error?: string; ok?: string }> {
  const raw = Object.fromEntries([...f.entries()].filter(([, v]) => v !== ""));
  const p = Change.safeParse(raw);
  if (!p.success) return { error: "Fill in what the change needs." };
  const d = p.data;
  if (d.action === "time" && !(d.date && d.start && d.end)) return { error: "Choose the date, start and end." };
  // Times on the form are South African time.
  const at = (t?: string) => (d.date && t ? new Date(`${d.date}T${t}:00+02:00`).toISOString() : null);
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("change_event", {
    p_event: d.event, p_action: d.action, p_venue: d.venue ?? null, p_lecturer: d.lecturer ?? null,
    p_starts: at(d.start), p_ends: at(d.end), p_note: d.note ?? null,
  });
  if (error) return { error: error.code === "PGRST202" ? NEEDS : error.message };
  revalidatePath("/lecturer");
  revalidatePath("/student/timetable");
  const n = (data as { notified?: number } | null)?.notified ?? 0;
  const done = { cancel: "Class cancelled", restore: "Class restored", venue: "Venue changed", time: "Time changed", substitute: "Substitute set",
    attendance_on: "Attendance will be taken", attendance_off: "No attendance for this class" }[d.action];
  return { ok: `${done}.${n ? ` ${n} student${n === 1 ? "" : "s"} told.` : ""}` };
}
