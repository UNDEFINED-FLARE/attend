import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { getUserWithRetry, SupabaseUnreachable } from "@/lib/supabase/resilient";
import { supabaseServer } from "@/lib/supabase/server";

export type Role = "super_admin" | "institution_admin" | "lecturer" | "student"
  | "faculty_admin" | "department_admin" | "attendance_officer" | "integration_admin" | "auditor";
export type RoleRow = {
  institution_id: string | null;
  institution_name: string | null;
  institution_slug: string | null;
  institution_status: string | null;
  brand_primary: string | null;
  role: Role;
  /** The faculty or department a scoped role covers (0030). */
  scope_name?: string | null;
};

export const ROLE_HOME: Record<Role, string> = {
  super_admin: "/super",
  institution_admin: "/admin",
  lecturer: "/lecturer",
  student: "/student",
  faculty_admin: "/staff",
  department_admin: "/staff",
  attendance_officer: "/staff",
  auditor: "/staff",
  integration_admin: "/admin/integrations",
};

export const ROLE_LABEL: Record<Role, string> = {
  super_admin: "Platform administrator",
  institution_admin: "Institution administrator",
  lecturer: "Lecturer",
  student: "Student",
  faculty_admin: "Faculty administrator",
  department_admin: "Department administrator",
  attendance_officer: "Attendance officer",
  integration_admin: "Integration administrator",
  auditor: "Auditor",
};

/** The roles of the staff area (/staff): oversight of attendance, by scope. */
export const STAFF_ROLES: Role[] = ["faculty_admin", "department_admin", "attendance_officer", "auditor"];
/** The roles that may manage connections, imports and sync runs. */
export const INTEGRATION_ROLES: Role[] = ["institution_admin", "integration_admin"];

export const INST_COOKIE = "ua_inst";

/** The signed-in user and their active roles, read from the database (never from the client). */
export const getSession = cache(async () => {
  const supabase = await supabaseServer();
  const { user, unreachable } = await getUserWithRetry(supabase);
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

/**
 * Gate for an area several roles share. `current` is the person's highest of those
 * roles in the chosen institution; `roles` lists every one of them they hold there.
 * The database still decides what each role may see and do.
 */
export async function requireAnyRole(allowed: Role[]) {
  const s = await getSession();
  if (!s) redirect("/login");
  const matches = s.roles.filter((r) => allowed.includes(r.role));
  if (!matches.length) redirect("/dashboard");
  const wanted = (await cookies()).get(INST_COOKIE)?.value;
  const current = matches.find((r) => r.institution_id === wanted) ?? matches[0];
  const choices = matches.filter((r, i) => matches.findIndex((x) => x.institution_id === r.institution_id) === i);
  const roles = matches.filter((r) => r.institution_id === current.institution_id);
  return { ...s, current, roles, institutionId: current.institution_id as string, choices };
}
