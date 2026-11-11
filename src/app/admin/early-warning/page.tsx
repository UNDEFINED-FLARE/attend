import Link from "next/link";
import { recheckAlerts, saveAlertSettings } from "@/app/early-warning-actions";
import { EarlyWarningList, loadAlerts } from "@/components/early-warning";
import { ActionForm } from "@/components/form";
import { Card, CardTitle, Field, Input, Notice, PageHeader, Stat } from "@/components/ui";
import { requireRole } from "@/lib/auth";

export const metadata = { title: "Early warning" };

export default async function AdminEarlyWarning({ searchParams }: { searchParams: Promise<{ show?: string; open?: string }> }) {
  const sp = await searchParams;
  const show = sp.show === "closed" ? "closed" : "live";
  const { supabase, institutionId, user } = await requireRole("institution_admin");
  const [{ alerts, missing }, { data: s }] = await Promise.all([
    loadAlerts(supabase, institutionId, false),
    supabase.from("institution_settings").select("*").eq("institution_id", institutionId).single(),
  ]);
  if (missing || !s || s.alerts_enabled === undefined) {
    return <Notice tone="warn">Early warning needs database update 0015. Run it in the Supabase SQL editor, then reload.</Notice>;
  }

  const live = alerts.filter((a) => a.status === "open" || a.status === "contacted");
  const closed = alerts.filter((a) => a.status === "resolved" || a.status === "dismissed");
  const monthAgo = Date.now() - 30 * 86_400_000;
  const closedThisMonth = closed.filter((a) => new Date(a.updated_at).getTime() >= monthAgo).length;
  const tab = (key: "live" | "closed", label: string, n: number) => (
    <Link href={key === "live" ? "/admin/early-warning" : "/admin/early-warning?show=closed"} aria-current={show === key ? "page" : undefined}
      className={`rounded-lg px-3 py-1.5 text-sm font-medium ${show === key ? "bg-brand text-brand-ink" : "text-muted hover:bg-black/5"}`}>
      {label} ({n})
    </Link>
  );

  return (
    <>
      <PageHeader title="Early warning"
        subtitle="Students whose attendance needs follow-up. Alerts open by themselves when attendance falls below the requirement or a student misses classes in a row, and close by themselves when it improves."
        action={<ActionForm action={recheckAlerts} submit="Re-check now" pending="Checking…" className="flex flex-col items-end gap-2">{null}</ActionForm>} />

      {!s.alerts_enabled && <div className="mb-4"><Notice tone="warn">Early warning is off, so no new alerts open. Turn it on below.</Notice></div>}

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Open" value={live.filter((a) => a.status === "open").length} hint="Not followed up yet" />
        <Stat label="Contacted" value={live.filter((a) => a.status === "contacted").length} hint="Waiting to be resolved" />
        <Stat label="Low attendance" value={live.filter((a) => a.kind === "low_attendance").length} hint={`Below the required ${s.min_attendance_pct}%`} />
        <Stat label="Closed in 30 days" value={closedThisMonth} hint="Resolved, dismissed or recovered" />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <nav aria-label="Alert list" className="mb-3 flex gap-2">{tab("live", "Needs follow-up", live.length)}{tab("closed", "Closed", closed.length)}</nav>
          <EarlyWarningList supabase={supabase} alerts={show === "live" ? live : closed} me={user.id}
            basePath="/admin/early-warning" openId={sp.open} show={show} />
        </div>
        <Card className="h-fit">
          <CardTitle>When to raise an alert</CardTitle>
          <ActionForm action={saveAlertSettings} submit="Save and re-check">
            <label className="flex items-start gap-3 rounded-lg border border-line p-3">
              <input type="checkbox" name="alerts_enabled" defaultChecked={s.alerts_enabled} className="mt-1 size-4" />
              <span>
                <span className="block text-sm font-medium">Early warning on</span>
                <span className="text-xs text-muted">Students and their lecturers are notified when an alert opens.</span>
              </span>
            </label>
            <Field label="Judge attendance after (classes)" hint="No low-attendance alert until a student has this many classes counted.">
              <Input name="alert_min_sessions" type="number" min={1} max={50} defaultValue={s.alert_min_sessions} />
            </Field>
            <Field label="Missed in a row (classes)" hint="Raise an alert after this many absences in a row in one module.">
              <Input name="alert_consecutive_absences" type="number" min={2} max={20} defaultValue={s.alert_consecutive_absences} />
            </Field>
            <p className="text-xs text-muted">
              The required attendance ({s.min_attendance_pct}%, or a module&apos;s own) is set under <Link href="/admin/settings" className="text-accent">Policy</Link>.
              Excused classes don&apos;t count; records still under review count as missed until resolved.
            </p>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
