"use server";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { kickPush } from "@/lib/push";
import { redirect } from "next/navigation";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";

type S = { error?: string; ok?: string } | undefined;
const uuid = z.string().uuid();

export async function openSession(_: S, form: FormData): Promise<S> {
  const p = z.object({
    module: uuid,
    venue: z.union([uuid, z.literal("")]),
    title: z.string().trim().max(120),
    minutes: z.coerce.number().int().min(5).max(480),
    late: z.coerce.number().int().min(0).max(240),
  }).safeParse(Object.fromEntries(form));
  if (!p.success) return { error: p.error.issues[0].message };
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("open_session", {
    p_module: p.data.module, p_venue: p.data.venue || null, p_title: p.data.title,
    p_minutes: p.data.minutes, p_late_minutes: p.data.late,
  });
  if (error) return { error: error.message };
  after(kickPush); // "attendance is open" to enrolled students' phones
  redirect(`/lecturer/sessions/${(data as { id: string }).id}`);
}

/** Polled by the live QR panel. Signing happens in the database with a key the browser never sees. */
type QrToken = { open: boolean; token?: string; join_code?: string; refresh_in_ms?: number; error?: string };
export async function qrToken(session: string): Promise<QrToken> {
  if (!uuid.safeParse(session).success) return { open: false };
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("session_qr_token", { p_session: session });
  if (error) return { open: false, error: error.message };
  return data as QrToken;
}

export async function closeSession(form: FormData) {
  const id = uuid.parse(form.get("session"));
  const supabase = await supabaseServer();
  const { error } = await supabase.rpc("close_session", { p_session: id });
  if (error) throw new Error(error.message);
  revalidatePath(`/lecturer/sessions/${id}`);
}

/** Accept (counts as attended, late) or deny (absent) one or more late arrivals. */
export async function decideLate(form: FormData) {
  const p = z.object({
    session: uuid,
    students: z.array(uuid).min(1).max(2000),
    accept: z.enum(["1", "0"]),
  }).parse({ session: form.get("session"), students: form.getAll("student"), accept: form.get("accept") });
  const supabase = await supabaseServer();
  const { error } = await supabase.rpc("decide_late", {
    p_session: p.session, p_students: p.students, p_accept: p.accept === "1", p_note: null,
  });
  if (error) throw new Error(error.message);
  after(kickPush);
  revalidatePath(`/lecturer/sessions/${p.session}`);
}

export async function override(_: S, form: FormData): Promise<S> {
  const p = z.object({
    session: uuid, student: uuid,
    status: z.enum(["present", "late", "absent", "excused"]),
    note: z.string().trim().min(3, "Give a reason for the correction.").max(500),
  }).safeParse(Object.fromEntries(form));
  if (!p.success) return { error: p.error.issues[0].message };
  const supabase = await supabaseServer();
  const { error } = await supabase.rpc("override_attendance", {
    p_session: p.data.session, p_student: p.data.student, p_status: p.data.status, p_note: p.data.note,
  });
  if (error) return { error: error.message };
  after(kickPush);
  revalidatePath(`/lecturer/sessions/${p.data.session}`);
  return { ok: "Saved." };
}

export async function resolveDispute(_: S, form: FormData): Promise<S> {
  const p = z.object({
    dispute: uuid,
    decision: z.enum(["present", "late", "excused", "reject"]),
    note: z.string().trim().max(500),
  }).safeParse(Object.fromEntries(form));
  if (!p.success) return { error: p.error.issues[0].message };
  const supabase = await supabaseServer();
  const upheld = p.data.decision !== "reject";
  const { error } = await supabase.rpc("resolve_dispute", {
    p_dispute: p.data.dispute, p_upheld: upheld, p_new_status: upheld ? p.data.decision : null, p_note: p.data.note,
  });
  if (error) return { error: error.message };
  after(kickPush);
  revalidatePath("/lecturer/disputes");
  return { ok: "Resolved. The student has been notified." };
}

// ------------------------------------------------------------ the register (0014)

const Entry = z.object({
  student: uuid,
  status: z.enum(["present", "late", "absent", "excused"]),
  custom: uuid.nullable().optional(),
  note: z.string().trim().max(300).nullable().optional(),
});

