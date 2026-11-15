import { apiError, apiOk, bearerKey, fromDbError } from "@/lib/api-errors";
import { apiDb, requestId } from "@/lib/api-v1";

// GET /api/v1/status — which connection a key belongs to, its rate-limit use and last runs.
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const rid = requestId();
  const key = bearerKey(req.headers.get("authorization"));
  if (!key) return apiError("invalid_key", "Send your API key as: Authorization: Bearer ua_…", rid, { "WWW-Authenticate": "Bearer" });
  const { data, error } = await apiDb().rpc("api_status", { p_key: key });
  if (error) { const e = fromDbError(error); return apiError(e.code, e.message, rid); }
  return apiOk(data as object, rid);
}
