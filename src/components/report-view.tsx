import Link from "next/link";
import { Card, CardTitle, Notice, pct, Table, Td } from "@/components/ui";
import { filterQuery, type Report, type ReportFilters } from "@/lib/report";

type Opt = { id: string; name?: string; code?: string; title?: string };

/** Date range, faculty, department and module. A plain GET form, so a report has a shareable address. */
export function ReportFiltersForm({ f, r, faculties, departments, modules, action }: {
  f: ReportFilters; r: Report | null; faculties: Opt[]; departments: Opt[]; modules: Opt[]; action: string;
}) {
  const sel = "h-10 w-full rounded-xl border border-line bg-surface px-3 text-sm";
  return (
    <form action={action} className="mb-6 grid gap-3 rounded-2xl bg-surface p-4 shadow-card sm:grid-cols-3 lg:grid-cols-6">
      <label className="text-xs font-medium text-muted">From<input type="date" name="from" defaultValue={f.from ?? r?.from} className={`${sel} mt-1`} /></label>
      <label className="text-xs font-medium text-muted">To<input type="date" name="to" defaultValue={f.to ?? r?.to} className={`${sel} mt-1`} /></label>
      <label className="text-xs font-medium text-muted">Faculty
        <select name="faculty" defaultValue={f.faculty ?? ""} className={`${sel} mt-1`}><option value="">All</option>
          {faculties.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
      <label className="text-xs font-medium text-muted">Department
        <select name="department" defaultValue={f.department ?? ""} className={`${sel} mt-1`}><option value="">All</option>
          {departments.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
      <label className="text-xs font-medium text-muted">Module
        <select name="module" defaultValue={f.module ?? ""} className={`${sel} mt-1`}><option value="">All</option>
          {modules.map((x) => <option key={x.id} value={x.id}>{x.code}</option>)}</select></label>
      <div className="flex items-end"><button className="h-10 w-full rounded-xl bg-ink px-4 text-sm font-semibold text-surface">Show</button></div>
    </form>
  );
}

function Tile({ label, value, hint, tone }: { label: string; value: string | number; hint?: string; tone?: "bad" | "warn" }) {
  return (
    <div className="rounded-2xl bg-surface p-4 shadow-card print:border print:border-line print:shadow-none">
      <div className="text-xs font-medium uppercase tracking-wide text-muted">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${tone === "bad" ? "text-bad" : tone === "warn" ? "text-warn" : ""}`}>{value}</div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </div>
  );
}

const fmtDate = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" });

/** The report itself. `exportBase` adds the download links; the printed version leaves them out. */
export function ReportBody({ r, f, exportBase, print = false }: { r: Report; f: ReportFilters; exportBase?: string; print?: boolean }) {
  const t = r.totals;
  const q = (extra: Record<string, string>) => `${exportBase}?${filterQuery(f, { from: r.from, to: r.to, ...extra })}`;
  const low = (rate: number | null, min = r.default_min_pct) => rate != null && Number(rate) < min;
  const maxSessions = Math.max(1, ...r.trend.map((w) => Number(w.sessions)));
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">{fmtDate(r.from)} to {fmtDate(r.to)} · closed classes only · required attendance {r.default_min_pct}% unless a module sets its own</p>
        {exportBase && !print && (
          <div className="flex flex-wrap gap-2 text-sm">
            <a href={q({ format: "xlsx" })} className="rounded-xl border border-line px-3 py-1.5 font-medium hover:bg-bg">Excel (all tables)</a>
            <a href={q({ format: "csv", section: "modules" })} className="rounded-xl border border-line px-3 py-1.5 font-medium hover:bg-bg">CSV: modules</a>
            <a href={q({ format: "csv", section: "at_risk" })} className="rounded-xl border border-line px-3 py-1.5 font-medium hover:bg-bg">CSV: students at risk</a>
            <Link href={`/reports/print?${filterQuery(f, { from: r.from, to: r.to })}`} className="rounded-xl border border-line px-3 py-1.5 font-medium hover:bg-bg">PDF (on your letterhead)</Link>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Tile label="Attendance" value={pct(t.rate)} tone={low(t.rate) ? "bad" : undefined} hint={`${t.present + t.late} of ${t.present + t.late + t.absent} counted`} />
        <Tile label="Classes" value={t.sessions} hint={`${t.modules} module${t.modules === 1 ? "" : "s"}`} />
        <Tile label="Late arrivals" value={t.late} />
        <Tile label="Unresolved" value={t.unresolved} tone={t.unresolved ? "warn" : undefined} hint="in review or disputed" />
        <Tile label="No register" value={r.missing_registers} tone={r.missing_registers ? "warn" : undefined} hint="timetabled classes" />
        <Tile label="Open disputes" value={r.open_disputes} />
      </div>

      {r.trend.length > 1 && (
        <Card className="print:break-inside-avoid">
          <CardTitle>Weekly attendance</CardTitle>
          <ul className="space-y-1.5 text-sm">
            {r.trend.map((w) => (
              <li key={w.week} className="grid grid-cols-[6.5rem_1fr_4rem] items-center gap-3">
                <span className="text-muted">{fmtDate(w.week)}</span>
                <span className="h-3 overflow-hidden rounded-full bg-bg" title={`${w.sessions} classes`}>
                  <span className={`block h-full rounded-full ${low(w.rate) ? "bg-bad" : "bg-ok"}`} style={{ width: `${w.rate ?? 0}%`, opacity: 0.4 + 0.6 * (Number(w.sessions) / maxSessions) }} />
                </span>
                <span className="text-right tabular-nums">{pct(w.rate)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="grid gap-6 2xl:grid-cols-2">
        <Card className="print:break-inside-avoid">
          <CardTitle>By faculty</CardTitle>
          <Table head={["Faculty", "Modules", "Classes", "Attendance", "Unresolved"]} empty="No faculties in this report.">
            {r.by_faculty.map((x) => (
              <tr key={x.name}><Td>{x.name}</Td><Td className="tabular-nums">{x.modules}</Td><Td className="tabular-nums">{x.sessions}</Td>
                <Td className={`tabular-nums font-medium ${low(x.rate) ? "text-bad" : ""}`}>{pct(x.rate)}</Td><Td className="tabular-nums">{x.unresolved || "—"}</Td></tr>
            ))}
          </Table>
        </Card>
        <Card className="print:break-inside-avoid">
          <CardTitle>By department</CardTitle>
          <Table head={["Department", "Modules", "Classes", "Attendance", "Unresolved"]} empty="No departments in this report.">
            {r.by_department.map((x) => (
              <tr key={`${x.faculty}/${x.name}`}><Td>{x.name}<span className="block text-xs text-muted">{x.faculty}</span></Td><Td className="tabular-nums">{x.modules}</Td>
                <Td className="tabular-nums">{x.sessions}</Td><Td className={`tabular-nums font-medium ${low(x.rate) ? "text-bad" : ""}`}>{pct(x.rate)}</Td>
                <Td className="tabular-nums">{x.unresolved || "—"}</Td></tr>
            ))}
          </Table>
        </Card>
      </div>

      <Card>
        <CardTitle>By module, lowest attendance first</CardTitle>
        <Table head={["Module", "Students", "Classes", "Present", "Late", "Absent", "Excused", "Unresolved", "Attendance"]} empty="No modules in this report.">
          {r.by_module.map((x) => (
            <tr key={x.id}>
              <Td><b>{x.code}</b> <span className="text-muted">{x.title}</span></Td>
              {[x.students, x.sessions, x.present, x.late, x.absent, x.excused, x.unresolved].map((v, i) => <Td key={i} className="tabular-nums">{v}</Td>)}
              <Td className={`tabular-nums font-medium ${low(x.rate, x.min_pct) ? "text-bad" : ""}`}>{pct(x.rate)}<span className="block text-xs font-normal text-muted">needs {x.min_pct}%</span></Td>
            </tr>
          ))}
        </Table>
      </Card>

      <Card>
        <CardTitle>Students at risk ({r.at_risk.length}{r.at_risk.length === 500 ? ", first 500" : ""})</CardTitle>
        <p className="mb-3 text-sm text-muted">Below their module&apos;s required attendance when records still in review count as missed, or absent from three or more classes in a row.</p>
        <Table head={["Student", "Module", "Attended", "Absent", "Unresolved", "In a row", "Worst case"]} empty="No student is at risk in this period.">
          {r.at_risk.map((x) => (
            <tr key={`${x.student_number}/${x.module_code}`}>
              <Td><b className="font-mono">{x.student_number}</b> {x.full_name}</Td><Td>{x.module_code}</Td>
              <Td className="tabular-nums">{x.attended}</Td><Td className="tabular-nums">{x.absent}</Td><Td className="tabular-nums">{x.unresolved || "—"}</Td>
              <Td className={`tabular-nums ${x.consecutive_absences >= 3 ? "font-semibold text-bad" : ""}`}>{x.consecutive_absences}</Td>
              <Td className={`tabular-nums font-medium ${low(x.worst_case, x.min_pct) ? "text-bad" : ""}`}>{pct(x.worst_case)}</Td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}

export function ReportError({ error }: { error: string }) {
  return <Notice tone={error.includes("database update") ? "warn" : "bad"}>{error}</Notice>;
}
