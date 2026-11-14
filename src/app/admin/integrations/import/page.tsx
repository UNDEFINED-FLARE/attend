import Link from "next/link";
import { Badge, Card, CardTitle, Notice, PageHeader, Table, Td } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { datasetDef, RUN_STATUS } from "@/lib/integrations/datasets";
import { deleteMapping } from "./actions";
import { ImportWizard } from "./import-wizard";

export const metadata = { title: "Import data" };

type Run = { id: string; status: string; label: string | null; summary: Record<string, number> | null; started_at: string; finished_at: string | null; error: string | null };
const at = (iso: string) => new Date(iso).toLocaleString("en-ZA", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Johannesburg" });

export default async function ImportCentre() {
  const { supabase, institutionId } = await requireRole("institution_admin");
  const [{ data: runs, error }, { data: maps }] = await Promise.all([
    supabase.from("integration_runs").select("id, status, label, summary, started_at, finished_at, error")
      .eq("institution_id", institutionId).eq("trigger", "upload").order("started_at", { ascending: false }).limit(15),
    supabase.from("integration_mappings").select("dataset, name, updated_at").eq("institution_id", institutionId).order("dataset").order("name"),
  ]);
  const list = (runs ?? []) as Run[];
  const waiting = list.filter((r) => r.status === "staging");

  return (
    <>
      <PageHeader title="Import data"
        subtitle="Load students, lecturers, modules, enrolments and your academic structure from a file. You match the columns once, see exactly what will change, then confirm."
        action={<Link href="/admin/connections" className="text-sm font-medium text-accent">Automatic connections →</Link>} />
      {error && <div className="mb-6"><Notice tone="warn">The Import Centre needs the latest database updates (migrations 0025 and 0026).</Notice></div>}

      {waiting.length > 0 && (
        <div className="mb-6 space-y-2">
          {waiting.map((r) => (
            <Notice key={r.id} tone="warn">
              <b>{r.label || "An import"}</b> was checked on {at(r.started_at)} and is waiting for you.{" "}
              <Link href={`/admin/integrations/import/${r.id}`} className="font-semibold underline">Review and confirm</Link>
            </Notice>
          ))}
        </div>
      )}

      <Card className="mb-6"><CardTitle>New import</CardTitle><ImportWizard /></Card>

      <div className="grid gap-6 xl:grid-cols-[2fr_1fr]">
        <Card>
          <CardTitle>Recent imports</CardTitle>
          <Table head={["File", "When", "New", "Updated", "Rejected", "Status", ""]} empty="No imports yet.">
            {list.map((r) => {
              const [label, tone] = RUN_STATUS[r.status] ?? [r.status, "pending"];
              return (
                <tr key={r.id}>
                  <Td className="max-w-64 truncate">{r.label || "File"}</Td>
                  <Td className="whitespace-nowrap text-muted">{at(r.started_at)}</Td>
                  <Td>{r.summary?.inserted ?? "—"}</Td><Td>{r.summary?.updated ?? "—"}</Td>
                  <Td className={r.summary?.rejected ? "font-semibold text-warn" : ""}>{r.summary?.rejected ?? "—"}</Td>
                  <Td><Badge status={tone}>{label}</Badge></Td>
                  <Td><Link href={`/admin/integrations/import/${r.id}`} className="font-medium text-accent">{r.status === "staging" ? "Review" : "Report"}</Link></Td>
                </tr>
              );
            })}
          </Table>
        </Card>

        <Card>
          <CardTitle>Saved column matchings</CardTitle>
          {(maps ?? []).length === 0 ? <p className="text-sm text-muted">When you name a matching during an import, it appears here for next time.</p> : (
            <ul className="space-y-2 text-sm">
              {(maps ?? []).map((m) => (
                <li key={`${m.dataset}|${m.name}`} className="flex items-center justify-between gap-2 rounded-xl border border-line p-2.5">
                  <span className="min-w-0"><span className="block truncate font-medium">{m.name}</span><span className="text-xs text-muted">{datasetDef(m.dataset)?.label ?? m.dataset}</span></span>
                  <form action={deleteMapping}><input type="hidden" name="dataset" value={m.dataset} /><input type="hidden" name="name" value={m.name} />
                    <button className="text-xs font-medium text-bad">Remove</button></form>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
