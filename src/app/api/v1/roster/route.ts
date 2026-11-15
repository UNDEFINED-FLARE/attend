import { createHash } from "node:crypto";
import { apiError, apiOk, bearerKey, fromDbError } from "@/lib/api-errors";
import { apiDb, requestId } from "@/lib/api-v1";
import { rosterFromText } from "@/lib/integrations/roster";

// POST /api/v1/roster — an institution's own system sends its roster.
// Documented at /developers. The key decides the institution; nothing in the body can.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_BYTES = 20 * 1024 * 1024;

export async function POST(req: Request) {
  const rid = requestId();
  const key = bearerKey(req.headers.get("authorization"));
  if (!key) return apiError("invalid_key", "Send your API key as: Authorization: Bearer ua_…", rid, { "WWW-Authenticate": "Bearer" });
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BYTES) return apiError("payload_too_large", "Send at most 20 MB per request.", rid);
  const idem = req.headers.get("idempotency-key");
  if (idem != null && !/^[A-Za-z0-9._:-]{8,100}$/.test(idem)) {
    return apiError("invalid_request", "The Idempotency-Key must be 8 to 100 letters, digits or . _ : -", rid);
  }

  let text: string, payload: Record<string, unknown>;
  try {
    text = await req.text();
    if (text.length > MAX_BYTES) return apiError("payload_too_large", "Send at most 20 MB per request.", rid);
    const type = req.headers.get("content-type") ?? "";
    const roster = rosterFromText(text, type);
    const complete = /json/i.test(type) || text.trimStart().startsWith("{")
      ? (JSON.parse(text) as { complete?: unknown }).complete === true
      : ["1", "true"].includes(new URL(req.url).searchParams.get("complete") ?? "");
    payload = { ...roster, complete };
  } catch {
    return apiError("invalid_request", "The roster couldn't be read. Send JSON { complete, modules, people } or CSV with a header row.", rid);
  }
  if ((payload.people as unknown[]).length > 20000) return apiError("payload_too_large", "Send at most 20,000 people per request.", rid);

  const { data, error } = await apiDb().rpc("api_roster_push", {
    p_key: key, p_payload: payload, p_idempotency_key: idem, p_body_sha256: idem ? createHash("sha256").update(text).digest("hex") : null,
  });
  if (error) { const e = fromDbError(error); return apiError(e.code, e.message, rid); }
  return apiOk(data as object, rid);
}
