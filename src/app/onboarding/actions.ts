"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";

type S = { error?: string; ok?: string } | undefined;

export async function applyForInstitution(_: S, form: FormData): Promise<S> {
  const p = z.object({
    name: z.string().trim().min(3, "Enter the institution's full name.").max(200),
    slug: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{1,40}$/, "Use lowercase letters, numbers and dashes."),
    contact_email: z.string().trim().email("Enter a contact email."),
  }).safeParse(Object.fromEntries(form));
  if (!p.success) return { error: p.error.issues[0].message };
  const supabase = await supabaseServer();
  const { error } = await supabase.rpc("request_institution", {
    p_name: p.data.name, p_slug: p.data.slug, p_contact_email: p.data.contact_email,
  });
  if (error) return { error: error.code === "23505" ? "That short name is taken." : error.message };
  redirect("/admin");
}

export async function relink(): Promise<S> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("link_my_accounts");
  if (error) return { error: error.message };
  const r = data as { linked: boolean; reason?: string; students: number; lecturers: number };
  if (!r.linked) return { error: r.reason };
  if (r.students + r.lecturers > 0) redirect("/dashboard");
  return { error: "No student or staff record matches your email yet. Ask your faculty administrator to add you." };
}
