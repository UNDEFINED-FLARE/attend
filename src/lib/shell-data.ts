import "server-only";
import type { getSession } from "@/lib/auth";
import { DEFAULT_THEME, parseTheme, type Theme } from "@/lib/theme";

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

/** Name/email for the top bar, unread notification count, and the institution's theme. */
export async function shellData(s: Pick<S, "user" | "supabase"> & { institutionId?: string | null }) {
  const [{ count }, theme] = await Promise.all([
    s.supabase.from("notifications").select("id", { count: "exact", head: true }).is("read_at", null),
    loadTheme(s.supabase, s.institutionId ?? null),
  ]);
  const meta = s.user.user_metadata as { full_name?: string } | undefined;
  return { user: { email: s.user.email, name: meta?.full_name || null }, unread: count ?? 0, theme };
}

/** The institution's campuses that have a location, for the maps. Works before migration 0009 (no outline/zoom yet). */
export async function loadCampuses(supabase: S["supabase"], institutionId: string): Promise<import("@/lib/campuses").Campus[]> {
  const { toCampus } = await import("@/lib/campuses");
  const { data } = await supabase.from("campuses").select("*").eq("institution_id", institutionId).is("deleted_at", null).order("name");
  return (data ?? []).map((r) => toCampus(r as Parameters<typeof toCampus>[0])).filter((c): c is NonNullable<typeof c> => !!c);
}
