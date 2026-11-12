"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";

/** Leave an institution: all of your roles there stop. Its administrators can't add you back. */
export async function leaveInstitution(_: unknown, f: FormData): Promise<{ error?: string; ok?: string }> {
  const p = z.object({ institution: z.string().uuid(), confirm: z.literal("on") }).safeParse(Object.fromEntries(f));
  if (!p.success) return { error: "Tick the box to confirm." };
  const supabase = await supabaseServer();
  const { error } = await supabase.rpc("leave_institution", { p_inst: p.data.institution });
  if (error) return { error: error.code === "PGRST202" ? "This needs the latest database update (migration 0021)." : error.message };
  revalidatePath("/", "layout");
  return { ok: "You have left. You no longer have access there." };
}
