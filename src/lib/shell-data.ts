import "server-only";
import type { getSession, Role, RoleRow } from "@/lib/auth";
import { DEFAULT_THEME, parseTheme, type Theme } from "@/lib/theme";

/** Order of the role switcher in the top bar. */
const ROLE_ORDER: Role[] = ["super_admin", "institution_admin", "lecturer", "student"];

type S = NonNullable<Awaited<ReturnType<typeof getSession>>>;

/** The institution's theme; the older brand colour setting still applies until a theme is designed. */
export async function loadTheme(supabase: S["supabase"], institutionId: string | null): Promise<Theme> {
  if (!institutionId) return DEFAULT_THEME;
  const { data, error } = await supabase.from("institutions").select("*").eq("id", institutionId).maybeSingle();
  if (error || !data) return DEFAULT_THEME;
  const raw = (data as { theme?: unknown }).theme;
  const theme = parseTheme(raw);
  const designed = raw && typeof raw === "object" && Object.keys(raw).length > 0;
  if (!designed && typeof data.brand_primary === "string") theme.colors.primary = data.brand_primary;
  return theme;
}

/** Name/email for the top bar, unread notification count, the institution's theme, and the user's roles. */
export async function shellData(s: Pick<S, "user" | "supabase"> & { institutionId?: string | null; roles?: RoleRow[] }) {
  const [{ count }, theme] = await Promise.all([
    s.supabase.from("notifications").select("id", { count: "exact", head: true }).is("read_at", null),
    loadTheme(s.supabase, s.institutionId ?? null),
  ]);
  const meta = s.user.user_metadata as { full_name?: string } | undefined;
  // Each role at most once, whatever institution it's held at; the switcher links to the role's area.
  const roles = ROLE_ORDER.filter((r) => s.roles?.some((x) => x.role === r));
  return { user: { email: s.user.email, name: meta?.full_name || null }, unread: count ?? 0, theme, roles };
}

/** The institution's campuses that have a location, for the maps. Works before migration 0009 (no outline/zoom yet). */
export async function loadCampuses(supabase: S["supabase"], institutionId: string): Promise<import("@/lib/campuses").Campus[]> {
  const { toCampus } = await import("@/lib/campuses");
  const { data } = await supabase.from("campuses").select("*").eq("institution_id", institutionId).is("deleted_at", null).order("name");
  return (data ?? []).map((r) => toCampus(r as Parameters<typeof toCampus>[0])).filter((c): c is NonNullable<typeof c> => !!c);
}
