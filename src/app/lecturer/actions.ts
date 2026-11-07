"use server";
import { revalidatePath } from "next/cache";
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
  revalidatePath("/lecturer/disputes");
  return { ok: "Resolved. The student has been notified." };
}
