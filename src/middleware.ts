import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getUserWithRetry } from "@/lib/supabase/resilient";

const PUBLIC = ["/", "/login", "/signup", "/forgot-password", "/auth/callback", "/privacy"];

// Refreshes the Supabase session cookie on every request and sends signed-out
// users to /login. This is navigation only; authorization is enforced by RLS
// and by the role checks in each area's server layout.
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (list) => {
          list.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );
  const { user, unreachable } = await getUserWithRetry(supabase);
  const path = request.nextUrl.pathname;
  // If Supabase is unreachable, let the request through: the page's own
  // server-side check will show a connection error instead of a false logout.
  if (!user && !unreachable && !PUBLIC.includes(path)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", path);
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|manifest.webmanifest|.*\\.(?:png|jpg|svg)$).*)"],
};
