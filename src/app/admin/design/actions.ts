"use server";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { DEFAULT_THEME, ThemeSchema } from "@/lib/theme";

type S = { error?: string; ok?: string } | undefined;

/** Save the institution's design. Validated in full; nothing partial is stored. */
export async function saveTheme(_: S, f: FormData): Promise<S> {
  let parsed;
  try {
    parsed = f.get("reset") === "1" ? { success: true as const, data: DEFAULT_THEME } : ThemeSchema.safeParse(JSON.parse(String(f.get("theme") ?? "{}")));
  } catch { return { error: "The design could not be read. Reload the page and try again." }; }
  if (!parsed.success) {
    const i = parsed.error.issues[0];
    return { error: `${i.path.join(" › ")}: ${i.message}` };
  }
  const { supabase, institutionId } = await requireRole("institution_admin");
  const { error } = await supabase.from("institutions")
    .update({ theme: parsed.data, brand_primary: parsed.data.colors.primary }).eq("id", institutionId);
  if (error) {
    return { error: error.code === "PGRST204" || error.code === "42703"
      ? "The database needs its latest update: run supabase/migrations/20261109000008_timetable_details.sql in the Supabase SQL Editor, then save again."
      : error.message };
  }
  // Every page under the institution uses the theme.
  revalidatePath("/", "layout");
  return { ok: f.get("reset") === "1" ? "Back to the default design." : "Design saved. Everyone at your institution sees it now." };
}
