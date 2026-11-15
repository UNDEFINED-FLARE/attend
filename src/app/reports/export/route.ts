import { requireAnyRole } from "@/lib/auth";
import { auditExport } from "@/lib/audit-export";
import { csvCell } from "@/lib/csv";
import { loadReport, parseFilters, REPORT_ROLES, reportSheets } from "@/lib/report";
import { toXlsx } from "@/lib/xlsx";

// The institutional report as Excel (every table, one sheet each) or CSV (one table,
// chosen with ?section=). The database limits it to the modules the person may see,
// and the download is written to the audit log first.
export const dynamic = "force-dynamic";

const SECTIONS: Record<string, string> = {
  modules: "By module", at_risk: "Students at risk", faculties: "By faculty", departments: "By department", trend: "Weekly trend", summary: "Summary",
};

export async function GET(request: Request) {
  const { supabase, institutionId, current } = await requireAnyRole(REPORT_ROLES);
  const u = new URL(request.url);
  const format = u.searchParams.get("format") === "xlsx" ? "xlsx" : "csv";
  const section = SECTIONS[u.searchParams.get("section") ?? "modules"] ? (u.searchParams.get("section") ?? "modules") : "modules";
  const filters = parseFilters(Object.fromEntries(u.searchParams));
  const { report, error } = await loadReport(supabase, institutionId, filters);
  if (!report) return new Response(error ?? "Could not prepare the report.", { status: error?.includes("Not allowed") ? 403 : 400 });

  const sheets = reportSheets(report, current.institution_name ?? "");
  const chosen = format === "xlsx" ? sheets : sheets.filter((s) => s.name === SECTIONS[section]);
  const rows = chosen.reduce((n, s) => n + s.rows.length, 0);
  const refused = await auditExport(supabase, {
    kind: "institution_report", rows, institutionId,
    details: { format, from: report.from, to: report.to, scope: format === "csv" ? section : "all" },
  });
  if (refused) return refused;

  const name = `attendance-report-${report.from}-to-${report.to}`;
  if (format === "xlsx") {
    return new Response(Buffer.from(toXlsx(sheets)), { headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${name}.xlsx"`, "Cache-Control": "private, no-store",
    } });
  }
  const s = chosen[0];
  const csv = [s.header, ...s.rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
  return new Response("﻿" + csv, { headers: {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="${name}-${section}.csv"`, "Cache-Control": "private, no-store",
  } });
}
