"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { env } from "@/lib/env";
import { safeNextPath } from "@/lib/safe-redirect";
import { SESSION_ONLY_COOKIE } from "@/lib/supabase/cookies";
import { supabaseServer } from "@/lib/supabase/server";

export type FormState = { error?: string; ok?: string } | undefined;
export type SignInState = { error?: string; next?: string } | undefined;

const email = z.string().trim().toLowerCase().email("Enter a valid email address.");
const password = z.string().min(10, "Use at least 10 characters.").max(128);

const safeNext = (v: FormDataEntryValue | null) => safeNextPath(v);

/**
 * Signs in and returns where to go next. The page then lets the browser save the
 * password (it only offers to once it knows the sign-in worked) and navigates.
 */
export async function signIn(_: SignInState, form: FormData): Promise<SignInState> {
  const parsed = z.object({ email, password: z.string().min(1) }).safeParse({ email: form.get("email"), password: form.get("password") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const remember = form.get("remember") === "on";
  const supabase = await supabaseServer({ sessionOnly: !remember });
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  // One message for both cases, so the form does not reveal which emails exist.
  if (error) return { error: "Email or password is incorrect, or the email is not yet confirmed." };
  const store = await cookies();
  if (remember) store.delete(SESSION_ONLY_COOKIE);
  else store.set(SESSION_ONLY_COOKIE, "1", { httpOnly: true, sameSite: "lax", secure: true, path: "/" });
  await supabase.rpc("link_my_accounts");
  return { next: safeNext(form.get("next")) };
}

export async function signUp(_: FormState, form: FormData): Promise<FormState> {
  const parsed = z.object({
    full_name: z.string().trim().min(2, "Enter your full name.").max(200),
    email,
    password,
    consent: z.literal("on", { errorMap: () => ({ message: "Please accept the privacy notice to continue." }) }),
  }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const supabase = await supabaseServer();
  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    // full_name only. Roles are never taken from signup data.
    options: { data: { full_name: parsed.data.full_name, app: "uniattend" }, emailRedirectTo: `${env.siteUrl}/auth/callback` },
  });
  if (error) return { error: error.message };
  return { ok: "Check your inbox to confirm your email, then sign in." };
}

export async function requestReset(_: FormState, form: FormData): Promise<FormState> {
  const parsed = email.safeParse(form.get("email"));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const supabase = await supabaseServer();
  await supabase.auth.resetPasswordForEmail(parsed.data, {
    redirectTo: `${env.siteUrl}/auth/callback?next=/reset-password`,
  });
  return { ok: "If an account uses that email, a reset link is on its way." };
}

export async function updatePassword(_: FormState, form: FormData): Promise<FormState> {
  const parsed = password.safeParse(form.get("password"));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const supabase = await supabaseServer();
  const { error } = await supabase.auth.updateUser({ password: parsed.data });
  if (error) return { error: error.message };
  redirect("/dashboard");
}
