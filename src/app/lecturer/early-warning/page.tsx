import { FeatureOff } from "@/components/feature-off";
import { loadTheme } from "@/lib/shell-data";
import Link from "next/link";
import { EarlyWarningList, loadAlerts } from "@/components/early-warning";
import { Notice, PageHeader } from "@/components/ui";
import { requireRole } from "@/lib/auth";

export const metadata = { title: "Early warning" };

export default async function LecturerEarlyWarning({ searchParams }: { searchParams: Promise<{ show?: string; open?: string }> }) {
  const sp = await searchParams;
  const show = sp.show === "closed" ? "closed" : "live";
  const { supabase, institutionId, user } = await requireRole("lecturer");
  if (!(await loadTheme(supabase, institutionId)).features.earlyWarning) return <FeatureOff name="Early warning" />;
  const { alerts, missing } = await loadAlerts(supabase, institutionId, false);
  if (missing) return <Notice tone="warn">Early warning isn&apos;t set up for your institution yet. Ask your administrator.</Notice>;

  const live = alerts.filter((a) => a.status === "open" || a.status === "contacted");
  const closed = alerts.filter((a) => a.status === "resolved" || a.status === "dismissed");
  const tab = (key: "live" | "closed", label: string, n: number) => (
    <Link href={key === "live" ? "/lecturer/early-warning" : "/lecturer/early-warning?show=closed"} aria-current={show === key ? "page" : undefined}
      className={`rounded-lg px-3 py-1.5 text-sm font-medium ${show === key ? "bg-brand text-brand-ink" : "text-muted hover:bg-black/5"}`}>
      {label} ({n})
    </Link>
  );

  return (
    <>
      <PageHeader title="Early warning"
        subtitle="Students in your modules whose attendance needs follow-up. Contact them, note what you agreed, and resolve the alert. It also closes by itself when their attendance improves." />
      <nav aria-label="Alert list" className="mb-3 flex gap-2">{tab("live", "Needs follow-up", live.length)}{tab("closed", "Closed", closed.length)}</nav>
      <div className="max-w-3xl">
        <EarlyWarningList supabase={supabase} alerts={show === "live" ? live : closed} me={user.id}
          basePath="/lecturer/early-warning" openId={sp.open} show={show} />
      </div>
    </>
  );
}
