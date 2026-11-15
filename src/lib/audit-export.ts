import "server-only";
import type { getSession } from "@/lib/auth";

type Sb = NonNullable<Awaited<ReturnType<typeof getSession>>>["supabase"];

export type ExportKind = "admin_data" | "module_report" | "rejected_rows" | "personal_data" | "institution_report" | "institution_export";

/**
 * Write a data download to the audit log (who, what, how many rows) before handing
 * it over. Returns a Response to send instead when the download must not go ahead.
 * Before migration 0028 the function does not exist; downloads then still work.
 */
export async function auditExport(
  supabase: Sb,
  a: { kind: ExportKind; rows: number; institutionId?: string | null; moduleId?: string | null; details?: Record<string, string | boolean> },
): Promise<Response | null> {
  const { error } = await supabase.rpc("log_export", {
    p_kind: a.kind, p_rows: a.rows, p_inst: a.institutionId ?? null, p_module: a.moduleId ?? null, p_details: a.details ?? {},
  });
  if (!error || error.code === "PGRST202") return null;
  if (error.code === "42501") return new Response("Not allowed.", { status: 403 });
  return new Response("Could not record this download in the audit log, so it was not sent. Try again.", { status: 503 });
}
