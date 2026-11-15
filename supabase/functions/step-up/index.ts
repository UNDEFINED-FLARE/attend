// Step-up ("confirm it's you") → sets public.admin_step_up for the caller.
//
// The dangerous admin actions require a recent confirmation (migration 0008).
// The app calls this with the user's password; only if it is correct does the
// server (service_role) record the confirmation. The database functions then
// allow the action for 20 minutes. Because the user cannot write admin_step_up
// themselves, a borrowed session or a modified client cannot skip this.
//
// Deploy: supabase functions deploy step-up   (JWT verification ON, the default)
import { createClient } from "jsr:@supabase/supabase-js@2";

const URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Small in-memory brake on password guessing per user, on top of Supabase Auth's
// own limits. Resets when the instance recycles; good enough as a second layer.
const fails = new Map<string, { n: number; until: number }>();

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return new Response("sign in first", { status: 401 });

  let password = "";
  try {
    password = (await req.json())?.password ?? "";
  } catch {
    return new Response("bad request", { status: 400 });
  }
  if (typeof password !== "string" || password.length < 1) return new Response("password required", { status: 400 });

  // Who is calling, from their own JWT.
  const asUser = createClient(URL, ANON, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } });
  const { data: { user } } = await asUser.auth.getUser();
  if (!user?.email) return new Response("sign in first", { status: 401 });

  const brake = fails.get(user.id);
  if (brake && brake.n >= 5 && Date.now() < brake.until) {
    return new Response("too many attempts, wait a minute", { status: 429 });
  }

  // Re-check the password on a throwaway client so the real session is untouched.
  const check = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await check.auth.signInWithPassword({ email: user.email, password });
  if (error) {
    const b = fails.get(user.id) ?? { n: 0, until: 0 };
    fails.set(user.id, { n: b.n + 1, until: Date.now() + 60_000 });
    return new Response("incorrect password", { status: 401 });
  }
  fails.delete(user.id);

  const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });
  const { error: upErr } = await admin.from("admin_step_up")
    .upsert({ user_id: user.id, verified_at: new Date().toISOString() });
  if (upErr) {
    console.error("step-up upsert failed", upErr.message);
    return new Response("temporary error", { status: 500 });
  }
  return new Response(JSON.stringify({ ok: true, minutes: 20 }), { headers: { "content-type": "application/json" } });
});
