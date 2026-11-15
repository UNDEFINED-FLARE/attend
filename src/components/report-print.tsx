import { DocFigure } from "@/components/print-document";
import type { Report } from "@/lib/report";

const pct = (v: number | null | undefined) => (v == null ? "—" : `${Number(v).toFixed(1)}%`);
const day = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" });

function H({ children }: { children: React.ReactNode }) {
  return <h2 className="mt-7 mb-2 text-[14px] font-semibold">{children}</h2>;
}

/** The institutional report laid out for paper: plain tables, worst first, nothing interactive. */
export function ReportPrint({ r, colour }: { r: Report; colour: string }) {
  const t = r.totals;
  const bad = (v: number | null, min = r.default_min_pct) => (v != null && Number(v) < min ? { color: "#b42318", fontWeight: 600 } : undefined);
  return (
    <>
      <section className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        <DocFigure label="Attendance" value={pct(t.rate)} colour={colour} />
        <DocFigure label="Classes" value={t.sessions} />
        <DocFigure label="Late arrivals" value={t.late} />
        <DocFigure label="Unresolved" value={t.unresolved} />
        <DocFigure label="No register" value={r.missing_registers} />
        <DocFigure label="Open disputes" value={r.open_disputes} />
      </section>
      <p className="mt-2 text-[11px] text-[#6b6e74]">Attendance is present + late over present + late + absent, closed classes only. Excused classes are left out.
        Records in review or disputed are shown as unresolved and never counted as absences. Required attendance {r.default_min_pct}% unless a module sets its own.</p>

      {r.trend.length > 1 && (
        <section>
          <H>Weekly attendance</H>
          <table>
            <thead><tr><th>Week starting</th><th className="num">Classes</th><th className="num">Attendance</th><th style={{ width: "45%" }} /></tr></thead>
            <tbody>
              {r.trend.map((w) => (
                <tr key={w.week}><td>{day(w.week)}</td><td className="num">{w.sessions}</td><td className="num" style={bad(w.rate)}>{pct(w.rate)}</td>
                  <td><div style={{ height: 8, width: `${w.rate ?? 0}%`, background: colour, opacity: 0.75, borderRadius: 4 }} /></td></tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {r.by_faculty.length > 1 && (
        <section>
          <H>By faculty</H>
          <table>
            <thead><tr><th>Faculty</th><th className="num">Modules</th><th className="num">Classes</th><th className="num">Late</th><th className="num">Unresolved</th><th className="num">Attendance</th></tr></thead>
            <tbody>{r.by_faculty.map((x) => (
              <tr key={x.name}><td>{x.name}</td><td className="num">{x.modules}</td><td className="num">{x.sessions}</td><td className="num">{x.late}</td>
                <td className="num">{x.unresolved || "—"}</td><td className="num" style={bad(x.rate)}>{pct(x.rate)}</td></tr>
            ))}</tbody>
          </table>
        </section>
      )}

      {r.by_department.length > 1 && (
        <section>
          <H>By department</H>
          <table>
            <thead><tr><th>Department</th><th>Faculty</th><th className="num">Modules</th><th className="num">Classes</th><th className="num">Unresolved</th><th className="num">Attendance</th></tr></thead>
            <tbody>{r.by_department.map((x) => (
              <tr key={`${x.faculty}/${x.name}`}><td>{x.name}</td><td>{x.faculty}</td><td className="num">{x.modules}</td><td className="num">{x.sessions}</td>
                <td className="num">{x.unresolved || "—"}</td><td className="num" style={bad(x.rate)}>{pct(x.rate)}</td></tr>
            ))}</tbody>
          </table>
        </section>
      )}

      <H>By module, lowest attendance first</H>
      <table>
        <thead><tr><th>Module</th><th className="num">Students</th><th className="num">Classes</th><th className="num">Present</th><th className="num">Late</th>
          <th className="num">Absent</th><th className="num">Excused</th><th className="num">Unres.</th><th className="num">Required</th><th className="num">Attendance</th></tr></thead>
        <tbody>{r.by_module.filter((m) => Number(m.sessions) > 0).map((x) => (
          <tr key={x.id}><td><b>{x.code}</b> <span className="text-[#6b6e74]">{x.title}</span></td><td className="num">{x.students}</td><td className="num">{x.sessions}</td>
            <td className="num">{x.present}</td><td className="num">{x.late}</td><td className="num">{x.absent}</td><td className="num">{x.excused}</td>
            <td className="num">{x.unresolved || "—"}</td><td className="num">{x.min_pct}%</td><td className="num" style={bad(x.rate, x.min_pct)}>{pct(x.rate)}</td></tr>
        ))}</tbody>
      </table>
      {r.by_module.some((m) => Number(m.sessions) === 0) && (
        <p className="mt-1 text-[11px] text-[#6b6e74]">{r.by_module.filter((m) => Number(m.sessions) === 0).length} module(s) had no closed classes in this period and are not listed.</p>
      )}

      <H>Students at risk ({r.at_risk.length}{r.at_risk.length === 500 ? ", first 500" : ""})</H>
      {r.at_risk.length === 0 ? <p className="text-[12px]">No student is at risk in this period.</p> : (
        <table>
          <thead><tr><th>Student</th><th>Name</th><th>Module</th><th className="num">Attended</th><th className="num">Absent</th><th className="num">Unres.</th>
            <th className="num">In a row</th><th className="num">Worst case</th></tr></thead>
          <tbody>{r.at_risk.map((x) => (
            <tr key={`${x.student_number}/${x.module_code}`}><td className="font-mono">{x.student_number}</td><td>{x.full_name}</td><td>{x.module_code}</td>
              <td className="num">{x.attended}</td><td className="num">{x.absent}</td><td className="num">{x.unresolved || "—"}</td>
              <td className="num" style={x.consecutive_absences >= 3 ? { color: "#b42318", fontWeight: 600 } : undefined}>{x.consecutive_absences}</td>
              <td className="num" style={bad(x.worst_case, x.min_pct)}>{pct(x.worst_case)}</td></tr>
          ))}</tbody>
        </table>
      )}
    </>
  );
}
