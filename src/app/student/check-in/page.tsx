import { requireRole } from "@/lib/auth";
import { loadTheme } from "@/lib/shell-data";
import { CheckIn } from "./check-in";

export const metadata = { title: "Check in" };

export default async function Page({ searchParams }: { searchParams: Promise<{ s?: string; t?: string }> }) {
  const { s, t } = await searchParams;
  const { supabase, institutionId } = await requireRole("student");
  const { features } = await loadTheme(supabase, institutionId);
  return <CheckIn initialSession={s ?? null} initialToken={t ?? null} liveClass={features.liveClass} />;
}
