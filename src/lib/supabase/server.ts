import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { DB_SCHEMA, env } from "@/lib/env";

/** Supabase client bound to the signed-in user's session. RLS always applies. */
export async function supabaseServer() {
  const store = await cookies();
  return createServerClient(env.url, env.anonKey, {
    db: { schema: DB_SCHEMA },
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          list.forEach(({ name, value, options }) => store.set(name, value, options));
        } catch {
          // Called from a Server Component: middleware refreshes the session instead.
        }
      },
    },
  });
}
