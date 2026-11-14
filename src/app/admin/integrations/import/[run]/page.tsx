import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/form";
import { Badge, Card, CardTitle, Notice, PageHeader, Stat, Table, Td } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { datasetDef, RUN_STATUS } from "@/lib/integrations/datasets";
import { cancelImport, confirmImport } from "../actions";

export const metadata = { title: "Import" };

type Counts = { received: number; inserted: number; updated: number; unchanged: number; duplicates: number; rejected: number; dropped_missing?: number; held_back?: number };
type Summary = Counts & { preview?: boolean; datasets?: Record<string, Counts> };
type Staged = { dataset: string; row_no: number; payload: Record<string, string>; outcome: string | null; error: string | null };

const ref = (p: Record<string, string>) => p.student_number ?? p.staff_number ?? p.code ?? p.module_code ?? p.name ?? p.external_id ?? "";
const show = (p: Record<string, string>) => Object.entries(p).filter(([k]) => k !== "external_id").map(([, v]) => v).join(" · ").slice(0, 140);

export default async function ImportRun({ params }: { params: Promise<{ run: string }> }) {
  const { run } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(run)) notFound();
  const { supabase, institutionId } = await requireRole("institution_admin");
  const { data: r } = await supabase.from("integration_runs").select("id, status, label, summary, started_at, finished_at, error, trigger")
    .eq("id", run).eq("institution_id", institutionId).maybeSingle();
  if (!r) notFound();
  const waiting = r.status === "staging";
  const s = (r.summary ?? {}) as Summary;
  const sets = Object.entries(s.datasets ?? {}).filter(([, c]) => c.received > 0);

  // Before confirming: the staged rows (rejected ones, and a few of each kind). After: the kept reasons for rejected rows.
  const [{ data: rejected }, { data: samples }, { data: errors }] = await Promise.all([
    waiting ? supabase.from("integration_staging").select("dataset, row_no, payload, outcome, error").eq("run_id", run).eq("outcome", "reject").order("row_no").limit(200) : Promise.resolve({ data: [] }),
    waiting ? supabase.from("integration_staging").select("dataset, row_no, payload, outcome, error").eq("run_id", run).in("outcome", ["insert", "update", "duplicate"]).order("row_no").limit(400) : Promise.resolve({ data: [] }),
    waiting ? Promise.resolve({ data: [] }) : supabase.from("integration_errors").select("dataset, row_no, ref, message").eq("run_id", run).order("row_no").limit(200),
  ]);
  const rej = (rejected ?? []) as Staged[];
  const some = (kind: string) => ((samples ?? []) as Staged[]).filter((x) => x.outcome === kind).slice(0, 8);
  const [label, tone] = RUN_STATUS[r.status] ?? [r.status, "pending"];
  const nothingToDo = waiting && (s.inserted ?? 0) + (s.updated ?? 0) === 0;

  return (
    <>
      <Link href="/admin/integrations/import" className="text-sm text-info underline underline-offset-2 hover:decoration-2">← Import data</Link>
      <PageHeader title={waiting ? "Check before importing" : "Import report"} subtitle={r.label ?? undefined} action={<Badge status={tone}>{label}</Badge>} />

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Rows in the file" value={(s.received ?? 0).toLocaleString("en-ZA")} />
        <Stat label={waiting ? "Will be added" : "Added"} value={(s.inserted ?? 0).toLocaleString("en-ZA")} />
        <Stat label={waiting ? "Will be updated" : "Updated"} value={(s.updated ?? 0).toLocaleString("en-ZA")} />
        <Stat label="Already up to date" value={(s.unchanged ?? 0).toLocaleString("en-ZA")} />
        <Stat label="Repeated in the file" value={(s.duplicates ?? 0).toLocaleString("en-ZA")} hint={s.duplicates ? "Counted once" : undefined} />
        <Stat label="Rejected" value={(s.rejected ?? 0).toLocaleString("en-ZA")} hint={s.rejected ? "Not imported; see why below" : undefined} />
      </div>

      {r.status === "failed" && r.error && <div className="mb-6"><Notice tone="bad">{r.error}</Notice></div>}
      {r.status === "cancelled" && <div className="mb-6"><Notice tone="info">This import was cancelled. Nothing was changed.</Notice></div>}

      {waiting && (
        <Card className="mb-6">
          <CardTitle>{nothingToDo ? "Nothing to import" : "Confirm the import"}</CardTitle>
          {nothingToDo ? (
            <p className="mb-4 text-sm text-muted">{s.rejected ? "Every row was rejected. Fix the problems below in your file, or change the column matching, and upload again." : "Everything in this file is already in UniAttend."}</p>
          ) : (
            <p className="mb-4 text-sm text-muted">
              {s.inserted ? `${s.inserted.toLocaleString("en-ZA")} will be added` : "Nothing will be added"}{s.updated ? ` and ${s.updated.toLocaleString("en-ZA")} updated` : ""}.
              {s.rejected ? ` ${s.rejected.toLocaleString("en-ZA")} rejected rows are left out; you can fix them and import them later.` : ""} Nothing is ever deleted by an import. It is applied all at once, or not at all.
            </p>
          )}
          <div className="flex flex-wrap items-start gap-4">
            {!nothingToDo && (
              <ActionForm action={confirmImport} submit="Import now" pending="Importing…" className="space-y-3">
                <input type="hidden" name="run" value={run} />
                <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="confirm" className="mt-0.5 size-4" />I have checked the numbers above.</label>
              </ActionForm>
            )}
            <form action={cancelImport}><input type="hidden" name="run" value={run} />
              <button className="h-10 rounded-xl border border-line px-4 text-sm font-medium hover:bg-bg">{nothingToDo ? "Close" : "Cancel, change nothing"}</button></form>
          </div>
        </Card>
      )}

      {sets.length > 1 && (
        <Card className="mb-6">
          <CardTitle>By kind of data</CardTitle>
          <Table head={["Data", "Rows", "Added", "Updated", "Up to date", "Rejected"]}>
            {sets.map(([k, c]) => (
              <tr key={k}><Td className="font-medium">{datasetDef(k)?.label ?? k}</Td><Td>{c.received}</Td><Td>{c.inserted}</Td><Td>{c.updated}</Td><Td>{c.unchanged}</Td><Td>{c.rejected}</Td></tr>
            ))}
          </Table>
        </Card>
      )}

      {(rej.length > 0 || (errors ?? []).length > 0) && (
        <Card className="mb-6">
          <CardTitle action={<a href={`/admin/integrations/import/${run}/errors`} className="text-sm font-medium text-accent">Download as CSV</a>}>
            Rejected rows{(s.rejected ?? 0) > 200 ? " (first 200)" : ""}
          </CardTitle>
          <Table head={["Row", "Record", "Why"]}>
            {waiting
              ? rej.map((x) => <tr key={`${x.dataset}${x.row_no}`}><Td className="text-muted">{x.row_no + 1}</Td><Td className="max-w-72 truncate">{show(x.payload) || "—"}</Td><Td className="text-warn">{x.error}</Td></tr>)
              : (errors ?? []).map((x, i) => <tr key={i}><Td className="text-muted">{(x.row_no ?? 0) + 1}</Td><Td>{x.ref ?? "—"}</Td><Td className="text-warn">{x.message}</Td></tr>)}
          </Table>
          <p className="mt-3 text-xs text-muted">Row numbers are the rows of your file, counting the heading as row 1.</p>
        </Card>
      )}

      {waiting && (["insert", "update", "duplicate"] as const).map((kind) => some(kind).length > 0 && (
        <Card key={kind} className="mb-6">
          <CardTitle>{{ insert: "Examples of what will be added", update: "Examples of what will be updated", duplicate: "Repeated in the file" }[kind]}</CardTitle>
          <Table head={["Row", "Record", "Details"]}>
            {some(kind).map((x) => <tr key={`${x.dataset}${x.row_no}`}><Td className="text-muted">{x.row_no + 1}</Td><Td className="font-medium">{ref(x.payload)}</Td><Td className="max-w-96 truncate text-muted">{show(x.payload)}</Td></tr>)}
          </Table>
        </Card>
      ))}
    </>
  );
}
