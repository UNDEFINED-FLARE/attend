import type { SupabaseClient, User } from "@supabase/supabase-js";

export class SupabaseUnreachable extends Error {
  constructor() {
    super("UniAttend can't reach its database right now. Check your internet connection and try again.");
    this.name = "SupabaseUnreachable";
  }
}

/**
 * auth.getUser() with one retry on network failure. A network failure is
 * reported as `unreachable` rather than as "signed out", so a flaky
 * connection never silently logs someone out or bounces them to /login.
 */
export async function getUserWithRetry(supabase: Pick<SupabaseClient, "auth">): Promise<{ user: User | null; unreachable: boolean }> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { data, error } = await supabase.auth.getUser();
      if (error?.name !== "AuthRetryableFetchError") return { user: data.user, unreachable: false };
    } catch {
      // fetch itself threw; fall through to retry
    }
    if (attempt === 0) await new Promise((r) => setTimeout(r, 500));
  }
  return { user: null, unreachable: true };
}
