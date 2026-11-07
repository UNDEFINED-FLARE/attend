import { NextResponse } from "next/server";
import { toCsv } from "@/lib/csv";
import { supabaseServer } from "@/lib/supabase/server";

// The report comes from module_report(), which refuses anyone who does not
// teach the module, so this route needs no authorization of its own.
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await supabaseServer();
  const [{ data: mod }, { data, error }] = await Promise.all([
    supabase.from("modules").select("code").eq("id", id).maybeSingle(),
    supabase.rpc("module_report", { p_module: id }),
  ]);
  if (error || !mod) return new NextResponse("Not found", { status: 404 });
  const csv = toCsv(data as Record<string, unknown>[], [
    "student_number", "full_name", "sessions", "attended", "late", "absent", "excused", "unresolved",
    "percent", "worst_case_percent", "meets_requirement",
  ]);
  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${mod.code}-attendance-${new Date().toISOString().slice(0, 10)}.csv"`,
      "cache-control": "no-store",
    },
  });
}
