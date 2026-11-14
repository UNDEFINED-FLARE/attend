import Link from "next/link";
import { Badge, Card, Notice, PageHeader, Table, Td } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { RUN_STATUS } from "@/lib/integrations/datasets";
import { runCounts } from "@/lib/integrations/providers";

export const metadata = { title: "Sync activity" };

type Run = { id: string; integration_id: string | null; trigger: string; status: string; summary: Record<string, unknown> | null;
  label: string | null; started_at: string; finished_at: string | null; error: string | null };
const TRIGGER: Record<string, string> = { schedule: "Scheduled", manual: "Sync now", api: "Sent by your system", upload: "File import", retry: "Retry" };
const at = (iso: string) => new Date(iso).toLocaleString("en-ZA", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Johannesburg" });
const took = (a: string, b: string | null) => {
  if (!b) return "—";
  const s = Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 1000));
  return s < 60 ? `${s} s` : s < 3600 ? `${Math.round(s / 60)} min` : `${(s / 3600).toFixed(1)} h`;
};
const PAGE = 50;

export default async function Activity({ searchParams }: { searchParams: Promise<{ status?: string; source?: string; page?: string }> }) {
  const { status = "", source = "", page = "1" } = await searchParams;
  const pg = Math.max(1, Number(page) || 1);
  const { supabase, institutionId } = await requireRole("institution_admin");
  let q = supabase.from("integration_runs").select("id, integration_id, trigger, status, summary, label, started_at, finished_at, error", { count: "exact" })
    .eq("institution_id", institutionId).order("started_at", { ascending: false }).range((pg - 1) * PAGE, pg * PAGE - 1);
  if (status) q = q.eq("status", status);
  if (source === "upload") q = q.is("integration_id", null);
  else if (source) q = q.eq("integration_id", source);
  const [{ data, count, error }, { data: conns }] = await Promise.all([
    q, supabase.from("integrations").select("id, name").eq("institution_id", institutionId).order("name"),
  ]);
  const runs = (data ?? []) as Run[];
  const nameOf = new Map((conns ?? []).map((c) => [c.id as string, c.name as string]));
  const pages = Math.max(1, Math.ceil((count ?? 0) / PAGE));
  const link = (p: Record<string, string | number>) => `/admin/integrations/activity?${new URLSearchParams({ status, source, page: String(pg), ...Object.fromEntries(Object.entries(p).map(([k, v]) => [k, String(v)])) })}`;

  return (
    <>
      <Link href="/admin/integrations" className="text-sm text-info hover:underline">← Integration Centre</Link>
      <PageHeader title="Sync activity" subtitle="Every sync and import: what came in, what changed, what was rejected and why." />
      {error && <div className="mb-6"><Notice tone="warn">Activity needs the latest database updates (migrations 0024 and 0025).</Notice></div>}

      <form className="mb-4 flex flex-wrap gap-2" role="search">
        <select name="source" defaultValue={source} aria-label="Source" className="h-10 rounded-xl border border-line bg-surface px-3 text-sm">
          <option value="">All sources</option><option value="upload">File imports</option>
          {(conns ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select name="status" defaultValue={status} aria-label="Status" className="h-10 rounded-xl border border-line bg-surface px-3 text-sm">
          <option value="">Any status</option>{Object.entries(RUN_STATUS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <button className="h-10 rounded-xl border border-line px-3 text-sm font-medium hover:bg-bg">Filter</button>
      </form>

      <Card>
        <Table head={["Source", "How", "Started", "Took", "Received", "Added", "Updated", "Rejected", "Status", ""]} empty="No syncs yet.">
          {runs.map((r) => {
            const c = runCounts(r.summary);
            const [label, tone] = RUN_STATUS[r.status] ?? [r.status, "pending"];
            return (
              <tr key={r.id}>
                <Td className="max-w-52 truncate font-medium">{r.integration_id ? nameOf.get(r.integration_id) ?? "Removed connection" : r.label?.split(" · ")[0] ?? "File"}</Td>
                <Td className="whitespace-nowrap text-muted">{TRIGGER[r.trigger] ?? r.trigger}</Td>
                <Td className="whitespace-nowrap">{at(r.started_at)}</Td>
                <Td className="text-muted">{took(r.started_at, r.finished_at)}</Td>
                <Td>{c.received || "—"}</Td><Td>{c.inserted}</Td><Td>{c.updated}</Td>
                <Td className={c.rejected ? "font-semibold text-warn" : ""}>{c.rejected}</Td>
                <Td><Badge status={tone}>{label}</Badge></Td>
                <Td><Link href={r.integration_id ? `/admin/integrations/activity/${r.id}` : `/admin/integrations/import/${r.id}`} className="font-medium text-accent">Details</Link></Td>
              </tr>
            );
          })}
        </Table>
        {pages > 1 && (
          <div className="mt-4 flex items-center justify-between text-sm">
            <span className="text-muted">Page {pg} of {pages}</span>
            <span className="flex gap-3">
              {pg > 1 && <Link href={link({ page: pg - 1 })} className="font-medium text-accent">← Newer</Link>}
              {pg < pages && <Link href={link({ page: pg + 1 })} className="font-medium text-accent">Older →</Link>}
            </span>
          </div>
        )}
      </Card>
    </>
  );
}
