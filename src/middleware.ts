import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { BRAND_COOKIE, BRAND_COOKIE_OPTIONS } from "@/lib/brand-cookie";
import { authCookieOptions, SESSION_ONLY_COOKIE } from "@/lib/supabase/cookies";
import { getUserWithRetry } from "@/lib/supabase/resilient";

const PUBLIC = ["/", "/login", "/signup", "/forgot-password", "/auth/callback", "/privacy", "/terms"];
// Machine endpoints that check their own secret.
const PUBLIC_PREFIX = ["/api/push/", "/api/health"];

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
  const { user, unreachable } = await getUserWithRetry(supabase);
  const path = request.nextUrl.pathname;
  // If Supabase is unreachable, let the request through: the page's own
  // server-side check will show a connection error instead of a false logout.
  if (!user && !unreachable && !PUBLIC.includes(path) && !PUBLIC_PREFIX.some((p) => path.startsWith(p))) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", path);
    return NextResponse.redirect(url);
  }
  // /login?i=<institution> (and the other sign-in pages): wear that institution's
  // branding now and on later visits from this device.
  const brand = request.nextUrl.searchParams.get("i")?.toLowerCase();
  if (brand && /^[a-z0-9][a-z0-9-]{1,40}$/.test(brand) && AUTH_PAGES.includes(path)) {
    request.cookies.set(BRAND_COOKIE, brand);
    const next = NextResponse.next({ request });
    response.cookies.getAll().forEach((c) => next.cookies.set(c));
    next.cookies.set(BRAND_COOKIE, brand, BRAND_COOKIE_OPTIONS);
    return next;
  }
  return response;
}

const AUTH_PAGES = ["/login", "/signup", "/forgot-password", "/reset-password"];

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|manifest.webmanifest|sw.js|icons/|.*\\.(?:png|jpg|svg)$).*)"],
};
