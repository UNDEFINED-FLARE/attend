import Link from "next/link";
import { redirect } from "next/navigation";
import { ConnectionForm } from "@/app/admin/connections/connection-forms";
import { Card, CardTitle, Notice, PageHeader } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { METHODS, PROVIDERS, providerDef, type MethodKey } from "@/lib/integrations/providers";
import { encryptionReady } from "@/lib/integrations/secrets";
import { dispatchSecret } from "@/lib/push";

export const metadata = { title: "Set up a connection" };

const STEPS = ["System", "Method", "Configure and test", "Data and schedule"];

/**
 * The setup wizard. Steps 1 and 2 are choices in the address (?provider=&method=),
 * so the back button works; steps 3 and 4 are the connection form, which tests the
 * connection for real before saving and then starts the first sync.
 */
export default async function Connect({ searchParams }: { searchParams: Promise<{ provider?: string; method?: string }> }) {
  const { provider: pk, method: mk } = await searchParams;
  const { current } = await requireRole("institution_admin");
  const p = providerDef(pk);
  const method = p && mk && (p.methods as string[]).includes(mk) ? (mk as MethodKey) : null;
  if (p && method === "upload") redirect("/admin/integrations/import");
  const step = !p ? 0 : !method ? 1 : 2;
  const kind = method ? METHODS[method].kind : undefined;

  return (
    <>
      <Link href="/admin/integrations" className="text-sm text-info hover:underline">← Integration Centre</Link>
      <PageHeader title={p ? `Connect ${p.name}` : "Set up a connection"} subtitle={p?.about} />
      <ol className="mb-6 flex flex-wrap gap-2 text-xs font-semibold">
        {STEPS.map((s, i) => (
          <li key={s} className={`rounded-full px-3 py-1 ${i === step || (step === 2 && i === 3) ? "bg-brand text-brand-ink" : i < step ? "bg-ok/15 text-ok" : "bg-bg text-muted"}`}>{i + 1}. {s}</li>
        ))}
      </ol>
      {current.institution_status !== "active" && <div className="mb-6"><Notice tone="info">You can set this up now. Syncing starts once your institution is approved.</Notice></div>}

      {!p && (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {PROVIDERS.map((x) => (
            <Card key={x.key} className={x.methods.length ? "" : "opacity-70"}>
              <p className="font-semibold">{x.name}</p>
              <p className="mb-3 text-xs text-muted">{x.vendor ? `${x.vendor} · ` : ""}{x.category}</p>
              {x.methods.length
                ? <Link href={`/admin/integrations/connect?provider=${x.key}`} className="text-sm font-semibold text-accent">Choose →</Link>
                : <p className="text-xs text-muted">{x.notYet}</p>}
            </Card>
          ))}
        </div>
      )}

      {p && !method && (
        <div className="space-y-4">
          {p.needs && <Notice tone="info"><b>Before you start:</b> {p.needs}</Notice>}
          <div className="grid gap-3 md:grid-cols-2">
            {p.methods.map((m, i) => (
              <Link key={m} href={`/admin/integrations/connect?provider=${p.key}&method=${m}`} className="rounded-2xl border border-line bg-surface p-4 shadow-card hover:border-accent">
                <p className="font-semibold">{METHODS[m].label}{i === 0 && <span className="ml-2 rounded-full bg-ok/15 px-2 py-0.5 text-xs text-ok">Recommended</span>}</p>
                <p className="mt-1 text-sm text-muted">{METHODS[m].about}</p>
              </Link>
            ))}
          </div>
          {p.notYet && <p className="text-sm text-muted"><b className="text-ink">Not available yet:</b> {p.notYet}</p>}
          <Link href="/admin/integrations/connect" className="text-sm text-accent">← Choose a different system</Link>
        </div>
      )}

      {p && method && kind && (
        <div className="grid gap-6 xl:grid-cols-[2fr_1fr]">
          <Card>
            <CardTitle>{METHODS[method].label}</CardTitle>
            {kind !== "api" && !encryptionReady() && (
              <div className="mb-4"><Notice tone="warn">This server can&apos;t store credentials yet: <code>INTEGRATION_ENCRYPTION_KEY</code> must be set in Vercel first. A link that needs no token can still be added.</Notice></div>
            )}
            {kind !== "api" && !dispatchSecret() && (
              <div className="mb-4"><Notice tone="warn">Scheduled syncs need <code>PUSH_DISPATCH_SECRET</code> on the server. The connection can be saved and tested, but won&apos;t run on a schedule until it is set.</Notice></div>
            )}
            <ConnectionForm preset={{ kind, provider: p.key, name: p.key === "custom" || p.key === "files" ? undefined : p.name }} />
          </Card>
          <div className="space-y-4">
            <Card>
              <CardTitle>What this brings in</CardTitle>
              <ul className="list-disc space-y-1 pl-5 text-sm">{p.data.filter((d) => !/sign-in|registration status|academic|periods|programmes|venues/i.test(d) || kind === "api").map((d) => <li key={d}>{d}</li>)}</ul>
              <p className="mt-3 text-xs text-muted">
                {kind === "moodle" ? "Each Moodle course becomes the module with the same code; students and teachers come with their enrolments."
                  : "The roster carries modules, students, lecturers, enrolments and who teaches what. Faculties, departments, programmes, periods and venues come in through file imports."}
                {" "}Nothing is ever deleted by a sync, and attendance already recorded is never touched.
              </p>
            </Card>
            <Card>
              <CardTitle>What happens next</CardTitle>
              <ol className="list-decimal space-y-1 pl-5 text-sm text-muted">
                {kind === "api" ? <>
                  <li>You get an API key, shown once.</li>
                  <li>Your system posts rosters to UniAttend with it (example on the Connections page).</li>
                  <li>Each roster is applied and recorded in the activity log.</li>
                </> : <>
                  <li>UniAttend signs in to the source and reads it once to test.</li>
                  <li>Only a successful test marks the connection as connected.</li>
                  <li>The first sync starts right away; then on your schedule.</li>
                  <li>Results, rejected rows and failures appear in the activity log; failures notify you.</li>
                </>}
              </ol>
            </Card>
            <Link href={`/admin/integrations/connect?provider=${p.key}`} className="text-sm text-accent">← Choose a different method</Link>
          </div>
        </div>
      )}
    </>
  );
}
