import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { DB_SCHEMA, env } from "@/lib/env";
import { authCookieOptions, SESSION_ONLY_COOKIE } from "@/lib/supabase/cookies";

/**
 * Supabase client bound to the signed-in user's session. RLS always applies.
 * `sessionOnly` overrides the remembered choice (used at sign-in).
 */
export async function supabaseServer(opts: { sessionOnly?: boolean } = {}) {
  const store = await cookies();
  const sessionOnly = opts.sessionOnly ?? store.get(SESSION_ONLY_COOKIE)?.value === "1";
  return createServerClient(env.url, env.anonKey, {
    db: { schema: DB_SCHEMA },
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          list.forEach(({ name, value, options }) => store.set(name, value, authCookieOptions(options, sessionOnly)));
        } catch {
          // Called from a Server Component: middleware refreshes the session instead.
        }
      },
    },
  });
}
