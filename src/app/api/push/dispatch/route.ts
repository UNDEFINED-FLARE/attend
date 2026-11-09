import { dispatchPush, pushConfigured, secretMatches } from "@/lib/push";

// Called every minute by pg_cron (supabase/push-schedule.sql) to send class
// reminders and anything else queued. Protected by the shared dispatch secret.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function handle(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  if (!secretMatches(auth.replace(/^Bearer\s+/i, ""))) return Response.json({ error: "not allowed" }, { status: 401 });
  if (!pushConfigured()) return Response.json({ error: "push is not configured" }, { status: 503 });
  try {
    return Response.json(await dispatchPush());
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}

export const POST = handle;
export const GET = handle;
