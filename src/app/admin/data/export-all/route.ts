import { requireRole } from "@/lib/auth";
import { auditExport } from "@/lib/audit-export";
import { csvCell } from "@/lib/csv";
import { zipStored } from "@/lib/xlsx";

// Everything the institution keeps in UniAttend, one CSV per table, in a ZIP: for
// moving to another system, an archive, or a POPIA access request. It reads through
// the administrator's own permissions (row-level security), so it can only ever
// contain this institution's data. Stored credentials are never included.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PAGE = 1000;
const MAX_ROWS = 200_000;

type T = { table: string; key?: string; order?: string; columns?: string };
const TABLES: T[] = [
  { table: "institutions", key: "id" },
  { table: "institution_settings", order: "institution_id" },
  { table: "campuses" }, { table: "faculties" }, { table: "departments" }, { table: "academic_programmes" }, { table: "academic_periods" },
  { table: "venues" }, { table: "modules" }, { table: "lecturers" }, { table: "students" }, { table: "module_enrolments" },
  { table: "lecturer_assignments" }, { table: "timetables" }, { table: "timetable_events" }, { table: "class_sessions" },
  { table: "attendance_records" }, { table: "attendance_evidence" }, { table: "attendance_verification_events" },
  { table: "attendance_disputes" }, { table: "attendance_statuses" }, { table: "student_alerts" }, { table: "announcements" },
  { table: "user_roles", columns: "id, user_id, institution_id, role, status, faculty_id, department_id, created_at" },
  { table: "integrations", columns: "id, institution_id, kind, name, base_url, schedule, status, last_run_at, last_status, created_at" },
  { table: "integration_runs" }, { table: "integration_external_ids", order: "external_id" }, { table: "integration_mappings" },
  { table: "institution_subscriptions" }, { table: "payments" }, { table: "audit_logs" },
];

export async function GET() {
  const { supabase, institutionId, current } = await requireRole("institution_admin");
  const enc = new TextEncoder();
  const files: { name: string; data: Uint8Array }[] = [];
  const summary: string[] = [];
  let total = 0;

  for (const t of TABLES) {
    const rows: Record<string, unknown>[] = [];
    let note = "";
    for (let from = 0; from < MAX_ROWS; from += PAGE) {
      let q = supabase.from(t.table).select(t.columns ?? "*").eq(t.key ?? "institution_id", institutionId).range(from, from + PAGE - 1);
      q = q.order(t.order ?? "id");
      const { data, error } = await q;
      if (error) { note = error.code === "42P01" || error.code === "PGRST205" ? "not in this database version" : `could not be read (${error.message})`; break; }
      rows.push(...((data ?? []) as unknown as Record<string, unknown>[]));
      if (!data || data.length < PAGE) break;
      if (from + PAGE >= MAX_ROWS) note = `first ${MAX_ROWS.toLocaleString("en-ZA")} rows only; ask UniAttend for the rest`;
    }
    const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
    const cell = (v: unknown) => csvCell(v != null && typeof v === "object" ? JSON.stringify(v) : v);
    const csv = "﻿" + [cols.join(","), ...rows.map((r) => cols.map((c) => cell(r[c])).join(","))].join("\r\n") + "\r\n";
    files.push({ name: `${t.table}.csv`, data: enc.encode(csv) });
    summary.push(`${t.table}.csv: ${rows.length} rows${note ? ` (${note})` : ""}`);
    total += rows.length;
  }

  const refused = await auditExport(supabase, { kind: "institution_export", rows: total, institutionId, details: { format: "zip" } });
  if (refused) return refused;

  const day = new Date().toISOString().slice(0, 10);
  files.unshift({ name: "README.txt", data: enc.encode([
    `UniAttend data export for ${current.institution_name ?? "your institution"}, ${new Date().toISOString()}.`,
    "", "One CSV file per table, UTF-8, comma-separated, with a header row. Lists and details are JSON in a single cell.",
    "Stored credentials (integration tokens and keys) are never exported. Account passwords are not held by UniAttend.",
    "Contains personal information: keep it under your institution's POPIA policy.", "", ...summary, "",
  ].join("\r\n")) });
  return new Response(Buffer.from(zipStored(files)), { headers: {
    "Content-Type": "application/zip",
    "Content-Disposition": `attachment; filename="uniattend-export-${day}.zip"`,
    "Cache-Control": "private, no-store",
  } });
}
