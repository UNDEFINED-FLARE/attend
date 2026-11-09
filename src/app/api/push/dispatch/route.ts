import { dispatchPush, missingPushSettings, pushConfigured, secretMatches } from "@/lib/push";

// Called every minute by pg_cron (supabase/push-schedule.sql) to send class
// reminders and anything else queued. Protected by the shared dispatch secret.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function handle(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  // Say which settings are missing (names only) so a half-finished setup is easy to spot.
  const missing = missingPushSettings();
  if (missing.includes("PUSH_DISPATCH_SECRET")) return Response.json({ error: "not configured on the server", missing }, { status: 503 });
  if (!secretMatches(auth.replace(/^Bearer\s+/i, ""))) return Response.json({ error: "not allowed" }, { status: 401 });
  if (!pushConfigured()) return Response.json({ error: "not configured on the server", missing }, { status: 503 });
  try {
    return Response.json(await dispatchPush());
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}

export const POST = handle;
export const GET = handle;
