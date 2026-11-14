import { requireRole } from "@/lib/auth";
import { toCsv } from "@/lib/csv";

// The rejected rows of one import, as a CSV to fix and upload again.
export const dynamic = "force-dynamic";

export async function GET(_: Request, { params }: { params: Promise<{ run: string }> }) {
  const { run } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(run)) return new Response("Not found", { status: 404 });
  const { supabase, institutionId } = await requireRole("institution_admin");
  const { data: r } = await supabase.from("integration_runs").select("status").eq("id", run).eq("institution_id", institutionId).maybeSingle();
  if (!r) return new Response("Not found", { status: 404 });

  let rows: Record<string, unknown>[], cols: string[];
  if (r.status === "staging") {
    // Before confirming, the whole row is still staged, so it can be corrected in place.
    const { data } = await supabase.from("integration_staging").select("dataset, row_no, payload, error").eq("run_id", run).eq("outcome", "reject").order("row_no").limit(50000);
    const keys = [...new Set((data ?? []).flatMap((x) => Object.keys(x.payload as object)))];
    cols = ["row", "problem", ...keys];
    rows = (data ?? []).map((x) => ({ row: x.row_no + 1, problem: x.error, ...(x.payload as object) }));
  } else {
    const { data } = await supabase.from("integration_errors").select("dataset, row_no, ref, message").eq("run_id", run).order("row_no").limit(50000);
    cols = ["row", "record", "problem"];
    rows = (data ?? []).map((x) => ({ row: (x.row_no ?? 0) + 1, record: x.ref, problem: x.message }));
  }
  return new Response(toCsv(rows, cols), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="rejected-rows-${run.slice(0, 8)}.csv"`, "Cache-Control": "private, no-store" },
  });
}
