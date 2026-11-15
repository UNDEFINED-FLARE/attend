// The public API's error contract (v1): every error is
//   { "error": { "code": "<stable_code>", "message": "<for people>" }, "request_id": "<uuid>" }
// with an HTTP status that matches the code. Codes never change meaning within v1;
// messages may be reworded.

export type ApiErrorCode =
  | "invalid_key" | "invalid_request" | "payload_too_large" | "connection_paused" | "institution_inactive"
  | "idempotency_conflict" | "not_found" | "rate_limited" | "unavailable" | "internal";

export const STATUS: Record<ApiErrorCode, number> = {
  invalid_key: 401, invalid_request: 400, payload_too_large: 413, connection_paused: 403, institution_inactive: 403,
  idempotency_conflict: 409, not_found: 404, rate_limited: 429, unavailable: 503, internal: 500,
};

/** A database error from the v1 functions, as an API error. */
export function fromDbError(e: { code?: string; message: string }): { code: ApiErrorCode; message: string } {
  if (e.code === "42501") return { code: "invalid_key", message: "That API key is not valid." };
  if (e.code === "UA409") return { code: "idempotency_conflict", message: e.message };
  if (e.code === "P0002") return { code: "not_found", message: e.message };
  if (e.code === "PGRST202") return { code: "unavailable", message: "The API is not set up on this server yet." };
  if (/Too many requests/.test(e.message)) return { code: "rate_limited", message: e.message };
  if (/paused/.test(e.message)) return { code: "connection_paused", message: e.message };
  if (/institution is not active/.test(e.message)) return { code: "institution_inactive", message: e.message };
  if (e.code === "22023" || e.code === "22P02" || e.code === "P0001") return { code: "invalid_request", message: e.message };
  return { code: "internal", message: "Something went wrong on our side. Try again; if it keeps happening, quote the request_id." };
}

export function apiError(code: ApiErrorCode, message: string, requestId: string, headers: Record<string, string> = {}): Response {
  return Response.json({ error: { code, message }, request_id: requestId },
    { status: STATUS[code], headers: { "X-Request-Id": requestId, "Cache-Control": "no-store", ...headers } });
}

export function apiOk(body: object, requestId: string): Response {
  return Response.json({ ...body, request_id: requestId }, { headers: { "X-Request-Id": requestId, "Cache-Control": "no-store" } });
}

/** The key from "Authorization: Bearer ua_…", or null. */
export function bearerKey(header: string | null): string | null {
  const key = (header ?? "").replace(/^Bearer\s+/i, "").trim();
  return /^ua_[0-9a-f]{48}$/.test(key) ? key : null;
}
