import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { getAuthUser, SupabaseUnreachable } from "@/lib/supabase/resilient";
import { supabaseServer } from "@/lib/supabase/server";

export type Role = "super_admin" | "institution_admin" | "lecturer" | "student";
export type RoleRow = {
  institution_id: string | null;
  institution_name: string | null;
  institution_slug: string | null;
  institution_status: string | null;
  brand_primary: string | null;
  role: Role;
};

export const ROLE_HOME: Record<Role, string> = {
  super_admin: "/super",
  institution_admin: "/admin",
  lecturer: "/lecturer",
  student: "/student",
};

export const INST_COOKIE = "ua_inst";

/** The signed-in user and their active roles, read from the database (never from the client). */
export const getSession = cache(async () => {
  const supabase = await supabaseServer();
  const { user, unreachable } = await getAuthUser(supabase);
  if (unreachable) throw new SupabaseUnreachable();
  if (!user) return null;
  // A failed roles lookup must not look like "no roles" (that would send an
  // admin to onboarding), so retry once and otherwise report the failure.
  let res = await supabase.rpc("my_roles");
  if (res.error) res = await supabase.rpc("my_roles");
  if (res.error) throw new SupabaseUnreachable();
  return { user, roles: (res.data ?? []) as RoleRow[], supabase };
});

/**
 * Gate for a role area. Returns the institution the user is acting in for that
 * role (chosen by cookie when they hold the role in more than one).
 */
export async function requireRole(role: Role) {
  const s = await getSession();
  if (!s) redirect("/login");
  const matches = s.roles.filter((r) => r.role === role);
  if (!matches.length) redirect("/dashboard");
  const wanted = (await cookies()).get(INST_COOKIE)?.value;
  const current = matches.find((r) => r.institution_id === wanted) ?? matches[0];
  return { ...s, current, institutionId: current.institution_id as string, choices: matches };
}
