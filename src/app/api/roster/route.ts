import { createClient } from "@supabase/supabase-js";
import { DB_SCHEMA, env } from "@/lib/env";
import { rosterFromText } from "@/lib/integrations/roster";

// For an institution's own student system: POST the roster here with the API key
// from Admin → Connections.
//
//   POST /api/roster
//   Authorization: Bearer ua_…
//   Content-Type: application/json   { "complete": true, "modules": [...], "people": [...] }
//            or:  text/csv           role,number,full_name,email,module_code,module_title
//   (CSV: add ?complete=1 when the file is the whole roster.)
//
// The key decides the institution; nothing in the body can choose another one.
// The database checks the key, applies the roster and answers with what changed.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_BYTES = 20 * 1024 * 1024;

export async function POST(req: Request) {
  const key = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!/^ua_[0-9a-f]{48}$/.test(key)) return Response.json({ error: "Send your API key as: Authorization: Bearer ua_…" }, { status: 401 });
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BYTES) return Response.json({ error: "Send at most 20 MB per request." }, { status: 413 });

  let payload: Record<string, unknown>;
  try {
    const text = await req.text();
    if (text.length > MAX_BYTES) return Response.json({ error: "Send at most 20 MB per request." }, { status: 413 });
    const type = req.headers.get("content-type") ?? "";
    const roster = rosterFromText(text, type);
    const complete = /json/i.test(type) || text.trimStart().startsWith("{")
      ? (JSON.parse(text) as { complete?: unknown }).complete === true
      : ["1", "true"].includes(new URL(req.url).searchParams.get("complete") ?? "");
    payload = { ...roster, complete };
  } catch {
    return Response.json({ error: "The roster couldn't be read. Send JSON { modules, people } or CSV with a header row." }, { status: 400 });
  }
  if ((payload.people as unknown[]).length > 20000) return Response.json({ error: "Send at most 20,000 people per request." }, { status: 413 });

  const db = createClient(env.url, env.anonKey, { db: { schema: DB_SCHEMA }, auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await db.rpc("roster_push", { p_key: key, p_payload: payload });
  if (error) {
    const status = error.code === "42501" ? 401 : error.code === "PGRST202" ? 503 : /Too many/.test(error.message) ? 429 : 400;
    return Response.json({ error: error.code === "PGRST202" ? "Roster sync is not set up on this server yet." : error.message }, { status });
  }
  return Response.json({ ok: true, ...(data as object) });
}
