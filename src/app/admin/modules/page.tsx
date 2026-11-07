import { ActionForm } from "@/components/form";
import { Card, CardTitle, Field, Input, PageHeader, Select, Table, Td } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { addModule, assignLecturer } from "../actions";

export const metadata = { title: "Modules" };

export default async function Modules() {
  const { supabase, institutionId } = await requireRole("institution_admin");
  const [{ data: modules }, { data: departments }, { data: lecturers }, { data: assignments }, { data: enrol }] = await Promise.all([
    supabase.from("modules").select("id, code, title, min_attendance_pct, departments(code)").eq("institution_id", institutionId).is("deleted_at", null).order("code"),
    supabase.from("departments").select("id, name").eq("institution_id", institutionId).is("deleted_at", null).order("name"),
    supabase.from("lecturers").select("id, full_name, staff_number").eq("institution_id", institutionId).is("deleted_at", null).order("full_name"),
    supabase.from("lecturer_assignments").select("module_id, role, lecturers(full_name)").eq("institution_id", institutionId),
    supabase.from("module_enrolments").select("module_id").eq("institution_id", institutionId).eq("status", "active"),
  ]);
  const lecturersOf = (id: string) => (assignments ?? []).filter((a) => a.module_id === id)
    .map((a) => `${(a.lecturers as unknown as { full_name: string }).full_name}${a.role === "assistant" ? " (asst)" : ""}`).join(", ");
  const enrolled = (id: string) => (enrol ?? []).filter((e) => e.module_id === id).length;

  return (
    <>
      <PageHeader title="Modules" subtitle="Students are enrolled through the CSV import (module_code column)." />
      <Card className="mb-6">
        <CardTitle>All modules</CardTitle>
        <Table head={["Code", "Title", "Department", "Lecturers", "Students", "Required"]} empty="No modules yet.">
          {(modules ?? []).map((m) => (
            <tr key={m.id}>
              <Td className="font-semibold">{m.code}</Td><Td>{m.title}</Td>
              <Td>{(m.departments as unknown as { code: string } | null)?.code ?? "—"}</Td>
              <Td className="text-sm">{lecturersOf(m.id) || <span className="text-warn">Unassigned</span>}</Td>
              <Td>{enrolled(m.id)}</Td>
              <Td>{m.min_attendance_pct != null ? `${m.min_attendance_pct}%` : "Default"}</Td>
            </tr>
          ))}
        </Table>
      </Card>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardTitle>Create a module</CardTitle>
          <ActionForm action={addModule} submit="Create module">
            <div className="grid grid-cols-[8rem_1fr] gap-2">
              <Field label="Code"><Input name="code" placeholder="CSC1541" required /></Field>
              <Field label="Title"><Input name="title" placeholder="Introduction to Programming" required /></Field>
            </div>
            <Field label="Department">
              <Select name="department_id" defaultValue=""><option value="">—</option>
                {(departments ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select>
            </Field>
            <Field label="Required attendance (%)" hint="Leave blank to use the institution default.">
              <Input name="min_attendance_pct" type="number" min={0} max={100} />
            </Field>
          </ActionForm>
        </Card>
        <Card>
          <CardTitle>Assign a lecturer</CardTitle>
          {modules?.length && lecturers?.length ? (
            <ActionForm action={assignLecturer} submit="Assign">
              <Field label="Module"><Select name="module_id">{modules.map((m) => <option key={m.id} value={m.id}>{m.code} · {m.title}</option>)}</Select></Field>
              <Field label="Lecturer"><Select name="lecturer_id">{lecturers.map((l) => <option key={l.id} value={l.id}>{l.full_name} ({l.staff_number})</option>)}</Select></Field>
              <Field label="Role"><Select name="role"><option value="primary">Primary</option><option value="assistant">Assistant</option></Select></Field>
            </ActionForm>
          ) : <p className="text-sm text-muted">Create a module and add a lecturer first.</p>}
        </Card>
      </div>
    </>
  );
}
