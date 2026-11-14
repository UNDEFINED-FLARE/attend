import Link from "next/link";
import { Badge, Card, CardTitle, Input, Notice, PageHeader, Stat } from "@/components/ui";
import { Icon } from "@/components/icons";
import { requireRole } from "@/lib/auth";
import { isStale, METHODS, PROVIDERS, providerOf, runCounts } from "@/lib/integrations/providers";

export const metadata = { title: "Integration Centre" };

type Conn = { id: string; kind: string; name: string; status: string; schedule: string; options: Record<string, unknown>; connection_status?: string;
  last_run_at: string | null; last_status: string | null; last_success_at?: string | null; last_summary: Record<string, unknown> | null;
  last_test_message?: string | null; next_run_at: string; created_at: string };
type Run = { integration_id: string | null; trigger: string; status: string; summary: Record<string, unknown> | null; started_at: string };

const CONN: Record<string, [string, string]> = {
  connected: ["Connected", "active"], not_configured: ["Not tested", "pending"], incomplete: ["Incomplete", "pending"], testing: ["Testing", "pending"],
  auth_failed: ["Sign-in failed", "absent"], connection_failed: ["Can't connect", "absent"], permission_denied: ["Permission denied", "absent"],
  unavailable: ["Unavailable", "late"], suspended: ["Paused", "closed"],
};
const at = (iso: string | null | undefined) => iso ? new Date(iso).toLocaleString("en-ZA", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Johannesburg" }) : "never";
const num = (n: number) => n.toLocaleString("en-ZA");

export default async function IntegrationCentre({ searchParams }: { searchParams: Promise<{ q?: string; cat?: string }> }) {
  const { q = "", cat = "" } = await searchParams;
  const { supabase, institutionId } = await requireRole("institution_admin");
  const since = new Date(Date.now() - 30 * 86400_000).toISOString();
  const [{ data: conns, error }, { data: runs }, { count: pending }, { count: errors }] = await Promise.all([
    supabase.from("integrations").select("*").eq("institution_id", institutionId).order("created_at"),
    supabase.from("integration_runs").select("integration_id, trigger, status, summary, started_at").eq("institution_id", institutionId).gte("started_at", since).order("started_at", { ascending: false }).limit(1000),
    supabase.from("integration_runs").select("id", { count: "exact", head: true }).eq("institution_id", institutionId).eq("status", "staging"),
    supabase.from("integration_errors").select("id", { count: "exact", head: true }).eq("institution_id", institutionId).gte("created_at", since),
  ]);
  const list = (conns ?? []) as Conn[];
  const recent = (runs ?? []) as Run[];

  // Every figure below comes from the institution's own records.
  const connected = list.filter((c) => c.status === "active" && (c.kind === "api" ? !!c.last_success_at || !!c.last_run_at : c.connection_status === "connected")).length;
  const lastSuccess = list.map((c) => c.last_success_at).filter(Boolean).sort().at(-1) ?? null;
  const failed = recent.filter((r) => r.status === "failed").length;
  const synced = recent.filter((r) => r.status === "ok" || r.status === "warnings").reduce((t, r) => { const c = runCounts(r.summary); return t + c.inserted + c.updated; }, 0);
  const needsLook = list.filter((c) => c.status === "active" && (c.last_status === "failed" || ["auth_failed", "connection_failed", "permission_denied"].includes(c.connection_status ?? "")
    || isStale(c.schedule, c.status, c.last_success_at ?? null, c.created_at)));

  const term = q.trim().toLowerCase();
  const shown = PROVIDERS.filter((p) => (!cat || p.category === cat) && (!term || `${p.name} ${p.vendor ?? ""} ${p.category} ${p.about} ${p.data.join(" ")}`.toLowerCase().includes(term)));
  const cats = [...new Set(PROVIDERS.map((p) => p.category))];

  return (
    <>
      <PageHeader title="Integration Centre"
        subtitle="Connect UniAttend to your university's systems, so students, lecturers, modules and enrolments stay up to date without typing them in twice." />
      {error && <div className="mb-6"><Notice tone="warn">The Integration Centre needs the latest database updates (migrations 0024 to 0026).</Notice></div>}

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        <Stat label="Connected systems" value={num(connected)} hint={list.length > connected ? `${list.length} set up` : undefined} />
        <Stat label="Available integrations" value={num(PROVIDERS.filter((p) => p.methods.length).length)} />
        <Stat label="Last successful sync" value={<span className="text-base">{lastSuccess ? at(lastSuccess) : "None yet"}</span>} />
        <Stat label="Failed syncs" value={num(failed)} hint="Last 30 days" />
        <Stat label="Records synchronised" value={num(synced)} hint="Added or updated, last 30 days" />
        <Stat label="Imports waiting" value={num(pending ?? 0)} hint={pending ? "Need your confirmation" : undefined} />
        <Stat label="Rejected rows" value={num(errors ?? 0)} hint="Last 30 days" />
      </div>

      {needsLook.length > 0 && (
        <div className="mb-6 space-y-2">
          {needsLook.map((c) => (
            <Notice key={c.id} tone="bad">
              <b>{c.name}</b>: {c.last_status === "failed" ? `the last sync failed${typeof c.last_summary?.error === "string" ? ` (${c.last_summary.error})` : ""}.`
                : ["auth_failed", "connection_failed", "permission_denied"].includes(c.connection_status ?? "") ? `${CONN[c.connection_status!][0].toLowerCase()}${c.last_test_message ? `: ${c.last_test_message}` : "."}`
                : `no successful sync since ${at(c.last_success_at ?? c.created_at)}.`}{" "}
              <Link href="/admin/connections" className="font-semibold underline">Check it</Link>
            </Notice>
          ))}
        </div>
      )}

      <div className="mb-8 grid gap-6 lg:grid-cols-[1fr_auto]">
        <Card>
          <CardTitle action={<span className="flex gap-3 text-sm font-medium"><Link href="/admin/integrations/activity" className="text-accent">Activity</Link><Link href="/admin/connections" className="text-accent">Manage</Link></span>}>
            Your connections
          </CardTitle>
          {list.length === 0 ? (
            <p className="text-sm text-muted">Nothing connected yet. Choose a system below, or <Link href="/admin/integrations/import" className="text-accent underline">import a file</Link>.</p>
          ) : (
            <ul className="divide-y divide-line">
              {list.map((c) => {
                const p = providerOf(c.kind, c.options);
                const [label, tone] = c.kind === "api" ? (c.last_run_at ? ["Receiving", "active"] : ["Waiting for first roster", "pending"]) : CONN[c.connection_status ?? "not_configured"] ?? [c.connection_status, "pending"];
                const counts = runCounts(c.last_summary);
                return (
                  <li key={c.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3 text-sm">
                    <span className="min-w-0 flex-1"><span className="block font-semibold">{c.name}</span>
                      <span className="text-xs text-muted">{p?.name ?? "Connection"} · {c.kind === "api" ? METHODS.api.label : c.kind === "feed" ? METHODS.feed.label : METHODS.moodle.label}</span></span>
                    <span className="text-xs text-muted">Last success: {at(c.last_success_at)}</span>
                    <span className="text-xs text-muted">{c.status === "paused" ? "Paused" : c.kind === "api" || c.schedule === "manual" ? "Runs on demand" : `Next: ${at(c.next_run_at)}`}</span>
                    {c.last_run_at && <span className="text-xs text-muted">{num(counts.inserted)} added · {num(counts.updated)} updated · {num(counts.rejected)} rejected</span>}
                    <Badge status={c.status === "paused" ? "closed" : tone}>{c.status === "paused" ? "Paused" : label}</Badge>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
        <Card className="lg:w-72">
          <CardTitle>Quick actions</CardTitle>
          <div className="space-y-2 text-sm">
            <Link href="/admin/integrations/import" className="flex items-center gap-2 rounded-xl border border-line p-3 font-medium hover:bg-bg"><Icon name="file" size={18} />Import a file</Link>
            <Link href="/admin/integrations/activity" className="flex items-center gap-2 rounded-xl border border-line p-3 font-medium hover:bg-bg"><Icon name="history" size={18} />See all sync activity</Link>
            <Link href="/admin/connections" className="flex items-center gap-2 rounded-xl border border-line p-3 font-medium hover:bg-bg"><Icon name="settings" size={18} />Manage connections</Link>
          </div>
        </Card>
      </div>

      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div><h2 className="text-lg font-semibold">Systems you can connect</h2><p className="text-sm text-muted">What each one can bring in today, and what it would still need.</p></div>
        <form className="flex flex-wrap gap-2" role="search">
          <Input name="q" defaultValue={q} placeholder="Search systems" aria-label="Search systems" className="h-10 w-48" />
          <select name="cat" defaultValue={cat} aria-label="Category" className="h-10 rounded-xl border border-line bg-surface px-3 text-sm">
            <option value="">All kinds</option>{cats.map((c) => <option key={c}>{c}</option>)}
          </select>
          <button className="h-10 rounded-xl border border-line px-3 text-sm font-medium hover:bg-bg">Filter</button>
        </form>
      </div>
      {shown.length === 0 && <Card><p className="text-sm text-muted">No systems match. <Link href="/admin/integrations" className="text-accent underline">Show all</Link></p></Card>}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {shown.map((p) => {
          const mine = list.filter((c) => providerOf(c.kind, c.options)?.key === p.key);
          return (
            <Card key={p.key} className="flex flex-col">
              <div className="mb-2 flex items-start justify-between gap-2">
                <div><p className="font-semibold">{p.name}</p><p className="text-xs text-muted">{p.vendor ? `${p.vendor} · ` : ""}{p.category}</p></div>
                {mine.length > 0 ? <Badge status="active">{mine.length} set up</Badge> : p.methods.length ? <Badge status="pending">Available</Badge> : <Badge status="closed">Not yet</Badge>}
              </div>
              <p className="mb-3 text-sm text-muted">{p.about}</p>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Data</p>
              <p className="mb-3 text-sm">{p.data.join(" · ")}</p>
              {p.methods.length > 0 && (<><p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">How</p>
                <p className="mb-3 text-sm">{p.methods.map((m) => METHODS[m].label).join(" · ")}</p></>)}
              {p.notYet && <p className="mb-3 rounded-xl bg-bg p-2.5 text-xs text-muted"><b className="text-ink">Not yet:</b> {p.notYet}</p>}
              <div className="mt-auto flex flex-wrap items-center gap-3 pt-1">
                {p.methods.length > 0 && <Link href={`/admin/integrations/connect?provider=${p.key}`} className="inline-flex h-10 items-center rounded-xl bg-brand px-4 text-sm font-semibold text-brand-ink">Set up</Link>}
                {p.docs && <a href={p.docs} className="text-sm font-medium text-accent" target={p.docs.startsWith("http") ? "_blank" : undefined} rel="noopener noreferrer">Documentation</a>}
              </div>
            </Card>
          );
        })}
      </div>
    </>
  );
}
