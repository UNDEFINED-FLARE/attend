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

/** Institution admins: an announcement to everyone, a group, a module or one person. */
export async function announceToInstitution(_: unknown, f: FormData): Promise<{ error?: string; ok?: string }> {
  const p = z.object({
    title: z.string().trim().min(3, "Give it a title.").max(120),
    body: z.string().trim().min(3, "Write the message.").max(2000),
    audience: z.enum(["all", "students", "lecturers", "admins"]),
    category: z.enum(["announcement", "academic", "system", "class_cancelled", "venue_change", "class_reminder", "timetable_change"]).default("announcement"),
    target_kind: z.enum(["all", "faculty", "department", "module", "student", "lecturer"]).default("all"),
    target_id: z.string().uuid().optional(),
    student_number: z.string().trim().max(32).optional(),
  }).safeParse({ ...Object.fromEntries(f), target_id: f.get("target_id") || undefined, student_number: f.get("student_number") || undefined });
  if (!p.success) return { error: p.error.issues[0].message };
  const { supabase, institutionId, user } = await requireRole("institution_admin");
  let targetId: string | null = null;
  const { target_kind, student_number, target_id, ...rest } = p.data;
  if (target_kind === "student") {
    if (!student_number) return { error: "Enter the student number." };
    const { data: st } = await supabase.from("students").select("id").eq("institution_id", institutionId).ilike("student_number", student_number).is("deleted_at", null).maybeSingle();
    if (!st) return { error: "No student with that number." };
    targetId = st.id;
  } else if (target_kind !== "all") {
    if (!target_id) return { error: "Choose who it goes to." };
    targetId = target_id;
  }
  const { data: me } = await supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle();
  const row = { ...rest, institution_id: institutionId, created_by: user.id, target_kind, target_id: targetId, sender_name: me?.full_name || null };
  let { error } = await supabase.from("announcements").insert(row);
  if (error?.code === "PGRST204" && target_kind === "all") {
    // targeting needs database update 0018; plain announcements still work before it
    ({ error } = await supabase.from("announcements").insert({ title: rest.title, body: rest.body, audience: rest.audience, institution_id: institutionId, created_by: user.id }));
  } else if (error?.code === "PGRST204") {
    return { error: "Targeted announcements need the latest database update (migration 0018)." };
  }
  if (error) return { error: error.message };
  after(kickPush);
  return { ok: "Sent. People with notifications on get it on their phone now." };
}

/** A lecturer's message to the students of one of their modules. */
export async function sendClassMessage(_: unknown, f: FormData): Promise<{ error?: string; ok?: string }> {
  const p = z.object({
    module: z.string().uuid(),
    category: z.enum(["announcement", "class_cancelled", "venue_change", "class_reminder", "timetable_change"]),
    title: z.string().trim().min(3, "Give it a title.").max(150),
    body: z.string().trim().min(3, "Write the message.").max(2000),
  }).safeParse(Object.fromEntries(f));
  if (!p.success) return { error: p.error.issues[0].message };
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("send_class_message", { p_module: p.data.module, p_category: p.data.category, p_title: p.data.title, p_body: p.data.body });
  if (error) return { error: error.code === "PGRST202" ? "Class messages need the latest database update (migration 0018)." : error.message };
  after(kickPush);
  const n = data as number;
  return { ok: `Sent to ${n} student${n === 1 ? "" : "s"}. Those with notifications on get it on their phone now.` };
}
