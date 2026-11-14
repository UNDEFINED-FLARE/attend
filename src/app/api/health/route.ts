import { createClient } from "@supabase/supabase-js";
import { DB_SCHEMA, env } from "@/lib/env";

// For an uptime monitor (e.g. UptimeRobot, every 5 minutes): 200 when the app and
// its database answer, 503 when the database doesn't. Reveals nothing private.
export const dynamic = "force-dynamic";

export async function GET() {
  const started = Date.now();
  let db: "ok" | "down" = "down";
  try {
    const supabase = createClient(env.url, env.anonKey, { db: { schema: DB_SCHEMA }, auth: { persistSession: false, autoRefreshToken: false } });
    // A tiny public query (unknown institution → null): proves the API and database answer.
    const { error } = await Promise.race([
      supabase.rpc("public_branding", { p_key: "health-check" }),
      new Promise<{ error: Error }>((r) => setTimeout(() => r({ error: new Error("timeout") }), 5000)),
    ]);
    // Answered (even "function missing" before migration 0019 means the database is up); only a timeout or a network failure is "down".
    if (!error || (error as { code?: string }).code === "PGRST202") db = "ok";
  } catch { /* reported as down */ }
  const body = { status: db === "ok" ? "ok" : "degraded", database: db, ms: Date.now() - started, time: new Date().toISOString() };
  return Response.json(body, { status: db === "ok" ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