/** Save many register changes at once. The database checks permissions and records the history. */
export async function saveRegister(session: string, entries: unknown, note: string): Promise<{ error?: string; ok?: string }> {
  const p = z.object({ session: uuid, entries: z.array(Entry).min(1).max(3000), note: z.string().trim().max(300) })
    .safeParse({ session, entries, note });
  if (!p.success) return { error: "Some of the changes could not be read. Reload the page and try again." };
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("save_register", {
    p_session: p.data.session, p_entries: p.data.entries, p_note: p.data.note || null,
  });
  if (error) return { error: error.code === "PGRST202" ? "The register needs the latest database update (migration 0014)." : error.message };
  after(kickPush);
  revalidatePath(`/lecturer/sessions/${p.data.session}`);
  const r = data as { changed: number; unchanged: number };
  return { ok: `${r.changed} saved${r.unchanged ? `, ${r.unchanged} unchanged` : ""}.` };
}

/** Close the session: everyone not marked becomes absent. */
export async function finaliseSession(session: string): Promise<{ error?: string; ok?: string }> {
  if (!uuid.safeParse(session).success) return { error: "Unknown session." };
  const supabase = await supabaseServer();
  // A paused session is resumed first, so it can be closed normally.
  const { data: st } = await supabase.from("class_sessions").select("status").eq("id", session).maybeSingle();
  if (st?.status === "scheduled") await supabase.rpc("session_control", { p_session: session, p_action: "resume" });
  const { data, error } = await supabase.rpc("close_session", { p_session: session });
  if (error) return { error: error.message };
  revalidatePath(`/lecturer/sessions/${session}`);
  const r = data as { absent: number; present: number; late: number };
  return { ok: `Session finalised: ${r.present} present, ${r.late} late, ${r.absent} absent.` };
}

export type HistoryItem = { at: string; kind: string; summary: string; by_name: string | null; note: string | null };
export async function recordHistory(record: string): Promise<HistoryItem[] | { error: string }> {
  if (!uuid.safeParse(record).success) return { error: "Unknown record." };
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("record_history", { p_record: record });
  return error ? { error: error.message } : ((data ?? []) as HistoryItem[]);
}

// ------------------------------------------------------- check-in controls (0016)

export async function sessionControl(_: { error?: string; ok?: string } | undefined, f: FormData): Promise<{ error?: string; ok?: string }> {
  const p = z.object({
    session: uuid,
    action: z.enum(["pause", "resume", "regenerate", "printed_on", "printed_off", "window"]),
    closes: z.coerce.number().int().min(1).max(480).optional().catch(undefined),
    late: z.coerce.number().int().min(0).max(480).optional().catch(undefined),
  }).safeParse({ ...Object.fromEntries(f), closes: f.get("closes") || undefined, late: f.get("late") || undefined });
  if (!p.success) return { error: "Check the values and try again." };
  const supabase = await supabaseServer();
  const { error } = await supabase.rpc("session_control", {
    p_session: p.data.session, p_action: p.data.action, p_closes_in_min: p.data.closes ?? null, p_late_in_min: p.data.late ?? null,
  });
  if (error) return { error: error.code === "PGRST202" ? "These controls need the latest database update (migration 0016)." : error.message };
  revalidatePath(`/lecturer/sessions/${p.data.session}`);
  const done: Record<string, string> = {
    pause: "Check-in paused.", resume: "Check-in resumed.", regenerate: "New QR and code. Old printouts no longer work.",
    printed_on: "Printed QR allowed.", printed_off: "Printed QR switched off.", window: "Times updated.",
  };
  return { ok: done[p.data.action] };
}

export type ScanResult = { outcome: string; message?: string; full_name?: string; student_number?: string; status?: string;
  minutes_late?: number | null; left_early?: boolean; minutes_present?: number | null };

/** A student card read by camera or USB scanner. */
export async function scanStudent(session: string, code: string, direction: "in" | "out"): Promise<ScanResult> {
  if (!uuid.safeParse(session).success || typeof code !== "string" || code.length > 64) return { outcome: "unknown", message: "That card could not be read." };
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("scan_student", { p_session: session, p_code: code, p_direction: direction === "out" ? "out" : "in" });
  if (error) return { outcome: "error", message: error.code === "PGRST202" ? "Card scanning needs the latest database update (migration 0016)." : error.message };
  return data as ScanResult;
}
