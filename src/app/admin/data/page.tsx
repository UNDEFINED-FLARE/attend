import Link from "next/link";
import { Card, Notice, PageHeader } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { DATA, loadData, PAGE_SIZE, type DataKind } from "@/lib/data-manager";
import { DataTable } from "./data-table";

export const metadata = { title: "Data" };

/** Every record the institution keeps, in one place: search, edit, bulk actions, export, restore. */
export default async function DataPage({ searchParams }: { searchParams: Promise<{ kind?: string; q?: string; show?: string; page?: string }> }) {
  const sp = await searchParams;
  const kind = (sp.kind && sp.kind in DATA ? sp.kind : "students") as DataKind;
  const archived = sp.show === "archived" && DATA[kind].archive;
  const page = Math.max(1, Number(sp.page) || 1);
  const q = (sp.q ?? "").slice(0, 80);
  const { supabase, institutionId } = await requireRole("institution_admin");
  const { rows, count, error } = await loadData(supabase, institutionId, kind, { q, archived, page });
  const pages = Math.max(1, Math.ceil(count / PAGE_SIZE));
  const href = (o: Record<string, string | number | undefined>) => {
    const p = new URLSearchParams({ kind, ...(q ? { q } : {}), ...(archived ? { show: "archived" } : {}), ...Object.fromEntries(Object.entries(o).map(([k, v]) => [k, String(v ?? "")])) });
    for (const [k, v] of [...p.entries()]) if (!v) p.delete(k);
    return `/admin/data?${p}`;
  };

  return (
    <>
      <PageHeader title="Data" subtitle="Every record at your institution: search, edit, delete, restore and export. Records with attendance history are archived, never erased." />
      <nav className="mb-4 flex flex-wrap gap-2" aria-label="Record type">
        {(Object.keys(DATA) as DataKind[]).map((k) => (
          <Link key={k} href={`/admin/data?kind=${k}`} aria-current={k === kind ? "page" : undefined}
            className={`h-10 rounded-full px-4 text-sm font-semibold leading-10 ${k === kind ? "bg-brand text-brand-ink" : "bg-surface text-muted shadow-card"}`}>{DATA[k].label}</Link>
        ))}
      </nav>
      <Card>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <form className="flex min-w-60 flex-1 gap-2" action="/admin/data">
            <input type="hidden" name="kind" value={kind} />
            {archived && <input type="hidden" name="show" value="archived" />}
            <input name="q" defaultValue={q} placeholder={`Search ${DATA[kind].label.toLowerCase()}`} className="h-10 flex-1 rounded-xl border border-line bg-bg px-3 text-sm" />
            <button className="h-10 rounded-xl bg-brand px-4 text-sm font-semibold text-brand-ink">Search</button>
          </form>
          {DATA[kind].archive && (
            <div className="flex rounded-xl bg-bg p-1 text-sm">
              <Link href={href({ show: "", page: "" })} className={`rounded-lg px-3 py-1.5 font-medium ${archived ? "text-muted" : "bg-surface shadow-sm"}`}>Active</Link>
              <Link href={href({ show: "archived", page: "" })} className={`rounded-lg px-3 py-1.5 font-medium ${archived ? "bg-surface shadow-sm" : "text-muted"}`}>Archived</Link>
            </div>
          )}
          <a href={`/admin/data/export?${new URLSearchParams({ kind, ...(q ? { q } : {}), ...(archived ? { show: "archived" } : {}) })}`}
            className="h-10 rounded-xl border border-line px-4 text-sm font-semibold leading-10 hover:bg-bg">Export CSV</a>
        </div>
        {error && <Notice tone="bad">{error}</Notice>}
        <DataTable kind={kind} archived={archived} columns={DATA[kind].columns} rows={rows} singular={DATA[kind].singular} />
        <div className="mt-4 flex items-center justify-between text-sm text-muted">
          <span>{count} {count === 1 ? DATA[kind].singular : DATA[kind].label.toLowerCase()}{q ? ` matching “${q}”` : ""}{archived ? " (archived)" : ""}</span>
          {pages > 1 && (
            <span className="flex items-center gap-2">
              {page > 1 && <Link href={href({ page: page - 1 })} className="rounded-lg border border-line px-3 py-1.5 font-medium text-ink">Previous</Link>}
              <span>Page {page} of {pages}</span>
              {page < pages && <Link href={href({ page: page + 1 })} className="rounded-lg border border-line px-3 py-1.5 font-medium text-ink">Next</Link>}
            </span>
          )}
        </div>
      </Card>
    </>
  );
}
