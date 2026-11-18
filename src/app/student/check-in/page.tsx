import { requireRole } from "@/lib/auth";
import { loadTheme } from "@/lib/shell-data";
import { CheckIn } from "./check-in";

export const metadata = { title: "Check in" };

export default async function Page({ searchParams }: { searchParams: Promise<{ s?: string; t?: string }> }) {
  const { s, t } = await searchParams;
  const { supabase, institutionId, user } = await requireRole("student");
  const [{ features }, { data: st }] = await Promise.all([
    loadTheme(supabase, institutionId),
    // bluetooth_enabled needs database update 0037; before it, the query fails and Bluetooth stays off.
    supabase.from("institution_settings").select("bluetooth_enabled").eq("institution_id", institutionId).maybeSingle(),
  ]);
  const bluetooth = !!(st as { bluetooth_enabled?: boolean } | null)?.bluetooth_enabled;
  return <CheckIn userId={user.id} initialSession={s ?? null} initialToken={t ?? null} liveClass={features.liveClass} bluetooth={bluetooth} />;
}
