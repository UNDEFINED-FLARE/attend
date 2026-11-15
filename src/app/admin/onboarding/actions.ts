"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSession, requireRole } from "@/lib/auth";

type S = { error?: string; ok?: string } | undefined;
const NEEDS = "This needs the latest database update (migration 0032).";
const msg = (e: { code?: string; message: string }) => (e.code === "PGRST202" ? NEEDS : e.message);

/** Sign an onboarding step off, or undo it. The database decides who may sign which step. */
export async function signOffStep(_: S, f: FormData): Promise<S> {
  const p = z.object({
    institution: z.string().uuid(), step: z.enum(["verified", "policy", "training", "go_live"]),
    note: z.string().trim().max(500).optional(), undo: z.enum(["0", "1"]).optional(),
  }).safeParse(Object.fromEntries(f));
  if (!p.success) return { error: "Something went wrong. Reload the page." };
  const s = await getSession();
  if (!s) return { error: "Sign in again." };
  const { error } = await s.supabase.rpc("onboarding_sign_off", {
    p_inst: p.data.institution, p_step: p.data.step, p_note: p.data.note || null, p_undo: p.data.undo === "1",
  });
  revalidatePath("/admin/onboarding");
  revalidatePath(`/super/institutions/${p.data.institution}`);
  revalidatePath("/super");
  if (error) return { error: msg(error) };
  return { ok: p.data.undo === "1" ? "Undone." : p.data.step === "go_live" ? "Approved for go-live." : "Signed off." };
}

export async function revokeCredentials(_: S, f: FormData): Promise<S> {
  if (f.get("confirm") !== "on") return { error: "Tick the box to confirm." };
  const { supabase, institutionId } = await requireRole("institution_admin");
  const { data, error } = await supabase.rpc("revoke_integration_credentials", { p_inst: institutionId });
  revalidatePath("/admin/exit");
  if (error) return { error: msg(error) };
  return { ok: `${data} stored credential${data === 1 ? "" : "s"} deleted; every connection is paused. Your systems' keys no longer work with UniAttend.` };
}

export async function requestExit(_: S, f: FormData): Promise<S> {
  const reason = z.string().trim().min(5, "Say briefly why you are leaving.").max(2000).safeParse(f.get("reason"));
  if (!reason.success) return { error: reason.error.issues[0].message };
  const { supabase, institutionId } = await requireRole("institution_admin");
  const { error } = await supabase.rpc("request_exit", { p_inst: institutionId, p_reason: reason.data });
  revalidatePath("/admin/exit");
  if (error) return { error: msg(error) };
  return { ok: "Request sent. UniAttend will contact you to agree the closing date. Nothing changes until then." };
}

export async function withdrawExit(): Promise<S> {
  const { supabase, institutionId } = await requireRole("institution_admin");
  const { error } = await supabase.rpc("withdraw_exit", { p_inst: institutionId });
  revalidatePath("/admin/exit");
  if (error) return { error: msg(error) };
  return { ok: "Withdrawn. Your institution stays on UniAttend." };
}

/** UniAttend closes an institution that asked to leave (archived; nothing deleted). */
export async function closeInstitution(_: S, f: FormData): Promise<S> {
  const p = z.object({ institution: z.string().uuid(), note: z.string().trim().min(5, "Record how the closure was agreed.").max(2000) })
    .safeParse(Object.fromEntries(f));
  if (!p.success) return { error: p.error.issues[0].message };
  const { supabase } = await requireRole("super_admin");
  const { error } = await supabase.rpc("close_institution", { p_inst: p.data.institution, p_note: p.data.note });
  revalidatePath("/super");
  if (error) return { error: msg(error) };
  return { ok: "Closed. The institution is archived, its credentials are deleted, and its data is kept." };
}
