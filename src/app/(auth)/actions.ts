"use server";
import type { Provider } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { env } from "@/lib/env";
import { safeNextPath } from "@/lib/safe-redirect";
import { SLUG } from "@/lib/sign-in";
import { loadDirectory } from "@/lib/sign-in-server";
import { SESSION_ONLY_COOKIE } from "@/lib/supabase/cookies";
import { supabaseServer } from "@/lib/supabase/server";

export type FormState = { error?: string; ok?: string } | undefined;
export type SignInState = { error?: string; next?: string } | undefined;

const email = z.string().trim().toLowerCase().email("Enter a valid email address.");
const password = z.string().min(10, "Use at least 10 characters.").max(128);

const safeNext = (v: FormDataEntryValue | null) => safeNextPath(v);
/** The bot-protection token from the form (see src/components/captcha.tsx); Supabase Auth checks it when CAPTCHA is on. */
const captcha = (form: FormData) => {
  const t = form.get("cf-turnstile-response");
  return typeof t === "string" && t ? { captchaToken: t.slice(0, 4096) } : {};
};
const CAPTCHA_MSG = "Please complete the check that you're not a robot, then try again.";
const isCaptcha = (m: string) => /captcha/i.test(m);

/**
 * Signs in and returns where to go next. The page then lets the browser save the
 * password (it only offers to once it knows the sign-in worked) and navigates.
 */
export async function signIn(_: SignInState, form: FormData): Promise<SignInState> {
  const parsed = z.object({ email, password: z.string().min(1) }).safeParse({ email: form.get("email"), password: form.get("password") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const remember = form.get("remember") === "on";
  const supabase = await supabaseServer({ sessionOnly: !remember });
  const { error } = await supabase.auth.signInWithPassword({ ...parsed.data, options: captcha(form) });
  if (error && isCaptcha(error.message)) return { error: CAPTCHA_MSG };
  // One message for both cases, so the form does not reveal which emails exist.
  if (error) return { error: "Email or password is incorrect, or the email is not yet confirmed." };
  const store = await cookies();
  if (remember) store.delete(SESSION_ONLY_COOKIE);
  else store.set(SESSION_ONLY_COOKIE, "1", { httpOnly: true, sameSite: "lax", secure: true, path: "/" });
  await supabase.rpc("link_my_accounts");
  return { next: safeNext(form.get("next")) };
}

export async function signUp(_: FormState, form: FormData): Promise<FormState> {
  // Email accounts only for an institution that still allows them (the transition,
  // migration 0036). The database enforces the same rule when linking, so an account
  // made some other way still gets no access at an institution that has moved on.
  const slug = String(form.get("i") ?? "");
  const { list } = await loadDirectory(SLUG.test(slug) ? slug : "-");
  if (list[0]?.method !== "email") return { error: "Accounts with an email and password can't be created for this institution. Sign in with your university account instead." };
  const parsed = z.object({
    full_name: z.string().trim().min(2, "Enter your full name.").max(200),
    email,
    password,
    consent: z.literal("on", { errorMap: () => ({ message: "Please accept the privacy notice to continue." }) }),
  }).safeParse({ full_name: form.get("full_name"), email: form.get("email"), password: form.get("password"), consent: form.get("consent") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const supabase = await supabaseServer();
  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    // full_name only. Roles are never taken from signup data.
    options: { data: { full_name: parsed.data.full_name, app: "uniattend" }, emailRedirectTo: `${env.siteUrl}/auth/callback`, ...captcha(form) },
  });
  if (error) return { error: isCaptcha(error.message) ? CAPTCHA_MSG : error.message };
  return { ok: "Check your inbox to confirm your email, then sign in." };
}

export async function requestReset(_: FormState, form: FormData): Promise<FormState> {
  const parsed = email.safeParse(form.get("email"));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const supabase = await supabaseServer();
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data, {
    redirectTo: `${env.siteUrl}/auth/callback?next=/reset-password`, ...captcha(form),
  });
  if (error && isCaptcha(error.message)) return { error: CAPTCHA_MSG };
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

/**
 * University sign-in: the institution's approved provider is looked up on the
 * server (never taken from the form), and Supabase Auth runs the OpenID Connect
 * flow — state, nonce, PKCE and the ID token's signature, issuer and audience —
 * then returns to /auth/callback with a one-time code.
 */
export async function startUniversitySignIn(form: FormData): Promise<void> {
  const slug = String(form.get("i") ?? "");
  const next = safeNext(form.get("next"));
  if (!SLUG.test(slug)) redirect("/login");
  const { list } = await loadDirectory(slug);
  const inst = list[0];
  if (!inst || inst.method !== "sso" || !inst.provider) redirect(`/login?i=${slug}&error=unavailable`);
  const supabase = await supabaseServer();
  const callback = new URL("/auth/callback", env.siteUrl);
  callback.searchParams.set("next", next);
  callback.searchParams.set("i", slug);
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: inst.provider as Provider,
    options: { redirectTo: callback.toString(), scopes: inst.scopes, skipBrowserRedirect: true },
  });
  if (error || !data?.url) redirect(`/login?i=${slug}&error=start`);
  redirect(data.url);
}
