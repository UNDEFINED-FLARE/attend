"use server";
import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { kickPush } from "@/lib/push";
import { supabaseServer } from "@/lib/supabase/server";

const Prefs = z.object({ classes: z.boolean(), announcements: z.boolean(), attendance: z.boolean() });
const Sub = z.object({
  endpoint: z.string().url().startsWith("https://").max(1000),
  keys: z.object({ p256dh: z.string().min(20).max(200), auth: z.string().min(8).max(100) }),
});

/** Store this device's push subscription for the signed-in person (moves it from any previous account). */
export async function savePushSubscription(raw: unknown, prefs: unknown, userAgent: string): Promise<{ error?: string }> {
  const s = Sub.safeParse(raw), p = Prefs.safeParse(prefs);
  if (!s.success || !p.success) return { error: "This browser gave an unexpected subscription." };
  const supabase = await supabaseServer();
  const { error } = await supabase.rpc("save_push_subscription", {
    p_endpoint: s.data.endpoint, p_p256dh: s.data.keys.p256dh, p_auth: s.data.keys.auth,
    p_user_agent: userAgent.slice(0, 300), p_prefs: p.data,
  });
  if (error) return { error: error.code === "PGRST202" ? "Notifications need the latest database update (migration 0011)." : error.message };
  return {};
}

export async function removePushSubscription(endpoint: string): Promise<void> {
  if (!z.string().url().safeParse(endpoint).success) return;
  const supabase = await supabaseServer();
  await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint);
}

export async function sendTestPush(): Promise<{ error?: string; ok?: string }> {
  const supabase = await supabaseServer();
  const { error } = await supabase.rpc("push_test");
  if (error) return { error: error.message };
  after(kickPush);
  revalidatePath("/notifications");
  return { ok: "Sent. It should appear within a few seconds." };
}

/** Institution admins: post an announcement to students, lecturers, admins or everyone. */
export async function announceToInstitution(_: unknown, f: FormData): Promise<{ error?: string; ok?: string }> {
  const p = z.object({
    title: z.string().trim().min(3, "Give it a title.").max(120),
    body: z.string().trim().min(3, "Write the message.").max(2000),
    audience: z.enum(["all", "students", "lecturers", "admins"]),
  }).safeParse(Object.fromEntries(f));
  if (!p.success) return { error: p.error.issues[0].message };
  const { supabase, institutionId, user } = await requireRole("institution_admin");
  const { error } = await supabase.from("announcements").insert({ ...p.data, institution_id: institutionId, created_by: user.id });
  if (error) return { error: error.message };
  after(kickPush);
  return { ok: `Sent to ${p.data.audience === "all" ? "everyone" : p.data.audience}. Phones with notifications on get it now.` };
}
