"use server";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { kickIntegrations } from "@/lib/integrations/runner";

/** Queue the connection behind a failed run to run again now. The database checks it is this admin's. */
export async function retryRun(_: unknown, f: FormData): Promise<{ error?: string; ok?: string }> {
  const run = z.string().uuid().safeParse(f.get("run"));
  if (!run.success) return { error: "Unknown run." };
  const { supabase } = await requireRole("institution_admin");
  const { error } = await supabase.rpc("retry_run", { p_run: run.data });
  if (error) return { error: error.code === "PGRST202" ? "Retry needs the latest database update (migration 0025)." : error.message };
  after(kickIntegrations);
  revalidatePath("/admin/integrations/activity");
  return { ok: "Started again. It appears at the top of the activity list in a minute." };
}
