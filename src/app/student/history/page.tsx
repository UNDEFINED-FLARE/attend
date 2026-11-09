import { ActionForm } from "@/components/form";
import { Badge, Card, CardTitle, PageHeader, Table, Td, Textarea, when } from "@/components/ui";
import { LateChip } from "@/components/late";
import { requireRole } from "@/lib/auth";
import { dispute } from "../actions";

export const metadata = { title: "History & disputes" };

type Rec = {
  id: string; status: string; minutes_late: number | null; checked_in_at: string | null; score: number | null; explanation: string[];
  class_sessions: { title: string; opens_at: string; modules: { code: string } } | null;
};

export default async function History() {
  const { supabase, institutionId } = await requireRole("student");
  const [{ data: recs }, { data: disputes }] = await Promise.all([
    supabase.from("attendance_records")
      .select("id, status, minutes_late, checked_in_at, score, explanation, class_sessions(title, opens_at, modules(code))")
      .eq("institution_id", institutionId).order("created_at", { ascending: false }).limit(200),
    supabase.from("attendance_disputes").select("id, record_id, status, reason, resolution_note, created_at")
      .eq("institution_id", institutionId).order("created_at", { ascending: false }),
  ]);
  const records = (recs ?? []) as unknown as Rec[];
  const disputable = records.filter((r) => ["absent", "late", "pending_verification"].includes(r.status));

  return (
    <>
      <PageHeader title="History & disputes" />
      <Card className="mb-6">
        <CardTitle>Attendance history</CardTitle>
        <Table head={["Session", "Date", "Status", "Notes"]} empty="No attendance recorded yet.">
          {records.map((r) => (
            <tr key={r.id}>
              <Td><b>{r.class_sessions?.modules.code}</b> {r.class_sessions?.title}</Td>
              <Td>{when(r.class_sessions?.opens_at)}</Td>
              <Td><span className="flex flex-wrap items-center gap-1"><Badge status={r.status} /><LateChip minutes={r.minutes_late} /></span></Td>
              <Td className="max-w-xs text-xs text-muted">{(r.explanation ?? []).join(" ")}</Td>
            </tr>
          ))}
        </Table>
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        <Card id="dispute" className="scroll-mt-24">
          <CardTitle>Dispute a record</CardTitle>
          {disputable.length === 0 ? <p className="text-sm text-muted">Nothing to dispute.</p> : (
            <ActionForm action={dispute} submit="Submit dispute" pending="Submitting…">
              <select name="record" className="h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm" required>
                {disputable.map((r) => (
                  <option key={r.id} value={r.id}>{r.class_sessions?.modules.code} · {when(r.class_sessions?.opens_at)} · {r.status.replace("_", " ")}</option>
                ))}
              </select>
              <Textarea name="reason" placeholder="What happened? e.g. I was in the back row and my phone's location was off." required minLength={10} />
            </ActionForm>
          )}
        </Card>
        <Card>
          <CardTitle>My disputes</CardTitle>
          <ul className="divide-y divide-line text-sm">
            {(disputes ?? []).length === 0 && <li className="py-2 text-muted">None.</li>}
            {(disputes ?? []).map((d) => (
              <li key={d.id} className="space-y-1 py-3">
                <div className="flex justify-between"><Badge status={d.status === "open" ? "pending" : d.status} /><span className="text-xs text-muted">{when(d.created_at)}</span></div>
                <p>{d.reason}</p>
                {d.resolution_note && <p className="text-muted">Response: {d.resolution_note}</p>}
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
