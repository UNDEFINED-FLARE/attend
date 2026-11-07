import { ActionForm } from "@/components/form";
import { Badge, Card, CardTitle, Field, Input, PageHeader, Select, Table, Td } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { addLecturer, grantAdmin, importStudents } from "../actions";

export const metadata = { title: "Lecturers & students" };

export default async function People({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const { supabase, institutionId } = await requireRole("institution_admin");
  const term = (q ?? "").trim().replace(/[%,()]/g, "");
  let students = supabase.from("students").select("id, student_number, full_name, email, user_id, status", { count: "exact" })
    .eq("institution_id", institutionId).is("deleted_at", null).order("student_number").limit(50);
  if (term) students = students.or(`student_number.ilike.%${term}%,full_name.ilike.%${term}%`);
  const [{ data: lecturers }, { data: studentRows, count }, { data: departments }, { data: admins }] = await Promise.all([
    supabase.from("lecturers").select("id, staff_number, full_name, email, user_id, status").eq("institution_id", institutionId).is("deleted_at", null).order("full_name"),
    students,
    supabase.from("departments").select("id, name").eq("institution_id", institutionId).is("deleted_at", null).order("name"),
    supabase.from("user_roles").select("id, user_id, status").eq("institution_id", institutionId).eq("role", "institution_admin"),
  ]);
  const { data: adminProfiles } = await supabase.from("profiles").select("id, full_name, email")
    .in("id", (admins ?? []).map((a) => a.user_id));
  const profileOf = new Map((adminProfiles ?? []).map((p) => [p.id, p]));

  return (
    <>
      <PageHeader title="Lecturers & students" />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardTitle>Import students (CSV)</CardTitle>
          <p className="mb-3 text-sm text-muted">
            Columns: <code>student_number, full_name</code>, optional <code>email, module_code</code>. Re-importing updates
            names and adds enrolments; it never creates duplicates. Students get access when they sign up with the listed
            email (or a university email whose name part is their student number, once your domain is verified).
          </p>
          <ActionForm action={importStudents} submit="Import" pending="Importing…">
            <Input type="file" name="file" accept=".csv,text/csv" required className="py-1.5" />
          </ActionForm>
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
        <Table head={["Staff no.", "Name", "Email", "Account"]} empty="No lecturers yet.">
          {(lecturers ?? []).map((l) => (
            <tr key={l.id}><Td className="font-mono">{l.staff_number}</Td><Td>{l.full_name}</Td><Td>{l.email}</Td>
              <Td>{l.user_id ? <Badge status="active">Linked</Badge> : <Badge status="pending">Not signed up</Badge>}</Td></tr>
          ))}
        </Table>
      </Card>

      <Card className="mt-6">
        <CardTitle action={
          <form className="flex gap-2"><Input name="q" defaultValue={q} placeholder="Search number or name" className="h-9 w-56" /></form>
        }>Students ({count ?? 0})</CardTitle>
        <Table head={["Student no.", "Name", "Email", "Account"]} empty={term ? "No match." : "No students yet. Import a CSV above."}>
          {(studentRows ?? []).map((s) => (
            <tr key={s.id}><Td className="font-mono">{s.student_number}</Td><Td>{s.full_name}</Td><Td>{s.email ?? "—"}</Td>
              <Td>{s.user_id ? <Badge status="active">Linked</Badge> : <Badge status="pending">Not signed up</Badge>}</Td></tr>
          ))}
        </Table>
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
