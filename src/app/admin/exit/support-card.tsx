import { ActionForm } from "@/components/form";
import { Card, CardTitle, Notice, Select, when } from "@/components/ui";
import type { getSession } from "@/lib/auth";
import { grantSupport, revokeSupport } from "./support-actions";

type Sb = NonNullable<Awaited<ReturnType<typeof getSession>>>["supabase"];

/** UniAttend staff see your students and attendance only while you allow it here. */
export async function SupportAccessCard({ supabase, institutionId }: { supabase: Sb; institutionId: string }) {
  const { data, error } = await supabase.from("support_access_grants").select("id, reason, expires_at, revoked_at, created_at")
    .eq("institution_id", institutionId).order("created_at", { ascending: false }).limit(10);
  const now = Date.now();
  const active = (data ?? []).find((g) => !g.revoked_at && Date.parse(g.expires_at) > now);
  return (
    <Card className="mb-6">
      <CardTitle>UniAttend support access</CardTitle>
      {error ? <Notice tone="warn">This needs the latest database update (migration 0034).</Notice> : (
        <>
          <p className="mb-3 text-sm text-muted">UniAttend staff cannot see your students, lecturers or attendance. If you need their help with your data,
            let them in here for a limited time. While access is on they act as an administrator, and everything they do is in your audit log.</p>
          {active ? (
            <div className="space-y-3">
              <Notice tone="warn">UniAttend has access until {when(active.expires_at)}. Reason: {active.reason}</Notice>
              <ActionForm action={revokeSupport} submit="Withdraw access now" pending="…"><span /></ActionForm>
            </div>
          ) : (
            <ActionForm action={grantSupport} submit="Give access" pending="…" className="grid gap-3 sm:grid-cols-[10rem_1fr] [&>button]:sm:w-fit [&>[role]]:sm:col-span-2">
              <Select name="hours" defaultValue="4" aria-label="For how long">
                <option value="1">1 hour</option><option value="4">4 hours</option><option value="24">1 day</option>
                <option value="72">3 days</option><option value="168">7 days</option>
              </Select>
              <input name="reason" required minLength={5} maxLength={500} placeholder="What should UniAttend help with?"
                className="h-10 rounded-xl border border-line bg-surface px-3 text-sm" />
            </ActionForm>
          )}
          {(data ?? []).length > 0 && (
            <ul className="mt-4 space-y-1 text-xs text-muted">
              {(data ?? []).map((g) => (
                <li key={g.id}>{when(g.created_at)}: {g.reason} — {g.revoked_at ? `withdrawn ${when(g.revoked_at)}` : Date.parse(g.expires_at) > now ? `until ${when(g.expires_at)}` : `ended ${when(g.expires_at)}`}</li>
              ))}
            </ul>
          )}
        </>
      )}
    </Card>
  );
}
