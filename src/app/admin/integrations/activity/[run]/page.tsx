import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ActionForm } from "@/components/form";
import { Badge, Card, CardTitle, Notice, PageHeader, Stat, Table, Td } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { datasetDef, RUN_STATUS } from "@/lib/integrations/datasets";
import { runCounts } from "@/lib/integrations/providers";
import { retryRun } from "../actions";

export const metadata = { title: "Sync details" };
const at = (iso: string | null) => iso ? new Date(iso).toLocaleString("en-ZA", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Africa/Johannesburg" }) : "—";

/** One connection's sync: counts per kind of data, rejected rows with reasons, checkpoints, and a retry. No source data or credentials are shown. */
export default async function RunDetail({ params }: { params: Promise<{ run: string }> }) {
  const { run } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(run)) notFound();
  const { supabase, institutionId } = await requireRole("institution_admin");
  const { data: r } = await supabase.from("integration_runs").select("*").eq("id", run).eq("institution_id", institutionId).maybeSingle();
  if (!r) notFound();
  if (!r.integration_id) redirect(`/admin/integrations/import/${run}`);
  const [{ data: conn }, { data: errs }] = await Promise.all([
    supabase.from("integrations").select("name, kind").eq("id", r.integration_id).maybeSingle(),
    supabase.from("integration_errors").select("dataset, row_no, ref, message").eq("run_id", run).order("row_no").limit(200),
  ]);
  const summary = (r.summary ?? {}) as Record<string, unknown> & { datasets?: Record<string, Record<string, number>> };
  const c = runCounts(summary);
  const [label, tone] = RUN_STATUS[r.status] ?? [r.status, "pending"];
  // Older roster syncs keep their rejected rows in the run itself.
  const rosterErrors = (Array.isArray(r.errors) ? r.errors : []) as { who: string; error: string }[];
  const unknown = (Array.isArray(r.unknown_modules) ? r.unknown_modules : []) as string[];
  const checkpoints = Object.entries((r.checkpoints ?? {}) as Record<string, string>);

  return (
    <>
      <Link href="/admin/integrations/activity" className="text-sm text-info hover:underline">← Sync activity</Link>
      <PageHeader title={conn?.name ?? "Removed connection"} subtitle={`Reference ${run}`} action={<Badge status={tone}>{label}</Badge>} />

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Received" value={c.received.toLocaleString("en-ZA")} />
        <Stat label="Added" value={c.inserted.toLocaleString("en-ZA")} />
        <Stat label="Updated" value={c.updated.toLocaleString("en-ZA")} />
        <Stat label="Rejected" value={c.rejected.toLocaleString("en-ZA")} />
      </div>

      {r.error && <div className="mb-6"><Notice tone="bad">{r.error}</Notice></div>}
      {Number(summary.held_back ?? 0) > 0 && (
        <div className="mb-6"><Notice tone="warn">{String(summary.held_back)} enrolments were missing at the source. They were left in place, because removing that many at once usually means the source was incomplete.</Notice></div>
      )}

      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardTitle>Run</CardTitle>
          <dl className="grid grid-cols-[9rem_1fr] gap-y-1 text-sm">
            <dt className="text-muted">Started</dt><dd>{at(r.started_at)}</dd>
            <dt className="text-muted">Finished</dt><dd>{at(r.finished_at)}</dd>
            <dt className="text-muted">Started by</dt><dd>{{ schedule: "Schedule", manual: "Sync now", api: "Your system", retry: "Retry", upload: "File import" }[r.trigger as string] ?? r.trigger}</dd>
            <dt className="text-muted">Mode</dt><dd>{r.mode === "incremental" ? "Changes since last time" : "Full"}{r.complete ? " · complete roster" : ""}</dd>
            {checkpoints.flatMap(([k, v]) => [
              <dt key={`${k}-t`} className="text-muted">Checkpoint: {datasetDef(k)?.label ?? k}</dt>,
              <dd key={`${k}-d`} className="break-all font-mono text-xs">{v}</dd>,
            ])}
          </dl>
        </Card>
        {(r.status === "failed" || r.status === "cancelled" || r.status === "warnings") && conn?.kind !== "api" && (
          <Card>
            <CardTitle>Try again</CardTitle>
            <p className="mb-3 text-sm text-muted">Runs the connection again now. It is safe to repeat: nothing is added twice.</p>
            <ActionForm action={retryRun} submit="Retry now" pending="Starting…"><input type="hidden" name="run" value={run} /></ActionForm>
          </Card>
        )}
      </div>

      {summary.datasets && (
        <Card className="mb-6">
          <CardTitle>By kind of data</CardTitle>
          <Table head={["Data", "Received", "Added", "Updated", "Up to date", "Rejected"]}>
            {Object.entries(summary.datasets).filter(([, d]) => d.received > 0).map(([k, d]) => (
              <tr key={k}><Td className="font-medium">{datasetDef(k)?.label ?? k}</Td><Td>{d.received}</Td><Td>{d.inserted}</Td><Td>{d.updated}</Td><Td>{d.unchanged}</Td><Td>{d.rejected}</Td></tr>
            ))}
          </Table>
        </Card>
      )}

      {unknown.length > 0 && <div className="mb-6"><Notice tone="warn">Module codes at the source that aren&apos;t in UniAttend (their people were not loaded): {unknown.join(", ")}.</Notice></div>}

      {((errs ?? []).length > 0 || rosterErrors.length > 0) && (
        <Card>
          <CardTitle>Rejected rows</CardTitle>
          <Table head={["Row", "Record", "Why"]}>
            {(errs ?? []).map((e, i) => <tr key={`e${i}`}><Td className="text-muted">{e.row_no ?? "—"}</Td><Td>{e.ref ?? "—"}</Td><Td className="text-warn">{e.message}</Td></tr>)}
            {rosterErrors.map((e, i) => <tr key={`r${i}`}><Td className="text-muted">—</Td><Td>{e.who}</Td><Td className="text-warn">{e.error}</Td></tr>)}
          </Table>
        </Card>
      )}
    </>
  );
}
