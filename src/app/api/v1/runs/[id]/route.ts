import { apiError, apiOk, bearerKey, fromDbError } from "@/lib/api-errors";
import { apiDb, requestId } from "@/lib/api-v1";

// GET /api/v1/runs/{id} — one run's result and its rejected rows, for the key's own connection.
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const rid = requestId();
  const key = bearerKey(req.headers.get("authorization"));
  if (!key) return apiError("invalid_key", "Send your API key as: Authorization: Bearer ua_…", rid, { "WWW-Authenticate": "Bearer" });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return apiError("not_found", "No such run for this key.", rid);
  const { data, error } = await apiDb().rpc("api_run", { p_key: key, p_run: id });
  if (error) { const e = fromDbError(error); return apiError(e.code, e.message, rid); }
  return apiOk(data as object, rid);
}
