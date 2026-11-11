// Supabase requests give up after this long. Postgres already stops a query after 8 s
// (Supabase's statement_timeout for signed-in users), so a real query is never cut short:
// this only stops a stalled connection from hanging a page for minutes. The aborted request
// surfaces as a network error, which the callers already treat as "can't reach the database".
export const SUPABASE_TIMEOUT_MS = 15_000;

export function fetchWithTimeout(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error(`Supabase did not answer within ${SUPABASE_TIMEOUT_MS / 1000} s`)),
    SUPABASE_TIMEOUT_MS,
  );
  const outer = init?.signal;
  if (outer) {
    if (outer.aborted) controller.abort(outer.reason);
    else outer.addEventListener("abort", () => controller.abort(outer.reason), { once: true });
  }
  return fetch(input, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
}
