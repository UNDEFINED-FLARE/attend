"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getSession, INST_COOKIE } from "@/lib/auth";
import { BRAND_COOKIE, BRAND_COOKIE_OPTIONS } from "@/lib/brand-cookie";
import { SESSION_ONLY_COOKIE } from "@/lib/supabase/cookies";
import { supabaseServer } from "@/lib/supabase/server";

export async function signOut() {
  const s = await getSession().catch(() => null);
  const jar = await cookies();
  // Keep the institution's branding on the sign-in page for whoever signs in next on this device.
  const wanted = jar.get(INST_COOKIE)?.value;
  const inst = s?.roles.find((r) => r.institution_id && r.institution_id === wanted)?.institution_id ?? s?.roles.find((r) => r.institution_id)?.institution_id;
  if (inst) jar.set(BRAND_COOKIE, inst, BRAND_COOKIE_OPTIONS);
  await (s?.supabase ?? await supabaseServer()).auth.signOut();
  jar.delete(SESSION_ONLY_COOKIE);
  redirect("/login");
}

export async function switchInstitution(form: FormData) {
  const id = String(form.get("institution") ?? "");
  // The cookie is a preference only; requireRole() ignores it unless the user
  // actually holds the role in that institution.
  if (/^[0-9a-f-]{36}$/.test(id)) {
    (await cookies()).set(INST_COOKIE, id, { httpOnly: true, sameSite: "lax", secure: true, path: "/" });
  }
  redirect("/dashboard");
}

export async function markAllRead() {
  const supabase = await supabaseServer();
  await supabase.rpc("mark_notifications_read", { p_ids: null });
  redirect("/notifications");
}
