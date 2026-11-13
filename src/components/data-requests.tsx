import { answerDataRequest } from "@/app/data-actions";
import { ActionForm } from "@/components/form";
import { Badge, Card, CardTitle, Select, Textarea } from "@/components/ui";

export type DataRequestRow = { id: string; kind: string; details: string; status: string; response: string | null; created_at: string; who: string };

const KIND: Record<string, string> = { deletion: "Delete my information", correction: "Correct my information", objection: "Object to processing", other: "Other" };
const day = (iso: string) => new Date(iso).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Johannesburg" });

/** Personal-information requests, with the 30-day clock and a form to record the outcome. */
export function DataRequestList({ rows, error }: { rows: DataRequestRow[]; error: boolean }) {
  if (error) return <Card><p className="text-sm text-muted">Requests need the latest database update (migration 0023).</p></Card>;
  const open = rows.filter((r) => r.status === "open" || r.status === "in_progress");
  const closed = rows.filter((r) => !open.includes(r));
  return (
    <div className="space-y-6">
      <Card>
        <CardTitle>Waiting for an answer ({open.length})</CardTitle>
        {open.length === 0 && <p className="text-sm text-muted">Nothing waiting.</p>}
        <ul className="space-y-3">
          {open.map((r) => {
            const due = Math.ceil((Date.parse(r.created_at) + 30 * 86400_000 - Date.now()) / 86400_000);
            return (
              <li key={r.id} className="space-y-2 rounded-2xl border border-line p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold">{KIND[r.kind] ?? r.kind} · {r.who}</p>
                  <span className={`text-xs font-semibold ${due <= 7 ? "text-bad" : "text-muted"}`}>
                    {day(r.created_at)} · {due >= 0 ? `answer within ${due} day${due === 1 ? "" : "s"}` : `${-due} days overdue`}
                  </span>
                </div>
                <p className="whitespace-pre-wrap text-sm">{r.details}</p>
                <ActionForm action={answerDataRequest} submit="Save" pending="Saving…" className="grid gap-2 sm:grid-cols-[180px_1fr]">
                  <input type="hidden" name="id" value={r.id} />
                  <Select name="status" defaultValue={r.status === "open" ? "in_progress" : "done"}>
                    <option value="in_progress">Working on it</option><option value="done">Done</option><option value="declined">Declined</option>
                  </Select>
                  <Textarea name="response" placeholder="What was done, or why not (the person sees this)." maxLength={2000} defaultValue={r.response ?? ""} />
                </ActionForm>
              </li>
            );
          })}
        </ul>
      </Card>
      {closed.length > 0 && (
        <Card>
          <CardTitle>Answered</CardTitle>
          <ul className="space-y-2 text-sm">
            {closed.map((r) => (
              <li key={r.id} className="rounded-xl border border-line p-3">
                <p className="font-medium">{KIND[r.kind] ?? r.kind} · {r.who} · {day(r.created_at)} <Badge status={r.status} /></p>
                {r.response && <p className="mt-1 text-muted">{r.response}</p>}
              </li>
            ))}
          </ul>
        </Card>
      )}
      <p className="text-xs text-muted">POPIA expects requests to be answered within a reasonable time; 30 days is the PAIA default. Deletion of attendance records is the institution&apos;s decision, as responsible party. Deleting a login account is done by UniAttend support.</p>
    </div>
  );
}
