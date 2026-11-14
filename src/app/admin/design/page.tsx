import { PageHeader } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { loadTheme } from "@/lib/shell-data";
import { parseTheme } from "@/lib/theme";
import { Designer, type Version } from "./designer";

export const metadata = { title: "Design" };

export default async function DesignPage() {
  const { supabase, institutionId, current } = await requireRole("institution_admin");
  const [theme, { data: rows, error }, { data: inst }] = await Promise.all([
    loadTheme(supabase, institutionId),
    supabase.from("theme_versions").select("id, status, note, created_by_name, created_at, updated_at, theme")
      .eq("institution_id", institutionId).order("created_at", { ascending: false }).limit(31),
    supabase.from("institutions").select("slug").eq("id", institutionId).maybeSingle(),
  ]);
  const draftRow = rows?.find((r) => r.status === "draft");
  const versions: Version[] = (rows ?? []).filter((r) => r.status === "published")
    .map((r) => ({ id: r.id, note: r.note, by: r.created_by_name, at: r.created_at }));
  return (
    <>
      <PageHeader title="Design your platform"
        subtitle="Themes, dark mode, logo, sign-in screen, menus, features and every card students see. Save a draft while you work; publish when it's ready." />
      <Designer
        published={theme}
        draft={draftRow ? { theme: parseTheme(draftRow.theme), at: draftRow.updated_at, by: draftRow.created_by_name } : null}
        versions={versions}
        historyReady={!error}
        slug={inst?.slug ?? null}
        institutionName={current.institution_name ?? "Your institution"} />
    </>
  );
}
