import { requireRole } from "@/lib/auth";
import { toCsv } from "@/lib/csv";
import { DATA, loadData, type DataKind } from "@/lib/data-manager";

// CSV of any Data tab, with the same search and archived filter as the page.
export async function GET(request: Request) {
  const { supabase, institutionId } = await requireRole("institution_admin");
  const u = new URL(request.url);
  const kind = (u.searchParams.get("kind") ?? "students") as DataKind;
  if (!(kind in DATA)) return new Response("Unknown kind", { status: 400 });
  const archived = u.searchParams.get("show") === "archived";
  const { rows } = await loadData(supabase, institutionId, kind, { q: u.searchParams.get("q") ?? "", archived, all: true });
  const cols = DATA[kind].columns.map((c) => c.key);
  const csv = toCsv(rows.map((r) => r.cells), cols);
  return new Response(csv, { headers: {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="${kind}${archived ? "-archived" : ""}-${new Date().toISOString().slice(0, 10)}.csv"`,
    "Cache-Control": "private, no-store",
  } });
}
