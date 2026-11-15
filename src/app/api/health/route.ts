import { createClient } from "@supabase/supabase-js";
import { DB_SCHEMA, env } from "@/lib/env";
import { EXPECTED_SCHEMA } from "@/lib/schema-version";

// For an uptime monitor (e.g. UptimeRobot, every 5 minutes): 200 when the app, its
// database and its background jobs are fine, 503 otherwise. A page loading is not
// proof the platform works, so this also checks that the database has the migrations
// this build needs and that no background job (push delivery, nightly classes,
// retention) has failed or stopped running. Reveals nothing private.
export const dynamic = "force-dynamic";

type Report = { schema: string | null; jobs: { job: string; last_status: string | null; last_run: string | null }[]; failing_jobs: string[] };

export async function GET() {
  const started = Date.now();
  let db: "ok" | "down" = "down";
  let report: Report | null = null;
  try {
    const supabase = createClient(env.url, env.anonKey, { db: { schema: DB_SCHEMA }, auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await Promise.race([
      supabase.rpc("health_report"),
      new Promise<{ data: null; error: Error }>((r) => setTimeout(() => r({ data: null, error: new Error("timeout") }), 5000)),
    ]);
    // Answered (even "function missing" before migration 0028 means the database is up); only a timeout or a network failure is "down".
    if (!error) { db = "ok"; report = data as Report; }
    else if ((error as { code?: string }).code === "PGRST202") db = "ok";
  } catch { /* reported as down */ }

  const problems: string[] = [];
  if (db === "down") problems.push("database not answering");
  if (db === "ok" && (!report?.schema || report.schema < EXPECTED_SCHEMA)) problems.push(`database migrations behind (needs ${EXPECTED_SCHEMA}, has ${report?.schema ?? "unknown"})`);
  for (const j of report?.failing_jobs ?? []) problems.push(`background job ${j} failed or is late`);

  const body = {
    status: problems.length ? "degraded" : "ok",
    database: db,
    schema: { expected: EXPECTED_SCHEMA, actual: report?.schema ?? null },
    jobs: report?.jobs ?? [],
    problems,
    ms: Date.now() - started,
    time: new Date().toISOString(),
  };
  return Response.json(body, { status: problems.length ? 503 : 200, headers: { "Cache-Control": "no-store" } });
}
