"use client";
import { useActionState, useEffect, useMemo, useState } from "react";
import { Submit } from "@/components/form";
import { Card, CardTitle, Notice } from "@/components/ui";
import type { AssignmentStatus } from "@/lib/assignment-match";
import { applyAssignments, previewAssignments } from "./assign-actions";

const LABEL: Record<AssignmentStatus, [string, string]> = {
  assign: ["Will assign", "bg-ok/10 text-ok"],
  new_lecturer: ["New lecturer", "bg-info/10 text-info"],
  new_module: ["New module", "bg-violet/10 text-violet"],
  ambiguous: ["Several matches", "bg-warn/10 text-warn"],
  exists: ["Already assigned", "bg-muted/15 text-muted"],
  no_lecturer: ["No lecturer found", "bg-bad/10 text-bad"],
};
const selectable = (s: AssignmentStatus) => s === "assign" || s === "new_lecturer" || s === "new_module";

/** Upload a PDF, Word, Excel or CSV list; review the matches; assign lecturers to modules. */
export function AssignImport() {
  const [preview, read] = useActionState(previewAssignments, undefined);
  const [result, apply] = useActionState(applyAssignments, undefined);
  const rows = useMemo(() => preview?.rows ?? [], [preview]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<AssignmentStatus | "all">("all");
  useEffect(() => { setPicked(new Set(rows.filter((r) => selectable(r.status)).map((r) => r.key))); setFilter("all"); }, [rows]);

  const counts = rows.reduce<Record<string, number>>((n, r) => ({ ...n, [r.status]: (n[r.status] ?? 0) + 1 }), {});
  const shown = rows.filter((r) => filter === "all" || r.status === filter);
  const chosen = rows.filter((r) => picked.has(r.key));
  const needLect = chosen.some((r) => !r.lecturer_id), needMod = chosen.some((r) => !r.module_id);
  const toggle = (k: string) => setPicked((p) => { const n = new Set(p); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  return (
    <Card className="mb-6">
      <CardTitle>Assign lecturers from a file</CardTitle>
      <form action={read} className="flex flex-wrap items-end gap-3">
        <label className="flex-1 min-w-60">
          <span className="mb-1 block text-xs text-muted">PDF, Word (.docx), Excel (.xlsx) or CSV — up to 5 MB</span>
          <input type="file" name="file" required accept=".pdf,.docx,.xlsx,.xlsm,.csv,.tsv,.txt,application/pdf"
            className="block w-full rounded-lg border border-line bg-surface text-sm file:mr-3 file:border-0 file:bg-bg file:px-3 file:py-2 file:text-sm" />
        </label>
        <Submit label="Read file" pending="Reading…" variant="secondary" />
      </form>
      <p className="mt-2 text-xs text-muted">
        Any layout works: a spreadsheet with <i>module code</i> and <i>lecturer</i> columns (email, staff number and role optional),
        a Word table or list, a PDF list, or a timetable PDF. Lecturers are matched by email, staff number or name
        (&ldquo;MELLO NS&rdquo; finds &ldquo;Dr N S Mello&rdquo;). Nothing is saved until you apply.
      </p>
      {preview?.error && <div className="mt-3"><Notice tone="bad">{preview.error}</Notice></div>}

      {rows.length > 0 && (
        <form action={apply} className="mt-4 space-y-3">
          <input type="hidden" name="items" value={JSON.stringify(chosen.map((r) => ({
            code: r.code, lecturer_id: r.lecturer_id, lecturer_name: r.lecturer_name, email: r.email, staff_number: r.staff_number, role: r.role,
          })))} />
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="mr-1 text-muted">{preview?.file} ·</span>
            {(["all", ...Object.keys(LABEL)] as (AssignmentStatus | "all")[]).filter((s) => s === "all" || counts[s]).map((s) => (
              <button key={s} type="button" onClick={() => setFilter(s)}
                className={`rounded-full px-2.5 py-1 font-medium transition ${filter === s ? "ring-2 ring-accent" : ""} ${s === "all" ? "bg-bg" : LABEL[s][1]}`}>
                {s === "all" ? `All ${rows.length}` : `${LABEL[s][0]} ${counts[s]}`}
              </button>
            ))}
          </div>
          <div className="-mx-5 max-h-[28rem] overflow-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="sticky top-0 bg-surface">
                <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                  <th className="w-10 px-5 py-2"><input type="checkbox" aria-label="Select all"
                    checked={shown.filter((r) => selectable(r.status)).every((r) => picked.has(r.key)) && shown.some((r) => selectable(r.status))}
                    onChange={(e) => setPicked((p) => { const n = new Set(p); for (const r of shown) if (selectable(r.status)) { if (e.target.checked) n.add(r.key); else n.delete(r.key); } return n; })} /></th>
                  <th className="px-2 py-2">Module</th><th className="px-2 py-2">Lecturer</th><th className="px-2 py-2">Role</th><th className="px-5 py-2">Result</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {shown.map((r) => (
                  <tr key={r.key} className={selectable(r.status) ? "" : "opacity-70"}>
                    <td className="px-5 py-2"><input type="checkbox" disabled={!selectable(r.status)} checked={picked.has(r.key)} onChange={() => toggle(r.key)} aria-label={`Select ${r.code}`} /></td>
                    <td className="px-2 py-2"><b className="font-mono">{r.code}</b> <span className="text-xs text-muted">{r.module_title !== r.code ? r.module_title : ""}</span></td>
                    <td className="px-2 py-2">
                      {r.lecturer_name ?? <span className="text-muted">—</span>}
                      {(r.email || r.staff_number) && <div className="text-xs text-muted">{[r.staff_number, r.email].filter(Boolean).join(" · ")}</div>}
                      {r.lecturer_text && r.lecturer_id && r.lecturer_text.toUpperCase() !== r.lecturer_name?.toUpperCase() && <div className="text-xs text-muted">from &ldquo;{r.lecturer_text}&rdquo;</div>}
                    </td>
                    <td className="px-2 py-2 text-xs">{r.role === "assistant" ? "Assistant" : "Primary"}</td>
                    <td className="px-5 py-2"><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${LABEL[r.status][1]}`}>{LABEL[r.status][0]}</span>
                      {r.note && <div className="mt-0.5 text-xs text-muted">{r.note}</div>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <label className={`flex items-center gap-2 ${needLect ? "" : "opacity-50"}`}><input type="checkbox" name="create_lecturers" defaultChecked disabled={!needLect} />Create new lecturers</label>
            <label className={`flex items-center gap-2 ${needMod ? "" : "opacity-50"}`}><input type="checkbox" name="create_modules" disabled={!needMod} />Create missing modules</label>
            <span className="ml-auto text-muted">{chosen.length} selected</span>
            <Submit label={`Assign ${chosen.length}`} pending="Saving…" />
          </div>
          {result?.error && <Notice tone="bad">{result.error}</Notice>}
          {result?.ok && <Notice tone="ok">{result.ok}</Notice>}
        </form>
      )}
    </Card>
  );
}
