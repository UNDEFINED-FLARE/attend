import { redirect } from "next/navigation";
import { getSession, ROLE_HOME } from "@/lib/auth";

// Sends each user to their highest-privilege area. With no role yet, onboarding.
export default async function Dashboard() {
  const s = await getSession();
  if (!s) redirect("/login");
  if (!s.roles.length) {
    await s.supabase.rpc("link_my_accounts");
    const { data } = await s.supabase.rpc("my_roles");
    if (!data?.length) redirect("/onboarding");
    redirect(ROLE_HOME[(data[0] as { role: keyof typeof ROLE_HOME }).role]);
  }
  redirect(ROLE_HOME[s.roles[0].role]);
}
