"use server";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { kickPush } from "@/lib/push";
import { z } from "zod";
import { requireRole } from "@/lib/auth";

type S = { error?: string; ok?: string } | undefined;

// requireRole("super_admin") is the page gate; the RPCs re-check is_super_admin()
// in the database, which is the real authority.
export async function setStatus(f: FormData) {
  const p = z.object({ id: z.string().uuid(), status: z.enum(["active", "suspended", "archived", "pending"]) }).parse(Object.fromEntries(f));
  const { supabase } = await requireRole("super_admin");
  const { error } = await supabase.rpc("set_institution_status", { p_inst: p.id, p_status: p.status });
  if (error) throw new Error(error.message);
  revalidatePath("/super");
}

export async function changePlan(_: S, f: FormData): Promise<S> {
  const p = z.object({
    id: z.string().uuid(), plan: z.string().min(2),
    status: z.enum(["trialing", "active", "past_due", "suspended", "cancelled"]),
    until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }).safeParse(Object.fromEntries(f));
  if (!p.success) return { error: "Choose a plan, status and end date." };
  const { supabase } = await requireRole("super_admin");
  const { error } = await supabase.rpc("change_subscription", {
    p_inst: p.data.id, p_plan_code: p.data.plan, p_status: p.data.status, p_period_end: `${p.data.until}T23:59:59+02:00`,
  });
  revalidatePath("/super");
  return error ? { error: error.message } : { ok: "Subscription updated." };
}

/** An invoice paid by EFT: recorded, and the institution is active for that many more months. */
export async function recordPayment(_: S, f: FormData): Promise<S> {
  const p = z.object({
    id: z.string().uuid(),
    amount: z.coerce.number().min(0).max(100_000_000),
    reference: z.string().trim().min(3, "Enter the invoice or EFT reference.").max(80),
    months: z.coerce.number().int().min(1).max(36),
  }).safeParse(Object.fromEntries(f));
  if (!p.success) return { error: p.error.issues[0].message };
  const { supabase } = await requireRole("super_admin");
  const { data, error } = await supabase.rpc("record_manual_payment", {
    p_inst: p.data.id, p_amount_cents: Math.round(p.data.amount * 100), p_reference: p.data.reference, p_months: p.data.months,
  });
  if (error) return { error: error.code === "PGRST202" ? "Recording payments needs the latest database update (migration 0022)." : error.message };
  revalidatePath("/super");
  const until = new Date((data as { active_until: string }).active_until).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" });
  return { ok: `Payment recorded. Active until ${until}.` };
}

export async function savePlan(_: S, f: FormData): Promise<S> {
  const num = z.union([z.literal(""), z.coerce.number().int().positive()]).transform((v) => (v === "" ? null : v));
  const p = z.object({
    id: z.string().uuid(),
    name: z.string().trim().min(2),
    price: z.union([z.literal(""), z.coerce.number().min(0)]).transform((v) => (v === "" ? null : Math.round(v * 100))),
    billing_interval: z.enum(["month", "year"]),
    max_students: num, max_lecturers: num, max_modules: num,
  }).safeParse(Object.fromEntries(f));
  if (!p.success) return { error: `${p.error.issues[0].path.join(".")}: ${p.error.issues[0].message}` };
  const { supabase } = await requireRole("super_admin");
  const { id, price, ...rest } = p.data;
  const { error } = await supabase.from("subscription_plans").update({ ...rest, price_cents: price }).eq("id", id);
  revalidatePath("/super/plans");
  return error ? { error: error.message } : { ok: "Plan saved." };
}

export async function announce(_: S, f: FormData): Promise<S> {
  const p = z.object({ title: z.string().trim().min(3).max(200), body: z.string().trim().min(3).max(4000),
    audience: z.enum(["all", "students", "lecturers", "admins"]) }).safeParse(Object.fromEntries(f));
  if (!p.success) return { error: p.error.issues[0].message };
  const { supabase, user } = await requireRole("super_admin");
  const { error } = await supabase.from("announcements").insert({ ...p.data, institution_id: null, created_by: user.id });
  if (!error) after(kickPush);
  return error ? { error: error.message } : { ok: "Announcement published to all institutions." };
}
