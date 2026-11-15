import { DecisionLog, MissingRegisters, ReviewQueue } from "@/components/review-queue";
import { Card, CardTitle, Notice, PageHeader } from "@/components/ui";
import { requireAnyRole, STAFF_ROLES } from "@/lib/auth";
import { loadReview } from "@/lib/review";

export const metadata = { title: "Reviews" };

export default async function StaffReview() {
  const { supabase, institutionId, roles } = await requireAnyRole(STAFF_ROLES);
  // An auditor who holds no other staff role here reads the queue but cannot decide.
  const readOnly = roles.every((r) => r.role === "auditor");
  const review = await loadReview(supabase, institutionId);
  return (
    <>
      <PageHeader title="Reviews"
        subtitle={readOnly ? "Read-only: what is waiting, and every decision of the last 30 days." : "Nothing here counts against a student until someone decides."} />
      {review.needsUpdate && <div className="mb-6"><Notice tone="warn">The review queue needs the latest database update.</Notice></div>}
      {review.error && <div className="mb-6"><Notice tone="bad">{review.error}</Notice></div>}
      <Card className="mb-6">
        <CardTitle>Waiting for a decision ({review.open.length})</CardTitle>
        <ReviewQueue items={review.open} readOnly={readOnly} />
      </Card>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card><CardTitle>Classes without a register (14 days)</CardTitle><MissingRegisters items={review.missing} /></Card>
        <Card><CardTitle>Decided in the last 30 days</CardTitle><DecisionLog items={review.decided} /></Card>
      </div>
    </>
  );
}
