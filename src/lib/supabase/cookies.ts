// How long the sign-in is remembered. "Keep me signed in" (the default) keeps the
// Supabase session cookies for 400 days, the longest browsers allow, and every
// visit renews them, so a regular user never has to sign in again. Unticked (a
// shared lab computer), the cookies last only until the browser is closed.

/** Set at sign-in when "Keep me signed in" is unticked. */
export const SESSION_ONLY_COOKIE = "ua_session_only";
const KEEP_FOR = 400 * 24 * 60 * 60;

type Options = { maxAge?: number; expires?: Date; [k: string]: unknown };

/** The options to write a Supabase auth cookie with, given the person's choice. */
export function authCookieOptions<T extends Options>(options: T | undefined, sessionOnly: boolean): T {
  const o = { ...(options ?? {}) } as T;
  // Deleting a cookie (maxAge 0) must always go through unchanged.
  if (o.maxAge === 0) return o;
  if (sessionOnly) { delete o.maxAge; delete o.expires; return o; }
  return { ...o, maxAge: KEEP_FOR };
}
