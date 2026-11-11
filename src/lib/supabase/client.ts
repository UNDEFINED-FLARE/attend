"use client";
import { createBrowserClient } from "@supabase/ssr";
import { fetchWithTimeout } from "@/lib/supabase/fetch";

let client: ReturnType<typeof createBrowserClient> | null = null;

/** Browser client for Realtime subscriptions. Uses the public anon key only. */
export function supabaseBrowser() {
  client ??= createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { db: { schema: "uniattend" }, global: { fetch: fetchWithTimeout } },
  );
  return client;
}
