import { ActionForm } from "@/components/form";
import { DeleteButton, EditToggle } from "@/components/row-actions";
import { Card, CardTitle, Field, Input, PageHeader, Select } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { addModule, assignLecturer } from "../actions";
import { changeEnrolment, updateModule } from "../data-actions";
import { AssignImport } from "./assign-import";

export const metadata = { title: "Modules" };

type Mod = { id: string; code: string; title: string; department_id: string | null; min_attendance_pct: number | null; expected_students?: number | null; departments: { code: string } | null };

export default async function Modules({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const { supabase, institutionId } = await requireRole("institution_admin");
  const [{ data: modRows }, { data: departments }, { data: lecturers }, { data: assignments }, { data: enrol }, { data: slots }] = await Promise.all([
    supabase.from("modules").select("*, departments(code)").eq("institution_id", institutionId).is("deleted_at", null).order("code"),
    supabase.from("departments").select("id, name").eq("institution_id", institutionId).is("deleted_at", null).order("name"),
    supabase.from("lecturers").select("id, full_name, staff_number").eq("institution_id", institutionId).is("deleted_at", null).order("full_name"),
    supabase.from("lecturer_assignments").select("id, module_id, role, lecturers(full_name)").eq("institution_id", institutionId),
    supabase.from("module_enrolments").select("module_id").eq("institution_id", institutionId).eq("status", "active"),
    supabase.from("timetables").select("module_id, starts_at, ends_at").eq("institution_id", institutionId),
  ]);
  const term = (q ?? "").trim().toUpperCase();
  const modules = ((modRows ?? []) as unknown as Mod[]).filter((m) => !term || m.code.includes(term) || m.title.toUpperCase().includes(term));
  const count = new Map<string, number>(), hours = new Map<string, number>();
  for (const e of enrol ?? []) count.set(e.module_id, (count.get(e.module_id) ?? 0) + 1);
  for (const s of slots ?? []) {
    const m = (t: string) => +t.slice(0, 2) * 60 + +t.slice(3, 5);
    hours.set(s.module_id, (hours.get(s.module_id) ?? 0) + (m(s.ends_at) - m(s.starts_at)) / 60);
  }

  return (
    <>
      <PageHeader title="Modules" subtitle={`${(modRows ?? []).length} modules. Edit, delete, assign lecturers and enrol students here.`} />

      <div className="mb-6 grid gap-6 lg:grid-cols-3">
        <Card>
          <CardTitle>Add a module</CardTitle>
          <ActionForm action={addModule} submit="Add module">
            <div className="grid grid-cols-[7rem_1fr] gap-2">
              <Field label="Code"><Input name="code" placeholder="CSC1541" required /></Field>
              <Field label="Title"><Input name="title" placeholder="Introduction to Programming" required /></Field>
            </div>
            <Field label="Department">
              <Select name="department_id" defaultValue=""><option value="">—</option>
                {(departments ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select>
            </Field>
            <Field label="Required attendance (%)" hint="Blank = institution default."><Input name="min_attendance_pct" type="number" min={0} max={100} /></Field>
          </ActionForm>
        </Card>
        <Card>
          <CardTitle>Assign a lecturer</CardTitle>
          {(modRows ?? []).length && lecturers?.length ? (
            <ActionForm action={assignLecturer} submit="Assign">
              <Field label="Module"><Select name="module_id">{(modRows as unknown as Mod[]).map((m) => <option key={m.id} value={m.id}>{m.code} · {m.title}</option>)}</Select></Field>
              <Field label="Lecturer"><Select name="lecturer_id">{lecturers.map((l) => <option key={l.id} value={l.id}>{l.full_name} ({l.staff_number})</option>)}</Select></Field>
              <Field label="Role"><Select name="role"><option value="primary">Primary</option><option value="assistant">Assistant</option></Select></Field>
            </ActionForm>
          ) : <p className="text-sm text-muted">Add a module and a lecturer first.</p>}
        </Card>
        <Card>
          <CardTitle>Enrol or remove a student</CardTitle>
          {(modRows ?? []).length ? (
            <ActionForm action={changeEnrolment} submit="Apply">
              <Field label="Module"><Select name="module_id">{(modRows as unknown as Mod[]).map((m) => <option key={m.id} value={m.id}>{m.code} · {m.title}</option>)}</Select></Field>
              <Field label="Student number"><Input name="student_number" required placeholder="22012345" /></Field>
              <Field label="Action"><Select name="op"><option value="add">Enrol</option><option value="remove">Remove from module</option></Select></Field>
            </ActionForm>
          ) : <p className="text-sm text-muted">Add a module first.</p>}
        </Card>
      </div>

      <AssignImport />

      <Card>
        <CardTitle action={<form><Input name="q" defaultValue={q} placeholder="Search code or title" className="h-9 w-56" /></form>}>All modules</CardTitle>
        {modules.length === 0 && <p className="py-8 text-center text-sm text-muted">{term ? "No match." : "No modules yet. Add one above or import a timetable."}</p>}
        <ul className="divide-y divide-line">
          {modules.map((m) => {
            const lects = (assignments ?? []).filter((a) => a.module_id === m.id);
            return (
              <li key={m.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
                <div className="min-w-48 flex-1">
                  <p><b>{m.code}</b> <span className="text-muted">{m.title !== m.code ? m.title : <i>no title yet</i>}</span></p>
                  <p className="text-xs text-muted">
                    {m.departments?.code ?? "No department"} · {count.get(m.id) ?? 0} enrolled
                    {m.expected_students ? ` of ~${m.expected_students} expected` : ""} · {(hours.get(m.id) ?? 0).toFixed(1).replace(".0", "")} h/week · needs {m.min_attendance_pct ?? "default"}{m.min_attendance_pct != null ? "%" : ""}
                  </p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {lects.length === 0 && <span className="text-xs text-warn">No lecturer assigned</span>}
                    {lects.map((a) => (
                      <span key={a.id} className="inline-flex items-center gap-1 rounded-full bg-bg py-0.5 pl-2 text-xs">
                        {(a.lecturers as unknown as { full_name: string } | null)?.full_name}{a.role === "assistant" ? " (asst)" : ""}
                        <DeleteButton kind="assignment" id={a.id} label="this lecturer from the module" confirm="Remove?" />
                      </span>
                    ))}
                  </div>
                </div>
                <div className="ml-auto flex items-center gap-1">
                  <EditToggle>
                    <ActionForm action={updateModule} submit="Save" className="grid gap-2 rounded-xl bg-bg p-3 sm:grid-cols-6 [&>button]:sm:col-span-6 [&>[role]]:sm:col-span-6">
                      <input type="hidden" name="id" value={m.id} />
                      <Field label="Code"><Input name="code" defaultValue={m.code} required /></Field>
                      <div className="sm:col-span-2"><Field label="Title"><Input name="title" defaultValue={m.title} required /></Field></div>
                      <Field label="Department"><Select name="department_id" defaultValue={m.department_id ?? ""}><option value="">—</option>
                        {(departments ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></Field>
                      <Field label="Required %"><Input name="min_attendance_pct" type="number" min={0} max={100} defaultValue={m.min_attendance_pct ?? ""} /></Field>
                      <Field label="Class size"><Input name="expected_students" type="number" min={0} defaultValue={m.expected_students ?? ""} /></Field>
                    </ActionForm>
                  </EditToggle>
                  <DeleteButton kind="module" id={m.id} label={m.code} confirm={`Delete ${m.code}?`} />
                </div>
              </li>
            );
          })}
        </ul>
      </Card>
    </>
  );
}
