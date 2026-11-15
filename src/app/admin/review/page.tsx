import Link from "next/link";
import { DecisionLog, MissingRegisters, ReviewQueue } from "@/components/review-queue";
import { Card, CardTitle, Notice, PageHeader } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { loadReview } from "@/lib/review";

export const metadata = { title: "Attendance reviews" };

// The whole institution's queue: what lecturers have not decided yet, classes that
// ended without a register, and every decision of the last 30 days.
export default async function AdminReview() {
  const { supabase, institutionId } = await requireRole("institution_admin");
  const [review, { count: disputes }] = await Promise.all([
    loadReview(supabase, institutionId),
    supabase.from("attendance_disputes").select("id", { count: "exact", head: true }).eq("institution_id", institutionId).eq("status", "open"),
  ]);
  return (
    <>
      <PageHeader title="Attendance reviews"
        subtitle="Check-ins with weak evidence wait here for a person. They never become absences on their own." />
      {review.needsUpdate && <div className="mb-6"><Notice tone="warn">The review queue needs the latest database update (migration 0029).</Notice></div>}
      {review.error && <div className="mb-6"><Notice tone="bad">{review.error}</Notice></div>}
      {!!disputes && <div className="mb-6"><Notice>{disputes} open dispute{disputes === 1 ? "" : "s"}. Lecturers decide these on their Reviews page.</Notice></div>}

      <Card className="mb-6">
        <CardTitle>Waiting for a decision ({review.open.length})</CardTitle>
        <ReviewQueue items={review.open} />
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardTitle action={<Link href="/admin/timetable" className="text-xs text-info hover:underline">Timetable →</Link>}>Classes without a register (14 days)</CardTitle>
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
