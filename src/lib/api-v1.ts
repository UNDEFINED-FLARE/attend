import "server-only";
import { createClient } from "@supabase/supabase-js";
import { DB_SCHEMA, env } from "@/lib/env";

/**
 * The database as the public API sees it: the public (anon) key only. The
 * institution's API key, checked inside each v1 function, is the only authority.
 */
export function apiDb() {
  return createClient(env.url, env.anonKey, { db: { schema: DB_SCHEMA }, auth: { persistSession: false, autoRefreshToken: false } });
}

export const requestId = () => crypto.randomUUID();
