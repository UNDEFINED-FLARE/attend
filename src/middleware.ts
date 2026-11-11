import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { authCookieOptions, SESSION_ONLY_COOKIE } from "@/lib/supabase/cookies";
import { fetchWithTimeout } from "@/lib/supabase/fetch";
import { getAuthUser } from "@/lib/supabase/resilient";

const PUBLIC = ["/", "/login", "/signup", "/forgot-password", "/auth/callback", "/privacy"];
// Machine endpoints that check their own secret.
const PUBLIC_PREFIX = ["/api/push/"];

// Refreshes the Supabase session cookie on every request and sends signed-out
// users to /login. This is navigation only; authorization is enforced by RLS
// and by the role checks in each area's server layout.
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });
  // Refreshing the session here also renews the cookie, so regular users stay signed in.
  const sessionOnly = request.cookies.get(SESSION_ONLY_COOKIE)?.value === "1";
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { fetch: fetchWithTimeout },
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (list) => {
          list.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          list.forEach(({ name, value, options }) => response.cookies.set(name, value, authCookieOptions(options, sessionOnly)));
        },
      },
    },
  );
  // Verifies the token locally with the project's signing keys (no Auth round trip), and
  // still refreshes an expired session, which renews the cookie.
  const { user, unreachable } = await getAuthUser(supabase);
  const path = request.nextUrl.pathname;
  // If Supabase is unreachable, let the request through: the page's own
  // server-side check will show a connection error instead of a false logout.
  if (!user && !unreachable && !PUBLIC.includes(path) && !PUBLIC_PREFIX.some((p) => path.startsWith(p))) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", path);
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|manifest.webmanifest|sw.js|icons/|.*\\.(?:png|jpg|svg)$).*)"],
};
