import Link from "next/link";
import { ActionForm } from "@/components/form";
import { Card, CardTitle, Input, PageHeader, Select, when } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { resolveDispute } from "../actions";

export const metadata = { title: "Disputes & reviews" };

export default async function Disputes() {
  const { supabase, institutionId } = await requireRole("lecturer");
  // RLS already limits both lists to modules this lecturer teaches.
  const [{ data: disputes }, { data: pending }] = await Promise.all([
    supabase.from("attendance_disputes")
      .select("id, reason, previous_status, created_at, students(student_number, full_name), attendance_records(session_id, class_sessions(title, opens_at, modules(code)))")
      .eq("institution_id", institutionId).eq("status", "open").order("created_at"),
    supabase.from("attendance_records")
      .select("id, session_id, score, explanation, students(student_number, full_name), class_sessions(title, opens_at, modules(code))")
      .eq("institution_id", institutionId).eq("status", "pending_verification").order("created_at").limit(100),
  ]);
  type D = { id: string; reason: string; previous_status: string; created_at: string;
    students: { student_number: string; full_name: string };
    attendance_records: { session_id: string; class_sessions: { title: string; opens_at: string; modules: { code: string } } } };
  type P = { id: string; session_id: string; score: number; explanation: string[];
    students: { student_number: string; full_name: string }; class_sessions: { title: string; opens_at: string; modules: { code: string } } };

  return (
    <>
      <PageHeader title="Disputes & reviews" subtitle="Nothing here counts against a student until you decide." />
      <Card className="mb-6">
        <CardTitle>Open disputes ({(disputes ?? []).length})</CardTitle>
        {(disputes ?? []).length === 0 && <p className="text-sm text-muted">No open disputes.</p>}
        <ul className="divide-y divide-line">
          {((disputes ?? []) as unknown as D[]).map((d) => (
            <li key={d.id} className="grid gap-3 py-4 md:grid-cols-2">
              <div className="text-sm">
                <p><b className="font-mono">{d.students.student_number}</b> {d.students.full_name}</p>
                <p className="text-muted">{d.attendance_records.class_sessions.modules.code} · {d.attendance_records.class_sessions.title} · {when(d.attendance_records.class_sessions.opens_at)} · was {d.previous_status.replace("_", " ")}</p>
                <blockquote className="mt-2 border-l-2 border-line pl-3">{d.reason}</blockquote>
              </div>
              <ActionForm action={resolveDispute} submit="Decide" pending="Saving…" className="space-y-2">
                <input type="hidden" name="dispute" value={d.id} />
                <Select name="decision" defaultValue="present">
                  <option value="present">Uphold: present</option><option value="late">Uphold: late</option>
                  <option value="excused">Uphold: excused</option><option value="reject">Do not uphold</option>
                </Select>
                <Input name="note" placeholder="Note to student (optional)" />
              </ActionForm>
            </li>
          ))}
        </ul>
      </Card>
      <Card>
        <CardTitle>Check-ins awaiting review ({(pending ?? []).length})</CardTitle>
        {(pending ?? []).length === 0 && <p className="text-sm text-muted">Nothing to review.</p>}
        <ul className="divide-y divide-line text-sm">
          {((pending ?? []) as unknown as P[]).map((p) => (
            <li key={p.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
              <div>
                <p><b className="font-mono">{p.students.student_number}</b> {p.students.full_name} · score {p.score}</p>
                <p className="text-muted">{p.class_sessions.modules.code} · {when(p.class_sessions.opens_at)}</p>
                <p className="text-xs text-muted">{(p.explanation ?? []).join(" ")}</p>
              </div>
              <Link href={`/lecturer/sessions/${p.session_id}`} className="text-info hover:underline">Review in register →</Link>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
