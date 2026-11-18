import "server-only";
import { supabaseServer } from "@/lib/supabase/server";
import { parseDirectory, SLUG, type DirectoryEntry } from "@/lib/sign-in";

/**
 * The public sign-in directory, or one institution in it. `ok` is false when the
 * database couldn't answer (or migration 0036 is missing), so the page can say so
 * instead of showing an empty list as if no institution existed.
 */
export async function loadDirectory(slug?: string | null): Promise<{ ok: boolean; list: DirectoryEntry[] }> {
  if (slug != null && !SLUG.test(slug)) return { ok: true, list: [] };
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("sign_in_directory", { p_slug: slug ?? null });
  if (error) return { ok: false, list: [] };
  return { ok: true, list: parseDirectory(data) };
}
