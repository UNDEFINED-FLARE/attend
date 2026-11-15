"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth";

type S = { error?: string; ok?: string } | undefined;

/** Let UniAttend staff act as an administrator here for a limited time. */
export async function grantSupport(_: S, f: FormData): Promise<S> {
  const p = z.object({ hours: z.coerce.number().int().min(1).max(168), reason: z.string().trim().min(5, "Say what UniAttend should help with.").max(500) })
    .safeParse(Object.fromEntries(f));
  if (!p.success) return { error: p.error.issues[0].message };
  const { supabase, institutionId } = await requireRole("institution_admin");
  const { error } = await supabase.rpc("grant_support_access", { p_inst: institutionId, p_hours: p.data.hours, p_reason: p.data.reason });
  revalidatePath("/admin/exit");
  if (error) return { error: error.code === "PGRST202" ? "This needs the latest database update (migration 0034)." : error.message };
  return { ok: `UniAttend can help for ${p.data.hours} hour${p.data.hours === 1 ? "" : "s"}. Everything they do is in the audit log.` };
}

export async function revokeSupport(): Promise<S> {
  const { supabase, institutionId } = await requireRole("institution_admin");
  const { error } = await supabase.rpc("revoke_support_access", { p_inst: institutionId });
  revalidatePath("/admin/exit");
  if (error) return { error: error.message };
  return { ok: "Access withdrawn. UniAttend can no longer see your records." };
}
