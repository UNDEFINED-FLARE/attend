import type { SupabaseClient, User } from "@supabase/supabase-js";

export class SupabaseUnreachable extends Error {
  constructor() {
    super("UniAttend can't reach its database right now. Check your internet connection and try again.");
    this.name = "SupabaseUnreachable";
  }
}

/** The parts of the signed-in user the app uses, taken from the verified access token. */
export type SessionUser = Pick<User, "id" | "email" | "user_metadata" | "app_metadata">;

type Claims = {
  sub?: string;
  email?: string;
  user_metadata?: Record<string, unknown>;
  app_metadata?: Record<string, unknown>;
};

export function userFromClaims(c: Claims | null | undefined): SessionUser | null {
  if (!c?.sub) return null;
  return {
    id: c.sub,
    email: c.email,
    user_metadata: c.user_metadata ?? {},
    app_metadata: (c.app_metadata ?? {}) as User["app_metadata"],
  };
}

/**
 * Who is signed in, via auth.getClaims() (readiness report B-3, P0 item 4).
 *
 * With the project's asymmetric JWT signing keys the token is verified locally (the keys are
 * cached per process), so a page no longer makes a round trip to Supabase Auth just to learn
 * who is signed in. With legacy symmetric keys getClaims() falls back to getUser(), one round
 * trip as before. An expired token is refreshed first. A session signed out on another device
 * stays valid here until its token expires (1 hour by default); RLS still checks every query.
 *
 * A network failure is reported as `unreachable` rather than "signed out", with one retry, so a
 * flaky connection never silently logs someone out or bounces them to /login.
 */
export async function getAuthUser(
  supabase: Pick<SupabaseClient, "auth">,
): Promise<{ user: SessionUser | null; unreachable: boolean }> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { data, error } = await supabase.auth.getClaims();
      if (!error) return { user: userFromClaims(data?.claims as Claims | undefined), unreachable: false };
      if (error.name !== "AuthRetryableFetchError") return { user: null, unreachable: false };
    } catch {
      // fetch itself threw (e.g. the request timed out); fall through to retry
    }
    if (attempt === 0) await new Promise((r) => setTimeout(r, 500));
  }
  return { user: null, unreachable: true };
}
