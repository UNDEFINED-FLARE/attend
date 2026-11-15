import { ActionForm } from "@/components/form";
import { DecisionLog, MissingRegisters, ReviewQueue } from "@/components/review-queue";
import { Card, CardTitle, Input, Notice, PageHeader, Select, when } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { loadReview } from "@/lib/review";
import { resolveDispute } from "../actions";

export const metadata = { title: "Reviews" };

export default async function Reviews() {
  const { supabase, institutionId } = await requireRole("lecturer");
  // RLS and the review functions limit everything to modules this lecturer teaches.
  const [{ data: disputes }, review] = await Promise.all([
    supabase.from("attendance_disputes")
      .select("id, reason, previous_status, created_at, students(student_number, full_name), attendance_records(session_id, class_sessions(title, opens_at, modules(code)))")
      .eq("institution_id", institutionId).eq("status", "open").order("created_at"),
    loadReview(supabase, institutionId),
  ]);
  type D = { id: string; reason: string; previous_status: string; created_at: string;
    students: { student_number: string; full_name: string };
    attendance_records: { session_id: string; class_sessions: { title: string; opens_at: string; modules: { code: string } } } };

  return (
    <>
      <PageHeader title="Reviews" subtitle="Nothing here counts against a student until you decide." />
      {review.needsUpdate && <div className="mb-6"><Notice tone="warn">The review queue needs the latest database update (migration 0029).</Notice></div>}
      {review.error && <div className="mb-6"><Notice tone="bad">{review.error}</Notice></div>}

      <Card className="mb-6">
        <CardTitle>Check-ins to review ({review.open.length})</CardTitle>
        <ReviewQueue items={review.open} sessionBase="/lecturer/sessions" />
      </Card>

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

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardTitle>Classes without a register</CardTitle>
          <MissingRegisters items={review.missing} />
        </Card>
        <Card>
          <CardTitle>Decided in the last 30 days</CardTitle>
          <DecisionLog items={review.decided} />
        </Card>
      </div>
    </>
  );
}
