import "server-only";
import type { getSession } from "@/lib/auth";

type Sb = NonNullable<Awaited<ReturnType<typeof getSession>>>["supabase"];

export type ReviewItem = {
  record_id: string; session_id: string; session_title: string; opens_at: string; session_status: string;
  module_code: string; student_number: string; full_name: string; status: string; method: string;
  score: number | null; checked_in_at: string | null; minutes_late: number | null; reasons: string[];
  kind: string;
  evidence: {
    accuracy_m: number | null; outside_by_m: number | null; p_inside: number | null; location_required: boolean;
    device_points: number | null; qr_points: number | null; attempts: number; refused_attempts: number;
  };
};
export type Decision = {
  decision_id: string; record_id: string; session_id: string; session_title: string; opens_at: string; module_code: string;
  student_number: string; full_name: string; decision: string; previous: string; note: string; decided_by: string;
  decided_at: string; status_now: string;
};
export type MissingRegister = {
  event_id: string; starts_at: string; ends_at: string; kind: string; group_name: string | null;
  module_code: string; module_title: string; venue: string | null; lecturer: string;
};

/** Everything the review page shows. `needsUpdate` when migration 0029 is not in the database yet. */
export async function loadReview(supabase: Sb, institutionId: string) {
  const [open, decided, missing] = await Promise.all([
    supabase.rpc("review_queue", { p_inst: institutionId, p_state: "open", p_limit: 300 }),
    supabase.rpc("review_queue", { p_inst: institutionId, p_state: "decided", p_limit: 100 }),
    supabase.rpc("missing_registers", { p_inst: institutionId, p_days: 14 }),
  ]);
  const needsUpdate = [open, decided, missing].some((r) => r.error?.code === "PGRST202");
  const error = [open, decided, missing].find((r) => r.error && r.error.code !== "PGRST202")?.error?.message ?? null;
  return {
    needsUpdate, error,
    open: (open.data ?? []) as ReviewItem[],
    decided: (decided.data ?? []) as Decision[],
    missing: (missing.data ?? []) as MissingRegister[],
  };
}
