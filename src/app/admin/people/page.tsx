import { ActionForm } from "@/components/form";
import { Badge, Card, CardTitle, Field, Input, PageHeader, Select } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { addLecturer, addStudent, grantAdmin, importStudents, pasteStudents } from "../actions";
import { StudentAdder } from "./student-adder";
import { DeleteButton, EditToggle } from "@/components/row-actions";
import { updatePerson } from "../data-actions";

export const metadata = { title: "Lecturers & students" };

export default async function People({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const { supabase, institutionId } = await requireRole("institution_admin");
  const term = (q ?? "").trim().replace(/[%,()]/g, "");
  let students = supabase.from("students").select("id, student_number, full_name, email, user_id, status", { count: "exact" })
    .eq("institution_id", institutionId).is("deleted_at", null).order("student_number").limit(50);
  if (term) students = students.or(`student_number.ilike.%${term}%,full_name.ilike.%${term}%`);
  const [{ data: lecturers }, { data: studentRows, count }, { data: departments }, { data: admins }, { data: modules }] = await Promise.all([
    supabase.from("lecturers").select("*").eq("institution_id", institutionId).is("deleted_at", null).order("full_name"),
    students,
    supabase.from("departments").select("id, name").eq("institution_id", institutionId).is("deleted_at", null).order("name"),
    supabase.from("user_roles").select("id, user_id, status").eq("institution_id", institutionId).eq("role", "institution_admin"),
    supabase.from("modules").select("code, title").eq("institution_id", institutionId).is("deleted_at", null).order("code"),
  ]);
  const { data: adminProfiles } = await supabase.from("profiles").select("id, full_name, email")
    .in("id", (admins ?? []).map((a) => a.user_id));
  const profileOf = new Map((adminProfiles ?? []).map((p) => [p.id, p]));

  return (
    <>
      <PageHeader title="Lecturers & students" subtitle="Add students one at a time, paste a list, or upload a CSV file." />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardTitle>Add students</CardTitle>
          <StudentAdder modules={modules ?? []} addOne={addStudent} paste={pasteStudents} upload={importStudents} />
        </Card>
        <Card>
          <CardTitle>Add a lecturer</CardTitle>
          <ActionForm action={addLecturer} submit="Add lecturer">
            <div className="grid grid-cols-[8rem_1fr] gap-2">
              <Field label="Staff no."><Input name="staff_number" required /></Field>
              <Field label="Full name"><Input name="full_name" required /></Field>
            </div>
            <Field label="Email" hint="They sign up with this email to get lecturer access."><Input name="email" type="email" required /></Field>
            <Field label="Department"><Select name="department_id" defaultValue=""><option value="">—</option>
              {(departments ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></Field>
          </ActionForm>
        </Card>
      </div>

      <Card className="mt-6">
        <CardTitle>Lecturers ({(lecturers ?? []).length})</CardTitle>
        {(lecturers ?? []).length === 0 && <p className="py-6 text-center text-sm text-muted">No lecturers yet. Add one above or import a timetable.</p>}
        <ul className="divide-y divide-line">
          {(lecturers ?? []).map((l) => (
            <PersonRow key={l.id} kind="lecturer" id={l.id} number={l.staff_number} name={l.full_name} email={l.email}
              linked={!!l.user_id} note={l.source === "timetable" ? (String(l.staff_number).startsWith("TT-") ? "from timetable: add staff no. and email" : "from timetable") : null} />
          ))}
        </ul>
      </Card>

      <Card className="mt-6">
        <CardTitle action={
          <form className="flex gap-2"><Input name="q" defaultValue={q} placeholder="Search number or name" className="h-9 w-56" /></form>
        }>Students ({count ?? 0})</CardTitle>
        {(studentRows ?? []).length === 0 && <p className="py-6 text-center text-sm text-muted">{term ? "No match." : "No students yet. Add them above."}</p>}
        <ul className="divide-y divide-line">
          {(studentRows ?? []).map((st) => (
            <PersonRow key={st.id} kind="student" id={st.id} number={st.student_number} name={st.full_name} email={st.email} linked={!!st.user_id} note={null} />
          ))}
        </ul>
        {(count ?? 0) > 50 && <p className="mt-3 text-xs text-muted">Showing the first 50. Search to narrow down.</p>}
      </Card>

      <Card className="mt-6">
        <CardTitle>Administrators</CardTitle>
        <ul className="mb-4 divide-y divide-line text-sm">
          {(admins ?? []).map((a) => {
            const p = profileOf.get(a.user_id);
            return <li key={a.id} className="flex justify-between py-2"><span>{p?.full_name || p?.email || a.user_id}</span><Badge status={a.status} /></li>;
          })}
        </ul>
        <ActionForm action={grantAdmin} submit="Add administrator" className="flex flex-wrap items-start gap-2 [&>[role]]:w-full">
          <Input name="email" type="email" placeholder="colleague@university.ac.za" className="max-w-xs" required />
        </ActionForm>
      </Card>
    </>
  );
}

function PersonRow({ kind, id, number, name, email, linked, note }: {
  kind: "student" | "lecturer"; id: string; number: string; name: string; email: string | null; linked: boolean; note: string | null;
}) {
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5">
      <span className="w-28 font-mono text-sm">{number}</span>
      <span className="min-w-40 flex-1">
        <span className="block font-medium">{name}</span>
        <span className="block text-xs text-muted">{email ?? "no email"}{note ? <span className="text-warn"> · {note}</span> : null}</span>
      </span>
      {linked ? <Badge status="active">Signed up</Badge> : <Badge status="pending">Not signed up</Badge>}
      <span className="flex items-center gap-1">
        <EditToggle>
          <ActionForm action={updatePerson} submit="Save" className="grid gap-2 rounded-xl bg-bg p-3 sm:grid-cols-3 [&>button]:sm:col-span-3 [&>[role]]:sm:col-span-3">
            <input type="hidden" name="kind" value={kind} />
            <input type="hidden" name="id" value={id} />
            <Field label={kind === "student" ? "Student no." : "Staff no."}><Input name="number" defaultValue={number} required /></Field>
            <Field label="Full name"><Input name="full_name" defaultValue={name} required /></Field>
            <Field label="Email"><Input name="email" type="email" defaultValue={email ?? ""} /></Field>
          </ActionForm>
        </EditToggle>
        <DeleteButton kind={kind} id={id} label={name} />
      </span>
    </li>
  );
}
