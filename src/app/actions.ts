"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { INST_COOKIE } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";

export async function signOut() {
  const supabase = await supabaseServer();
  await supabase.auth.signOut();
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
