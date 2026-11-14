import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { INST_COOKIE } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { DEFAULT_THEME, parseTheme, type Theme } from "@/lib/theme";
import { BRAND_COOKIE } from "@/lib/brand-cookie";

export type Branding = { name: string | null; slug: string | null; theme: Theme };

/**
 * The institution branding for the sign-in, registration and password pages,
 * from ?i=<slug> (remembered by the middleware) or the last institution used on
 * this device. Falls back to the UniAttend look, also before migration 0019.
 */
export const loadBranding = cache(async (): Promise<Branding> => {
  const jar = await cookies();
  const key = jar.get(BRAND_COOKIE)?.value || jar.get(INST_COOKIE)?.value;
  if (!key || !/^[a-z0-9-]{2,64}$/i.test(key)) return { name: null, slug: null, theme: DEFAULT_THEME };
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("public_branding", { p_key: key });
  if (error || !data) return { name: null, slug: null, theme: DEFAULT_THEME };
  const b = data as { name: string; slug: string; theme: Record<string, unknown> | null; brand_primary: string };
  const raw = b.theme ?? {};
  const theme = parseTheme(raw);
  if (!raw.colors && /^#[0-9a-f]{6}$/i.test(b.brand_primary)) theme.colors.primary = b.brand_primary;
  return { name: b.name, slug: b.slug, theme };
});
